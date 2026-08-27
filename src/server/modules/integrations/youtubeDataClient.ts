/**
 * YouTube Data API v3 client — leitura de channel + videos + comments.
 *
 * NÃO cobre Analytics API (watch time, retention, subscriber gain/loss) —
 * esse é PR futuro (exige OAuth com escopo yt-analytics.readonly + projeto
 * GCP separado). Aqui: só leitura pública do CanalOfficial + videos do
 * candidato + comments dos videos dele.
 *
 * DOIS modos de autenticação:
 *   - API KEY (`apiKey` no `YtAuth`): funciona pra QUALQUER endpoint público —
 *     channel snippet, videos list, comments. Não precisa OAuth. Perfeito
 *     pra MVP.
 *   - ACCESS TOKEN (`accessToken` no `YtAuth`): OAuth 2.0 token. Necessário
 *     pra endpoints privados (uploads não-listados, playlists privadas,
 *     Analytics API). PR futuro.
 *
 * Ambos usam o mesmo endpoint; a diferença é passar `?key=...` vs
 * `Authorization: Bearer ...`.
 *
 * Rate limits: 10.000 units/dia na API v3 (default). Cada endpoint tem custo
 * diferente — `channels.list` = 1 unit, `search.list` = 100 units,
 * `videos.list` = 1 unit, `commentThreads.list` = 1 unit. Usamos os baratos.
 */

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';

export type YtAuth = { apiKey: string } | { accessToken: string };

export interface YtChannelSnapshot {
  channelId: string;
  title: string | null;
  description: string | null;
  customUrl: string | null;
  publishedAt: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  viewCount: number | null;
  thumbnailUrl: string | null;
  hiddenSubscriberCount: boolean;
}

export interface YtVideo {
  id: string;
  channelId: string;
  title: string;
  description: string;
  publishedAt: string;
  durationIso: string;      // ISO 8601 (ex.: "PT1M30S")
  durationSeconds: number;  // parsed
  isShort: boolean;         // heurística: duration ≤ 60s
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  thumbnailUrl: string | null;
  permalink: string;
}

export interface YtComment {
  id: string;
  videoId: string;
  authorDisplayName: string | null;
  authorChannelId: string | null;
  textDisplay: string;
  publishedAt: string;
  likeCount: number | null;
  totalReplyCount: number | null;
}

// ── Internos ─────────────────────────────────────────────────────────

function buildUrl(path: string, auth: YtAuth, params: Record<string, string | number> = {}): { url: string; headers: Record<string, string> } {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) search.set(k, String(v));
  const headers: Record<string, string> = { Accept: 'application/json' };

  if ('apiKey' in auth) {
    search.set('key', auth.apiKey);
    return { url: `${YT_API_BASE}${path}?${search.toString()}`, headers };
  }
  headers['Authorization'] = `Bearer ${auth.accessToken}`;
  return { url: `${YT_API_BASE}${path}?${search.toString()}`, headers };
}

