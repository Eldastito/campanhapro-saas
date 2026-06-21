/**
 * Testes do legalShieldRouter (módulo Blindagem, por campanha): gate de acesso
 * (Admin/Coordenador), validação do /review e leitura de pareceres/dashboard.
 * O /review completo chama IA — aqui só a validação (que ocorre antes da chamada).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';
import { createLegalShieldRouter } from '../src/server/modules/rag/legalShieldRouter';

function buildApp(supabase: any, user: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).user = user; next(); });
  app.use('/api/v1/legal-shield', createLegalShieldRouter(supabase));
  return app;
}

const ADMIN = { id: 'u1', campaignId: 'c1', userType: 'Admin' };

async function req(app: express.Express, method: string, path: string, body?: any) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method, headers: { 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let parsed: any = null; try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.status, body: parsed });
      } catch (err) { reject(err); } finally { server.close(); }
    });
  });
}

describe('legalShieldRouter', () => {
  test('membro comum é bloqueado (403)', async () => {
    const sb = createMockSupabase({ legal_opinions: [] });
    const app = buildApp(sb, { id: 'u2', campaignId: 'c1', userType: 'Membro' });
    const r = await req(app, 'GET', '/api/v1/legal-shield/opinions');
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'admin_required');
  });

  test('review rejeita kind inválido', async () => {
    const sb = createMockSupabase({ legal_opinions: [] });
    const r = await req(buildApp(sb, ADMIN), 'POST', '/api/v1/legal-shield/review', { kind: 'foo', description: 'x' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_kind');
  });

  test('review exige description', async () => {
    const sb = createMockSupabase({ legal_opinions: [] });
    const r = await req(buildApp(sb, ADMIN), 'POST', '/api/v1/legal-shield/review', { kind: 'donation' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'description_required');
  });

  test('GET opinions lista só a campanha do usuário', async () => {
    const sb = createMockSupabase({ legal_opinions: [
      { id: 'o1', campaignId: 'c1', title: 'Doação X', subjectType: 'donation', riskLevel: 'alto', status: 'final', createdAt: '2026-02-02' },
      { id: 'o2', campaignId: 'c2', title: 'Outro', subjectType: 'expense', riskLevel: 'baixo', status: 'final', createdAt: '2026-02-01' },
    ] });
    const r = await req(buildApp(sb, ADMIN), 'GET', '/api/v1/legal-shield/opinions');
    assert.equal(r.status, 200);
    assert.equal(r.body.opinions.length, 1);
    assert.equal(r.body.opinions[0].id, 'o1');
  });

  test('GET opinions/:id traz parecer + citações; 404 fora da campanha', async () => {
    const sb = createMockSupabase({
      legal_opinions: [{ id: 'o1', campaignId: 'c1', title: 'Doação X', legalText: 'parecer...', riskLevel: 'alto' }],
      legal_opinion_citations: [
        { id: 'ct1', opinionId: 'o1', campaignId: 'c1', sourceOrg: 'TSE', excerpt: '...' },
      ],
    });
    const ok = await req(buildApp(sb, ADMIN), 'GET', '/api/v1/legal-shield/opinions/o1');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.opinion.id, 'o1');
    assert.equal(ok.body.citations.length, 1);

    // parecer de outra campanha não vaza
    const sb2 = createMockSupabase({ legal_opinions: [{ id: 'o9', campaignId: 'c2', title: 'Alheio' }] });
    const miss = await req(buildApp(sb2, ADMIN), 'GET', '/api/v1/legal-shield/opinions/o9');
    assert.equal(miss.status, 404);
  });

  test('dashboard agrega por nível de risco', async () => {
    const sb = createMockSupabase({ legal_opinions: [
      { id: 'o1', campaignId: 'c1', title: 'A', riskLevel: 'alto', createdAt: '2026-02-03' },
      { id: 'o2', campaignId: 'c1', title: 'B', riskLevel: 'crítico', createdAt: '2026-02-02' },
      { id: 'o3', campaignId: 'c1', title: 'C', riskLevel: 'baixo', createdAt: '2026-02-01' },
    ] });
    const r = await req(buildApp(sb, ADMIN), 'GET', '/api/v1/legal-shield/dashboard');
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 3);
    assert.equal(r.body.byRisk['alto'], 1);
    assert.equal(r.body.byRisk['crítico'], 1);
    assert.equal(r.body.openHighRisk.length, 2);
  });
});
