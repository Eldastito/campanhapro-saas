/**
 * X (ex-Twitter) API v2 — OAuth 2.0 com PKCE + leitura de métricas (#123).
 *
 * Requisitos:
 *   - X_CLIENT_ID, X_CLIENT_SECRET (Confidential Client App)
 *   - X_OAUTH_REDIRECT — URL completa do callback no nosso server
 *
 * Pra rodar com tier Free: só consegue ler o próprio perfil (users/me +
 * tweets recentes). Tier Basic (US$ 200/mês) destrava /tweets com métricas
 * públicas. Pro destrava tudo.
 *
 * Escopos:
 *   - tweet.read, users.read → métricas do candidato
 *   - offline.access → refresh token
 */
import crypto from 'crypto';

const X_AUTH_BASE = 'https://twitter.com/i/oauth2/authorize';
const X_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const X_API_BASE = 'https://api.twitter.com/2';

export interface XTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export interface XSnapshot {
  id: string;
  username: string;
  name: string;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  bio: string | null;
  recentTweets: Array<{
    id: string;
    text: string;
    createdAt: string;
    likeCount: number;
    retweetCount: number;
    replyCount: number;
    impressionCount: number | null;
  }>;
  raw: Record<string, any>;
}

export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(64).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function buildXAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const u = new URL(X_AUTH_BASE);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('scope', 'tweet.read users.read offline.access');
  u.searchParams.set('state', opts.state);
  u.searchParams.set('code_challenge', opts.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

async function postForm(url: string, params: Record<string, string>, basicAuth?: string): Promise<any> {
  const body = new URLSearchParams(params).toString();
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (basicAuth) headers['Authorization'] = `Basic ${basicAuth}`;
  const r = await fetch(url, { method: 'POST', headers, body });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`x_token_${r.status}: ${j?.error || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

export async function exchangeXCodeForToken(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<XTokenResponse> {
  const basicAuth = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64');
  return postForm(X_TOKEN_URL, {
    grant_type: 'authorization_code',
    code: opts.code,
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  }, basicAuth);
}

export async function refreshXToken(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<XTokenResponse> {
  const basicAuth = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64');
  return postForm(X_TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  }, basicAuth);
}

async function apiGet(path: string, accessToken: string): Promise<any> {
  const r = await fetch(`${X_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`x_api_${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

export async function fetchXSnapshot(accessToken: string): Promise<XSnapshot> {
  // 1) Perfil
  const me = await apiGet(
    '/users/me?user.fields=name,username,description,public_metrics,profile_image_url',
    accessToken,
  );
  const u = me.data || {};
  const metrics = u.public_metrics || {};

  // 2) Últimos 10 tweets com métricas
  let recentTweets: XSnapshot['recentTweets'] = [];
  try {
    const tw = await apiGet(
      `/users/${u.id}/tweets?max_results=10&tweet.fields=created_at,public_metrics,non_public_metrics`,
      accessToken,
    );
    recentTweets = (tw.data || []).map((t: any) => ({
      id: t.id,
      text: t.text,
      createdAt: t.created_at,
      likeCount: t.public_metrics?.like_count ?? 0,
      retweetCount: t.public_metrics?.retweet_count ?? 0,
      replyCount: t.public_metrics?.reply_count ?? 0,
      impressionCount: t.non_public_metrics?.impression_count ?? null,
    }));
  } catch (err) {
    // Free tier não tem permissão pra ler /tweets — segue só com perfil
    console.warn('[x] /tweets falhou (esperado em Free tier):', (err as Error).message);
  }

  return {
    id: u.id,
    username: u.username,
    name: u.name,
    followers: metrics.followers_count ?? null,
    following: metrics.following_count ?? null,
    postsCount: metrics.tweet_count ?? null,
    bio: u.description ?? null,
    recentTweets,
    raw: { me: u, sampleTweets: recentTweets.slice(0, 3) },
  };
}
