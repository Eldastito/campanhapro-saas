/**
 * Runner de sync de redes sociais (#124) — função pura reusada por:
 *   - Endpoint POST /api/v1/social/sync/:provider (manual)
 *   - Job noturno tickSocialSync() no routinesWorker (automatizado)
 *
 * Não faz auth/quota — quem chama é responsável. Faz:
 *   1. Refresh OAuth se token expirado
 *   2. Chama a API do provedor
 *   3. Persiste em social_metrics_daily (upsert por (campaignId, provider, date))
 *   4. Indexa snapshot textual no RAG (source=social:<provider>)
 *
 * Retorna o snapshot bruto e a linha persistida.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { refreshXToken, fetchXSnapshot } from './socialSyncX';
import { refreshLinkedInToken, fetchLinkedInSnapshot } from './socialSyncLinkedIn';
import { fetchKwaiPublicProfile } from './socialSyncKwai';
import { ingestArtifact } from '../server/modules/rag/knowledgeIngest';

export type SyncProvider = 'x' | 'linkedin' | 'kwai';

export interface SyncResult {
  provider: SyncProvider;
  snapshotDate: string;
  metricsRow: Record<string, any>;
  snapshotTitle: string;
  snapshotText: string;
}

function envOrNull(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v : null;
}

export async function runSocialSync(
  supabase: SupabaseClient,
  campaignId: string,
  provider: SyncProvider,
): Promise<SyncResult> {
  const { data: token } = await supabase
    .from('social_tokens')
    .select('*')
    .eq('campaignId', campaignId)
    .eq('provider', provider)
    .maybeSingle();
  if (!token) throw new Error('not_connected');

  const todayIso = new Date().toISOString().slice(0, 10);
  let metricsRow: any = null;
  let snapshotText = '';
  let snapshotTitle = '';

  if (provider === 'x') {
    let accessToken = (token as any).access_token;
    const expiresAt = (token as any).expires_at ? new Date((token as any).expires_at).getTime() : 0;
    const clientId = envOrNull('X_CLIENT_ID');
    const clientSecret = envOrNull('X_CLIENT_SECRET');
    if (expiresAt && expiresAt < Date.now() + 60_000 && (token as any).refresh_token && clientId && clientSecret) {
      const refreshed = await refreshXToken({
        clientId, clientSecret, refreshToken: (token as any).refresh_token,
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
  } else if (provider === 'linkedin') {
    let accessToken = (token as any).access_token;
    const expiresAt = (token as any).expires_at ? new Date((token as any).expires_at).getTime() : 0;
    const clientId = envOrNull('LINKEDIN_CLIENT_ID');
    const clientSecret = envOrNull('LINKEDIN_CLIENT_SECRET');
    if (expiresAt && expiresAt < Date.now() + 60_000 && (token as any).refresh_token && clientId && clientSecret) {
      const refreshed = await refreshLinkedInToken({
        clientId, clientSecret, refreshToken: (token as any).refresh_token,
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
  } else if (provider === 'kwai') {
    const handle = (token as any).settings?.handle || (token as any).settings?.profileUrl;
    if (!handle) throw new Error('handle_nao_configurado');
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

  if (!metricsRow) throw new Error('sync_no_data');

  await supabase.from('social_metrics_daily')
    .upsert(metricsRow, { onConflict: 'campaignId,provider,snapshotDate' });

  void ingestArtifact(supabase, {
    campaignId,
    source: `social:${provider}`,
    title: snapshotTitle,
    text: snapshotText,
    metadata: {
      provider, snapshotDate: todayIso, hasPrimarySources: true,
      primarySources: [{ url: (token as any).settings?.profileUrl || null, title: snapshotTitle }],
    },
  });

  return { provider, snapshotDate: todayIso, metricsRow, snapshotTitle, snapshotText };
}

// ── Detecção de mudança significativa entre hoje e ontem ────────────────

export interface SignificantChange {
  campaignId: string;
  reasons: string[];
  summary: string;
}

const FOLLOWER_DELTA_THRESHOLD = 0.20;     // 20% mudança em followers
const ENGAGEMENT_DELTA_THRESHOLD = 0.50;   // 50% mudança em engagement
const VIRAL_MULTIPLIER = 5;                // post c/ engajamento >5x média

/**
 * Compara métricas de hoje vs ontem (mesmo provider) e detecta:
 *   - Salto/queda de followers (≥20%)
 *   - Salto/queda de engagement7d (≥50%)
 *   - Post viral (top post c/ engajamento >5x média do feed)
 */
export async function detectSignificantChange(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<SignificantChange | null> {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  const { data: rows } = await supabase
    .from('social_metrics_daily')
    .select('provider, "snapshotDate", followers, "engagement7d", "topPosts"')
    .eq('campaignId', campaignId)
    .in('snapshotDate', [today, yesterday]);

  if (!rows?.length) return null;

  const byProvider = new Map<string, { today?: any; yesterday?: any }>();
  for (const r of rows as any[]) {
    const slot = byProvider.get(r.provider) || {};
    if (r.snapshotDate === today) slot.today = r;
    else if (r.snapshotDate === yesterday) slot.yesterday = r;
    byProvider.set(r.provider, slot);
  }

  const reasons: string[] = [];

  for (const [provider, { today: t, yesterday: y }] of byProvider) {
    if (!t) continue;
    if (y && y.followers != null && t.followers != null && y.followers > 0) {
      const delta = (t.followers - y.followers) / y.followers;
      if (Math.abs(delta) >= FOLLOWER_DELTA_THRESHOLD) {
        const dir = delta > 0 ? 'aumento' : 'queda';
        reasons.push(`${provider}: ${dir} de ${(delta * 100).toFixed(1)}% nos seguidores (${y.followers} → ${t.followers})`);
      }
    }
    if (y && y.engagement7d != null && t.engagement7d != null && y.engagement7d > 0) {
      const delta = (t.engagement7d - y.engagement7d) / y.engagement7d;
      if (Math.abs(delta) >= ENGAGEMENT_DELTA_THRESHOLD) {
        const dir = delta > 0 ? 'salto' : 'queda';
        reasons.push(`${provider}: ${dir} de ${(delta * 100).toFixed(1)}% no engajamento (7d)`);
      }
    }
    if (Array.isArray(t.topPosts) && t.topPosts.length >= 3) {
      const engs = t.topPosts.map((p: any) =>
        (p.likeCount || 0) + (p.retweetCount || 0) + (p.replyCount || 0),
      ).filter((n: number) => n > 0);
      if (engs.length >= 3) {
        const avg = engs.reduce((s: number, n: number) => s + n, 0) / engs.length;
        const max = Math.max(...engs);
        if (max >= avg * VIRAL_MULTIPLIER && max > 50) {
          reasons.push(`${provider}: post viral (${max} interações, ${(max / avg).toFixed(1)}x acima da média)`);
        }
      }
    }
  }

  if (!reasons.length) return null;

  return {
    campaignId,
    reasons,
    summary: reasons.join('; '),
  };
}

// ── Renderizadores RAG (movidos do router) ─────────────────────────────

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
