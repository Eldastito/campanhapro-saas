import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';
import {
  listPlans, subscribeCampaign, getActiveSubscription,
  recordUsage, getUsageForCurrentPeriod, isWithinAiBudget,
  cancelSubscription,
} from '../src/server/modules/billing/billingService';

const CAMPAIGN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function freshSupabase() {
  return createMockSupabase({
    plans: [
      {
        id: 'free', name: 'Gratuito', monthly_cents: 0, active: true,
        features: ['dashboard', 'crm'],
        limits: { contacts: 100, ai_budget_cents: 0, team_users: 2, messages_per_month: 0 },
      },
      {
        id: 'pro', name: 'Pro', monthly_cents: 29900, active: true,
        features: ['dashboard', 'crm', 'ai_agents'],
        limits: { contacts: 10000, ai_budget_cents: 50000, team_users: 25, messages_per_month: 5000 },
      },
      {
        id: 'enterprise', name: 'Enterprise', monthly_cents: 99900, active: true,
        features: ['dashboard', 'crm', 'ai_agents', 'scenarios'],
        limits: { contacts: -1, ai_budget_cents: -1, team_users: -1, messages_per_month: -1 },
      },
    ],
    subscriptions: [],
    usage_records: [],
  });
}

describe('billingService', () => {
  test('listPlans returns active plans sorted by price', async () => {
    const sb = freshSupabase();
    const plans = await listPlans(sb);
    assert.equal(plans.length, 3);
    assert.equal(plans[0].id, 'free');
    assert.equal(plans[2].id, 'enterprise');
  });

  test('subscribeCampaign creates subscription with plan features snapshot', async () => {
    const sb = freshSupabase();
    const sub = await subscribeCampaign(sb, CAMPAIGN, 'pro');
    assert.equal(sub.planId, 'pro');
    assert.equal(sub.status, 'active');
    assert.deepEqual(sub.features, ['dashboard', 'crm', 'ai_agents']);
  });

  test('subscribeCampaign rejects unknown plan', async () => {
    const sb = freshSupabase();
    await assert.rejects(() => subscribeCampaign(sb, CAMPAIGN, 'bogus'), /plan_not_found/);
  });

  test('isWithinAiBudget returns false when no subscription', async () => {
    const sb = freshSupabase();
    assert.equal(await isWithinAiBudget(sb, CAMPAIGN), false);
  });

  test('isWithinAiBudget true for fresh Pro plan, false after exceeding cap', async () => {
    const sb = freshSupabase();
    await subscribeCampaign(sb, CAMPAIGN, 'pro');
    assert.equal(await isWithinAiBudget(sb, CAMPAIGN), true);

    // Record usage that exceeds Pro's 50000-cent cap
    await recordUsage(sb, { campaignId: CAMPAIGN, metric: 'ai_call', costCents: 60000 });
    assert.equal(await isWithinAiBudget(sb, CAMPAIGN), false);
  });

  test('isWithinAiBudget true for Enterprise even after large usage', async () => {
    const sb = freshSupabase();
    await subscribeCampaign(sb, CAMPAIGN, 'enterprise');
    await recordUsage(sb, { campaignId: CAMPAIGN, metric: 'ai_call', costCents: 999_999 });
    assert.equal(await isWithinAiBudget(sb, CAMPAIGN), true);
  });

  test('getUsageForCurrentPeriod aggregates by metric', async () => {
    const sb = freshSupabase();
    await subscribeCampaign(sb, CAMPAIGN, 'pro');
    await recordUsage(sb, { campaignId: CAMPAIGN, metric: 'ai_call', costCents: 100 });
    await recordUsage(sb, { campaignId: CAMPAIGN, metric: 'ai_call', costCents: 250 });
    await recordUsage(sb, { campaignId: CAMPAIGN, metric: 'message_outbound', quantity: 5 });
    await recordUsage(sb, { campaignId: CAMPAIGN, metric: 'simulation' });

    const usage = await getUsageForCurrentPeriod(sb, CAMPAIGN);
    assert.equal(usage.aiCalls, 2);
    assert.equal(usage.aiCostCents, 350);
    assert.equal(usage.messagesOutbound, 5);
    assert.equal(usage.simulations, 1);
  });

  test('cancelSubscription transitions active sub to canceled', async () => {
    const sb = freshSupabase();
    await subscribeCampaign(sb, CAMPAIGN, 'pro');
    await cancelSubscription(sb, CAMPAIGN);
    const sub = await getActiveSubscription(sb, CAMPAIGN);
    assert.equal(sub, null, 'no subscription should be returned with status active|trialing|past_due');
  });

  test('recordUsage never throws on db failure', async () => {
    const broken: any = {
      from: () => ({ insert: async () => { throw new Error('boom'); } }),
    };
    await assert.doesNotReject(() => recordUsage(broken, {
      campaignId: CAMPAIGN, metric: 'ai_call', costCents: 100,
    }));
  });

  test('subscribing twice updates existing subscription (plan change)', async () => {
    const sb = freshSupabase();
    const first = await subscribeCampaign(sb, CAMPAIGN, 'pro');
    const second = await subscribeCampaign(sb, CAMPAIGN, 'enterprise');
    assert.equal(first.id, second.id, 'should reuse subscription row, not create a new one');
    assert.equal(second.planId, 'enterprise');
    assert.deepEqual(second.features, ['dashboard', 'crm', 'ai_agents', 'scenarios']);
  });
});
