/**
 * Testes do contractsRouter: CRUD de contratos (Supreme). Cobre criar (exige
 * título), listar, detalhar, editar e remover.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';
import { createContractsRouter } from '../src/server/modules/contracts/contractsRouter';

function buildApp(supabase: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).user = { id: 'sup-1', isSupremeAdmin: true }; next(); });
  app.use('/api/v1/supreme/contracts', createContractsRouter(supabase));
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

describe('contractsRouter', () => {
  test('POST exige título', async () => {
    const supabase = createMockSupabase({ contracts: [] });
    const res = await req(buildApp(supabase), 'POST', '/api/v1/supreme/contracts', { provider: { razaoSocial: 'X' } });
    assert.equal(res.status, 400);
  });

  test('POST cria com createdBy do servidor e dados variáveis', async () => {
    const supabase = createMockSupabase({ contracts: [] });
    const res = await req(buildApp(supabase), 'POST', '/api/v1/supreme/contracts', {
      title: 'Licenciamento CampanhaPro',
      provider: { razaoSocial: 'Tesseract', cnpj: '00.000.000/0001-00' },
      client: { razaoSocial: 'Cliente LTDA' },
      people: [{ nome: 'Fulano', papel: 'testemunha' }],
      clauses: [{ titulo: 'Confidencialidade', texto: '...' }],
      fields: { valor: 'R$ 3.000', objeto: 'Licença de uso' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.contract.title, 'Licenciamento CampanhaPro');
    assert.equal(res.body.contract.createdBy, 'sup-1');
    assert.equal(res.body.contract.provider.cnpj, '00.000.000/0001-00');
    assert.equal(res.body.contract.clauses[0].titulo, 'Confidencialidade');
  });

  test('GET lista e GET :id detalham', async () => {
    const supabase = createMockSupabase({ contracts: [
      { id: 'c1', title: 'A', status: 'draft', client: { razaoSocial: 'Cli' }, fields: { valor: '10' } },
    ] });
    const list = await req(buildApp(supabase), 'GET', '/api/v1/supreme/contracts');
    assert.equal(list.status, 200);
    assert.equal(list.body.contracts.length, 1);

    const one = await req(buildApp(supabase), 'GET', '/api/v1/supreme/contracts/c1');
    assert.equal(one.status, 200);
    assert.equal(one.body.contract.fields.valor, '10');

    const missing = await req(buildApp(supabase), 'GET', '/api/v1/supreme/contracts/zzz');
    assert.equal(missing.status, 404);
  });

  test('POST :id/sign anexa assinatura e marca como signed', async () => {
    const supabase = createMockSupabase({ contracts: [{ id: 'c1', title: 'A', status: 'draft', signatures: [] }] });
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const r = await req(buildApp(supabase), 'POST', '/api/v1/supreme/contracts/c1/sign', { nome: 'Ronald', papel: 'Contratante', imageDataUrl: png });
    assert.equal(r.status, 200);
    const stored = (supabase as any)._store.get('contracts')[0];
    assert.equal(stored.status, 'signed');
    assert.equal(stored.signatures.length, 1);
    assert.equal(stored.signatures[0].nome, 'Ronald');
    assert.equal(stored.signatures[0].imageDataUrl, png);
  });

  test('POST :id/sign rejeita imagem inválida', async () => {
    const supabase = createMockSupabase({ contracts: [{ id: 'c1', title: 'A', signatures: [] }] });
    const r = await req(buildApp(supabase), 'POST', '/api/v1/supreme/contracts/c1/sign', { imageDataUrl: 'not-an-image' });
    assert.equal(r.status, 400);
  });

  test('PUT edita e DELETE remove', async () => {
    const supabase = createMockSupabase({ contracts: [{ id: 'c1', title: 'A', status: 'draft' }] });
    const upd = await req(buildApp(supabase), 'PUT', '/api/v1/supreme/contracts/c1', { status: 'final' });
    assert.equal(upd.status, 200);
    assert.equal((supabase as any)._store.get('contracts')[0].status, 'final');

    const del = await req(buildApp(supabase), 'DELETE', '/api/v1/supreme/contracts/c1');
    assert.equal(del.status, 200);
    assert.equal((supabase as any)._store.get('contracts').length, 0);
  });
});