async function ytGet(path: string, auth: YtAuth, params: Record<string, string | number> = {}): Promise<any> {
  const { url, headers } = buildUrl(path, auth, params);
  const res = await fetch(url, { headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    const code = json?.error?.code ?? res.status;
    const msg = json?.error?.message ?? `youtube_http_${res.status}`;
    throw new Error(`youtube_error_${code}:${msg}`);
  }
  return json;
}

/**
 * Parse ISO 8601 duration (PT1H2M3S) para segundos. Retorna 0 pra input
 * inválido — chamador decide o que fazer.
 */
export function parseIsoDurationSeconds(iso: string): number {
  if (!iso) return 0;
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (
    (parseInt(d || '0', 10) * 86400) +
    (parseInt(h || '0', 10) * 3600) +
    (parseInt(min || '0', 10) * 60) +
    parseInt(s || '0', 10)
  );
}

// ── Fetchers públicos ────────────────────────────────────────────────

/**
 * Snapshot do canal. `channelId` opcional se auth for OAuth (`mine=true`
 * usa o canal do usuário autenticado). Se auth for API key, `channelId`
 * é obrigatório.
 */
export async function fetchYtChannel(
  auth: YtAuth,
  channelId?: string,
): Promise<YtChannelSnapshot> {
  const params: Record<string, string | number> = {
    part: 'snippet,statistics',
  };
  if (channelId) {
    params.id = channelId;
  } else if ('accessToken' in auth) {
    params.mine = 'true';
  } else {
    throw new Error('fetchYtChannel: channelId obrigatório quando auth=apiKey');
  }

  const json = await ytGet('/channels', auth, params);
  const item = (json?.items ?? [])[0];
  if (!item) throw new Error('youtube_error_404:channel_not_found');

  const s = item.snippet ?? {};
  const stats = item.statistics ?? {};

  return {
    channelId: item.id,
    title: s.title ?? null,
    description: s.description ?? null,
    customUrl: s.customUrl ?? null,
    publishedAt: s.publishedAt ?? null,
    subscriberCount: typeof stats.subscriberCount === 'string' ? Number(stats.subscriberCount) : null,
    videoCount: typeof stats.videoCount === 'string' ? Number(stats.videoCount) : null,
    viewCount: typeof stats.viewCount === 'string' ? Number(stats.viewCount) : null,
    thumbnailUrl: s.thumbnails?.high?.url ?? s.thumbnails?.default?.url ?? null,
    hiddenSubscriberCount: !!stats.hiddenSubscriberCount,
  };
}

/**
 * Lista de videos recentes do canal. Usa uploads playlist (barato: 1 unit)
 * ao invés de `search.list` (100 units).
 */
export async function fetchYtVideos(
  auth: YtAuth,
  channelId: string,
  limit = 10,
): Promise<YtVideo[]> {
  // Passo 1: descobre uploads playlist id (contentDetails.relatedPlaylists.uploads)
  const chJson = await ytGet('/channels', auth, {
    part: 'contentDetails',
    id: channelId,
  });
  const uploadsPlaylistId = chJson?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) throw new Error('youtube_error_404:uploads_playlist_not_found');

  // Passo 2: pega os videos da playlist
  const plJson = await ytGet('/playlistItems', auth, {
    part: 'snippet,contentDetails',
    playlistId: uploadsPlaylistId,
    maxResults: Math.min(Math.max(limit, 1), 50),
  });
  const items = plJson?.items ?? [];
  const videoIds: string[] = items
    .map((it: any) => it?.contentDetails?.videoId)
    .filter((id: string | undefined): id is string => !!id);

  if (!videoIds.length) return [];

  // Passo 3: pega detalhes com statistics + duration
  const videosJson = await ytGet('/videos', auth, {
    part: 'snippet,statistics,contentDetails',
    id: videoIds.join(','),
  });

  return (videosJson?.items ?? []).map((v: any): YtVideo => {
    const s = v.snippet ?? {};
    const stats = v.statistics ?? {};
    const contentDetails = v.contentDetails ?? {};
    const durationIso = contentDetails.duration ?? 'PT0S';
    const durationSeconds = parseIsoDurationSeconds(durationIso);
    return {
      id: String(v.id),
      channelId: s.channelId ?? channelId,
      title: s.title ?? '',
      description: s.description ?? '',
      publishedAt: s.publishedAt ?? '',
      durationIso,
      durationSeconds,
      isShort: durationSeconds > 0 && durationSeconds <= 60,
      viewCount: typeof stats.viewCount === 'string' ? Number(stats.viewCount) : null,
      likeCount: typeof stats.likeCount === 'string' ? Number(stats.likeCount) : null,
      commentCount: typeof stats.commentCount === 'string' ? Number(stats.commentCount) : null,
      thumbnailUrl: s.thumbnails?.high?.url ?? s.thumbnails?.default?.url ?? null,
      permalink: `https://www.youtube.com/watch?v=${v.id}`,
    };
  });
}

/**
 * Comentários top-level de um video. Não expande replies (retorna
 * apenas `totalReplyCount` como agregado). Se `videoId` é próprio, texto
 * completo vem; se é de terceiro, YouTube devolve conforme setting do dono.
 */
export async function fetchYtVideoComments(
  auth: YtAuth,
  videoId: string,
  limit = 30,
): Promise<YtComment[]> {
  const json = await ytGet('/commentThreads', auth, {
    part: 'snippet',
    videoId,
    maxResults: Math.min(Math.max(limit, 1), 100),
    order: 'time',
    textFormat: 'plainText',
  });
  return (json?.items ?? []).map((it: any): YtComment => {
    const top = it?.snippet?.topLevelComment?.snippet ?? {};
    return {
      id: String(it?.snippet?.topLevelComment?.id ?? it?.id),
      videoId,
      authorDisplayName: top.authorDisplayName ?? null,
      authorChannelId: top.authorChannelId?.value ?? null,
      textDisplay: top.textDisplay ?? '',
      publishedAt: top.publishedAt ?? '',
      likeCount: typeof top.likeCount === 'number' ? top.likeCount : null,
      totalReplyCount: typeof it?.snippet?.totalReplyCount === 'number' ? it.snippet.totalReplyCount : null,
    };
  });
}
