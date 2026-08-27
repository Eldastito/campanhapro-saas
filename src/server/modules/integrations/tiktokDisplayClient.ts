/**
 * TikTok Display API client — leitura de user info + video list do próprio
 * usuário autenticado.
 *
 * REGRAS DO PRD (§32):
 *   - Login Kit oficial → só as capabilities APROVADAS pelo app review.
 *   - NADA de scraping, mesmo que o Display API mude endpoint ou fique caro.
 *   - Publishing (Content Posting API) fica bloqueado até approval separada.
 *
 * DIFERENÇA vs YouTube/Meta:
 *   - TikTok NÃO tem "API key" mode. Toda chamada exige OAuth access_token.
 *   - Sem access_token → adapter joga `not_configured`.
 *   - Login Kit real (obtenção do token) NÃO entra neste PR — vira paste
 *     manual no Hub por enquanto.
 *
 * Endpoints:
 *   - POST /v2/user/info/     → username, display_name, follower_count, etc.
 *   - POST /v2/video/list/    → últimos videos do usuário (max 20 por página)
 *
 * TikTok usa POST + form fields para leitura — não é REST idiomático mas é
 * o que a doc oficial estabelece.
 */

const TT_API_BASE = 'https://open.tiktokapis.com/v2';

export interface TtAccessToken {
  accessToken: string;
}

export interface TtUserSnapshot {
  openId: string;
  unionId: string | null;
  username: string | null;
  displayName: string | null;
  bioDescription: string | null;
  profileDeepLink: string | null;
  avatarUrl: string | null;
  followerCount: number | null;
  followingCount: number | null;
  likesCount: number | null;
  videoCount: number | null;
  isVerified: boolean;
}

export interface TtVideo {
  id: string;
  ownerOpenId: string;
  title: string | null;
  description: string | null;
  createTime: number;              // Unix seconds
  durationSeconds: number | null;
  shareUrl: string | null;
  embedLink: string | null;
  coverImageUrl: string | null;
  videoDescription: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  isShort: boolean;                // TikTok tudo é short — mantido pra parity com YouTube
}

// ── Internos ─────────────────────────────────────────────────────────

async function ttPost(path: string, accessToken: string, body: Record<string, unknown>): Promise<any> {
  const url = `${TT_API_BASE}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  // TikTok devolve status HTTP 200 mesmo em erro; o payload traz error.code != 'ok'.
  const errorCode = json?.error?.code;
  if (!res.ok || (errorCode && errorCode !== 'ok')) {
    const msg = json?.error?.message ?? `tiktok_http_${res.status}`;
    throw new Error(`tiktok_error_${errorCode ?? res.status}:${msg}`);
  }
  return json;
}

// ── Fetchers públicos ────────────────────────────────────────────────

/**
 * User info do próprio usuário autenticado (usa access_token para saber quem é).
 * Fields: open_id, union_id, avatar_url, display_name, bio_description,
 * profile_deep_link, is_verified, follower_count, following_count, likes_count,
 * video_count, username.
 */
export async function fetchTtUserInfo(auth: TtAccessToken): Promise<TtUserSnapshot> {
  const fields = [
    'open_id',
    'union_id',
    'username',
    'display_name',
    'bio_description',
    'profile_deep_link',
    'avatar_url',
    'follower_count',
    'following_count',
    'likes_count',
    'video_count',
    'is_verified',
  ].join(',');
  const json = await ttPost(`/user/info/?fields=${encodeURIComponent(fields)}`, auth.accessToken, {});
  const u = json?.data?.user;
  if (!u) throw new Error('tiktok_error_missing_user:payload sem data.user');
  return {
    openId: u.open_id ?? '',
    unionId: u.union_id ?? null,
    username: u.username ?? null,
    displayName: u.display_name ?? null,
    bioDescription: u.bio_description ?? null,
    profileDeepLink: u.profile_deep_link ?? null,
    avatarUrl: u.avatar_url ?? null,
    followerCount: typeof u.follower_count === 'number' ? u.follower_count : null,
    followingCount: typeof u.following_count === 'number' ? u.following_count : null,
    likesCount: typeof u.likes_count === 'number' ? u.likes_count : null,
    videoCount: typeof u.video_count === 'number' ? u.video_count : null,
    isVerified: !!u.is_verified,
  };
}

/**
 * Lista videos do próprio usuário. `cursor` opcional para paginar (Display
 * API devolve `cursor` next no response). Cap de 20 por página é da API.
 */
export async function fetchTtUserVideos(
  auth: TtAccessToken,
  limit = 10,
  cursor?: number,
): Promise<TtVideo[]> {
  const fields = [
    'id',
    'title',
    'video_description',
    'create_time',
    'duration',
    'share_url',
    'embed_link',
    'cover_image_url',
    'view_count',
    'like_count',
    'comment_count',
    'share_count',
  ].join(',');
  const body: Record<string, unknown> = {
    max_count: Math.min(Math.max(limit, 1), 20),
  };
  if (cursor !== undefined) body.cursor = cursor;

  const json = await ttPost(`/video/list/?fields=${encodeURIComponent(fields)}`, auth.accessToken, body);
  const videos: any[] = json?.data?.videos ?? [];
  return videos.map(v => {
    const duration = typeof v.duration === 'number' ? v.duration : null;
    return {
      id: String(v.id),
      // Display API não devolve owner_open_id por video — o dono é sempre
      // o usuário autenticado. Preenchemos no adapter com o openId do user.
      ownerOpenId: '',
      title: v.title ?? null,
      description: v.title ?? null,
      createTime: typeof v.create_time === 'number' ? v.create_time : 0,
      durationSeconds: duration,
      shareUrl: v.share_url ?? null,
      embedLink: v.embed_link ?? null,
      coverImageUrl: v.cover_image_url ?? null,
      videoDescription: v.video_description ?? null,
      viewCount: typeof v.view_count === 'number' ? v.view_count : null,
      likeCount: typeof v.like_count === 'number' ? v.like_count : null,
      commentCount: typeof v.comment_count === 'number' ? v.comment_count : null,
      shareCount: typeof v.share_count === 'number' ? v.share_count : null,
      // TikTok é 100% vertical short-form. Marcamos true pra parity com YT.
      isShort: true,
    };
  });
}
