/**
 * Subscription lifecycle sweeper tests.
 *
 * Uses a frozen `now` so the day-window arithmetic is deterministic regardless
 * of when the test suite is invoked.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';
import {
  runLifecycleSweep, DEFAULT_CONFIG,
} from '../src/server/modules/billing/subscriptionLifecycle';

const NOW = new Date('2026-06-15T12:00:00Z');
const days = (d: number) => d * 24 * 60 * 60 * 1000;

function freshSupabase(overrides: Record<string, any[]> = {}) {
  return createMockSupabase({
    plans: [
      { id: 'free', name: 'Gratuito', monthly_cents: 0, active: true,
        features: ['dashboard', 'crm'], limits: {} },
      { id: 'pro', name: 'Pro', monthly_cents: 29900, active: true,
        features: ['dashboard', 'crm', 'ai_agents'], limits: {} },
    ],
    subscriptions: [],
    users: [],
    email_log: [],
    audit_logs: [],
    ...overrides,
  });
}

const config = {
  reminderDays: [3, 1],
  gracePeriodDays: 7,
  downgradePlanId: 'free',
};

describe('runLifecycleSweep — reminders', () => {
  test('sends reminder 3 days before current_period_end', async () => {
    const dueIn3 = new Date(NOW.getTime() + days(3)).toISOString();
    const sb = freshSupabase({
      subscriptions: [{
        id: 's1', campaign_id: 'c1', plan_id: 'pro', status: 'active',
        current_period_start: NOW.toISOString(),
        current_period_end: dueIn3,
        updated_at: NOW.toISOString(),
      }],
      users: [{ id: 'u1', campaign_id: 'c1', type: 'Admin', email: 'admin@c1.com', name: 'Admin' }],
    });

    const result = await runLifecycleSweep(sb, config, NOW);
    assert.equal(result.remindersSent, 1, 'should send a 3-day reminder');

    const emails = (sb as any)._store.get('email_log');
    const reminder = emails.find((e: any) => e.template === 'payment_upcoming');
    assert.ok(reminder, 'reminder email logged');
    assert.equal(reminder.status, 'sent');
    assert.match(reminder.idempotency_key, /^payment_upcoming:s1:/);
  });

  test('sends reminder 1 day before current_period_end', async () => {
    const dueIn1 = new Date(NOW.getTime() + days(1)).toISOString();
    const sb = freshSupabase({
      subscriptions: [{
        id: 's1', campaign_id: 'c1', plan_id: 'pro', status: 'active',
        current_period_start: NOW.toISOString(),
        current_period_end: dueIn1,
        updated_at: NOW.toISOString(),
      }],
      users: [{ id: 'u1', campaign_id: 'c1', type: 'Admin', email: 'admin@c1.com', name: 'Admin' }],
    });

    const result = await runLifecycleSweep(sb, config, NOW);
    assert.equal(result.remindersSent, 1);
  });

  test('does NOT remind for free plans (monthly_cents=0)', async () => {
    const dueIn3 = new Date(NOW.getTime() + days(3)).toISOString();
    const sb = freshSupabase({
      subscriptions: [{
        id: 's1', campaign_id: 'c1', plan_id: 'free', status: 'active',
        current_period_start: NOW.toISOString(),
        current_period_end: dueIn3, updated_at: NOW.toISOString(),
      }],
      users: [{ id: 'u1', campaign_id: 'c1', type: 'Admin', email: 'admin@c1.com', name: 'Admin' }],
    });
    const result = await runLifecycleSweep(sb, config, NOW);
    assert.equal(result.remindersSent, 0, 'free plans never trigger reminders');
  });

  test('does NOT remind if outside window (e.g. 5 days away)', async () => {
    const dueIn5 = new Date(NOW.getTime() + days(5)).toISOString();
    const sb = freshSupabase({
      subscriptions: [{
        id: 's1', campaign_id: 'c1', plan_id: 'pro', status: 'active',
        current_period_start: NOW.toISOString(),
        current_period_end: dueIn5, updated_at: NOW.toISOString(),
      }],
      users: [{ id: 'u1', campaign_id: 'c1', type: 'Admin', email: 'admin@c1.com', name: 'Admin' }],
    });
    const result = await runLifecycleSweep(sb, config, NOW);
    assert.equal(result.remindersSent, 0);
  });

  test('idempotent — re-running same day does not re-send', async () => {
    const dueIn3 = new Date(NOW.getTime() + days(3)).toISOString();
    const sb = freshSupabase({
      subscriptions: [{
        id: 's1', campaign_id: 'c1', plan_id: 'pro', status: 'active',
        current_period_start: NOW.toISOString(),
        current_period_end: dueIn3, updated_at: NOW.toISOString(),
      }],
      users: [{ id: 'u1', campaign_id: 'c1', type: 'Admin', email: 'admin@c1.com', name: 'Admin' }],
    });

    await runLifecycleSweep(sb, config, NOW);
    await runLifecycleSweep(sb, config, NOW);

    const emails = (sb as any)._store.get('email_log');
    const reminders = emails.filter((e: any) => e.template === 'payment_upcoming');
    assert.equal(reminders.length, 1, 'second sweep should hit the email_log unique key and skip');
  });
});

describe('runLifecycleSweep — auto-downgrade', () => {
  test('downgrades past_due > grace_days to free + sends email', async () => {
    const longAgo = new Date(NOW.getTime() - days(10)).toISOString();
    const sb = freshSupabase({
      subscriptions: [{
        id: 's1', campaign_id: 'c1', plan_id: 'pro', status: 'past_due',
        features: ['dashboard', 'crm', 'ai_agents'],
        current_period_start: longAgo,
        current_period_end: longAgo,
        updated_at: longAgo,
      }],
      users: [{ id: 'u1', campaign_id: 'c1', type: 'Admin', email: 'admin@c1.com', name: 'Admin' }],
    });

    const result = await runLifecycleSweep(sb, config, NOW);
    assert.equal(result.downgraded, 1);

    const sub = (sb as any)._store.get('subscriptions')[0];
    assert.equal(sub.plan_id, 'free', 'plan id changed to free');
    assert.equal(sub.status, 'active', 'status flipped back to active on free plan');
    assert.deepEqual(sub.features, ['dashboard', 'crm']);

    const emails = (sb as any)._store.get('email_log');
    const downgrade = emails.find((e: any) => e.template === 'subscription_downgraded');
    assert.ok(downgrade, 'downgrade email sent');
    assert.match(downgrade.idempotency_key, /^subscription_downgraded:s1/);

    const audits = (sb as any)._store.get('audit_logs');
    assert.ok(audits.find((a: any) => a.action === 'lifecycle.downgrade'));
  });

  test('does NOT downgrade past_due that is still within grace period', async () => {
    const recent = new Date(NOW.getTime() - days(3)).toISOString();
    const sb = freshSupabase({
      subscriptions: [{
        id: 's1', campaign_id: 'c1', plan_id: 'pro', status: 'past_due',
        features: ['dashboard', 'crm', 'ai_agents'],
        current_period_start: recent, current_period_end: recent,
        updated_at: recent,
      }],
      users: [{ id: 'u1', campaign_id: 'c1', type: 'Admin', email: 'admin@c1.com', name: 'Admin' }],
    });

    const result = await runLifecycleSweep(sb, config, NOW);
    assert.equal(result.downgraded, 0);
    const sub = (sb as any)._store.get('subscriptions')[0];
    assert.equal(sub.plan_id, 'pro', 'plan unchanged within grace period');
  });

  test('downgrade is idempotent across re-runs', async () => {
    const longAgo = new Date(NOW.getTime() - days(10)).toISOString();
    const sb = freshSupabase({
      subscriptions: [{
        id: 's1', campaign_id: 'c1', plan_id: 'pro', status: 'past_due',
        features: ['dashboard', 'crm', 'ai_agents'],
        current_period_start: longAgo, current_period_end: longAgo,
        updated_at: longAgo,
      }],
      users: [{ id: 'u1', campaign_id: 'c1', type: 'Admin', email: 'admin@c1.com', name: 'Admin' }],
    });

    const r1 = await runLifecycleSweep(sb, config, NOW);
    const r2 = await runLifecycleSweep(sb, config, NOW);
    assert.equal(r1.downgraded, 1);
    assert.equal(r2.downgraded, 0, 'second sweep finds no past_due to downgrade');

    const audits = (sb as any)._store.get('audit_logs')
      .filter((a: any) => a.action === 'lifecycle.downgrade');
    assert.equal(audits.length, 1);
  });
});

describe('runLifecycleSweep — expired canceled', () => {
  test('canceled subscription past period_end is rebased to free', async () => {
    const expired = new Date(NOW.getTime() - days(2)).toISOString();
    const sb = freshSupabase({
      subscriptions: [{
        id: 's1', campaign_id: 'c1', plan_id: 'pro', status: 'canceled',
        features: ['dashboard', 'crm', 'ai_agents'],
        current_period_start: expired, current_period_end: expired,
        updated_at: expired,
      }],
      users: [{ id: 'u1', campaign_id: 'c1', type: 'Admin', email: 'admin@c1.com' }],
    });

    const result = await runLifecycleSweep(sb, config, NOW);
    assert.equal(result.canceledExpired, 1);

    const sub = (sb as any)._store.get('subscriptions')[0];
    assert.equal(sub.plan_id, 'free');
    assert.equal(sub.status, 'active');
  });

  test('canceled but not yet past period_end is left alone', async () => {
    const future = new Date(NOW.getTime() + days(2)).toISOString();
    const sb = freshSupabase({
      subscriptions: [{
        id: 's1', campaign_id: 'c1', plan_id: 'pro', status: 'canceled',
        features: [], current_period_start: NOW.toISOString(),
        current_period_end: future, updated_at: NOW.toISOString(),
      }],
    });

    const result = await runLifecycleSweep(sb, config, NOW);
    assert.equal(result.canceledExpired, 0);
    const sub = (sb as any)._store.get('subscriptions')[0];
    assert.equal(sub.status, 'canceled', 'still in grace until period_end');
  });
});

describe('runLifecycleSweep — overall', () => {
  test('writes summary audit row with all counters', async () => {
    const sb = freshSupabase();
    const result = await runLifecycleSweep(sb, config, NOW);
    assert.equal(typeof result.ranAt, 'string');
    const audits = (sb as any)._store.get('audit_logs');
    const sweep = audits.find((a: any) => a.action === 'lifecycle.sweep');
    assert.ok(sweep);
    assert.equal(sweep.actor_type, 'system');
  });
});

describe('DEFAULT_CONFIG', () => {
  test('parses LIFECYCLE_REMINDER_DAYS env var', () => {
    assert.ok(Array.isArray(DEFAULT_CONFIG.reminderDays));
    assert.ok(DEFAULT_CONFIG.reminderDays.every(n => Number.isFinite(n) && n > 0));
  });
});
