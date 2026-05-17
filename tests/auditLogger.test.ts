import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { audit, actorFromRequest } from '../src/server/modules/observability/auditLogger';
import { createMockSupabase } from './helpers/mockSupabase';

describe('auditLogger', () => {
  test('writes to audit_logs with camelCase columns and defaults', async () => {
    const supabase = createMockSupabase({ audit_logs: [] });
    await audit(supabase, {
      campaignId: 'c1',
      actorId: 'u1',
      action: 'dossier.approve',
      resourceType: 'dossier',
      resourceId: 'd1',
      severity: 'warn',
      metadata: { foo: 'bar' },
    });
    const rows = (supabase as any)._store.get('audit_logs');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].campaignId, 'c1');
    assert.equal(rows[0].actorId, 'u1');
    assert.equal(rows[0].actorType, 'user');
    assert.equal(rows[0].action, 'dossier.approve');
    assert.equal(rows[0].resourceType, 'dossier');
    assert.equal(rows[0].severity, 'warn');
    assert.deepEqual(rows[0].metadata, { foo: 'bar' });
  });

  test('audit failure never throws', async () => {
    const broken: any = {
      from: () => ({
        insert: async () => {
          throw new Error('connection refused');
        },
      }),
    };
    await assert.doesNotReject(() =>
      audit(broken, { action: 'test.action', actorType: 'system' }),
    );
  });

  test('actorFromRequest extracts auth context', () => {
    const req: any = {
      user: { id: 'u1', campaignId: 'c1' },
      ip: '203.0.113.5',
      get: (h: string) => (h === 'user-agent' ? 'Mozilla/5.0' : undefined),
      traceId: 'trace-abc',
    };
    const actor = actorFromRequest(req);
    assert.equal(actor.actorId, 'u1');
    assert.equal(actor.campaignId, 'c1');
    assert.equal(actor.ipAddress, '203.0.113.5');
    assert.equal(actor.userAgent, 'Mozilla/5.0');
    assert.equal(actor.traceId, 'trace-abc');
  });
});
