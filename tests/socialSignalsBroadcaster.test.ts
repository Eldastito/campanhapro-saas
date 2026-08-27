/**
 * Testes do PR 18 do PRD Social Intelligence — SocialSignalsBroadcaster.
 *
 * Cobre:
 *   broadcastSignals:
 *     - Lista vazia → skipped_empty (não chama fetch)
 *     - Sem env válido → skipped_no_env (não chama fetch)
 *     - Payload correto: url = /realtime/v1/api/broadcast, headers apikey +
 *       Authorization Bearer, body messages[0].topic/event/payload
 *     - Signals serializados corretamente (Date → ISO)
 *     - HTTP não-ok → reason='error' com httpStatus e errorMessage
 *     - fetch rejects → reason='error'
 *   socialSignalsTopic:
 *     - formato campaign:<id>:social_signals
 *     - throws sem campaignId
 *   Runner integration:
 *     - broadcast=false (default) NÃO chama fetch, result.broadcast=undefined
 *     - broadcast=true + broadcastConfig custom → chama fetch com URL certa
 *     - broadcast=true sem config nem env → skipped_no_env
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';

import {
  broadcastSignals,
  socialSignalsTopic,
  SOCIAL_SIGNALS_BROADCASTER_VERSION,
  type BroadcastConfig,
} from '../src/server/modules/social/socialSignalsBroadcaster';
import { computeCampaignSocialSignals } from '../src/server/modules/social/socialSignalsRunner';
import type { SocialSignal } from '../src/server/modules/social/intelligence/socialSignalBus';
import { SOCIAL_SIGNAL_BUS_VERSION } from '../src/server/modules/social/intelligence/socialSignalBus';
import type { StoredSocialPost } from '../src/server/modules/social/socialIngestionService';

const CAMP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOW = new Date('2026-08-27T12:00:00Z');
const HOUR = 3_600_000;

// ── Helpers ─────────────────────────────────────────────────────────

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function makeFetchStub(response: { ok: boolean; status?: number; text?: string } = { ok: true }): {
  fetch: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      text: async () => response.text ?? (response.ok ? 'ok' : 'error'),
    } as Response;
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function makeThrowingFetch(err: Error): typeof fetch {
  return (async () => { throw err; }) as typeof fetch;
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

// ── socialSignalsTopic ──────────────────────────────────────────────

describe('socialSignalsTopic', () => {
  test('formato campaign:<id>:social_signals', () => {
    assert.equal(socialSignalsTopic('camp-1'), 'campaign:camp-1:social_signals');
  });
  test('throws sem campaignId', () => {
    assert.throws(() => socialSignalsTopic(''), /obrigatório/);
  });
});

// ── broadcastSignals — casos vazios ────────────────────────────────

describe('broadcastSignals — short-circuits', () => {
  test('lista vazia → skipped_empty; fetch não chamado', async () => {
    const { fetch, calls } = makeFetchStub();
    const cfg: BroadcastConfig = { supabaseUrl: 'https://x.supabase.co', serviceRoleKey: 'srk', fetchImpl: fetch };
    const r = await broadcastSignals(cfg, CAMP, []);
    assert.equal(r.reason, 'skipped_empty');
    assert.equal(r.attempted, 0);
    assert.equal(r.broadcast, 0);
    assert.equal(calls.length, 0);
  });

  test('sem supabaseUrl → skipped_no_env', async () => {
    const { fetch, calls } = makeFetchStub();
    const cfg: BroadcastConfig = { supabaseUrl: '', serviceRoleKey: 'srk', fetchImpl: fetch };
    const r = await broadcastSignals(cfg, CAMP, [signal({})]);
    assert.equal(r.reason, 'skipped_no_env');
    assert.equal(r.broadcast, 0);
    assert.equal(calls.length, 0);
  });

  test('sem serviceRoleKey → skipped_no_env', async () => {
    const { fetch, calls } = makeFetchStub();
    const cfg: BroadcastConfig = { supabaseUrl: 'https://x.supabase.co', serviceRoleKey: '', fetchImpl: fetch };
    const r = await broadcastSignals(cfg, CAMP, [signal({})]);
    assert.equal(r.reason, 'skipped_no_env');
    assert.equal(calls.length, 0);
  });

  test('campaignId obrigatório', async () => {
    const { fetch } = makeFetchStub();
    const cfg: BroadcastConfig = { supabaseUrl: 'https://x.supabase.co', serviceRoleKey: 'srk', fetchImpl: fetch };
    await assert.rejects(() => broadcastSignals(cfg, '', [signal({})]), /obrigatório/);
  });
});

// ── broadcastSignals — happy path ───────────────────────────────────

describe('broadcastSignals — happy path', () => {
  test('POST em /realtime/v1/api/broadcast com apikey e Bearer', async () => {
    const { fetch, calls } = makeFetchStub({ ok: true });
    const cfg: BroadcastConfig = {
      supabaseUrl: 'https://x.supabase.co',
      serviceRoleKey: 'srk-secret',
      fetchImpl: fetch,
    };
    const r = await broadcastSignals(cfg, CAMP, [signal({ dedupKey: 'a', severity: 'risk' })]);
    assert.equal(r.reason, 'ok');
    assert.equal(r.broadcast, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://x.supabase.co/realtime/v1/api/broadcast');
    const init = calls[0].init;
    assert.equal(init.method, 'POST');
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.apikey, 'srk-secret');
    assert.equal(headers.Authorization, 'Bearer srk-secret');
    assert.equal(headers['Content-Type'], 'application/json');
  });

  test('body.messages[0] tem topic + event + payload.signals serializados', async () => {
    const { fetch, calls } = makeFetchStub({ ok: true });
    const cfg: BroadcastConfig = { supabaseUrl: 'https://x.supabase.co', serviceRoleKey: 'srk', fetchImpl: fetch };
    const s = signal({
      dedupKey: 'k1',
      severity: 'crisis',
      topic: 'saude',
      providers: ['instagram', 'facebook'],
      emittedAt: new Date('2026-08-27T10:00:00Z'),
    });
    await broadcastSignals(cfg, CAMP, [s]);
    const body = JSON.parse(calls[0].init.body as string);
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].topic, `campaign:${CAMP}:social_signals`);
    assert.equal(body.messages[0].event, 'new');
    const payload = body.messages[0].payload;
    assert.equal(payload.signals.length, 1);
    assert.equal(payload.signals[0].dedupKey, 'k1');
    assert.equal(payload.signals[0].severity, 'crisis');
    assert.equal(payload.signals[0].topic, 'saude');
    assert.equal(payload.signals[0].emittedAt, '2026-08-27T10:00:00.000Z');
    assert.equal(payload.broadcasterVersion, SOCIAL_SIGNALS_BROADCASTER_VERSION);
    assert.ok(typeof payload.emittedAt === 'string');
  });

  test('supabaseUrl com trailing slash é normalizado', async () => {
    const { fetch, calls } = makeFetchStub({ ok: true });
    const cfg: BroadcastConfig = { supabaseUrl: 'https://x.supabase.co/', serviceRoleKey: 'srk', fetchImpl: fetch };
    await broadcastSignals(cfg, CAMP, [signal({})]);
    assert.equal(calls[0].url, 'https://x.supabase.co/realtime/v1/api/broadcast');
  });

  test('topic sem valor vai como null (não undefined)', async () => {
    const { fetch, calls } = makeFetchStub({ ok: true });
    const cfg: BroadcastConfig = { supabaseUrl: 'https://x.supabase.co', serviceRoleKey: 'srk', fetchImpl: fetch };
    await broadcastSignals(cfg, CAMP, [signal({ topic: undefined })]);
    const body = JSON.parse(calls[0].init.body as string);
    assert.equal(body.messages[0].payload.signals[0].topic, null);
  });
});

// ── broadcastSignals — erros ────────────────────────────────────────

describe('broadcastSignals — erros', () => {
  test('HTTP 500 → reason=error, httpStatus preservado, mensagem inclui detail', async () => {
    const { fetch } = makeFetchStub({ ok: false, status: 500, text: 'internal server error' });
    const cfg: BroadcastConfig = { supabaseUrl: 'https://x.supabase.co', serviceRoleKey: 'srk', fetchImpl: fetch };
    const r = await broadcastSignals(cfg, CAMP, [signal({})]);
    assert.equal(r.reason, 'error');
    assert.equal(r.httpStatus, 500);
    assert.ok(r.errorMessage?.includes('500'));
  });

  test('fetch rejects → reason=error com mensagem do throw', async () => {
    const cfg: BroadcastConfig = {
      supabaseUrl: 'https://x.supabase.co',
      serviceRoleKey: 'srk',
      fetchImpl: makeThrowingFetch(new Error('ECONNREFUSED')),
    };
    const r = await broadcastSignals(cfg, CAMP, [signal({})]);
    assert.equal(r.reason, 'error');
    assert.ok(r.errorMessage?.includes('ECONNREFUSED'));
  });
});

// ── Runner integration ─────────────────────────────────────────────

describe('computeCampaignSocialSignals opts.broadcast', () => {
  function seedPosts(): StoredSocialPost[] {
    const posts: StoredSocialPost[] = [];
    const anchor = new Date();
    let idSeq = 1;
    for (let i = 0; i < 5; i++) {
      posts.push({
        id: `p${idSeq++}`, campaignId: CAMP, provider: 'instagram',
        externalId: `pcur${i}`, accountExternalId: 'acct1',
        publishedAt: new Date(anchor.getTime() - (i + 1) * 3 * HOUR).toISOString(),
        contentType: 'post', text: 'saúde melhor no bairro', permalink: null,
        metrics: null, provenance: {},
        ingestedAt: anchor.toISOString(), updatedAt: anchor.toISOString(),
      });
    }
    for (let i = 0; i < 4; i++) {
      posts.push({
        id: `p${idSeq++}`, campaignId: CAMP, provider: 'instagram',
        externalId: `pold${i}`, accountExternalId: 'acct1',
        publishedAt: new Date(anchor.getTime() - (25 + i * 4) * HOUR).toISOString(),
        contentType: 'post', text: 'consulta hospital antiga UPA', permalink: null,
        metrics: null, provenance: {},
        ingestedAt: anchor.toISOString(), updatedAt: anchor.toISOString(),
      });
    }
    return posts;
  }

  test('broadcast=false (default) → result.broadcast=undefined; fetch não chamado', async () => {
    const { fetch, calls } = makeFetchStub({ ok: true });
    const supabase = createMockSupabase({ social_posts: seedPosts(), social_comments: [], social_signals: [] });
    const res = await computeCampaignSocialSignals(supabase, CAMP, {
      broadcastConfig: { supabaseUrl: 'https://x.supabase.co', serviceRoleKey: 'srk', fetchImpl: fetch },
    });
    assert.equal(res.broadcast, undefined);
    assert.equal(calls.length, 0);
  });

  test('broadcast=true + broadcastConfig custom → chama fetch e devolve result.broadcast.reason=ok', async () => {
    const { fetch, calls } = makeFetchStub({ ok: true });
    const supabase = createMockSupabase({ social_posts: seedPosts(), social_comments: [], social_signals: [] });
    const res = await computeCampaignSocialSignals(supabase, CAMP, {
      broadcast: true,
      broadcastConfig: { supabaseUrl: 'https://x.supabase.co', serviceRoleKey: 'srk', fetchImpl: fetch },
    });
    assert.ok(res.broadcast);
    assert.equal(res.broadcast!.reason, 'ok');
    assert.equal(res.broadcast!.broadcast, res.signals.length);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://x.supabase.co/realtime/v1/api/broadcast');
  });

  test('broadcast=true sem config nem env → skipped_no_env', async () => {
    // sanitizar env
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const supabase = createMockSupabase({ social_posts: seedPosts(), social_comments: [], social_signals: [] });
      const res = await computeCampaignSocialSignals(supabase, CAMP, { broadcast: true });
      assert.ok(res.broadcast);
      assert.equal(res.broadcast!.reason, 'skipped_no_env');
    } finally {
      if (originalUrl !== undefined) process.env.SUPABASE_URL = originalUrl;
      if (originalKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  });

  test('persist=true + broadcast=true coexistem: ambos rodam, ambos aparecem no result', async () => {
    const { fetch, calls } = makeFetchStub({ ok: true });
    const supabase = createMockSupabase({ social_posts: seedPosts(), social_comments: [], social_signals: [] });
    const res = await computeCampaignSocialSignals(supabase, CAMP, {
      persist: true,
      broadcast: true,
      broadcastConfig: { supabaseUrl: 'https://x.supabase.co', serviceRoleKey: 'srk', fetchImpl: fetch },
    });
    assert.ok(res.persist);
    assert.equal(res.persist!.reason, 'ok');
    assert.ok(res.broadcast);
    assert.equal(res.broadcast!.reason, 'ok');
    assert.equal(calls.length, 1, 'broadcast fetch called once');
  });
});
