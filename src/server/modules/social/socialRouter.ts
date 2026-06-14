/**
 * Social Router (#123) — conectar X / LinkedIn / Kwai + sync de métricas.
 *
 * Fluxo OAuth (X e LinkedIn):
 *   1. Frontend chama POST /connect/:provider/start (autenticado)
 *      → backend gera state CSRF + PKCE, salva em `social_oauth_state`,
 *        devolve { authorizeUrl }.
 *   2. Frontend window.location = authorizeUrl. Usuário autoriza no provedor.
 *   3. Provedor redireciona pra REDIRECT_URI (uma rota do FRONTEND, tipo
 *      /oauth/x/callback). A página do frontend lê code+state da URL e chama
 *      POST /connect/:provider/callback (autenticado) passando { code, state }.
 *   4. Backend valida state, troca code por token, persiste em `social_tokens`.
 *
 * Kwai (sem OAuth):
 *   - POST /connect/kwai com { handleOrUrl } salva em social_tokens
 *     (provider='kwai', token='public', settings.handle=...).
 *
 * Sync:
 *   - POST /sync/:provider — busca métricas, salva em social_metrics_daily,
 *     indexa snapshot no RAG.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestArtifact } from '../rag/knowledgeIngest';
import { fireOrchestration } from '../../../lib/orchestrationTriggers';
import {
  generatePkce, buildXAuthorizeUrl, exchangeXCodeForToken,
  refreshXToken, fetchXSnapshot,
} from '../../../lib/socialSyncX';
import {
  buildLinkedInAuthorizeUrl, exchangeLinkedInCode,
  refreshLinkedInToken, fetchLinkedInSnapshot,
} from '../../../lib/socialSyncLinkedIn';
import { fetchKwaiPublicProfile } from '../../../lib/socialSyncKwai';

const VALID_OAUTH_PROVIDERS = new Set(['x', 'linkedin']);
const VALID_SYNC_PROVIDERS = new Set(['x', 'linkedin', 'kwai']);

function isAdmin(req: Request): boolean {
  const t = (req as any).user?.type;
  return t === 'Admin' || t === 'Coordenador';
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`env_missing:${name}`);
  return v;
}

export function createSocialRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // ── STATUS ────────────────────────────────────────────────────────────
  router.get('/status', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    const { data, error } = await supabase
      .from('social_tokens')
      .select('provider, expires_at, settings, "updatedAt"')
      .eq('campaignId', campaignId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ connections: data || [] });
  });

  // ── METRICS HISTORY ───────────────────────────────────────────────────
  router.get('/metrics/:provider', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    const { provider } = req.params;
    const { data, error } = await supabase
      .from('social_metrics_daily')
      .select('*')
      .eq('campaignId', campaignId)
      .eq('provider', provider)
      .order('snapshotDate', { ascending: false })
      .limit(30);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ metrics: data || [] });
  });

  // ── OAUTH START ───────────────────────────────────────────────────────
  router.post('/connect/:provider/start', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      const userId = (req as any).user?.id;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
      if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

      const provider = req.params.provider;
      if (!VALID_OAUTH_PROVIDERS.has(provider)) {
        return res.status(400).json({ error: 'provider_invalid' });
      }

      const state = crypto.randomBytes(24).toString('base64url');
      let authorizeUrl = '';
      let codeVerifier: string | null = null;

      if (provider === 'x') {
        const clientId = getEnv('X_CLIENT_ID');
        const redirectUri = getEnv('X_OAUTH_REDIRECT');
        const pkce = generatePkce();
        codeVerifier = pkce.codeVerifier;
        authorizeUrl = buildXAuthorizeUrl({
          clientId, redirectUri, state, codeChallenge: pkce.codeChallenge,
        });
      } else if (provider === 'linkedin') {
        const clientId = getEnv('LINKEDIN_CLIENT_ID');
        const redirectUri = getEnv('LINKEDIN_OAUTH_REDIRECT');
        authorizeUrl = buildLinkedInAuthorizeUrl({ clientId, redirectUri, state });
      }

      const { error } = await supabase.from('social_oauth_state').insert({
        state, campaignId, userId, provider, codeVerifier,
      });
      if (error) return res.status(500).json({ error: error.message });

      return res.json({ authorizeUrl, state });
    } catch (err: any) {
      console.error('[social] start:', err);
      return res.status(500).json({ error: err?.message || 'start_failed' });
    }
  });

  // ── OAUTH CALLBACK ────────────────────────────────────────────────────
  router.post('/connect/:provider/callback', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
      if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

      const provider = req.params.provider;
      if (!VALID_OAUTH_PROVIDERS.has(provider)) {
        return res.status(400).json({ error: 'provider_invalid' });
      }

      const { code, state } = req.body || {};
      if (!code || !state) return res.status(400).json({ error: 'missing_params' });

      // Valida state (CSRF + escopo de campanha)
      const { data: stateRow } = await supabase
        .from('social_oauth_state')
        .select('*')
        .eq('state', state)
        .maybeSingle();
      if (!stateRow) return res.status(400).json({ error: 'state_invalid_or_expired' });
      if ((stateRow as any).campaignId !== campaignId) {
        return res.status(403).json({ error: 'campaign_mismatch' });
      }
      if (new Date((stateRow as any).expiresAt).getTime() < Date.now()) {
        return res.status(400).json({ error: 'state_expired' });
      }

      let tokenResp: { access_token: string; refresh_token?: string; expires_in: number };

      if (provider === 'x') {
        tokenResp = await exchangeXCodeForToken({
          clientId: getEnv('X_CLIENT_ID'),
          clientSecret: getEnv('X_CLIENT_SECRET'),
          code, redirectUri: getEnv('X_OAUTH_REDIRECT'),
          codeVerifier: (stateRow as any).codeVerifier,
        });
      } else {
        tokenResp = await exchangeLinkedInCode({
          clientId: getEnv('LINKEDIN_CLIENT_ID'),
          clientSecret: getEnv('LINKEDIN_CLIENT_SECRET'),
          code, redirectUri: getEnv('LINKEDIN_OAUTH_REDIRECT'),
        });
      }

      const expiresAt = new Date(Date.now() + (tokenResp.expires_in || 3600) * 1000).toISOString();

      const { error: upsertErr } = await supabase.from('social_tokens').upsert({
        campaignId,
        provider,
        access_token: tokenResp.access_token,
        refresh_token: tokenResp.refresh_token || null,
        expires_at: expiresAt,
        settings: {},
        updatedAt: new Date().toISOString(),
      }, { onConflict: 'campaignId,provider' });
      if (upsertErr) return res.status(500).json({ error: upsertErr.message });

      // Consome o state (one-time)
      await supabase.from('social_oauth_state').delete().eq('state', state);

      return res.json({ ok: true, provider, expiresAt });
    } catch (err: any) {
      console.error('[social] callback:', err);
      return res.status(500).json({ error: err?.message || 'callback_failed' });
    }
  });

  // ── KWAI: salva handle público (sem OAuth) ────────────────────────────
  router.post('/connect/kwai', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
      if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

      const handleOrUrl = String((req.body || {}).handleOrUrl || '').trim();
      if (!handleOrUrl) return res.status(400).json({ error: 'handle_required' });

      // Faz uma busca preview pra confirmar que o handle é válido
      const preview = await fetchKwaiPublicProfile(handleOrUrl).catch((err) => {
        throw new Error(`preview_falhou:${err.message}`);
      });

      const { error } = await supabase.from('social_tokens').upsert({
        campaignId,
        provider: 'kwai',
        access_token: 'public', // placeholder — Kwai não usa token
        refresh_token: null,
        expires_at: null,
        settings: { handle: preview.handle, profileUrl: preview.profileUrl },
        updatedAt: new Date().toISOString(),
      }, { onConflict: 'campaignId,provider' });
      if (error) return res.status(500).json({ error: error.message });

      return res.json({ ok: true, handle: preview.handle, profileUrl: preview.profileUrl });
    } catch (err: any) {
      console.error('[social] kwai connect:', err);
      return res.status(500).json({ error: err?.message || 'kwai_connect_failed' });
    }
  });

  // ── DISCONNECT ────────────────────────────────────────────────────────
  router.delete('/connect/:provider', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });
    const { provider } = req.params;
    if (!VALID_SYNC_PROVIDERS.has(provider)) return res.status(400).json({ error: 'provider_invalid' });
    const { error } = await supabase.from('social_tokens')
      .delete().eq('campaignId', campaignId).eq('provider', provider);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  // ── SYNC: pega métricas, persiste em social_metrics_daily, indexa no RAG
  router.post('/sync/:provider', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
      if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

      const provider = req.params.provider;
      if (!VALID_SYNC_PROVIDERS.has(provider)) {
        return res.status(400).json({ error: 'provider_invalid' });
      }

      const { data: token } = await supabase
        .from('social_tokens')
        .select('*')
        .eq('campaignId', campaignId)
        .eq('provider', provider)
        .maybeSingle();
      if (!token) return res.status(404).json({ error: 'not_connected' });

      const todayIso = new Date().toISOString().slice(0, 10);
      let metricsRow: any = null;
      let snapshotText = '';
      let snapshotTitle = '';

      if (provider === 'x') {
        let accessToken = (token as any).access_token;
        // Refresh se expirado
        const expiresAt = (token as any).expires_at ? new Date((token as any).expires_at).getTime() : 0;
        if (expiresAt && expiresAt < Date.now() + 60_000 && (token as any).refresh_token) {
          const refreshed = await refreshXToken({
            clientId: getEnv('X_CLIENT_ID'),
            clientSecret: getEnv('X_CLIENT_SECRET'),
            refreshToken: (token as any).refresh_token,
          });
          accessToken = refreshed.access_token;
          await supabase.from('social_tokens').update({
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token || (token as any).refresh_token,
            expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
            updatedAt: new Date().toISOString(),
          }).eq('campaignId', campaignId).eq('provider', 'x');
        }

        const snap = await fetchXSnapshot(accessToken);
        metricsRow = {
          campaignId, provider: 'x', snapshotDate: todayIso,
          handle: snap.username,
          followers: snap.followers, following: snap.following,
          postsCount: snap.postsCount,
          impressions7d: snap.recentTweets.reduce((s, t) => s + (t.impressionCount || 0), 0) || null,
          engagement7d: snap.recentTweets.reduce((s, t) => s + (t.likeCount + t.retweetCount + t.replyCount), 0) || null,
          topPosts: snap.recentTweets.slice(0, 5),
          raw: snap.raw,
        };
        snapshotTitle = `X (Twitter) snapshot — @${snap.username} em ${todayIso}`;
        snapshotText = renderXSnapshotForRag(snap);
      }

      else if (provider === 'linkedin') {
        let accessToken = (token as any).access_token;
        const expiresAt = (token as any).expires_at ? new Date((token as any).expires_at).getTime() : 0;
        if (expiresAt && expiresAt < Date.now() + 60_000 && (token as any).refresh_token) {
          const refreshed = await refreshLinkedInToken({
            clientId: getEnv('LINKEDIN_CLIENT_ID'),
            clientSecret: getEnv('LINKEDIN_CLIENT_SECRET'),
            refreshToken: (token as any).refresh_token,
          });
          accessToken = refreshed.access_token;
          await supabase.from('social_tokens').update({
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token || (token as any).refresh_token,
            expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
            updatedAt: new Date().toISOString(),
          }).eq('campaignId', campaignId).eq('provider', 'linkedin');
        }

        const snap = await fetchLinkedInSnapshot(accessToken);
        const totalFollowers = snap.organizations.reduce((s, o) => s + (o.followers || 0), 0) || null;
        metricsRow = {
          campaignId, provider: 'linkedin', snapshotDate: todayIso,
          handle: snap.profile.name,
          followers: totalFollowers,
          following: null, postsCount: null,
          impressions7d: null, engagement7d: null,
          topPosts: snap.organizations.flatMap(o => o.sharePosts.slice(0, 3)),
          raw: snap.raw,
        };
        snapshotTitle = `LinkedIn snapshot — ${snap.profile.name} em ${todayIso}`;
        snapshotText = renderLinkedInSnapshotForRag(snap);
      }

      else if (provider === 'kwai') {
        const handle = (token as any).settings?.handle || (token as any).settings?.profileUrl;
        if (!handle) return res.status(400).json({ error: 'handle_nao_configurado' });
        const snap = await fetchKwaiPublicProfile(handle);
        metricsRow = {
          campaignId, provider: 'kwai', snapshotDate: todayIso,
          handle: snap.handle,
          followers: snap.followers, following: snap.following,
          postsCount: snap.videosCount,
          impressions7d: null, engagement7d: null,
          topPosts: null,
          raw: { displayName: snap.displayName, bio: snap.bio, profileUrl: snap.profileUrl },
        };
        snapshotTitle = `Kwai snapshot — @${snap.handle} em ${todayIso}`;
        snapshotText = renderKwaiSnapshotForRag(snap);
      }

      if (!metricsRow) return res.status(500).json({ error: 'sync_no_data' });

      // Persiste (upsert pelo unique (campaignId, provider, snapshotDate))
      const { error: insertErr } = await supabase
        .from('social_metrics_daily')
        .upsert(metricsRow, { onConflict: 'campaignId,provider,snapshotDate' });
      if (insertErr) {
        console.warn('[social] upsert metrics falhou:', insertErr.message);
      }

      // Indexa no RAG (best-effort — não bloqueia)
      void ingestArtifact(supabase, {
        campaignId,
        source: `social:${provider}`,
        title: snapshotTitle,
        text: snapshotText,
        metadata: { provider, snapshotDate: todayIso, hasPrimarySources: true,
                    primarySources: [{ url: (token as any).settings?.profileUrl || null, title: snapshotTitle }] },
      });

      return res.json({ ok: true, provider, snapshotDate: todayIso, metrics: metricsRow });
    } catch (err: any) {
      console.error('[social] sync:', err);
      return res.status(500).json({ error: err?.message || 'sync_failed' });
    }
  });

  // ── ANALYZE: dispara orquestrador em background, retorna 200 imediato ──
  router.post('/analyze', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
      if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

      const intent = (req.body || {}).intent
        || 'Analisar as redes sociais conectadas do candidato (X, LinkedIn, Kwai, Meta). '
          + 'Compare métricas vs. dias anteriores, identifique tendências (crescimento de seguidores, picos de engajamento, '
          + 'posts virais), pautas que estão funcionando, comparativo competitivo com adversários, e proponha cenários de ação '
          + '(o que postar amanhã, qual rede priorizar, ajustes de tom). Use os snapshots indexados no RAG (source=social:*).';

      // fire-and-forget — orquestrador roda em background
      fireOrchestration(supabase, {
        campaignId,
        intent,
        source: 'social_connections_hub',
      });

      return res.json({ ok: true, queued: true });
    } catch (err: any) {
      console.error('[social] analyze:', err);
      return res.status(500).json({ error: err?.message || 'analyze_failed' });
    }
  });

  // ── CLEANUP: limpa states expirados (chamado pelo routinesWorker) ─────
  router.post('/cleanup-expired-state', async (_req: Request, res: Response) => {
    const { error } = await supabase.from('social_oauth_state')
      .delete().lt('expiresAt', new Date().toISOString());
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  return router;
}

// ── Renderizadores para o RAG (texto humano-friendly) ───────────────────

function renderXSnapshotForRag(snap: any): string {
  const lines = [
    `Perfil do candidato no X (ex-Twitter):`,
    `- @${snap.username} (${snap.name})`,
    `- Seguidores: ${snap.followers ?? 'desconhecido'} | Seguindo: ${snap.following ?? 'desconhecido'}`,
    `- Total de posts: ${snap.postsCount ?? 'desconhecido'}`,
    snap.bio ? `- Bio: ${snap.bio}` : null,
  ].filter(Boolean);
  if (snap.recentTweets?.length) {
    lines.push('\nÚltimos posts e métricas:');
    snap.recentTweets.slice(0, 5).forEach((t: any, i: number) => {
      lines.push(`${i + 1}. "${t.text.slice(0, 140)}" — ❤️ ${t.likeCount} 🔁 ${t.retweetCount} 💬 ${t.replyCount}${t.impressionCount ? ` 👁️ ${t.impressionCount}` : ''}`);
    });
  }
  return lines.join('\n');
}

function renderLinkedInSnapshotForRag(snap: any): string {
  const lines = [
    `Perfil do candidato no LinkedIn:`,
    `- Nome: ${snap.profile.name}`,
    snap.profile.headline ? `- Posição: ${snap.profile.headline}` : null,
    snap.profile.email ? `- E-mail registrado: ${snap.profile.email}` : null,
  ].filter(Boolean);
  if (snap.organizations?.length) {
    lines.push('\nPáginas LinkedIn administradas pelo candidato:');
    snap.organizations.forEach((o: any) => {
      lines.push(`- ${o.name}: ${o.followers ?? 'sem dado'} seguidores`);
    });
  } else {
    lines.push('\nNenhuma Company Page administrada (ou sem aprovação Marketing Developer).');
  }
  return lines.join('\n');
}

function renderKwaiSnapshotForRag(snap: any): string {
  const lines = [
    `Perfil público do candidato no Kwai:`,
    `- @${snap.handle} (${snap.displayName ?? 'sem nome'})`,
    `- URL: ${snap.profileUrl}`,
    `- Seguidores: ${snap.followers ?? 'desconhecido'} | Seguindo: ${snap.following ?? 'desconhecido'}`,
    `- Vídeos publicados: ${snap.videosCount ?? 'desconhecido'}`,
    snap.bio ? `- Bio: ${snap.bio}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}
