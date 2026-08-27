/**
 * Testes do PR 29 do PRD Social Intelligence — getSignalStats + endpoint.
 *
 * Cobre:
 *   getSignalStats:
 *     - Vazio → total=0, todos os buckets em zero
 *     - Contagem por severity, source, topic, provider
 *     - Provider counting: signal com N providers conta N vezes
 *     - Topic null vira "__null__"
 *     - Filtro since/until aplica antes de agregar
 *     - Isolamento §35: campanha OTHER não vaza no resultado
 *     - Default: últimos 7 dias
 *   GET /signals/stats:
 *     - 401 sem campaignId
 *     - Devolve stats sem exigir Admin
 *     - Filtros since/until aplicam
 *     - 400 pra since ou until inválido
 *     - 400 pra since >= until
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';
import { createSocialSignalsRouter } from '../src/server/modules/social/socialSignalsRouter';
import {
  getSignalStats,
  persistSignals,
} from '../src/server/modules/social/socialSignalStore';
import type { SocialSignal } from '../src/server/modules/social/intelligence/socialSignalBus';
import { SOCIAL_SIGNAL_BUS_VERSION } from '../src/server/modules/social/intelligence/socialSignalBus';

const CAMP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NOW = new Date('2026-08-27T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let seq = 1;
function signal(overrides: Partial<SocialSignal> = {}): SocialSignal {
  return {
    dedupKey: overrides.dedupKey ?? `stub::${seq++}`,
    source: overrides.source ?? 'trend',
    severity: overrides.severity ?? 'info',
    summary: overrides.summary ?? 'stub',
    hypotheses: overrides.hypotheses ?? [],
    providers: overrides.providers ?? ['instagram'],
    topic: overrides.topic,
    confidence: overrides.confidence ?? 0.5,
    emittedAt: overrides.emittedAt ?? NOW,
    payload: overrides.payload ?? { kind: 'trend', result: {} as never },
    busVersion: SOCIAL_SIGNAL_BUS_VERSION,
  };
}

// ── getSignalStats ─────────────────────────────────────────────────

describe('getSignalStats — casos base', () => {
  test('lista vazia devolve total=0 e buckets zerados', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date(NOW.getTime() - 3 * DAY),
      until: NOW,
    });
    assert.equal(stats.total, 0);
    assert.equal(stats.bySeverity.info + stats.bySeverity.attention + stats.bySeverity.risk + stats.bySeverity.crisis, 0);
    assert.equal(stats.bySource.trend, 0);
    assert.equal(stats.byProvider.instagram, 0);
    assert.deepEqual(stats.byTopic, {});
    // sinceDate/untilDate presentes e ISO
    assert.ok(stats.sinceDate);
    assert.ok(stats.untilDate);
  });

  test('campaignId obrigatório', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    await assert.rejects(() => getSignalStats(supabase, '', {}));
  });
});

describe('getSignalStats — contagem por dimensão', () => {
  async function seed() {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ severity: 'info', source: 'trend', topic: 'saude', providers: ['instagram'] }),
      signal({ severity: 'info', source: 'trend', topic: 'saude', providers: ['instagram', 'facebook'] }),
      signal({ severity: 'risk', source: 'anomaly', topic: 'seguranca', providers: ['x'] }),
      signal({ severity: 'crisis', source: 'cross_network_anomaly', topic: undefined, providers: ['instagram', 'facebook', 'youtube'] }),
    ]);
    return supabase;
  }

  test('bySeverity', async () => {
    const supabase = await seed();
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date(NOW.getTime() - DAY),
      until: new Date(NOW.getTime() + DAY),
    });
    assert.equal(stats.total, 4);
    assert.equal(stats.bySeverity.info, 2);
    assert.equal(stats.bySeverity.risk, 1);
    assert.equal(stats.bySeverity.crisis, 1);
    assert.equal(stats.bySeverity.attention, 0);
  });

  test('bySource', async () => {
    const supabase = await seed();
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date(NOW.getTime() - DAY),
      until: new Date(NOW.getTime() + DAY),
    });
    assert.equal(stats.bySource.trend, 2);
    assert.equal(stats.bySource.anomaly, 1);
    assert.equal(stats.bySource.cross_network_anomaly, 1);
    assert.equal(stats.bySource.cross_network_trend, 0);
  });

  test('byTopic com "__null__" pra sem topic', async () => {
    const supabase = await seed();
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date(NOW.getTime() - DAY),
      until: new Date(NOW.getTime() + DAY),
    });
    assert.equal(stats.byTopic['saude'], 2);
    assert.equal(stats.byTopic['seguranca'], 1);
    assert.equal(stats.byTopic['__null__'], 1);
  });

  test('byProvider conta N vezes por N providers', async () => {
    const supabase = await seed();
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date(NOW.getTime() - DAY),
      until: new Date(NOW.getTime() + DAY),
    });
    // instagram: 3 (1+1+1 do crisis), facebook: 2 (1+1), youtube: 1 (crisis), x: 1
    assert.equal(stats.byProvider.instagram, 3);
    assert.equal(stats.byProvider.facebook, 2);
    assert.equal(stats.byProvider.youtube, 1);
    assert.equal(stats.byProvider.x, 1);
    assert.equal(stats.byProvider.tiktok, 0);
  });
});

describe('getSignalStats — janela + isolamento', () => {
  async function seedTimeRange() {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ dedupKey: 'now', severity: 'crisis', emittedAt: NOW }),
      signal({ dedupKey: '2h', severity: 'risk', emittedAt: new Date(NOW.getTime() - 2 * HOUR) }),
      signal({ dedupKey: '2d', severity: 'attention', emittedAt: new Date(NOW.getTime() - 2 * DAY) }),
      signal({ dedupKey: '10d', severity: 'info', emittedAt: new Date(NOW.getTime() - 10 * DAY) }),
    ]);
    await persistSignals(supabase, OTHER, [
      signal({ dedupKey: 'other-1', severity: 'crisis', emittedAt: NOW }),
    ]);
    return supabase;
  }

  test('since filtra: só entrar coisa >= since', async () => {
    const supabase = await seedTimeRange();
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date(NOW.getTime() - DAY),
      until: new Date(NOW.getTime() + HOUR),
    });
    // pega now (crisis) e 2h (risk); 2d e 10d ficam fora
    assert.equal(stats.total, 2);
    assert.equal(stats.bySeverity.crisis, 1);
    assert.equal(stats.bySeverity.risk, 1);
  });

  test('until filtra: só entrar coisa < until', async () => {
    const supabase = await seedTimeRange();
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date(NOW.getTime() - 15 * DAY),
      until: new Date(NOW.getTime() - HOUR), // exclui now
    });
    // 2h + 2d + 10d
    assert.equal(stats.total, 3);
    assert.equal(stats.bySeverity.crisis, 0); // now fica de fora
  });

  test('isolamento §35: CAMP não vê OTHER', async () => {
    const supabase = await seedTimeRange();
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date(NOW.getTime() - HOUR),
      until: new Date(NOW.getTime() + HOUR),
    });
    // só 'now' entra; 'other-1' está na OTHER
    assert.equal(stats.total, 1);
    assert.equal(stats.bySeverity.crisis, 1);
  });

  test('default: últimos 7 dias', async () => {
    const supabase = await seedTimeRange();
    const stats = await getSignalStats(supabase, CAMP);
    // now + 2h + 2d (mas NÃO 10d)
    assert.equal(stats.total, 3);
  });
});

// ── Router ────────────────────────────────────────────────────────

interface FakeUser { id?: string; campaignId?: string; type?: string }

function buildApp(user: FakeUser, supabase: ReturnType<typeof createMockSupabase>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { user: FakeUser }).user = user; next(); });
  app.use('/api/v1/social', createSocialSignalsRouter(supabase));
  return app;
}

async function req(app: express.Express, method: string, path: string) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as { port: number }).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
        const text = await res.text();
        let parsed: unknown = null;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.status, body: parsed });
      } catch (err) { reject(err); } finally { server.close(); }
    });
  });
}

describe('GET /signals/stats — auth + shape', () => {
  test('401 sem campaignId', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ id: 'u1' }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals/stats');
    assert.equal(r.status, 401);
  });

  test('200 pra usuário autenticado (não exige Admin)', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP, type: 'Fiscal' }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals/stats');
    assert.equal(r.status, 200);
    const body = r.body as { total: number; bySeverity: Record<string, number> };
    assert.equal(body.total, 0);
    // buckets presentes
    assert.equal(body.bySeverity.info, 0);
  });

  test('devolve counts corretos com dados', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ severity: 'crisis', topic: 'saude', providers: ['instagram', 'facebook'] }),
      signal({ severity: 'risk', topic: 'seguranca', providers: ['x'] }),
    ]);
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals/stats');
    assert.equal(r.status, 200);
    const body = r.body as {
      total: number;
      bySeverity: Record<string, number>;
      byTopic: Record<string, number>;
      byProvider: Record<string, number>;
    };
    assert.equal(body.total, 2);
    assert.equal(body.bySeverity.crisis, 1);
    assert.equal(body.bySeverity.risk, 1);
    assert.equal(body.byTopic.saude, 1);
    assert.equal(body.byProvider.instagram, 1);
    assert.equal(body.byProvider.facebook, 1);
    assert.equal(body.byProvider.x, 1);
  });
});

describe('GET /signals/stats — validação de query', () => {
  test('since inválido → 400', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals/stats?since=not-a-date');
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'invalid_since' });
  });

  test('until inválido → 400', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals/stats?until=bogus');
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'invalid_until' });
  });

  test('since >= until → 400', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals/stats?since=2026-08-27T12:00:00Z&until=2026-08-27T11:00:00Z');
    assert.equal(r.status, 400);
    const body = r.body as { error: string };
    assert.equal(body.error, 'invalid_range');
  });
});

describe('GET /signals/stats — isolamento §35 no HTTP', () => {
  test('CAMP não vê OTHER via endpoint', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [signal({ severity: 'info', dedupKey: 'a' })]);
    await persistSignals(supabase, OTHER, [signal({ severity: 'crisis', dedupKey: 'x' })]);
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals/stats');
    const body = r.body as { total: number; bySeverity: Record<string, number> };
    assert.equal(body.total, 1);
    assert.equal(body.bySeverity.info, 1);
    assert.equal(body.bySeverity.crisis, 0);
  });
});
