/**
 * Instagram Graph API client — leitura de inteligência social PÚBLICA e legal.
 *
 * IMPORTANTE (limites que a Meta impõe de propósito, já documentados no intelRouter):
 *  - Business Discovery: com a conta IG Business/Creator do candidato dá pra ler
 *    de OUTRAS contas business/creator públicas a lista de posts, legendas e a
 *    CONTAGEM de likes/comentários — mas NUNCA o TEXTO dos comentários de terceiros.
 *    É por isso que não conseguimos "ler os comentários" da página do bairro: a API
 *    não devolve esse conteúdo. O sinal que extraímos é tema (legenda) + intensidade
 *    (nº de comentários/likes).
 *  - Comentários COM texto: só nas publicações do PRÓPRIO candidato (ou onde ele é
 *    @marcado). Esse caminho a API libera por completo.
 *
 * Raspar comentários de terceiros viola os Termos da Meta (risco de ban + jurídico)
 * — não fazemos. Tudo aqui usa endpoints oficiais.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const API_VERSION = process.env.META_API_VERSION || 'v19.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;
const GLOBAL_TOKEN = process.env.META_ACCESS_TOKEN || '';
const ENV_IG_USER_ID = process.env.META_IG_USER_ID || '';

export interface IgConnection {
  igUserId: string;
  token: string;
  username?: string;
}

export interface IgPost {
  caption: string;
  likeCount: number;
  commentsCount: number;
  timestamp: string;
  permalink: string;
  mediaType?: string;
}

export interface IgComment {
  text: string;
  username?: string;
  timestamp: string;
  likeCount?: number;
}

export interface DiscoveryResult {
  username: string;
  followersCount: number;
  mediaCount: number;
  posts: IgPost[];
}

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

/**
 * Resolve a conta IG conectada da campanha. FONTE ÚNICA: a aba "Conexões"
 * (Agentes IA → SocialConnectionsHub), que grava o Instagram como uma linha
 * `social_tokens` com provider='meta', settings.accountId (= IG Business
 * Account ID) e settings.accessToken. Ordem:
 *   1. social_tokens(provider='meta') → settings.accountId + settings.accessToken
 *   2. env META_IG_USER_ID + META_ACCESS_TOKEN (modelo single-token de fallback)
 * Retorna null se nada estiver configurado.
 */
export async function resolveInstagram(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<IgConnection | null> {
  try {
    const { data } = await supabase
      .from('social_tokens')
      .select('token, settings')
      .eq('campaignId', campaignId)
      .eq('provider', 'meta')
      .maybeSingle();
    // O Hub salva o IG Business Account ID em settings.accountId.
    const igUserId = (data?.settings?.accountId || data?.settings?.igUserId) as string | undefined;
    if (igUserId) {
      // token: settings.accessToken (o que o Hub colou) → coluna token → global.
      const token = data?.settings?.accessToken || data?.token || GLOBAL_TOKEN;
      if (token) return { igUserId, token, username: data?.settings?.username };
    }
  } catch { /* fallback abaixo */ }

  if (ENV_IG_USER_ID && GLOBAL_TOKEN) {
    return { igUserId: ENV_IG_USER_ID, token: GLOBAL_TOKEN };
  }
  return null;
}

/**
 * Descobre automaticamente a conta IG Business ligada à Página do token global,
 * via /me/accounts. Útil pra conectar em 1 clique sem o operador caçar o ID.
 */
export async function autoResolveIgUserId(
  token = GLOBAL_TOKEN,
): Promise<{ igUserId: string; username?: string } | null> {
  if (!token) return null;
  const json = await graphGet(
    `me/accounts?fields=name,instagram_business_account{id,username}`,
    token,
  );
  const pages: any[] = json?.data ?? [];
  for (const p of pages) {
    const ig = p?.instagram_business_account;
    if (ig?.id) return { igUserId: ig.id, username: ig.username };
  }
  return null;
}

/**
 * Business Discovery — dados públicos de OUTRA conta business/creator (a página do
 * bairro). Traz posts + legendas + contagens. NÃO traz o texto dos comentários.
 */
export async function businessDiscovery(
  conn: IgConnection,
  targetUsername: string,
  postLimit = 12,
): Promise<DiscoveryResult> {
  const handle = targetUsername.replace(/^@/, '').trim();
  // Valida o handle ANTES de interpolar na query (anti-injeção/SSRF de parâmetro).
  // Usernames do Instagram: letras, números, ponto e underscore, até 30 chars.
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) {
    throw new Error('graph_error:invalid_username');
  }
  const fields =
    `business_discovery.username(${handle}){username,followers_count,media_count,` +
    `media.limit(${postLimit}){caption,like_count,comments_count,timestamp,permalink,media_type}}`;
  const json = await graphGet(`${conn.igUserId}?fields=${encodeURIComponent(fields)}`, conn.token);
  const bd = json?.business_discovery;
  if (!bd) throw new Error('graph_error:business_discovery_empty');
  const posts: IgPost[] = (bd.media?.data ?? []).map((m: any) => ({
    caption: m.caption ?? '',
    likeCount: m.like_count ?? 0,
    commentsCount: m.comments_count ?? 0,
    timestamp: m.timestamp ?? '',
    permalink: m.permalink ?? '',
    mediaType: m.media_type,
  }));
  return {
    username: bd.username ?? handle,
    followersCount: bd.followers_count ?? 0,
    mediaCount: bd.media_count ?? 0,
    posts,
  };
}

