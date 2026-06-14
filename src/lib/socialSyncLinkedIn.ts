/**
 * LinkedIn API v2 — OAuth 2.0 + leitura de perfil + métricas da Company Page (#123).
 *
 * Requisitos:
 *   - LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
 *   - LINKEDIN_OAUTH_REDIRECT
 *
 * Escopos:
 *   - openid profile email           → perfil básico (sempre liberado)
 *   - r_organization_social          → posts/métricas da Company Page (precisa
 *                                      Marketing Developer approval)
 *   - rw_organization_admin          → contagem de followers da Company Page
 *
 * Sem aprovação Marketing Developer, só conseguimos o perfil básico —
 * sem followers, sem métricas. O candidato precisa ter (ou criar) uma
 * Company Page LinkedIn dele e dar permissão ao nosso app.
 */

const LI_AUTH_BASE = 'https://www.linkedin.com/oauth/v2/authorization';
const LI_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LI_API_BASE = 'https://api.linkedin.com/v2';

export interface LiTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export interface LiSnapshot {
  profile: {
    id: string;
    name: string;
    email: string | null;
    pictureUrl: string | null;
    headline: string | null;
  };
  organizations: Array<{
    urn: string;
    name: string;
    followers: number | null;
    sharePosts: Array<{ id: string; text: string; createdAt: string; impressions: number | null; engagements: number | null }>;
  }>;
  raw: Record<string, any>;
}

export function buildLinkedInAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
}): string {
  const u = new URL(LI_AUTH_BASE);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('state', opts.state);
  const scopes = opts.scopes && opts.scopes.length
    ? opts.scopes
    : ['openid', 'profile', 'email', 'r_organization_social', 'rw_organization_admin'];
  u.searchParams.set('scope', scopes.join(' '));
  return u.toString();
}

async function postForm(url: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params).toString();
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`linkedin_token_${r.status}: ${j?.error || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

export async function exchangeLinkedInCode(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<LiTokenResponse> {
  return postForm(LI_TOKEN_URL, {
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });
}

export async function refreshLinkedInToken(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<LiTokenResponse> {
  return postForm(LI_TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });
}

async function apiGet(path: string, accessToken: string): Promise<any> {
  const r = await fetch(`${LI_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`linkedin_api_${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

export async function fetchLinkedInSnapshot(accessToken: string): Promise<LiSnapshot> {
  // 1) Perfil básico (OIDC userinfo, sempre liberado)
  const me = await apiGet('/userinfo', accessToken);

  // 2) Organizações que o usuário administra (precisa rw_organization_admin)
  const organizations: LiSnapshot['organizations'] = [];
  try {
    const orgsAcl = await apiGet(
      '/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organizationalTarget~(localizedName,id,vanityName)))',
      accessToken,
    );
    const orgs = (orgsAcl.elements || [])
      .map((el: any) => el['organizationalTarget~'])
      .filter(Boolean);

    for (const o of orgs.slice(0, 3)) {
      // Followers do canal
      let followers: number | null = null;
      try {
        const stats = await apiGet(
          `/networkSizes/urn:li:organization:${o.id}?edgeType=CompanyFollowedByMember`,
          accessToken,
        );
        followers = stats.firstDegreeSize ?? null;
      } catch { /* segue */ }

      organizations.push({
        urn: `urn:li:organization:${o.id}`,
        name: o.localizedName || o.vanityName || `org_${o.id}`,
        followers,
        sharePosts: [], // posts/share statistics tem cota baixa — pega depois se precisar
      });
    }
  } catch (err) {
    console.warn('[linkedin] organizations ACL falhou (esperado sem Marketing Developer approval):', (err as Error).message);
  }

  return {
    profile: {
      id: me.sub,
      name: me.name,
      email: me.email || null,
      pictureUrl: me.picture || null,
      headline: me.given_name && me.family_name ? `${me.given_name} ${me.family_name}` : null,
    },
    organizations,
    raw: { me, sampleOrgs: organizations.slice(0, 2) },
  };
}
