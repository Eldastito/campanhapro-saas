/**
 * Testes do PR 17 do PRD Social Intelligence — endpoints HTTP /social/signals.
 *
 * Cobre:
 *   GET /signals:
 *     - 401 sem campaignId
 *     - devolve signals da campanha correta (§35 isolamento)
 *     - filtros minSeverity, source, topic, provider, since, limit
 *     - 400 pra filtros inválidos
 *   POST /signals/compute:
 *     - 401 sem campaignId
 *     - 403 pra não-Admin
 *     - 200 pra Admin, com signalsCount e persist.reason='ok'
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';
import { createSocialSignalsRouter } from '../src/server/modules/social/socialSignalsRouter';
import { persistSignals } from '../src/server/modules/social/socialSignalStore';
import type { SocialSignal } from '../src/server/modules/social/intelligence/socialSignalBus';
import { SOCIAL_SIGNAL_BUS_VERSION } from '../src/server/modules/social/intelligence/socialSignalBus';
import type { StoredSocialPost } from '../src/server/modules/social/socialIngestionService';

const CAMP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NOW = new Date('2026-08-27T12:00:00Z');
const HOUR = 3_600_000;

interface FakeUser {
  id?: string;
  campaignId?: string;
  type?: string;
}

function buildApp(user: FakeUser, supabase: ReturnType<typeof createMockSupabase>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { user: FakeUser }).user = user; next(); });
  app.use('/api/v1/social', createSocialSignalsRouter(supabase));
  return app;
}

async function req(app: express.Express, method: string, path: string, body?: unknown) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as { port: number }).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let parsed: unknown = null;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.status, body: parsed });
      } catch (err) { reject(err); } finally { server.close(); }
    });
  });
}

let seq = 1;
function signal(overrides: Partial<SocialSignal> = {}): SocialSignal {
  return {
    dedupKey: overrides.dedupKey ?? `stub::${seq++}`,
    source: overrides.source ?? 'trend',
    severity: overrides.severity ?? 'info',
    summary: overrides.summary ?? 'stub summary',
    hypotheses: overrides.hypotheses ?? [],
    providers: overrides.providers ?? ['instagram'],
    topic: overrides.topic,
    confidence: overrides.confidence ?? 0.5,
    emittedAt: overrides.emittedAt ?? NOW,
    payload: overrides.payload ?? {
      kind: 'trend',
      result: {
        window: '24h', state: 'trend', direction: 'rising',
        currentTotal: 100, baselineTotal: 80, deltaPct: 0.25,
        samples: { current: 5, baseline: 5 }, confidence: 0.5,
        detectorVersion: 'test',
      } as never,
    },
    busVersion: SOCIAL_SIGNAL_BUS_VERSION,
  };
}

// ── GET /signals ────────────────────────────────────────────────────

describe('GET /signals — auth', () => {
  test('401 sem campaignId no user', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ id: 'u1' }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals');
    assert.equal(r.status, 401);
    assert.deepEqual(r.body, { error: 'unauthorized' });
  });
});

describe('GET /signals — resultados e isolamento §35', () => {
  async function seedMulti() {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ dedupKey: 'a', severity: 'info', source: 'trend', topic: 'saude', providers: ['instagram'], emittedAt: new Date(NOW.getTime() - 1 * HOUR) }),
      signal({ dedupKey: 'b', severity: 'risk', source: 'anomaly', topic: 'saude', providers: ['facebook', 'youtube'], emittedAt: new Date(NOW.getTime() - 2 * HOUR) }),
      signal({ dedupKey: 'c', severity: 'attention', source: 'trend', topic: 'educacao', providers: ['x'], emittedAt: new Date(NOW.getTime() - 3 * HOUR) }),
      signal({ dedupKey: 'd', severity: 'crisis', source: 'cross_network_anomaly', topic: 'seguranca', providers: ['instagram', 'facebook', 'youtube'], emittedAt: new Date(NOW.getTime() - 4 * HOUR) }),
    ]);
    // sinal de OUTRA campanha
    await persistSignals(supabase, OTHER, [
      signal({ dedupKey: 'other-1', severity: 'crisis', source: 'anomaly', topic: 'saude', providers: ['instagram'], emittedAt: NOW }),
    ]);
    return supabase;
  }

  test('devolve signals ordenados por emittedAt DESC', async () => {
    const supabase = await seedMulti();
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals');
    assert.equal(r.status, 200);
    const body = r.body as { signals: Array<{ dedupKey: string }> };
    assert.equal(body.signals.length, 4);
    assert.equal(body.signals[0].dedupKey, 'a');
    assert.equal(body.signals[3].dedupKey, 'd');
  });

  test('isolamento §35: campanha CAMP NÃO vê OTHER', async () => {
    const supabase = await seedMulti();
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals');
    const body = r.body as { signals: Array<{ dedupKey: string }> };
    for (const s of body.signals) {
      assert.notEqual(s.dedupKey, 'other-1');
    }
  });

  test('minSeverity=risk devolve só risk e crisis', async () => {
    const supabase = await seedMulti();
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals?minSeverity=risk');
    const body = r.body as { signals: Array<{ dedupKey: string; severity: string }> };
    assert.deepEqual(body.signals.map(s => s.dedupKey).sort(), ['b', 'd']);
  });

  test('source=trend', async () => {
    const supabase = await seedMulti();
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals?source=trend');
    const body = r.body as { signals: Array<{ dedupKey: string }> };
    assert.deepEqual(body.signals.map(s => s.dedupKey).sort(), ['a', 'c']);
  });

  test('topic=saude', async () => {
    const supabase = await seedMulti();
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals?topic=saude');
    const body = r.body as { signals: Array<{ dedupKey: string }> };
    assert.deepEqual(body.signals.map(s => s.dedupKey).sort(), ['a', 'b']);
  });

  test('provider=instagram (matcha arrays contendo)', async () => {
    const supabase = await seedMulti();
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals?provider=instagram');
    const body = r.body as { signals: Array<{ dedupKey: string }> };
    assert.deepEqual(body.signals.map(s => s.dedupKey).sort(), ['a', 'd']);
  });

  test('since filtra', async () => {
    const supabase = await seedMulti();
    const app = buildApp({ campaignId: CAMP }, supabase);
    const cutoff = new Date(NOW.getTime() - 2.5 * HOUR).toISOString();
    const r = await req(app, 'GET', `/api/v1/social/signals?since=${encodeURIComponent(cutoff)}`);
    const body = r.body as { signals: Array<{ dedupKey: string }> };
    assert.deepEqual(body.signals.map(s => s.dedupKey).sort(), ['a', 'b']);
  });

  test('limit trunca', async () => {
    const supabase = await seedMulti();
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals?limit=2');
    const body = r.body as { signals: Array<{ dedupKey: string }> };
    assert.equal(body.signals.length, 2);
  });
});

describe('GET /signals — filtros inválidos', () => {
  const empty = () => createMockSupabase({ social_signals: [] });

  test('minSeverity fora do enum → 400', async () => {
    const app = buildApp({ campaignId: CAMP }, empty());
    const r = await req(app, 'GET', '/api/v1/social/signals?minSeverity=urgent');
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'invalid_minSeverity' });
  });

  test('source fora do enum → 400', async () => {
    const app = buildApp({ campaignId: CAMP }, empty());
    const r = await req(app, 'GET', '/api/v1/social/signals?source=weird');
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'invalid_source' });
  });

  test('topic fora da taxonomia → 400', async () => {
    const app = buildApp({ campaignId: CAMP }, empty());
    const r = await req(app, 'GET', '/api/v1/social/signals?topic=medicina');
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'invalid_topic' });
  });

  test('provider fora do enum → 400', async () => {
    const app = buildApp({ campaignId: CAMP }, empty());
    const r = await req(app, 'GET', '/api/v1/social/signals?provider=myspace');
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'invalid_provider' });
  });

  test('since não-parseável → 400', async () => {
    const app = buildApp({ campaignId: CAMP }, empty());
    const r = await req(app, 'GET', '/api/v1/social/signals?since=not-a-date');
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'invalid_since' });
  });

  test('limit não-inteiro ou fora de 1-500 → 400', async () => {
    const app = buildApp({ campaignId: CAMP }, empty());
    for (const bad of ['0', '501', 'abc', '2.5']) {
      const r = await req(app, 'GET', `/api/v1/social/signals?limit=${bad}`);
      assert.equal(r.status, 400, `limit=${bad} deveria dar 400`);
      assert.deepEqual(r.body, { error: 'invalid_limit' });
    }
  });
});

// ── POST /signals/compute ───────────────────────────────────────────

describe('POST /signals/compute — auth + admin gate', () => {
  test('401 sem campaignId', async () => {
    const supabase = createMockSupabase({ social_posts: [], social_comments: [], social_signals: [] });
    const app = buildApp({ id: 'u1' }, supabase);
    const r = await req(app, 'POST', '/api/v1/social/signals/compute');
    assert.equal(r.status, 401);
  });

  test('403 pra usuário não-Admin', async () => {
    const supabase = createMockSupabase({ social_posts: [], social_comments: [], social_signals: [] });
    const app = buildApp({ campaignId: CAMP, type: 'Fiscal' }, supabase);
    const r = await req(app, 'POST', '/api/v1/social/signals/compute');
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { error: 'admin_required' });
  });

  test('200 pra Admin, roda pipeline com persist=true', async () => {
    // Fixtures precisam bater o default minSamplesPerSide=3 do detector,
    // já que o endpoint POST /signals/compute usa defaults (não expõe
    // trendOptions via query params).
    let postSeq = 1;
    const anchor = new Date();
    const posts: StoredSocialPost[] = [];
    // 5 posts no current window (últimas 24h)
    for (let i = 0; i < 5; i++) {
      posts.push({
        id: `p${postSeq++}`, campaignId: CAMP, provider: 'instagram',
        externalId: `pcur${i}`, accountExternalId: 'acct1',
        publishedAt: new Date(anchor.getTime() - (i + 1) * 3 * HOUR).toISOString(),
        contentType: 'post', text: 'saúde melhor no bairro', permalink: null,
        metrics: null, provenance: {},
        ingestedAt: anchor.toISOString(), updatedAt: anchor.toISOString(),
      });
    }
    // 4 posts no baseline (24-48h atrás) para atender minSamplesPerSide=3
    for (let i = 0; i < 4; i++) {
      posts.push({
        id: `p${postSeq++}`, campaignId: CAMP, provider: 'instagram',
        externalId: `pold${i}`, accountExternalId: 'acct1',
        publishedAt: new Date(anchor.getTime() - (25 + i * 4) * HOUR).toISOString(),
        contentType: 'post', text: 'consulta hospital antiga UPA', permalink: null,
        metrics: null, provenance: {},
        ingestedAt: anchor.toISOString(), updatedAt: anchor.toISOString(),
      });
    }
    const supabase = createMockSupabase({ social_posts: posts, social_comments: [], social_signals: [] });
    const app = buildApp({ campaignId: CAMP, type: 'Admin' }, supabase);
    const r = await req(app, 'POST', '/api/v1/social/signals/compute');
    assert.equal(r.status, 200);
    const body = r.body as { signalsCount: number; persist: { reason: string; written: number } | null };
    assert.ok(body.signalsCount >= 1);
    assert.ok(body.persist);
    assert.equal(body.persist!.reason, 'ok');
    assert.equal(body.persist!.written, body.signalsCount);
    // Confere que gravou no store
    const store = (supabase as unknown as { _store: Map<string, unknown[]> })._store;
    assert.equal(store.get('social_signals')!.length, body.signalsCount);
  });
});
