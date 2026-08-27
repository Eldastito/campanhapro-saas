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

// ── statsCsv ──────────────────────────────────────────────────────

import { statsCsv, statsCsvFilename } from '../src/server/modules/social/socialSignalsCsvExporter';

const UTF8_BOM = '﻿';

describe('statsCsv — shape e blocos', () => {
  test('BOM + header meta como primeira linha', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date('2026-08-20T00:00:00Z'),
      until: new Date('2026-08-27T00:00:00Z'),
    });
    const csv = statsCsv(stats);
    assert.ok(csv.startsWith(UTF8_BOM));
    const withoutBom = csv.slice(UTF8_BOM.length);
    const lines = withoutBom.split('\r\n');
    assert.equal(lines[0], 'section,key,value');
    assert.equal(lines[1], 'meta,sinceDate,2026-08-20T00:00:00.000Z');
    assert.equal(lines[2], 'meta,untilDate,2026-08-27T00:00:00.000Z');
    assert.equal(lines[3], 'meta,total,0');
  });

  test('bloco bySeverity contém os 4 níveis', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ severity: 'crisis' }),
      signal({ severity: 'crisis' }),
      signal({ severity: 'risk' }),
    ]);
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date(NOW.getTime() - DAY),
      until: new Date(NOW.getTime() + HOUR),
    });
    const csv = statsCsv(stats).slice(UTF8_BOM.length);
    assert.ok(csv.includes('bySeverity,count'));
    assert.ok(csv.includes('crisis,2'));
    assert.ok(csv.includes('risk,1'));
    assert.ok(csv.includes('attention,0'));
    assert.ok(csv.includes('info,0'));
  });

  test('bloco byTopic renderiza "__null__" como "(sem topic)"', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ topic: undefined }),
      signal({ topic: 'saude' }),
    ]);
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date(NOW.getTime() - DAY),
      until: new Date(NOW.getTime() + HOUR),
    });
    const csv = statsCsv(stats).slice(UTF8_BOM.length);
    assert.ok(csv.includes('byTopic,count'));
    assert.ok(csv.includes('(sem topic),1'));
    assert.ok(csv.includes('saude,1'));
  });

  test('bloco byDay só quando bucket=day', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ severity: 'crisis', emittedAt: new Date('2026-08-26T10:00:00Z') }),
    ]);
    const statsNoBucket = await getSignalStats(supabase, CAMP, {
      since: new Date('2026-08-25T00:00:00Z'),
      until: new Date('2026-08-28T00:00:00Z'),
    });
    const csvNoBucket = statsCsv(statsNoBucket);
    assert.ok(!csvNoBucket.includes('byDay'));

    const statsWithBucket = await getSignalStats(supabase, CAMP, {
      since: new Date('2026-08-25T00:00:00Z'),
      until: new Date('2026-08-28T00:00:00Z'),
      bucket: 'day',
    });
    const csvWithBucket = statsCsv(statsWithBucket);
    assert.ok(csvWithBucket.includes('byDay,total,crisis,risk,attention,info'));
    assert.ok(csvWithBucket.includes('2026-08-26,1,1,0,0,0'));
  });
});

describe('statsCsvFilename', () => {
  test('formato signals-stats-<short>-<stamp>.csv', () => {
    const out = statsCsvFilename(CAMP, new Date('2026-08-27T14:22:00Z'));
    assert.equal(out, 'signals-stats-aaaaaaaa-202608271422.csv');
  });

  test('campaignId inválido cai em "campaign"', () => {
    const out = statsCsvFilename('!!!', new Date('2026-08-27T00:00:00Z'));
    assert.match(out, /^signals-stats-campaign-\d{12}\.csv$/);
  });
});

describe('GET /signals/stats?format=csv', () => {
  test('200 text/csv com Content-Disposition attachment', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ severity: 'crisis', topic: 'saude', providers: ['instagram', 'facebook'] }),
    ]);
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await httpReq(app, 'GET', '/api/v1/social/signals/stats?format=csv');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /text\/csv/);
    const dispo = r.headers.get('content-disposition') ?? '';
    assert.match(dispo, /^attachment; filename="signals-stats-aaaaaaaa-\d{12}\.csv"$/);
  });

  test('body começa com BOM (0xEF 0xBB 0xBF)', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await httpReq(app, 'GET', '/api/v1/social/signals/stats?format=csv');
    assert.equal(r.bytes[0], 0xEF);
    assert.equal(r.bytes[1], 0xBB);
    assert.equal(r.bytes[2], 0xBF);
  });

  test('bucket=day + format=csv → bloco byDay presente', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ severity: 'risk', emittedAt: new Date('2026-08-26T10:00:00Z') }),
    ]);
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await httpReq(app, 'GET', '/api/v1/social/signals/stats?format=csv&bucket=day&since=2026-08-25T00:00:00Z&until=2026-08-28T00:00:00Z');
    assert.equal(r.status, 200);
    assert.ok(r.text.includes('byDay,total,crisis,risk,attention,info'));
    assert.ok(r.text.includes('2026-08-26,1,0,1,0,0'));
  });

  test('format inválido → 400 JSON', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await httpReq(app, 'GET', '/api/v1/social/signals/stats?format=xml');
    assert.equal(r.status, 400);
  });
});

