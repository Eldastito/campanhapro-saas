/**
 * Testes do legalBaseRouter: curadoria da base jurídica (Supreme).
 * Cobre validação do import e o ciclo de revisão (queue → approve/reject),
 * incluindo o efeito colateral em knowledge_chunks. Não exercita o import
 * completo (chama embeddings/OpenAI) — só a validação.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';
import { createLegalBaseRouter } from '../src/server/modules/rag/legalBaseRouter';

function buildApp(supabase: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).user = { id: 'sup-1', isSupremeAdmin: true }; next(); });
  app.use('/api/v1/supreme/legal-base', createLegalBaseRouter(supabase));
  return app;
}

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

describe('legalBaseRouter', () => {
  test('import exige title', async () => {
    const sb = createMockSupabase({ legal_source_documents: [] });
    const r = await req(buildApp(sb), 'POST', '/api/v1/supreme/legal-base/import', { content: 'x', sourceOrg: 'TSE' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'title_required');
  });

  test('import rejeita sourceOrg inválido', async () => {
    const sb = createMockSupabase({ legal_source_documents: [] });
    const r = await req(buildApp(sb), 'POST', '/api/v1/supreme/legal-base/import', { title: 'Res', content: 'x', sourceOrg: 'WIKI' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_sourceOrg');
  });

  test('import exige content ou pdf', async () => {
    const sb = createMockSupabase({ legal_source_documents: [] });
    const r = await req(buildApp(sb), 'POST', '/api/v1/supreme/legal-base/import', { title: 'Res', sourceOrg: 'TSE' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'content_or_pdf_required');
  });

  test('queue lista só pending', async () => {
    const sb = createMockSupabase({ legal_source_documents: [
      { id: 'd1', source: 'A', title: 'A', sourceOrg: 'TSE', status: 'pending', createdAt: '2026-01-02' },
      { id: 'd2', source: 'B', title: 'B', sourceOrg: 'TSE', status: 'active', createdAt: '2026-01-01' },
    ] });
    const r = await req(buildApp(sb), 'GET', '/api/v1/supreme/legal-base/queue');
    assert.equal(r.status, 200);
    assert.equal(r.body.documents.length, 1);
    assert.equal(r.body.documents[0].id, 'd1');
  });

  test('approve ativa o doc e os chunks dele', async () => {
    const sb = createMockSupabase({
      legal_source_documents: [{ id: 'd1', source: 'Res 23607', title: 'Res 23607', sourceOrg: 'TSE', status: 'pending' }],
      knowledge_chunks: [
        { id: 'k1', campaignId: 'global:legal', source: 'Res 23607', status: 'pending' },
        { id: 'k2', campaignId: 'global:legal', source: 'Res 23607', status: 'pending' },
        { id: 'k3', campaignId: 'global:legal', source: 'Outro', status: 'pending' }, // não deve mudar
      ],
    });
    const r = await req(buildApp(sb), 'POST', '/api/v1/supreme/legal-base/d1/approve');
    assert.equal(r.status, 200);
    assert.equal(r.body.document.status, 'active');
    assert.equal(r.body.document.reviewedByUserId, 'sup-1');
    const chunks = (sb as any)._store.get('knowledge_chunks');
    assert.equal(chunks.find((c: any) => c.id === 'k1').status, 'active');
    assert.equal(chunks.find((c: any) => c.id === 'k2').status, 'active');
    assert.equal(chunks.find((c: any) => c.id === 'k3').status, 'pending'); // outro source intacto
  });

  test('reject marca rejected e remove os chunks', async () => {
    const sb = createMockSupabase({
      legal_source_documents: [{ id: 'd1', source: 'Res X', title: 'Res X', sourceOrg: 'TSE', status: 'pending' }],
      knowledge_chunks: [
        { id: 'k1', campaignId: 'global:legal', source: 'Res X', status: 'pending' },
        { id: 'k2', campaignId: 'global:legal', source: 'Mantido', status: 'active' },
      ],
    });
    const r = await req(buildApp(sb), 'POST', '/api/v1/supreme/legal-base/d1/reject', { reason: 'fonte não oficial' });
    assert.equal(r.status, 200);
    assert.equal(r.body.document.status, 'rejected');
    assert.equal(r.body.document.rejectionReason, 'fonte não oficial');
    const chunks = (sb as any)._store.get('knowledge_chunks');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].id, 'k2');
  });

  test('approve de id inexistente → 404', async () => {
    const sb = createMockSupabase({ legal_source_documents: [] });
    const r = await req(buildApp(sb), 'POST', '/api/v1/supreme/legal-base/zzz/approve');
    assert.equal(r.status, 404);
  });
});
