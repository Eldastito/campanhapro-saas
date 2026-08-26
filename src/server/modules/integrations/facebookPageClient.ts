/**
 * Facebook Page Graph API client — leitura de Page Feed + insights + comentários
 * da(s) Página(s) que o candidato administra.
 *
 * IMPORTANTE — três tokens diferentes no Meta:
 *   - USER access_token: o que o candidato colou no Hub (`social_tokens.settings.accessToken`).
 *   - PAGE access_token: derivado do user token via `/me/accounts`. TODOS os
 *     endpoints de Page (posts, insights, comments, publishing) EXIGEM esse
 *     token. USER token não funciona.
 *   - APP access_token: só pra chamadas de plataforma (ex. debug_token). Não usamos aqui.
 *
 * Este client abstrai essa diferença — `resolveFacebookPage` devolve o par
 * (pageId, pageAccessToken) pronto pra uso; os fetchers só sabem chamar Graph
 * com Page token.
 *
 * NENHUMA função existente é modificada. Este módulo é NOVO — pareamento
 * com o `instagramGraphClient.ts` já existente.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const API_VERSION = process.env.META_API_VERSION || 'v19.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;
const GLOBAL_TOKEN = process.env.META_ACCESS_TOKEN || '';

export interface FbPageConnection {
  pageId: string;
  pageAccessToken: string;
  pageName?: string;
}

export interface FbPageProfile {
  pageId: string;
  name: string | null;
  category: string | null;
  fanCount: number | null;
  followersCount: number | null;
  about: string | null;
  link: string | null;
  pictureUrl: string | null;
}

export interface FbPagePost {
  id: string;
  message: string | null;
  createdTime: string;
  permalinkUrl: string | null;
  mediaType: 'status' | 'link' | 'photo' | 'video' | 'other';
  reactionsCount: number | null;
  commentsCount: number | null;
  sharesCount: number | null;
}

export interface FbPagePostComment {
  id: string;
  postId: string;
  message: string | null;
  createdTime: string;
  fromName?: string;
  fromId?: string;
  likeCount: number | null;
}

// ── Interno: Graph call com validação ────────────────────────────────

async function graphGet(path: string, token: string): Promise<any> {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    const msg = json?.error?.message || `graph_http_${res.status}`;
    throw new Error(`graph_error:${msg}`);
  }
  return json;
}

// ── Resolvers ────────────────────────────────────────────────────────

/**
 * Descobre a Page principal do candidato + Page token.
 *
 * Ordem:
 *   1. Se `settings.pageId` e `settings.pageAccessToken` já estão salvos, usa direto.
 *   2. Se só `settings.pageId` está salvo, deriva pageAccessToken via /me/accounts.
 *   3. Chama /me/accounts e pega a primeira Page (com aviso — múltiplas pages
 *      exigem que o operador escolha uma no Hub futuro).
 *   4. null quando o token não dá acesso a nenhuma Page.
 */