// Helper HTTP que devolve bytes crus (BOM detection). Reusa buildApp já
// definido acima; renomeado pra evitar shadow.
async function httpReq(app: express.Express, method: string, path: string) {
  return new Promise<{ status: number; text: string; bytes: Uint8Array; headers: Headers }>((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as { port: number }).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const text = new TextDecoder('utf-8').decode(bytes);
        resolve({ status: res.status, text, bytes, headers: res.headers });
      } catch (err) { reject(err); } finally { server.close(); }
    });
  });
}

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

// ── bucket=day ─────────────────────────────────────────────────────

describe('getSignalStats — bucket=day', () => {
  test('sem bucket, byDay ausente', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date(NOW.getTime() - DAY),
      until: new Date(NOW.getTime() + HOUR),
    });
    assert.equal(stats.byDay, undefined);
  });

  test('bucket=day devolve buckets pre-populados (zeros pra dias vazios)', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    // intervalo de 3 dias
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date('2026-08-25T00:00:00Z'),
      until: new Date('2026-08-28T00:00:00Z'),
      bucket: 'day',
    });
    assert.ok(Array.isArray(stats.byDay));
    // 25, 26, 27 → 3 dias
    assert.equal(stats.byDay!.length, 3);
    assert.deepEqual(stats.byDay!.map(b => b.date), ['2026-08-25', '2026-08-26', '2026-08-27']);
    // todos zerados
    for (const b of stats.byDay!) {
      assert.equal(b.total, 0);
      assert.equal(b.crisis, 0);
      assert.equal(b.risk, 0);
      assert.equal(b.attention, 0);
      assert.equal(b.info, 0);
    }
  });

  test('bucket=day distribui signals no dia UTC correto', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ dedupKey: 'a', severity: 'crisis', emittedAt: new Date('2026-08-25T12:00:00Z') }),
      signal({ dedupKey: 'b', severity: 'risk', emittedAt: new Date('2026-08-25T23:00:00Z') }),
      signal({ dedupKey: 'c', severity: 'attention', emittedAt: new Date('2026-08-26T02:00:00Z') }),
      signal({ dedupKey: 'd', severity: 'info', emittedAt: new Date('2026-08-27T10:00:00Z') }),
    ]);
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date('2026-08-25T00:00:00Z'),
      until: new Date('2026-08-28T00:00:00Z'),
      bucket: 'day',
    });
    assert.equal(stats.byDay!.length, 3);
    const day25 = stats.byDay!.find(b => b.date === '2026-08-25')!;
    assert.equal(day25.total, 2);
    assert.equal(day25.crisis, 1);
    assert.equal(day25.risk, 1);
    const day26 = stats.byDay!.find(b => b.date === '2026-08-26')!;
    assert.equal(day26.total, 1);
    assert.equal(day26.attention, 1);
    const day27 = stats.byDay!.find(b => b.date === '2026-08-27')!;
    assert.equal(day27.total, 1);
    assert.equal(day27.info, 1);
  });

  test('bucket=day: dias com signals somam por severity, dias sem ficam zerados', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ dedupKey: 'x1', severity: 'crisis', emittedAt: new Date('2026-08-25T10:00:00Z') }),
      signal({ dedupKey: 'x2', severity: 'crisis', emittedAt: new Date('2026-08-27T10:00:00Z') }),
    ]);
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date('2026-08-25T00:00:00Z'),
      until: new Date('2026-08-28T00:00:00Z'),
      bucket: 'day',
    });
    // 3 dias: 25 tem 1 crisis, 26 zero, 27 tem 1 crisis
    const day26 = stats.byDay!.find(b => b.date === '2026-08-26')!;
    assert.equal(day26.total, 0);
    assert.equal(day26.crisis, 0);
    // ordem ASC preservada
    assert.deepEqual(stats.byDay!.map(b => b.date), ['2026-08-25', '2026-08-26', '2026-08-27']);
  });

  test('bucket=day quando until cai no meio do dia → dia atual entra', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const stats = await getSignalStats(supabase, CAMP, {
      since: new Date('2026-08-26T00:00:00Z'),
      until: new Date('2026-08-27T15:00:00Z'), // meio do dia 27
      bucket: 'day',
    });
    // 26 e 27 devem aparecer
    assert.deepEqual(stats.byDay!.map(b => b.date), ['2026-08-26', '2026-08-27']);
  });
});

describe('GET /signals/stats — bucket=day via HTTP', () => {
  test('bucket=day retorna byDay no payload', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ severity: 'crisis', emittedAt: new Date('2026-08-27T10:00:00Z') }),
    ]);
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals/stats?since=2026-08-26T00:00:00Z&until=2026-08-28T00:00:00Z&bucket=day');
    assert.equal(r.status, 200);
    const body = r.body as { total: number; byDay?: Array<{ date: string; crisis: number }> };
    assert.ok(Array.isArray(body.byDay));
    assert.equal(body.byDay!.length, 2);
    const day27 = body.byDay!.find(b => b.date === '2026-08-27')!;
    assert.equal(day27.crisis, 1);
  });

  test('bucket=xyz → 400 invalid_bucket', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals/stats?bucket=week');
    assert.equal(r.status, 400);
    const body = r.body as { error: string };
    assert.equal(body.error, 'invalid_bucket');
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
