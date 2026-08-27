/**
 * Testes do PR 28 do PRD Social Intelligence — email notifier bridge.
 *
 * Cobre:
 *   emailNotifySignals(cfg, campaignId, signals):
 *     - Short-circuits (lista vazia, sem recipients, campaignId obrigatório)
 *     - Gate de severity (default 'risk' skipa info/attention)
 *     - Override de threshold (minSeverity='attention')
 *     - Dedup por (campaignId, dedupKey) — segunda chamada não re-envia
 *     - Isolamento: caches de campanhas diferentes não colidem
 *     - Payload shape (subject + html + text; §42 "Hipóteses (não afirmação)")
 *     - Provider falha em TODOS os recipients → error, não marca cache
 *     - Provider falha em 1 de 2 → partial + failedRecipients
 *     - buildEmailTemplate: escape HTML de caracteres perigosos
 *   emailNotifierConfigFromEnv():
 *     - Sem SOCIAL_SIGNALS_NOTIFY_EMAILS → null
 *     - Lista comma-separated com whitespace → trim + filter
 *     - Override de minSeverity via env
 *   Integração via runner:
 *     - emailNotify=false default (sem result.emailNotify)
 *     - emailNotify=true + config → propaga EmailNotifyResult
 *     - emailNotify=true sem env → reason='skipped_no_env'
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  emailNotifySignals,
  emailNotifierConfigFromEnv,
  buildEmailTemplate,
  _resetEmailNotifierCacheForTests,
  type EmailNotifyConfig,
} from '../src/server/modules/social/socialSignalsEmailNotifier';
import type { SocialSignal } from '../src/server/modules/social/intelligence/socialSignalBus';
import { SOCIAL_SIGNAL_BUS_VERSION } from '../src/server/modules/social/intelligence/socialSignalBus';
import { computeCampaignSocialSignals } from '../src/server/modules/social/socialSignalsRunner';
import { createMockSupabase } from './helpers/mockSupabase';
import type { EmailProvider, SendEmailParams, SendEmailResult } from '../src/server/modules/email/emailProvider';

const CAMP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NOW = new Date('2026-08-27T12:00:00Z');

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
    payload: overrides.payload ?? { kind: 'trend', result: {} as never },
    busVersion: SOCIAL_SIGNAL_BUS_VERSION,
  };
}

interface RecordedSend {
  to: string;
  subject: string;
  html: string;
  text: string | undefined;
}

function makeStubProvider(overrides: Partial<Record<string, boolean>> = {}): EmailProvider & { sent: RecordedSend[] } {
  const sent: RecordedSend[] = [];
  const provider: EmailProvider & { sent: RecordedSend[] } = {
    providerName: 'stub' as const,
    sent,
    async sendEmail(p: SendEmailParams): Promise<SendEmailResult> {
      sent.push({ to: p.to, subject: p.subject, html: p.html, text: p.text });
      const ok = overrides[p.to] ?? true;
      return ok
        ? { providerMessageId: `stub-${sent.length}`, ok: true }
        : { providerMessageId: null, ok: false, error: `stub rejected ${p.to}` };
    },
  };
  return provider;
}

beforeEach(() => {
  _resetEmailNotifierCacheForTests();
  seq = 1;
});

// ── Short-circuits ─────────────────────────────────────────────────

describe('emailNotifySignals — short-circuits', () => {
  test('lista vazia devolve skipped_empty sem chamar provider', async () => {
    const provider = makeStubProvider();
    const r = await emailNotifySignals(
      { recipients: ['a@b.com'], provider },
      CAMP,
      [],
    );
    assert.equal(r.reason, 'skipped_empty');
    assert.equal(r.attempted, 0);
    assert.equal(provider.sent.length, 0);
  });

  test('recipients vazio → skipped_no_env', async () => {
    const provider = makeStubProvider();
    const r = await emailNotifySignals(
      { recipients: [], provider },
      CAMP,
      [signal({ severity: 'crisis' })],
    );
    assert.equal(r.reason, 'skipped_no_env');
    assert.equal(r.notified, 0);
    assert.equal(provider.sent.length, 0);
  });

  test('campaignId falsy → throw', async () => {
    const provider = makeStubProvider();
    await assert.rejects(() => emailNotifySignals(
      { recipients: ['a@b.com'], provider },
      '',
      [signal()],
    ));
  });
});

// ── Severity gate ──────────────────────────────────────────────────

describe('emailNotifySignals — filtro de severity', () => {
  test('default minSeverity=risk: info e attention são skipados', async () => {
    const provider = makeStubProvider();
    const r = await emailNotifySignals(
      { recipients: ['a@b.com'], provider },
      CAMP,
      [
        signal({ severity: 'info', dedupKey: 'a' }),
        signal({ severity: 'attention', dedupKey: 'b' }),
        signal({ severity: 'risk', dedupKey: 'c' }),
        signal({ severity: 'crisis', dedupKey: 'd' }),
      ],
    );
    assert.equal(r.reason, 'ok');
    assert.equal(r.attempted, 4);
    assert.equal(r.skippedBelowThreshold, 2);
    assert.equal(r.notified, 2);
    // 1 request pro provider (batched em 1 email)
    assert.equal(provider.sent.length, 1);
  });

  test('minSeverity=attention: só info é skipado', async () => {
    const provider = makeStubProvider();
    const r = await emailNotifySignals(
      { recipients: ['a@b.com'], provider, minSeverity: 'attention' },
      CAMP,
      [
        signal({ severity: 'info', dedupKey: 'a' }),
        signal({ severity: 'attention', dedupKey: 'b' }),
      ],
    );
    assert.equal(r.skippedBelowThreshold, 1);
    assert.equal(r.notified, 1);
  });

  test('todos abaixo do threshold → reason=ok, provider não chamado', async () => {
    const provider = makeStubProvider();
    const r = await emailNotifySignals(
      { recipients: ['a@b.com'], provider },
      CAMP,
      [signal({ severity: 'info' }), signal({ severity: 'attention' })],
    );
    assert.equal(r.reason, 'ok');
    assert.equal(r.skippedBelowThreshold, 2);
    assert.equal(r.notified, 0);
    assert.equal(provider.sent.length, 0);
  });
});

// ── Dedup + isolamento ─────────────────────────────────────────────

describe('emailNotifySignals — dedup por dedupKey', () => {
  test('2ª chamada com mesmo dedupKey → skippedDeduped, provider não chamado', async () => {
    const provider = makeStubProvider();
    const s = signal({ severity: 'crisis', dedupKey: 'same' });
    const r1 = await emailNotifySignals({ recipients: ['a@b.com'], provider }, CAMP, [s]);
    assert.equal(r1.notified, 1);
    assert.equal(provider.sent.length, 1);

    const r2 = await emailNotifySignals({ recipients: ['a@b.com'], provider }, CAMP, [s]);
    assert.equal(r2.reason, 'ok');
    assert.equal(r2.skippedDeduped, 1);
    assert.equal(r2.notified, 0);
    assert.equal(provider.sent.length, 1); // sem novo request
  });

  test('campaign A e B não colidem no dedup', async () => {
    const provider = makeStubProvider();
    const s = signal({ severity: 'crisis', dedupKey: 'shared-key' });
    await emailNotifySignals({ recipients: ['a@b.com'], provider }, CAMP, [s]);
    const r2 = await emailNotifySignals({ recipients: ['a@b.com'], provider }, OTHER, [s]);
    assert.equal(r2.notified, 1);
    assert.equal(r2.skippedDeduped, 0);
    assert.equal(provider.sent.length, 2);
  });

  test('cache isolado do Slack notifier (nada compartilhado)', async () => {
    // Não import direto do slack — só garantimos que o reset do email não
    // afeta ninguém: reset separado é literal (cache separado).
    const provider = makeStubProvider();
    const s = signal({ severity: 'crisis', dedupKey: 'k' });
    await emailNotifySignals({ recipients: ['a@b.com'], provider }, CAMP, [s]);
    _resetEmailNotifierCacheForTests(CAMP);
    const r2 = await emailNotifySignals({ recipients: ['a@b.com'], provider }, CAMP, [s]);
    assert.equal(r2.notified, 1);
  });
});

// ── Payload shape ──────────────────────────────────────────────────

describe('buildEmailTemplate — §42 e shape', () => {
  test('single signal → subject "Sinal <Sev>: <summary80>"', () => {
    const s = signal({ severity: 'crisis', summary: 'protesto na porta da prefeitura', topic: 'seguranca' });
    const t = buildEmailTemplate([s]);
    assert.match(t.subject, /^\[Pulso Digital\] Sinal Crise:/);
    assert.ok(t.subject.includes('protesto na porta da prefeitura'));
  });

  test('multi signals → subject "N sinais — pico <Sev>"', () => {
    const s1 = signal({ severity: 'crisis' });
    const s2 = signal({ severity: 'risk' });
    const t = buildEmailTemplate([s1, s2]);
    assert.match(t.subject, /^\[Pulso Digital\] 2 sinais — pico Crise/);
  });

  test('summary aparece em html e text', () => {
    const s = signal({ severity: 'risk', summary: 'sentimento negativo cresceu' });
    const t = buildEmailTemplate([s]);
    assert.ok(t.html.includes('sentimento negativo cresceu'));
    assert.ok(t.text.includes('sentimento negativo cresceu'));
  });

  test('§42: hypotheses aparecem em bloco separado com rótulo em html', () => {
    const s = signal({
      severity: 'crisis',
      summary: 'volume subiu 3x sobre segurança',
      hypotheses: ['post viral do adversário', 'reação a fala pública'],
    });
    const t = buildEmailTemplate([s]);
    assert.ok(t.html.includes('Hipóteses (não afirmação):'), `html sem rótulo §42: ${t.html.slice(0, 200)}`);
    assert.ok(t.html.includes('post viral do adversário'));
    assert.ok(t.text.includes('Hipóteses (não afirmação):'));
    assert.ok(t.text.includes('post viral do adversário'));
  });

  test('sem hypotheses → nenhum bloco §42 renderizado', () => {
    const s = signal({ severity: 'crisis', hypotheses: [] });
    const t = buildEmailTemplate([s]);
    assert.ok(!t.html.includes('Hipóteses (não afirmação)'));
    assert.ok(!t.text.includes('Hipóteses (não afirmação)'));
  });

  test('escape HTML: <script> no summary não vira tag', () => {
    const s = signal({
      severity: 'crisis',
      summary: '<script>alert(1)</script> texto',
    });
    const t = buildEmailTemplate([s]);
    assert.ok(!t.html.includes('<script>alert(1)</script>'), 'não pode conter <script> cru');
    assert.ok(t.html.includes('&lt;script&gt;'), 'tem que estar escapado');
  });

  test('confidence formatado como %', () => {
    const s = signal({ severity: 'risk', confidence: 0.735 });
    const t = buildEmailTemplate([s]);
    assert.ok(t.html.includes('confidence 74%'));
    assert.ok(t.text.includes('confidence 74%'));
  });
});

// ── Provider fail modes ────────────────────────────────────────────

describe('emailNotifySignals — provider fail modes', () => {
  test('todos recipients rejeitados → reason=error, cache NÃO marcado', async () => {
    const provider = makeStubProvider({ 'a@b.com': false, 'c@d.com': false });
    const s = signal({ severity: 'crisis', dedupKey: 'k1' });
    const r = await emailNotifySignals(
      { recipients: ['a@b.com', 'c@d.com'], provider },
      CAMP,
      [s],
    );
    assert.equal(r.reason, 'error');
    assert.equal(r.notified, 0);
    assert.deepEqual(r.failedRecipients, ['a@b.com', 'c@d.com']);
    // retry seguro: cache não marcado → próxima chamada re-tenta
    const r2 = await emailNotifySignals(
      { recipients: ['e@f.com'], provider: makeStubProvider() },
      CAMP,
      [s],
    );
    assert.equal(r2.notified, 1);
  });

  test('1 de 2 rejeitado → reason=partial + failedRecipients, cache MARCADO', async () => {
    const provider = makeStubProvider({ 'a@b.com': false, 'c@d.com': true });
    const s = signal({ severity: 'crisis', dedupKey: 'k1' });
    const r = await emailNotifySignals(
      { recipients: ['a@b.com', 'c@d.com'], provider },
      CAMP,
      [s],
    );
    assert.equal(r.reason, 'partial');
    assert.equal(r.notified, 1);
    assert.equal(r.deliveredCount, 1);
    assert.deepEqual(r.failedRecipients, ['a@b.com']);
    // cache marcado — próxima chamada com mesmo dedupKey vira skipped
    const r2 = await emailNotifySignals(
      { recipients: ['e@f.com'], provider: makeStubProvider() },
      CAMP,
      [s],
    );
    assert.equal(r2.skippedDeduped, 1);
    assert.equal(r2.notified, 0);
  });
});

// ── Env config ─────────────────────────────────────────────────────

describe('emailNotifierConfigFromEnv', () => {
  test('sem SOCIAL_SIGNALS_NOTIFY_EMAILS → null', () => {
    delete process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS;
    delete process.env.SOCIAL_SIGNALS_EMAIL_NOTIFY_MIN_SEVERITY;
    assert.equal(emailNotifierConfigFromEnv(), null);
  });

  test('lista comma-separated com espaços → trim + filter', () => {
    process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS = '  a@b.com , c@d.com ,  , e@f.com';
    const cfg = emailNotifierConfigFromEnv();
    assert.ok(cfg);
    assert.deepEqual(cfg!.recipients, ['a@b.com', 'c@d.com', 'e@f.com']);
    delete process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS;
  });

  test('minSeverity via env é aplicado', () => {
    process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS = 'a@b.com';
    process.env.SOCIAL_SIGNALS_EMAIL_NOTIFY_MIN_SEVERITY = 'attention';
    const cfg = emailNotifierConfigFromEnv();
    assert.equal(cfg!.minSeverity, 'attention');
    delete process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS;
    delete process.env.SOCIAL_SIGNALS_EMAIL_NOTIFY_MIN_SEVERITY;
  });

  test('minSeverity inválido é descartado', () => {
    process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS = 'a@b.com';
    process.env.SOCIAL_SIGNALS_EMAIL_NOTIFY_MIN_SEVERITY = 'urgente';
    const cfg = emailNotifierConfigFromEnv();
    assert.equal(cfg!.minSeverity, undefined);
    delete process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS;
    delete process.env.SOCIAL_SIGNALS_EMAIL_NOTIFY_MIN_SEVERITY;
  });

  test('lista com só vírgulas/espaços vazios → null', () => {
    process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS = ' , , ';
    assert.equal(emailNotifierConfigFromEnv(), null);
    delete process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS;
  });
});

// ── Runner integration ────────────────────────────────────────────

describe('computeCampaignSocialSignals — emailNotify opt-in', () => {
  test('emailNotify=false (default) → result.emailNotify ausente', async () => {
    const supabase = createMockSupabase({ social_posts: [], social_comments: [], social_signals: [] });
    const r = await computeCampaignSocialSignals(supabase, CAMP);
    assert.equal(r.emailNotify, undefined);
  });

  test('emailNotify=true + config → propaga EmailNotifyResult', async () => {
    const supabase = createMockSupabase({ social_posts: [], social_comments: [], social_signals: [] });
    const provider = makeStubProvider();
    const cfg: EmailNotifyConfig = { recipients: ['a@b.com'], provider };
    const r = await computeCampaignSocialSignals(supabase, CAMP, {
      emailNotify: true,
      emailNotifyConfig: cfg,
    });
    assert.ok(r.emailNotify);
    // Sem posts → pipeline devolve 0 signals → skipped_empty
    assert.equal(r.emailNotify!.reason, 'skipped_empty');
  });

  test('emailNotify=true sem env válido → skipped_no_env', async () => {
    delete process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS;
    const supabase = createMockSupabase({ social_posts: [], social_comments: [], social_signals: [] });
    const r = await computeCampaignSocialSignals(supabase, CAMP, { emailNotify: true });
    assert.ok(r.emailNotify);
    assert.equal(r.emailNotify!.reason, 'skipped_no_env');
  });
});