export async function resolveFacebookPage(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<FbPageConnection | null> {
  let userToken: string | null = null;
  let settingsPageId: string | undefined;
  let settingsPageToken: string | undefined;
  let settingsPageName: string | undefined;

  try {
    const { data } = await supabase
      .from('social_tokens')
      .select('access_token, token, settings')
      .eq('campaignId', campaignId)
      .eq('provider', 'meta')
      .maybeSingle();
    const settings = (data as any)?.settings ?? {};
    userToken = settings.accessToken ?? (data as any)?.access_token ?? (data as any)?.token ?? null;
    settingsPageId = settings.pageId;
    settingsPageToken = settings.pageAccessToken;
    settingsPageName = settings.pageName;
  } catch {
    // fall through — fallback pra env abaixo
  }

  if (!userToken) userToken = GLOBAL_TOKEN || null;
  if (!userToken) return null;

  // Caso 1: par completo já salvo
  if (settingsPageId && settingsPageToken) {
    return { pageId: settingsPageId, pageAccessToken: settingsPageToken, pageName: settingsPageName };
  }

  // Caso 2+3: precisamos consultar /me/accounts
  let pages: Array<{ id: string; name?: string; access_token?: string; category?: string }> = [];
  try {
    const json = await graphGet('me/accounts?fields=id,name,access_token,category', userToken);
    pages = json?.data ?? [];
  } catch (err) {
    console.warn('[facebook] /me/accounts falhou:', (err as Error).message);
    return null;
  }
  if (!pages.length) return null;

  const target = settingsPageId ? pages.find(p => p.id === settingsPageId) : pages[0];
  if (!target?.access_token) return null;
  return { pageId: target.id, pageAccessToken: target.access_token, pageName: target.name };
}

// ── Fetchers ─────────────────────────────────────────────────────────

/**
 * Perfil básico da Page. Contagens `null` quando o token não tem escopo
 * (§20/§103 do PRD: nunca 0 quando é indisponível).
 */
export async function fetchFbPageProfile(conn: FbPageConnection): Promise<FbPageProfile> {
  const fields = 'id,name,category,fan_count,followers_count,about,link,picture{url}';
  const json = await graphGet(
    `${conn.pageId}?fields=${encodeURIComponent(fields)}`,
    conn.pageAccessToken,
  );
  return {
    pageId: json?.id ?? conn.pageId,
    name: json?.name ?? null,
    category: json?.category ?? null,
    fanCount: typeof json?.fan_count === 'number' ? json.fan_count : null,
    followersCount: typeof json?.followers_count === 'number' ? json.followers_count : null,
    about: json?.about ?? null,
    link: json?.link ?? null,
    pictureUrl: json?.picture?.data?.url ?? null,
  };
}

function mapFbMediaType(status_type: string | undefined, type: string | undefined): FbPagePost['mediaType'] {
  const s = (status_type || '').toLowerCase();
  const t = (type || '').toLowerCase();
  if (t === 'photo' || s.includes('photo')) return 'photo';
  if (t === 'video' || s.includes('video')) return 'video';
  if (t === 'link' || s === 'shared_story') return 'link';
  if (t === 'status') return 'status';
  return 'other';
}

/**
 * Posts do feed da Page com summary de reações/comentários/shares.
 *
 * `reactions.summary(true)` pede a contagem sem baixar cada reação — barato.
 * `comments.summary(true)` idem. `shares` já vem como {count}.
 */
export async function fetchFbPagePosts(
  conn: FbPageConnection,
  limit = 10,
): Promise<FbPagePost[]> {
  const fields = [
    'id',
    'message',
    'created_time',
    'permalink_url',
    'status_type',
    'type',
    'reactions.summary(true).limit(0)',
    'comments.summary(true).limit(0)',
    'shares',
  ].join(',');
  const json = await graphGet(
    `${conn.pageId}/posts?fields=${encodeURIComponent(fields)}&limit=${limit}`,
    conn.pageAccessToken,
  );
  return (json?.data ?? []).map((p: any) => ({
    id: String(p.id),
    message: p.message ?? null,
    createdTime: p.created_time ?? '',
    permalinkUrl: p.permalink_url ?? null,
    mediaType: mapFbMediaType(p.status_type, p.type),
    reactionsCount: p.reactions?.summary?.total_count ?? null,
    commentsCount: p.comments?.summary?.total_count ?? null,
    sharesCount: p.shares?.count ?? null,
  }));
}

/**
 * Comentários de um post específico. Meta libera texto completo pra Pages
 * do próprio candidato — sem restrição de terceiros como no Business
 * Discovery do Instagram.
 */
export async function fetchFbPagePostComments(
  conn: FbPageConnection,
  postId: string,
  limit = 30,
): Promise<FbPagePostComment[]> {
  const fields = 'id,message,created_time,from{id,name},like_count';
  const json = await graphGet(
    `${postId}/comments?fields=${encodeURIComponent(fields)}&limit=${limit}`,
    conn.pageAccessToken,
  );
  return (json?.data ?? []).map((c: any) => ({
    id: String(c.id),
    postId,
    message: c.message ?? null,
    createdTime: c.created_time ?? '',
    fromName: c.from?.name,
    fromId: c.from?.id,
    likeCount: typeof c.like_count === 'number' ? c.like_count : null,
  }));
}

/**
 * Combo eficiente: puxa posts + comments por post em 1 pass ao invés de N.
 * Útil para o adapter — 1 chamada por Page ao invés de 1 + N.
 */
export async function fetchFbPagePostsWithComments(
  conn: FbPageConnection,
  postLimit = 8,
  commentsPerPost = 30,
): Promise<Array<FbPagePost & { comments: FbPagePostComment[] }>> {
  const commentFields = 'id,message,created_time,from{id,name},like_count';
  const fields = [
    'id',
    'message',
    'created_time',
    'permalink_url',
    'status_type',
    'type',
    'reactions.summary(true).limit(0)',
    'comments.summary(true).limit(0)',
    'shares',
    `comments.limit(${commentsPerPost}){${commentFields}}`,
  ].join(',');
  const json = await graphGet(
    `${conn.pageId}/posts?fields=${encodeURIComponent(fields)}&limit=${postLimit}`,
    conn.pageAccessToken,
  );
  return (json?.data ?? []).map((p: any) => ({
    id: String(p.id),
    message: p.message ?? null,
    createdTime: p.created_time ?? '',
    permalinkUrl: p.permalink_url ?? null,
    mediaType: mapFbMediaType(p.status_type, p.type),
    reactionsCount: p.reactions?.summary?.total_count ?? null,
    commentsCount: p.comments?.summary?.total_count ?? null,
    sharesCount: p.shares?.count ?? null,
    comments: (p.comments?.data ?? []).map((c: any) => ({
      id: String(c.id),
      postId: String(p.id),
      message: c.message ?? null,
      createdTime: c.created_time ?? '',
      fromName: c.from?.name,
      fromId: c.from?.id,
      likeCount: typeof c.like_count === 'number' ? c.like_count : null,
    })),
  }));
}
