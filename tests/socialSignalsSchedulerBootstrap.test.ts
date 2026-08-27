/**
 * Testes do PR 21 — bootstrap env-gated do scheduler
 * (maybeStartSocialSignalsScheduler).
 *
 * Cobre:
 *   - Env sem SOCIAL_SIGNALS_SCHEDULER_ENABLED → null
 *   - Env ENABLED=0 → null
 *   - Env ENABLED=1 → SchedulerHandle
 *   - Interval inválido (letras, negativo, <1000) → default aplicado + warn
 *   - Interval válido → propagado
 *   - runOnStart=1 dispara tick imediato
 *   - persist/broadcast defaults e overrides propagados
 *   - Handle.stop() encerra o loop
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';

import {
  maybeStartSocialSignalsScheduler,
  type SchedulerEnv,
  type SignalsTickOutcome,
} from '../src/server/modules/social/socialSignalsScheduler';

// Silencia stderr do scheduler
let warnings: string[] = [];
let logs: string[] = [];
beforeEach(() => {
  warnings = [];
  logs = [];
  console.warn = (msg: string) => { warnings.push(String(msg)); };
  console.log = (msg: string) => { logs.push(String(msg)); };
});

// ── Env off ─────────────────────────────────────────────────────────

describe('maybeStartSocialSignalsScheduler — env off', () => {
  test('sem SOCIAL_SIGNALS_SCHEDULER_ENABLED → null', () => {
    const supabase = createMockSupabase({});
    const handle = maybeStartSocialSignalsScheduler({ supabase, env: {} });
    assert.equal(handle, null);
  });

  test('ENABLED=0 → null', () => {
    const supabase = createMockSupabase({});
    const handle = maybeStartSocialSignalsScheduler({
      supabase,
      env: { SOCIAL_SIGNALS_SCHEDULER_ENABLED: '0' },
    });
    assert.equal(handle, null);
  });

  test('ENABLED=false (string) → null', () => {
    const supabase = createMockSupabase({});
    const handle = maybeStartSocialSignalsScheduler({
      supabase,
      env: { SOCIAL_SIGNALS_SCHEDULER_ENABLED: 'false' },
    });
    assert.equal(handle, null);
  });
});

// ── Env on ──────────────────────────────────────────────────────────

describe('maybeStartSocialSignalsScheduler — env on', () => {
  test('ENABLED=1 devolve handle e loga info', () => {
    const supabase = createMockSupabase({});
    const env: SchedulerEnv = {
      SOCIAL_SIGNALS_SCHEDULER_ENABLED: '1',
      SOCIAL_SIGNALS_SCHEDULER_INTERVAL_MS: '600000',
    };
    const handle = maybeStartSocialSignalsScheduler({ supabase, env });
    assert.ok(handle);
    assert.equal(handle!.isRunning(), true);
    handle!.stop();
    assert.equal(handle!.isRunning(), false);
    const infoLine = logs.find(l => l.includes('enabled'));
    assert.ok(infoLine, `esperado log "enabled" nos logs: ${logs.join('\n')}`);
    assert.ok(infoLine!.includes('interval=600000ms'));
  });

  test('ENABLED=true (string) → handle', () => {
    const supabase = createMockSupabase({});
    const handle = maybeStartSocialSignalsScheduler({
      supabase,
      env: { SOCIAL_SIGNALS_SCHEDULER_ENABLED: 'true' },
    });
    assert.ok(handle);
    handle!.stop();
  });
});

// ── Interval validation ─────────────────────────────────────────────

describe('maybeStartSocialSignalsScheduler — interval', () => {
  test('interval não-numérico → warn + default', () => {
    const supabase = createMockSupabase({});
    const handle = maybeStartSocialSignalsScheduler({
      supabase,
      env: {
        SOCIAL_SIGNALS_SCHEDULER_ENABLED: '1',
        SOCIAL_SIGNALS_SCHEDULER_INTERVAL_MS: 'abc',
      },
    });
    assert.ok(handle);
    handle!.stop();
    assert.ok(warnings.some(w => w.includes('INTERVAL_MS inválido')));
    // Log de startup deve mostrar o default (900000)
    assert.ok(logs.some(l => l.includes('interval=900000ms')));
  });

  test('interval < 1000 → warn + default', () => {
    const supabase = createMockSupabase({});
    const handle = maybeStartSocialSignalsScheduler({
      supabase,
      env: {
        SOCIAL_SIGNALS_SCHEDULER_ENABLED: '1',
        SOCIAL_SIGNALS_SCHEDULER_INTERVAL_MS: '500',
      },
    });
    assert.ok(handle);
    handle!.stop();
    assert.ok(warnings.some(w => w.includes('INTERVAL_MS inválido')));
  });

  test('interval válido é usado', () => {
    const supabase = createMockSupabase({});
    const handle = maybeStartSocialSignalsScheduler({
      supabase,
      env: {
        SOCIAL_SIGNALS_SCHEDULER_ENABLED: '1',
        SOCIAL_SIGNALS_SCHEDULER_INTERVAL_MS: '5000',
      },
    });
    assert.ok(handle);
    handle!.stop();
    assert.ok(logs.some(l => l.includes('interval=5000ms')));
    assert.equal(warnings.length, 0);
  });

  test('interval string vazia → default (não warn)', () => {
    const supabase = createMockSupabase({});
    const handle = maybeStartSocialSignalsScheduler({
      supabase,
      env: {
        SOCIAL_SIGNALS_SCHEDULER_ENABLED: '1',
        SOCIAL_SIGNALS_SCHEDULER_INTERVAL_MS: '',
      },
    });
    assert.ok(handle);
    handle!.stop();
    assert.equal(warnings.length, 0);
    assert.ok(logs.some(l => l.includes('interval=900000ms')));
  });
});

// ── runOnStart ──────────────────────────────────────────────────────

describe('maybeStartSocialSignalsScheduler — runOnStart', () => {
  test('runOnStart=1 → tick imediato disparado', async () => {
    const supabase = createMockSupabase({ campaign_configs: [], social_posts: [], social_comments: [], social_signals: [] });
    const outcomes: SignalsTickOutcome[] = [];
    const handle = maybeStartSocialSignalsScheduler({
      supabase,
      env: {
        SOCIAL_SIGNALS_SCHEDULER_ENABLED: '1',
        SOCIAL_SIGNALS_SCHEDULER_RUN_ON_START: '1',
        SOCIAL_SIGNALS_SCHEDULER_INTERVAL_MS: '60000',
      },
      onTick: (o) => outcomes.push(o),
    });
    await new Promise(res => setTimeout(res, 30));
    handle!.stop();
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].ok, true);
  });

  test('runOnStart default=0 → sem tick imediato', async () => {
    const supabase = createMockSupabase({});
    const outcomes: SignalsTickOutcome[] = [];
    const handle = maybeStartSocialSignalsScheduler({
      supabase,
      env: {
        SOCIAL_SIGNALS_SCHEDULER_ENABLED: '1',
        SOCIAL_SIGNALS_SCHEDULER_INTERVAL_MS: '60000',
      },
      onTick: (o) => outcomes.push(o),
    });
    await new Promise(res => setTimeout(res, 30));
    handle!.stop();
    assert.equal(outcomes.length, 0);
  });
});

// ── persist / broadcast defaults ────────────────────────────────────

describe('maybeStartSocialSignalsScheduler — persist/broadcast', () => {
  test('defaults: persist=true + broadcast=true propagados', () => {
    const supabase = createMockSupabase({});
    const handle = maybeStartSocialSignalsScheduler({
      supabase,
      env: { SOCIAL_SIGNALS_SCHEDULER_ENABLED: '1' },
    });
    handle!.stop();
    const info = logs.find(l => l.includes('enabled'));
    assert.ok(info);
    assert.ok(info!.includes('persist=true'));
    assert.ok(info!.includes('broadcast=true'));
  });

  test('override: persist=0 + broadcast=0', () => {
    const supabase = createMockSupabase({});
    const handle = maybeStartSocialSignalsScheduler({
      supabase,
      env: {
        SOCIAL_SIGNALS_SCHEDULER_ENABLED: '1',
        SOCIAL_SIGNALS_SCHEDULER_PERSIST: '0',
        SOCIAL_SIGNALS_SCHEDULER_BROADCAST: '0',
      },
    });
    handle!.stop();
    const info = logs.find(l => l.includes('enabled'));
    assert.ok(info);
    assert.ok(info!.includes('persist=false'));
    assert.ok(info!.includes('broadcast=false'));
  });
});
