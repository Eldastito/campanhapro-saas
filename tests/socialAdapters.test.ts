/**
 * Testes do PR 3 do PRD Social Intelligence — wrappers X/LinkedIn/Kwai
 * implementando `SocialProviderAdapter`.
 *
 * Foco:
 *   - `getCapabilities()` devolve o snapshot do registry (sem I/O)
 *   - `getProfile()` normaliza corretamente (com fetcher mockado via DI)
 *   - `refreshCredentials()` chama refresh do provider e persiste via
 *     SocialCredentialService (cifrado)
 *   - `disconnect()` marca conexão como revoked
 *   - Capabilities não suportadas lançam `SocialCapabilityNotAvailableError`
 *   - `SocialConnectionNotFoundError` quando connectionId é fantasma
 *
 * DI: passamos `fetchProfile` e `refreshToken` no `deps` do factory — assim
 * nunca tocamos em rede real.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';

process.env.FIELD_ENCRYPTION_KEY = 'c'.repeat(64);

import {
  createSocialAdapters,
  SocialCapabilityNotAvailableError,
  SocialConnectionNotFoundError,
  IMPLEMENTED_PROVIDERS,
} from '../src/server/modules/social/adapters';
import { createXAdapter } from '../src/server/modules/social/adapters/xAdapter';
import { describeConnection, revealTokens } from '../src/server/modules/social/socialCredentialService';
import { encryptField, _resetKeyCache } from '../src/server/lib/fieldCrypto';

// Seed direto no store — o mock atual tem inconsistência entre insert (que
// gera id) e upsert (que devolve input sem id), então saveCredentials +
// desc.id não é confiável nos testes. Aqui ancoramos o id.
function seedConnection(opts: {
  id: string;
  campaignId: string;
  provider: 'x' | 'linkedin' | 'kwai';
  accessToken?: string | null;
  refreshToken?: string | null;
  settings?: Record<string, unknown> | null;
  status?: string;
}) {
  const enc = (v: string | null | undefined) => (v ? encryptField(v) : v ?? null);
  return {
    id: opts.id,
    campaignId: opts.campaignId,
    provider: opts.provider,
    access_token: opts.accessToken !== undefined ? enc(opts.accessToken) : null,
    refresh_token: opts.refreshToken !== undefined ? enc(opts.refreshToken) : null,
    expires_at: null,
    providerAccountId: null,
    handle: null,
    scopes: null,
    settings: opts.settings ?? null,
    status: opts.status ?? 'active',
    granted_at: null,
    revoked_at: null,
    last_error_code: null,
  };
}

const CAMP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// ── Fixtures ──────────────────────────────────────────────────────────

const X_SNAPSHOT = {
  id: 'x-user-1',
  username: 'candidato',
  name: 'Candidato Silva',
  followers: 12000,
  following: 300,
  postsCount: 450,
  bio: 'Vereador · Cidade X',
  recentTweets: [],
  raw: { source: 'x-mock' },
};

const LI_SNAPSHOT = {
  profile: {
    id: 'li-user-1',
    name: 'Candidato Silva',
    email: 'c@x.com',
    pictureUrl: 'https://media.li/pic.jpg',
    headline: 'Vereador',
  },
  organizations: [
    { urn: 'urn:li:organization:1', name: 'Comitê Silva', followers: 200, sharePosts: [] },
    { urn: 'urn:li:organization:2', name: 'Partido X', followers: 500, sharePosts: [] },
  ],
  raw: { source: 'li-mock' },
};

const KWAI_SNAPSHOT = {
  handle: 'candidato',
  profileUrl: 'https://www.kwai.com/@candidato',
  displayName: 'Candidato',
  bio: 'Perfil oficial',
  followers: 8500,
  following: 12,
  videosCount: 40,
  raw: { source: 'kwai-mock' },
  fetchedAt: '2026-08-26T23:00:00.000Z',
};

// ── Suites ────────────────────────────────────────────────────────────

describe('createSocialAdapters — registry', () => {
  test('devolve adapters somente para os providers implementados neste PR', () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapters = createSocialAdapters(supabase);
    for (const p of IMPLEMENTED_PROVIDERS) {
      assert.ok(adapters[p], `${p} deveria estar implementado`);
      assert.equal(adapters[p]!.provider, p);
    }
    // Providers ainda não implementados ficam ausentes (undefined) —
    // §11 do PRD, caller decide como tratar.
    assert.equal(adapters.instagram, undefined);
    assert.equal(adapters.facebook, undefined);
    assert.equal(adapters.youtube, undefined);
    assert.equal(adapters.tiktok, undefined);
  });

  test('cada adapter devolve o snapshot do registry sem I/O', () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapters = createSocialAdapters(supabase);
    assert.equal(adapters.x!.getCapabilities().adapterMaturity, 'production');
    assert.equal(adapters.linkedin!.getCapabilities().adapterMaturity, 'beta');
    assert.equal(adapters.kwai!.getCapabilities().adapterMaturity, 'limited');
  });
});

describe('XAdapter — getProfile normalização', () => {
  test('normaliza XSnapshot → NormalizedSocialProfile', async () => {
    _resetKeyCache();
    const supabase = createMockSupabase({
      social_tokens: [seedConnection({
        id: 'x-conn-1', campaignId: CAMP, provider: 'x',
        accessToken: 'access-x', refreshToken: 'refresh-x',
      })],
    });

    let fetchCalledWith: string | null = null;
    const adapters = createSocialAdapters(supabase, {
      x: {
        fetchProfile: async (accessToken) => {
          fetchCalledWith = accessToken;
          return X_SNAPSHOT as any;
        },
      },
    });

    const profile = await adapters.x!.getProfile('x-conn-1');
    assert.equal(fetchCalledWith, 'access-x', 'fetcher recebeu access_token descriptografado');
    assert.equal(profile.provider, 'x');
    assert.equal(profile.externalId, 'x-user-1');
    assert.equal(profile.handle, 'candidato');
    assert.equal(profile.displayName, 'Candidato Silva');
    assert.equal(profile.followers, 12000);
    assert.equal(profile.postsCount, 450);
  });

  test('getProfile em conexão fantasma → SocialConnectionNotFoundError', async () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapters = createSocialAdapters(supabase, {
      x: { fetchProfile: async () => X_SNAPSHOT as any },
    });
    await assert.rejects(
      () => adapters.x!.getProfile('00000000-0000-0000-0000-000000000000'),
      SocialConnectionNotFoundError,
    );
  });
});

describe('XAdapter — refreshCredentials', () => {
  test('chama refreshToken do provider e persiste tokens cifrados', async () => {
    _resetKeyCache();
    const supabase = createMockSupabase({
      social_tokens: [seedConnection({
        id: 'x-refresh-1', campaignId: CAMP, provider: 'x',
        accessToken: 'old', refreshToken: 'old-refresh',
      })],
    });

    const xAdapter = createXAdapter(
      supabase,
      {
        refreshToken: async ({ refreshToken }) => {
          assert.equal(refreshToken, 'old-refresh');
          return {
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 7200,
            scope: 'tweet.read',
            token_type: 'bearer',
          };
        },
      },
      { clientId: 'test-client', clientSecret: 'test-secret' },
    );

    await xAdapter.refreshCredentials('x-refresh-1');

    const tokens = await revealTokens(supabase, CAMP, 'x');
    assert.equal(tokens!.accessToken, 'new-access');
    assert.equal(tokens!.refreshToken, 'new-refresh');
    // Verifica que o token novo foi CIFRADO em storage (não plaintext).
    const stored = (supabase as any)._store.get('social_tokens')[0];
    assert.ok(stored.access_token.startsWith('enc:v1:'));
  });

  test('sem refresh_token → SocialCapabilityNotAvailableError permission_required', async () => {
    _resetKeyCache();
    const supabase = createMockSupabase({
      social_tokens: [seedConnection({
        id: 'x-no-refresh', campaignId: CAMP, provider: 'x',
        accessToken: 'only-access',
        // refreshToken omitido
      })],
    });
    const xAdapter = createXAdapter(
      supabase,
      { refreshToken: async () => { throw new Error('não deveria chamar'); } },
      { clientId: 'c', clientSecret: 's' },
    );
    await assert.rejects(
      () => xAdapter.refreshCredentials('x-no-refresh'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        err.level === 'permission_required',
    );
  });

  test('sem client credentials → SocialCapabilityNotAvailableError not_configured', async () => {
    _resetKeyCache();
    const supabase = createMockSupabase({
      social_tokens: [seedConnection({
        id: 'x-no-env', campaignId: CAMP, provider: 'x',
        accessToken: 'a', refreshToken: 'r',
      })],
    });
    const xAdapter = createXAdapter(
      supabase,
      { refreshToken: async () => { throw new Error('não deveria chamar'); } },
      {}, // sem clientId/Secret
    );
    await assert.rejects(
      () => xAdapter.refreshCredentials('x-no-env'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        err.level === 'not_configured',
    );
  });
});

describe('XAdapter — disconnect', () => {
  test('marca conexão como revoked sem apagar linha', async () => {
    _resetKeyCache();
    const supabase = createMockSupabase({
      social_tokens: [seedConnection({
        id: 'x-disc-1', campaignId: CAMP, provider: 'x', accessToken: 'a',
      })],
    });
    const adapters = createSocialAdapters(supabase);

    await adapters.x!.disconnect('x-disc-1');

    const status = await describeConnection(supabase, CAMP, 'x');
    assert.ok(status, 'linha continua existindo');
    assert.equal(status!.status, 'revoked');
    assert.ok(status!.revokedAt);
  });
});

describe('XAdapter — capabilities não implementadas lançam typed error', () => {
  test('connect / getPosts / getComments / getMetrics → SocialCapabilityNotAvailableError', async () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapters = createSocialAdapters(supabase);
    const x = adapters.x!;
    await assert.rejects(() => x.connect({ campaignId: CAMP, payload: {} }), SocialCapabilityNotAvailableError);
    await assert.rejects(() => x.getPosts('any'), SocialCapabilityNotAvailableError);
    await assert.rejects(() => x.getComments('any'), SocialCapabilityNotAvailableError);
    await assert.rejects(() => x.getMetrics('any'), SocialCapabilityNotAvailableError);
  });
});

describe('LinkedInAdapter — getProfile', () => {
  test('soma followers das organizações admin', async () => {
    _resetKeyCache();
    const supabase = createMockSupabase({
      social_tokens: [seedConnection({
        id: 'li-conn-1', campaignId: CAMP, provider: 'linkedin',
        accessToken: 'li-access', refreshToken: 'li-refresh',
      })],
    });
    const adapters = createSocialAdapters(supabase, {
      linkedin: { fetchProfile: async () => LI_SNAPSHOT as any },
    });
    const p = await adapters.linkedin!.getProfile('li-conn-1');
    assert.equal(p.provider, 'linkedin');
    assert.equal(p.externalId, 'li-user-1');
    assert.equal(p.displayName, 'Candidato Silva');
    assert.equal(p.followers, 700); // 200 + 500
    assert.equal(p.following, null, '§20/§103: null quando o provider não expõe');
    assert.equal(p.postsCount, null);
    assert.equal(p.avatarUrl, 'https://media.li/pic.jpg');
  });

  test('sem organizações admin → followers=null (não conseguimos consultar)', async () => {
    _resetKeyCache();
    const supabase = createMockSupabase({
      social_tokens: [seedConnection({
        id: 'li-conn-2', campaignId: CAMP, provider: 'linkedin', accessToken: 'a',
      })],
    });
    const adapters = createSocialAdapters(supabase, {
      linkedin: {
        fetchProfile: async () => ({
          profile: {
            id: 'li-2', name: 'Sem Org', email: null,
            pictureUrl: null, headline: null,
          },
          organizations: [],
          raw: {},
        }) as any,
      },
    });
    const p = await adapters.linkedin!.getProfile('li-conn-2');
    assert.equal(p.followers, null, 'null (não 0) quando nada consultado');
  });
});

describe('KwaiAdapter — getProfile', () => {
  test('lê handle de settings e normaliza scraping', async () => {
    _resetKeyCache();
    // Kwai não usa cripto — inserimos direto no store para simular a
    // conexão que socialRouter.ts:199 (POST /connect/kwai) cria hoje.
    const supabase = createMockSupabase({
      social_tokens: [{
        id: 'kwai-conn-1', campaignId: CAMP, provider: 'kwai',
        access_token: null, refresh_token: null, expires_at: null,
        settings: { handle: 'candidato', profileUrl: 'https://www.kwai.com/@candidato' },
        status: 'active',
      }],
    });

    let fetchArg: string | null = null;
    const adapters = createSocialAdapters(supabase, {
      kwai: {
        fetchProfile: async (h) => {
          fetchArg = h;
          return KWAI_SNAPSHOT as any;
        },
      },
    });

    const p = await adapters.kwai!.getProfile('kwai-conn-1');
    assert.equal(fetchArg, 'candidato');
    assert.equal(p.provider, 'kwai');
    assert.equal(p.followers, 8500);
    assert.equal(p.postsCount, 40);
    assert.equal(p.displayName, 'Candidato');
  });

  test('sem handle em settings → SocialCapabilityNotAvailableError not_configured', async () => {
    const supabase = createMockSupabase({
      social_tokens: [{
        id: 'kwai-broken', campaignId: CAMP, provider: 'kwai',
        access_token: null, refresh_token: null, settings: {}, status: 'active',
      }],
    });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.kwai!.getProfile('kwai-broken'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        err.level === 'not_configured',
    );
  });

  test('refreshCredentials é no-op (Kwai não tem token)', async () => {
    const supabase = createMockSupabase({
      social_tokens: [{
        id: 'kwai-1', campaignId: CAMP, provider: 'kwai',
        access_token: null, settings: { handle: 'x' }, status: 'active',
      }],
    });
    const adapters = createSocialAdapters(supabase);
    // Não deve lançar
    await adapters.kwai!.refreshCredentials('kwai-1');
  });

  test('getPosts/getComments/getMetrics todos lançam capabilityUnavailable', async () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapters = createSocialAdapters(supabase);
    const k = adapters.kwai!;
    await assert.rejects(() => k.getPosts('x'), SocialCapabilityNotAvailableError);
    await assert.rejects(() => k.getComments('x'), SocialCapabilityNotAvailableError);
    await assert.rejects(() => k.getMetrics('x'), SocialCapabilityNotAvailableError);
  });
});

describe('Cross-provider — resolveConnection tenant safety', () => {
  test('connectionId de outro provider não vaza', async () => {
    _resetKeyCache();
    const supabase = createMockSupabase({
      social_tokens: [
        seedConnection({ id: 'x-cross', campaignId: CAMP, provider: 'x', accessToken: 'a' }),
        seedConnection({ id: 'li-cross', campaignId: CAMP, provider: 'linkedin', accessToken: 'b' }),
      ],
    });
    const adapters = createSocialAdapters(supabase, {
      linkedin: { fetchProfile: async () => LI_SNAPSHOT as any },
    });
    // Passa o connectionId de X pro adapter LinkedIn — deve NÃO encontrar.
    await assert.rejects(
      () => adapters.linkedin!.getProfile('x-cross'),
      SocialConnectionNotFoundError,
    );
  });
});
