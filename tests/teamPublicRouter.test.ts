/**
 * Testes do teamPublicRouter (auto-cadastro anônimo): cifra CPF/RG/título/banco/
 * PIX antes de inserir, valida a campanha e força role=Apoiador.
 * Define a chave ANTES de importar (fieldCrypto resolve a chave lazy).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';

process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);

import { createTeamPublicRouter } from '../src/server/modules/team/teamPublicRouter';
import { isEncrypted } from '../src/server/lib/fieldCrypto';

const CAMP = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

function buildApp(supabase: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/public/team', createTeamPublicRouter(supabase)); // sem auth, de propósito
  return app;
}

async function req(app: express.Express, path: string, body?: any) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: 'POST',
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

describe('teamPublicRouter', () => {
  test('cadastra cifrando CPF/RG/título/PIX e força Apoiador', async () => {
    const supabase = createMockSupabase({
      campaign_configs: [{ id: CAMP }],
      team_members: [],
    });
    const res = await req(buildApp(supabase), '/api/public/team/register', {
      campaignId: CAMP, name: 'Apoiador Z', phone: '21988',
      cpf: '111.222.333-44', rg: '12.345', voterId: '9999 8888 7777', pixKey: 'z@pix',
      role: 'Admin', // deve ser ignorado
    });
    assert.equal(res.status, 201);

    const stored = (supabase as any)._store.get('team_members')[0];
    assert.ok(isEncrypted(stored.cpf), 'cpf cifrado');
    assert.ok(isEncrypted(stored.rg), 'rg cifrado');
    assert.ok(isEncrypted(stored.voterId), 'título cifrado');
    assert.ok(isEncrypted(stored.pixKey), 'pix cifrado');
    assert.equal(stored.phone, '21988', 'telefone em texto puro');
    assert.equal(stored.role, 'Apoiador', 'role forçada (ignora o que veio)');
    assert.equal(stored.campaignId, CAMP);
  });

  test('campanha inexistente → 404, nada inserido', async () => {
    const supabase = createMockSupabase({ campaign_configs: [], users: [], team_members: [] });
    const res = await req(buildApp(supabase), '/api/public/team/register', { campaignId: 'nope', name: 'X' });
    assert.equal(res.status, 404);
    assert.equal((supabase as any)._store.get('team_members').length, 0);
  });

  test('aceita campanha via fallback users (Supreme mandou o ID dele)', async () => {
    const supabase = createMockSupabase({ campaign_configs: [], users: [{ id: CAMP }], team_members: [] });
    const res = await req(buildApp(supabase), '/api/public/team/register', { campaignId: CAMP, name: 'Y', cpf: '1' });
    assert.equal(res.status, 201);
    assert.ok(isEncrypted((supabase as any)._store.get('team_members')[0].cpf));
  });

  test('sem nome → 400', async () => {
    const supabase = createMockSupabase({ campaign_configs: [{ id: CAMP }], team_members: [] });
    const res = await req(buildApp(supabase), '/api/public/team/register', { campaignId: CAMP, cpf: '1' });
    assert.equal(res.status, 400);
  });
});
