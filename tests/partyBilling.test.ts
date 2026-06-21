/**
 * Testes do plano do app Partido no router supremo: lê preço + lista partidos
 * com status de cobrança, edita o preço (upsert em module_prices) e marca/remove
 * "cortesia" (module_subscriptions tenantKind='party', metadata.courtesy).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';
import { createSupremeAdminRouter } from '../src/server/modules/supremeAdmin/supremeAdminRouter';

function buildApp(supabase: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'sup-1', email: 'sup@x.com', isSupremeAdmin: true, userType: 'Suporte' };
    next();
  });
  app.use('/api/v1/supreme', createSupremeAdminRouter(supabase));
  return app;
}

async function req(app: express.Express, method: string, path: string, body?: any) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.status, body: parsed });
      } catch (err) { reject(err); } finally { server.close(); }
    });
  });
}

function seed() {
  return createMockSupabase({
    module_prices: [{ moduleKey: 'partido', monthlyCents: 300000, active: true }],
    parties: [
      { id: 'party-1', name: 'Partido A', presidentId: 'u1', createdAt: '2026-06-01' },
      { id: 'party-2', name: 'Partido B', presidentId: 'u2', createdAt: '2026-06-02' },
    ],
    users: [
      { id: 'u1', email: 'ronald@x.com', name: 'Ronald' },
      { id: 'u2', email: 'b@x.com', name: 'Pres B' },
    ],
    module_subscriptions: [],
    audit_logs: [],
  });
}

describe('supreme party-billing', () => {
  test('GET lista preço + partidos com presidente', async () => {
    const supabase = seed();
    const res = await req(buildApp(supabase), 'GET', '/api/v1/supreme/party-billing');
    assert.equal(res.status, 200);
    assert.equal(res.body.price.monthlyCents, 300000);
    assert.equal(res.body.price.configured, true);
    assert.equal(res.body.parties.length, 2);
    const ronald = res.body.parties.find((p: any) => p.partyId === 'party-1');
    assert.equal(ronald.presidentEmail, 'ronald@x.com');
    assert.equal(ronald.billing, null); // sem cobrança ainda
  });

  test('PUT atualiza o preço (upsert)', async () => {
    const supabase = seed();
    const res = await req(buildApp(supabase), 'PUT', '/api/v1/supreme/party-billing/price', { monthlyCents: 350000 });
    assert.equal(res.status, 200);
    assert.equal(res.body.monthlyCents, 350000);
    assert.equal((supabase as any)._store.get('module_prices')[0].monthlyCents, 350000);
  });

  test('PUT rejeita valor inválido', async () => {
    const supabase = seed();
    const res = await req(buildApp(supabase), 'PUT', '/api/v1/supreme/party-billing/price', { monthlyCents: -5 });
    assert.equal(res.status, 400);
  });

  test('marca cortesia (Ronald): acesso mantido, sem cobrança, flag interna', async () => {
    const supabase = seed();
    const res = await req(buildApp(supabase), 'POST', '/api/v1/supreme/party-billing/party-1/courtesy', { courtesy: true, note: 'Validação do app' });
    assert.equal(res.status, 200);

    const subs = (supabase as any)._store.get('module_subscriptions');
    assert.equal(subs.length, 1);
    assert.equal(subs[0].tenantId, 'party-1');
    assert.equal(subs[0].tenantKind, 'party');
    assert.equal(subs[0].status, 'active');
    assert.equal(subs[0].amountCents, 0);
    assert.equal(subs[0].paymentProvider, 'comp');
    assert.equal(subs[0].metadata.courtesy, true);
    assert.equal(subs[0].metadata.note, 'Validação do app');

    // GET reflete cortesia
    const after = await req(buildApp(supabase), 'GET', '/api/v1/supreme/party-billing');
    const ronald = after.body.parties.find((p: any) => p.partyId === 'party-1');
    assert.equal(ronald.billing.courtesy, true);
  });

  test('GET /parties traz presidente, preço do plano, cortesia e repasses', async () => {
    const supabase = createMockSupabase({
      module_prices: [{ moduleKey: 'partido', monthlyCents: 300000, active: true }],
      parties: [{ id: 'party-1', name: 'Partido A', presidentId: 'u1', status: 'active', createdAt: '2026-06-01' }],
      users: [{ id: 'u1', email: 'ronald@x.com', name: 'Ronald Azaro' }],
      party_candidates: [
        { id: 'c1', partyId: 'party-1', valorRecebido: 1000, valorAlocado: 400 },
        { id: 'c2', partyId: 'party-1', valorRecebido: 500, valorAlocado: 100 },
      ],
      // Ronald marcado como cortesia
      module_subscriptions: [{
        id: 's1', tenantId: 'party-1', tenantKind: 'party', moduleKey: 'partido',
        status: 'active', paymentProvider: 'comp', amountCents: 0, metadata: { courtesy: true, note: 'Validação' },
      }],
    });
    const res = await req(buildApp(supabase), 'GET', '/api/v1/supreme/parties');
    assert.equal(res.status, 200);
    assert.equal(res.body.planMonthlyCents, 300000);
    const p = res.body.parties[0];
    assert.equal(p.presidentName, 'Ronald Azaro');
    assert.equal(p.presidentEmail, 'ronald@x.com');
    assert.equal(p.candidatesCount, 2);
    assert.equal(p.valorRecebido, undefined); // repasses NÃO são mais expostos
    assert.equal(p.valorAlocado, undefined);
    assert.equal(p.courtesy, true);
    assert.equal(p.courtesyNote, 'Validação');
  });

  test('remover cortesia cancela a linha comp', async () => {
    const supabase = seed();
    await req(buildApp(supabase), 'POST', '/api/v1/supreme/party-billing/party-1/courtesy', { courtesy: true });
    const off = await req(buildApp(supabase), 'POST', '/api/v1/supreme/party-billing/party-1/courtesy', { courtesy: false });
    assert.equal(off.status, 200);
    const subs = (supabase as any)._store.get('module_subscriptions');
    assert.equal(subs[0].status, 'canceled');
    assert.equal(subs[0].metadata.courtesy, false);
  });
});
