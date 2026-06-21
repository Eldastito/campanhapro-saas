/**
 * Testes do incomesRouter: garante que documentoDoador é cifrado em repouso
 * (no store) e decifrado na resposta, que o escopo de campanha é respeitado,
 * e que a migração de linhas legadas é idempotente + restrita a Admin.
 *
 * Define a chave ANTES de importar (fieldCrypto resolve a chave lazy).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';

process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);

import { createIncomesRouter } from '../src/server/modules/financial/incomesRouter';
import { isEncrypted } from '../src/server/lib/fieldCrypto';

const CAMPAIGN_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMPAIGN_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function buildApp(campaignId: string, supabase: any, userType = 'Admin') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'user-' + campaignId, campaignId, userType };
    next();
  });
  app.use('/api/v1/incomes', createIncomesRouter(supabase));
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

describe('incomesRouter', () => {
  test('POST cifra documentoDoador no store e devolve decifrado', async () => {
    const supabase = createMockSupabase({ incomes: [] });
    const app = buildApp(CAMPAIGN_A, supabase);
    const res = await req(app, 'POST', '/api/v1/incomes', {
      data: '2026-06-01', origem: 'Doação Pessoal', doador: 'Fulano',
      documentoDoador: '123.456.789-00', descricao: 'x', valor: 100,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.income.documentoDoador, '123.456.789-00'); // resposta decifrada

    const stored = (supabase as any)._store.get('incomes')[0];
    assert.ok(isEncrypted(stored.documentoDoador), 'em repouso deve estar cifrado');
    assert.equal(stored.campaignId, CAMPAIGN_A);
    assert.equal(stored.createdBy, 'user-' + CAMPAIGN_A);
  });

  test('GET decifra e retorna só a própria campanha', async () => {
    const supabase = createMockSupabase({ incomes: [] });
    // grava um da A (cifrado pelo POST) e injeta um da B já cifrado
    await req(buildApp(CAMPAIGN_A, supabase), 'POST', '/api/v1/incomes', {
      data: '2026-06-01', origem: 'Doação Pessoal', documentoDoador: 'AAA', descricao: 'a', valor: 1,
    });
    await req(buildApp(CAMPAIGN_B, supabase), 'POST', '/api/v1/incomes', {
      data: '2026-06-02', origem: 'Doação Pessoal', documentoDoador: 'BBB', descricao: 'b', valor: 2,
    });

    const res = await req(buildApp(CAMPAIGN_A, supabase), 'GET', '/api/v1/incomes');
    assert.equal(res.status, 200);
    assert.equal(res.body.incomes.length, 1);
    assert.equal(res.body.incomes[0].documentoDoador, 'AAA');
  });

  test('DELETE não apaga linha de outra campanha', async () => {
    const supabase = createMockSupabase({
      incomes: [{ id: 'x1', campaignId: CAMPAIGN_B, data: '2026-01-01', origem: 'Partido', valor: 9 }],
    });
    const res = await req(buildApp(CAMPAIGN_A, supabase), 'DELETE', '/api/v1/incomes/x1');
    assert.equal(res.status, 200);
    assert.equal((supabase as any)._store.get('incomes').length, 1, 'linha da B deve sobreviver');
  });

  test('migrate-encrypt cifra legado em texto puro, idempotente e Admin-only', async () => {
    const supabase = createMockSupabase({
      incomes: [
        { id: 'leg1', campaignId: CAMPAIGN_A, documentoDoador: '999.888.777-66', valor: 1 },
        { id: 'leg2', campaignId: CAMPAIGN_A, documentoDoador: null, valor: 2 },
      ],
    });
    // não-admin → 403
    const denied = await req(buildApp(CAMPAIGN_A, supabase, 'Apoiador'), 'POST', '/api/v1/incomes/migrate-encrypt');
    assert.equal(denied.status, 403);

    const r1 = await req(buildApp(CAMPAIGN_A, supabase), 'POST', '/api/v1/incomes/migrate-encrypt');
    assert.equal(r1.status, 200);
    assert.equal(r1.body.migrated, 1); // só a linha com valor não-nulo
    assert.ok(isEncrypted((supabase as any)._store.get('incomes')[0].documentoDoador));

    // segunda passada não re-cifra (idempotente)
    const r2 = await req(buildApp(CAMPAIGN_A, supabase), 'POST', '/api/v1/incomes/migrate-encrypt');
    assert.equal(r2.body.migrated, 0);
  });
});
