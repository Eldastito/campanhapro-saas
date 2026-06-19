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
import { fireOrchestration } from '../../../lib/orchestrationTriggers';
import {
  generatePkce, buildXAuthorizeUrl, exchangeXCodeForToken,
} from '../../../lib/socialSyncX';
import {
  buildLinkedInAuthorizeUrl, exchangeLinkedInCode,
} from '../../../lib/socialSyncLinkedIn';
import { fetchKwaiPublicProfile } from '../../../lib/socialSyncKwai';
import { runSocialSync, SyncProvider } from '../../../lib/socialSyncRunner';
import {
  resolveInstagram, businessDiscovery, fetchOwnMediaWithComments,
  type DiscoveryResult,
} from '../integrations/instagramGraphClient';
import { callAgent } from '../../../lib/aiCallAgent';
import { ingestArtifact } from '../rag/knowledgeIngest';

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

  // ── SYNC: delega pro runner compartilhado (também usado pelo worker noturno)
  router.post('/sync/:provider', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
      if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

      const provider = req.params.provider as SyncProvider;
      if (!VALID_SYNC_PROVIDERS.has(provider)) {
        return res.status(400).json({ error: 'provider_invalid' });
      }

      const result = await runSocialSync(supabase, campaignId, provider);
      return res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error('[social] sync:', err);
      const msg = err?.message || 'sync_failed';
      const status = msg === 'not_connected' ? 404 : msg === 'handle_nao_configurado' ? 400 : 500;
      return res.status(status).json({ error: msg });
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

  // ── HISTORY: manager_runs com source LIKE 'social_%' (cenários gerados) ──
  router.get('/history', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    const { data, error } = await supabase
      .from('manager_runs')
      .select('id, intent, "finalSummary", iterations, status, "startedAt", "finishedAt", source')
      .eq('campaignId', campaignId)
      .like('source', 'social%')
      .order('startedAt', { ascending: false })
      .limit(30);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ runs: data || [] });
  });

  // ── LAST CHANGE: o que o sync noturno detectou na campanha ───────────
  router.get('/last-change', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    const { data } = await supabase.from('social_sync_log')
      .select('lastSyncedDate, lastSyncedAt, lastChangeDetected')
      .eq('campaignId', campaignId)
      .maybeSingle();
    return res.json(data || {});
  });

  // ════════════════════════════════════════════════════════════════════
  // INSTAGRAM — inteligência social (Business Discovery + comentários próprios)
  // ════════════════════════════════════════════════════════════════════

  // GET /instagram/status — conta IG conectada? (lê a conexão da aba Conexões,
  // que grava provider='meta'. Conectar/desconectar é SÓ lá — fonte única.)
  router.get('/instagram/status', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    const conn = await resolveInstagram(supabase, campaignId);
    return res.json({ connected: !!conn, igUserId: conn?.igUserId ?? null, username: conn?.username ?? null });
  });

  // ── WATCHLIST de páginas de bairro ────────────────────────────────────
  router.get('/watchlist', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    const { data, error } = await supabase.from('social_watchlist')
      .select('id, username, label, bairro, "lastSnapshot", "createdAt"')
      .eq('campaignId', campaignId).order('createdAt', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ watchlist: data ?? [] });
  });

  router.post('/watchlist', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    const { username, label, bairro } = req.body as { username?: string; label?: string; bairro?: string };
    const handle = (username || '').replace(/^@/, '').trim();
    if (!handle) return res.status(400).json({ error: 'username required' });
    // Username válido do Instagram (anti-injeção; mesmo padrão do graph client).
    if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return res.status(400).json({ error: 'invalid_username' });
    const { data, error } = await supabase.from('social_watchlist')
      .upsert({ campaignId, username: handle, label: label ?? null, bairro: bairro ?? null }, { onConflict: 'campaignId,username' })
      .select('id, username, label, bairro').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data ?? {});
  });

  router.delete('/watchlist/:id', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    const { error } = await supabase.from('social_watchlist')
      .delete().eq('campaignId', campaignId).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  // POST /instagram/pulse — "Pulso dos Bairros": roda Business Discovery em cada
  // página da watchlist, junta posts (legenda + engajamento) e a IA rankeia os
  // TEMAS QUENTES por bairro. Sem texto de comentário de terceiros (a Meta não dá).
  router.post('/instagram/pulse', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    const conn = await resolveInstagram(supabase, campaignId);
    if (!conn) return res.status(400).json({ error: 'ig_not_connected' });

    const { data: wl } = await supabase.from('social_watchlist')
      .select('id, username, label, bairro').eq('campaignId', campaignId);
    if (!wl?.length) return res.status(400).json({ error: 'watchlist_empty' });

    const pages: Array<{ username: string; label: string | null; bairro: string | null; discovery?: DiscoveryResult; error?: string }> = [];
    for (const w of wl) {
      try {
        const d = await businessDiscovery(conn, w.username, 12);
        pages.push({ username: w.username, label: w.label, bairro: w.bairro, discovery: d });
        await supabase.from('social_watchlist')
          .update({ lastSnapshot: { at: new Date().toISOString(), followers: d.followersCount, topPostComments: Math.max(0, ...d.posts.map(p => p.commentsCount)) } })
          .eq('id', w.id);
      } catch (err: any) {
        pages.push({ username: w.username, label: w.label, bairro: w.bairro, error: String(err?.message ?? err) });
      }
    }

    // Monta o material pra IA: posts mais comentados de cada página.
    const material = pages.filter(p => p.discovery).map((p) => {
      const top = [...p.discovery!.posts].sort((a, b) => b.commentsCount - a.commentsCount).slice(0, 6);
      return `### ${p.label || p.username} (@${p.username}${p.bairro ? `, ${p.bairro}` : ''}) — ${p.discovery!.followersCount} seguidores\n` +
        top.map(t => `- [${t.commentsCount} coment., ${t.likeCount} likes] ${(t.caption || '(sem legenda)').slice(0, 220).replace(/\n/g, ' ')}`).join('\n');
    }).join('\n\n');

    let temas = '';
    if (material.trim()) {
      try {
        const result = await callAgent(supabase, 'competitive_intel',
          `Abaixo, posts recentes de páginas de bairro (com nº de comentários como proxy de engajamento). ` +
          `Identifique os TEMAS/DORES mais quentes POR BAIRRO, do mais inflamado pro menos, citando a página. ` +
          `Diga o sentimento provável (positivo/negativo/cobrança) e uma sugestão de ação pra campanha. ` +
          `Responda em markdown PT-BR, conciso.\n\n${material}`,
          {
            campaignId, userId: (req as any).user?.id ?? null,
            systemInstruction: 'Você é analista de inteligência social de campanha. Não invente: trabalhe só com o material dado. Engajamento alto = tema quente.',
            complexity: 'balanced', maxTokens: 1800,
          });
        temas = result.text || '';
        await ingestArtifact(supabase, {
          campaignId, source: 'agent:bairro-pulse',
          title: 'Pulso dos bairros (Instagram)', text: temas,
          metadata: { kind: 'bairro_pulse', pages: pages.map(p => p.username) },
        }).catch(() => {});
      } catch { /* devolve só os dados crus se a IA falhar */ }
    }

    return res.json({ pages, temas });
  });

  // GET /instagram/own-comments — comentários (COM texto) dos posts do próprio
  // candidato + análise de sentimento/temas pela IA. A API libera por completo.
  router.get('/instagram/own-comments', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    const conn = await resolveInstagram(supabase, campaignId);
    if (!conn) return res.status(400).json({ error: 'ig_not_connected' });
    try {
      const media = await fetchOwnMediaWithComments(conn, 8, 30);
      const allComments = media.flatMap(m => m.comments.map(c => c.text)).filter(Boolean);
      let analysis = '';
      if (allComments.length) {
        const sample = allComments.slice(0, 120).map(t => `- ${t.slice(0, 180).replace(/\n/g, ' ')}`).join('\n');
        try {
          const result = await callAgent(supabase, 'competitive_intel',
            `Comentários reais nos posts do candidato. Faça: (1) sentimento geral (% aprox. positivo/negativo/neutro), ` +
            `(2) 5 temas/dores mais citados, (3) comentários que pedem resposta urgente (crise), ` +
            `(4) 2 sugestões de pauta. Markdown PT-BR conciso.\n\n${sample}`,
            {
              campaignId, userId: (req as any).user?.id ?? null,
              systemInstruction: 'Analista de comunidade de campanha. Trabalhe só com os comentários dados; não invente.',
              complexity: 'balanced', maxTokens: 1500,
            });
          analysis = result.text || '';
        } catch { /* devolve crus */ }
      }
      return res.json({ media, totalComments: allComments.length, analysis });
    } catch (err: any) {
      return res.status(502).json({ error: 'ig_fetch_failed', detail: String(err?.message ?? err) });
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