export interface IgAccountProfile {
  igUserId: string;
  username: string | null;
  name: string | null;
  followersCount: number | null;
  mediaCount: number | null;
  biography: string | null;
  profilePictureUrl: string | null;
}

/**
 * Snapshot básico da CONTA IG conectada. Distinto de `businessDiscovery`
 * (que é sobre outras contas). Usa o endpoint `/{igUserId}` com fields do
 * próprio Business account. Contagens são `null` quando a API não expõe
 * (§20/§103 do PRD: nunca 0 quando é indisponível).
 */
export async function fetchIgAccountProfile(conn: IgConnection): Promise<IgAccountProfile> {
  const fields = 'username,name,followers_count,media_count,biography,profile_picture_url';
  const json = await graphGet(`${conn.igUserId}?fields=${encodeURIComponent(fields)}`, conn.token);
  return {
    igUserId: conn.igUserId,
    username: json?.username ?? null,
    name: json?.name ?? null,
    followersCount: typeof json?.followers_count === 'number' ? json.followers_count : null,
    mediaCount: typeof json?.media_count === 'number' ? json.media_count : null,
    biography: json?.biography ?? null,
    profilePictureUrl: json?.profile_picture_url ?? null,
  };
}

/**
 * Comentários COM texto nas publicações do PRÓPRIO candidato. A API libera isso por
 * completo (são posts da conta autenticada).
 */
export async function fetchOwnMediaWithComments(
  conn: IgConnection,
  mediaLimit = 8,
  commentsPerMedia = 30,
): Promise<Array<IgPost & { comments: IgComment[] }>> {
  const fields =
    `caption,like_count,comments_count,timestamp,permalink,media_type,` +
    `comments.limit(${commentsPerMedia}){text,username,timestamp,like_count}`;
  const json = await graphGet(`${conn.igUserId}/media?fields=${encodeURIComponent(fields)}&limit=${mediaLimit}`, conn.token);
  return (json?.data ?? []).map((m: any) => ({
    caption: m.caption ?? '',
    likeCount: m.like_count ?? 0,
    commentsCount: m.comments_count ?? 0,
    timestamp: m.timestamp ?? '',
    permalink: m.permalink ?? '',
    mediaType: m.media_type,
    comments: (m.comments?.data ?? []).map((c: any) => ({
      text: c.text ?? '',
      username: c.username,
      timestamp: c.timestamp ?? '',
      likeCount: c.like_count ?? 0,
    })),
  }));
}
