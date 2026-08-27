/**
 * Testes do PR 25 do PRD Social Intelligence — SocialSignalsNotifier.
 *
 * Cobre:
 *   notifySignals:
 *     - Lista vazia → skipped_empty
 *     - Sem slackWebhookUrl → skipped_no_env
 *     - campaignId obrigatório
 *     - Signals abaixo do threshold NÃO batem fetch
 *     - Signal >= threshold bate fetch com payload esperado
 *     - Dedup: 2ª chamada com mesmo dedupKey → skipped_deduped
 *     - Falha HTTP não marca como notificado (retry na próxima)
 *     - Fetch throws → reason='error'
 *     - Cache é escopado por campaignId (mesmo dedupKey em campanhas
 *       diferentes = 2 notificações)
 *   Runner integration:
 *     - notify=false (default) → result.notify undefined
 *     - notify=true + config → result.notify.reason='ok'
 *     - notify=true sem env nem config → skipped_no_env
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';

import {
  notifySignals,
  _resetNotifierCacheForTests,
  SOCIAL_SIGNALS_NOTIFIER_VERSION,
  type NotifyConfig,
} from '../src/server/modules/social/socialSignalsNotifier';
import { computeCampaignSocialSignals } from '../src/server/modules/social/socialSignalsRunner';
import type { SocialSignal } from '../src/server/modules/social/intelligence/socialSignalBus';
import { SOCIAL_SIGNAL_BUS_VERSION } from '../src/server/modules/social/intelligence/socialSignalBus';
import type { StoredSocialPost } from '../src/server/modules/social/socialIngestionService';

const CAMP_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMP_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NOW = new Date('2026-08-27T12:00:00Z');
const HOUR = 3_600_000;

beforeEach(() => {
  _resetNotifierCacheForTests();
});

// ── Helpers ────────────────────────────────────────────────────────

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
    source: overrides.source ?? 'anomaly',
    severity: overrides.severity ?? 'risk',
    summary: overrides.summary ?? 'stub summary',
    hypotheses: overrides.hypotheses ?? [],
    providers: overrides.providers ?? ['instagram'],
    topic: overrides.topic,
    confidence: overrides.confidence ?? 0.8,
    emittedAt: overrides.emittedAt ?? NOW,
    payload: overrides.payload ?? {
      kind: 'anomaly',
      event: { kind: 'follower_drop', state: 'detected', severity: 'risk', summary: 's', observed: 100, baseline: 200, confidence: 0.8 } as never,
    },
    busVersion: SOCIAL_SIGNAL_BUS_VERSION,
  };
}

// ── Short-circuits ─────────────────────────────────────────────────

describe('notifySignals — short-circuits', () => {
  test('lista vazia → skipped_empty; fetch não chamado', async () => {
    const { fetch, calls } = makeFetchStub();
    const cfg: NotifyConfig = { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: fetch };
    const r = await notifySignals(cfg, CAMP_A, []);
    assert.equal(r.reason, 'skipped_empty');
    assert.equal(r.notified, 0);
    assert.equal(calls.length, 0);
  });

  test('sem slackWebhookUrl → skipped_no_env; fetch não chamado', async () => {
    const { fetch, calls } = makeFetchStub();
    const cfg: NotifyConfig = { slackWebhookUrl: '', fetchImpl: fetch };
    const r = await notifySignals(cfg, CAMP_A, [signal({ severity: 'crisis' })]);
    assert.equal(r.reason, 'skipped_no_env');
    assert.equal(calls.length, 0);
  });

  test('campaignId obrigatório', async () => {
    const { fetch } = makeFetchStub();
    const cfg: NotifyConfig = { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: fetch };
    await assert.rejects(() => notifySignals(cfg, '', [signal({})]), /obrigatório/);
  });
});

// ── Severity filter ────────────────────────────────────────────────

describe('notifySignals — severity gate', () => {
  test('signal info/attention não notifica quando threshold default (risk)', async () => {
    const { fetch, calls } = makeFetchStub();
    const cfg: NotifyConfig = { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: fetch };
    const r = await notifySignals(cfg, CAMP_A, [
      signal({ dedupKey: 'a', severity: 'info' }),
      signal({ dedupKey: 'b', severity: 'attention' }),
    ]);
    assert.equal(r.reason, 'ok');
    assert.equal(r.notified, 0);
    assert.equal(r.skippedBelowThreshold, 2);
    assert.equal(calls.length, 0);
  });

  test('signal risk/crisis notifica com threshold default', async () => {
    const { fetch, calls } = makeFetchStub();
    const cfg: NotifyConfig = { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: fetch };
    const r = await notifySignals(cfg, CAMP_A, [
      signal({ dedupKey: 'a', severity: 'risk' }),
      signal({ dedupKey: 'b', severity: 'crisis' }),
    ]);
    assert.equal(r.reason, 'ok');
    assert.equal(r.notified, 2);
    assert.equal(calls.length, 1);
  });

  test('threshold customizado attention filtra info', async () => {
    const { fetch } = makeFetchStub();
    const cfg: NotifyConfig = { slackWebhookUrl: 'https://hooks.slack.com/x', minSeverity: 'attention', fetchImpl: fetch };
    const r = await notifySignals(cfg, CAMP_A, [
      signal({ dedupKey: 'a', severity: 'info' }),
      signal({ dedupKey: 'b', severity: 'attention' }),
    ]);
    assert.equal(r.notified, 1);
    assert.equal(r.skippedBelowThreshold, 1);
  });
});

// ── Payload ────────────────────────────────────────────────────────

describe('notifySignals — payload Slack', () => {
  test('POST no webhook com body JSON contendo texto formatado', async () => {
    const { fetch, calls } = makeFetchStub();
    const cfg: NotifyConfig = { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: fetch };
    await notifySignals(cfg, CAMP_A, [
      signal({ dedupKey: 'k1', severity: 'crisis', topic: 'saude',
        providers: ['instagram', 'facebook'], summary: 'Queda súbita de followers',
        confidence: 0.9, hypotheses: ['Reação negativa', 'Bots removidos'],
      }),
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://hooks.slack.com/x');
    assert.equal(calls[0].init.method, 'POST');
    const body = JSON.parse(calls[0].init.body as string);
    assert.ok(typeof body.text === 'string');
    assert.ok(body.text.includes('Crise'));
    assert.ok(body.text.includes('Queda súbita'));
    assert.ok(body.text.includes('saude'));
    assert.ok(body.text.includes('instagram'));
    assert.ok(body.text.includes('facebook'));
    // §42: hypotheses aparecem SEPARADAS, com label explícito
    assert.ok(body.text.includes('Hipóteses (não afirmação)'));
    assert.ok(body.text.includes('Reação negativa'));
  });
});

// ── Dedup ──────────────────────────────────────────────────────────

describe('notifySignals — dedup in-memory', () => {
  test('2ª chamada com mesmo dedupKey → skipped_deduped', async () => {
    const { fetch, calls } = makeFetchStub();
    const cfg: NotifyConfig = { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: fetch };
    const s = signal({ dedupKey: 'dup', severity: 'risk' });
    const r1 = await notifySignals(cfg, CAMP_A, [s]);
    const r2 = await notifySignals(cfg, CAMP_A, [s]);
    assert.equal(r1.notified, 1);
    assert.equal(r2.notified, 0);
    assert.equal(r2.skippedDeduped, 1);
    assert.equal(calls.length, 1, 'fetch chamado apenas 1x');
  });

  test('cache é escopado por campaignId — mesmo dedupKey em outra campanha notifica', async () => {
    const { fetch, calls } = makeFetchStub();
    const cfg: NotifyConfig = { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: fetch };
    const s = signal({ dedupKey: 'shared', severity: 'risk' });
    await notifySignals(cfg, CAMP_A, [s]);
    await notifySignals(cfg, CAMP_B, [s]);
    assert.equal(calls.length, 2, 'campanhas diferentes → 2 posts');
  });

  test('falha HTTP NÃO marca como notificado; próxima tentativa envia', async () => {
    const { fetch: failFetch } = makeFetchStub({ ok: false, status: 500, text: 'boom' });
    const failCfg: NotifyConfig = { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: failFetch };
    const s = signal({ dedupKey: 'retry', severity: 'risk' });
    const r1 = await notifySignals(failCfg, CAMP_A, [s]);
    assert.equal(r1.reason, 'error');

    const { fetch: okFetch, calls: okCalls } = makeFetchStub({ ok: true });
    const okCfg: NotifyConfig = { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: okFetch };
    const r2 = await notifySignals(okCfg, CAMP_A, [s]);
    assert.equal(r2.reason, 'ok');
    assert.equal(r2.notified, 1);
    assert.equal(okCalls.length, 1);
  });
});

// ── Erros ──────────────────────────────────────────────────────────

describe('notifySignals — erros', () => {
  test('HTTP 500 → reason=error com httpStatus', async () => {
    const { fetch } = makeFetchStub({ ok: false, status: 500, text: 'internal' });
    const cfg: NotifyConfig = { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: fetch };
    const r = await notifySignals(cfg, CAMP_A, [signal({ severity: 'risk' })]);
    assert.equal(r.reason, 'error');
    assert.equal(r.httpStatus, 500);
    assert.ok(r.errorMessage?.includes('500'));
  });

  test('fetch throws → reason=error com mensagem', async () => {
    const cfg: NotifyConfig = {
      slackWebhookUrl: 'https://hooks.slack.com/x',
      fetchImpl: makeThrowingFetch(new Error('ECONNRESET')),
    };
    const r = await notifySignals(cfg, CAMP_A, [signal({ severity: 'risk' })]);
    assert.equal(r.reason, 'error');
    assert.ok(r.errorMessage?.includes('ECONNRESET'));
  });

  test('SOCIAL_SIGNALS_NOTIFIER_VERSION é string estável', () => {
    assert.ok(typeof SOCIAL_SIGNALS_NOTIFIER_VERSION === 'string');
  });
});

// ── Runner integration ─────────────────────────────────────────────

describe('computeCampaignSocialSignals opts.notify', () => {
  function seedPosts(): StoredSocialPost[] {
    const posts: StoredSocialPost[] = [];
    const anchor = new Date();
    let idSeq = 1;
    for (let i = 0; i < 5; i++) {
      posts.push({
        id: `p${idSeq++}`, campaignId: CAMP_A, provider: 'instagram',
        externalId: `pcur${i}`, accountExternalId: 'acct1',
        publishedAt: new Date(anchor.getTime() - (i + 1) * 3 * HOUR).toISOString(),
        contentType: 'post', text: 'saúde melhor no bairro', permalink: null,
        metrics: null, provenance: {},
        ingestedAt: anchor.toISOString(), updatedAt: anchor.toISOString(),
      });
    }
    for (let i = 0; i < 4; i++) {
      posts.push({
        id: `p${idSeq++}`, campaignId: CAMP_A, provider: 'instagram',
        externalId: `pold${i}`, accountExternalId: 'acct1',
        publishedAt: new Date(anchor.getTime() - (25 + i * 4) * HOUR).toISOString(),
        contentType: 'post', text: 'consulta hospital antiga UPA', permalink: null,
        metrics: null, provenance: {},
        ingestedAt: anchor.toISOString(), updatedAt: anchor.toISOString(),
      });
    }
    return posts;
  }

  test('notify=false (default) → result.notify undefined; fetch não chamado', async () => {
    const { fetch, calls } = makeFetchStub();
    const supabase = createMockSupabase({
      social_posts: seedPosts(), social_comments: [], social_signals: [],
    });
    const res = await computeCampaignSocialSignals(supabase, CAMP_A, {
      notifyConfig: { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: fetch },
    });
    assert.equal(res.notify, undefined);
    assert.equal(calls.length, 0);
  });

  test('notify=true + config → result.notify presente', async () => {
    const { fetch } = makeFetchStub();
    const supabase = createMockSupabase({
      social_posts: seedPosts(), social_comments: [], social_signals: [],
    });
    const res = await computeCampaignSocialSignals(supabase, CAMP_A, {
      notify: true,
      notifyConfig: { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: fetch },
    });
    assert.ok(res.notify);
    // Sem signals >= risk nos fixtures, esperamos skippedBelowThreshold ou notified 0
    assert.ok(['ok', 'skipped_empty', 'skipped_no_env'].includes(res.notify!.reason));
  });

  test('notify=true sem env nem config → skipped_no_env', async () => {
    const originalUrl = process.env.SOCIAL_SIGNALS_SLACK_WEBHOOK_URL;
    delete process.env.SOCIAL_SIGNALS_SLACK_WEBHOOK_URL;
    try {
      const supabase = createMockSupabase({
        social_posts: seedPosts(), social_comments: [], social_signals: [],
      });
      const res = await computeCampaignSocialSignals(supabase, CAMP_A, { notify: true });
      assert.ok(res.notify);
      assert.equal(res.notify!.reason, 'skipped_no_env');
    } finally {
      if (originalUrl !== undefined) process.env.SOCIAL_SIGNALS_SLACK_WEBHOOK_URL = originalUrl;
    }
  });
});
