/**
 * Testes do teamMembersRouter: cifra CPF/RG/banco/PIX em repouso, decifra na
 * resposta, replica o escopo por papel (Líder/Admin/membro) e migra legado.
 * Define a chave ANTES de importar (fieldCrypto resolve a chave lazy).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';

process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);

import { createTeamMembersRouter } from '../src/server/modules/team/teamMembersRouter';
import { isEncrypted } from '../src/server/lib/fieldCrypto';

const CAMP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function buildApp(user: any, supabase: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).user = user; next(); });
  app.use('/api/v1/team-members', createTeamMembersRouter(supabase));
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

const admin = { id: 'admin-1', email: 'a@x.com', campaignId: CAMP, userType: 'Admin' };

describe('teamMembersRouter', () => {
  test('POST cifra CPF/banco no store e devolve decifrado', async () => {
    const supabase = createMockSupabase({ team_members: [] });
    const res = await req(buildApp(admin, supabase), 'POST', '/api/v1/team-members', {
      name: 'Maria', role: 'Apoiador', email: 'm@x.com', phone: '21999',
      cpf: '111.222.333-44', bankAccount: '12345-6', pixKey: 'm@pix.com',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.member.cpf, '111.222.333-44');     // resposta decifrada
    assert.equal(res.body.member.pixKey, 'm@pix.com');

    const stored = (supabase as any)._store.get('team_members')[0];
    assert.ok(isEncrypted(stored.cpf), 'cpf cifrado em repouso');
    assert.ok(isEncrypted(stored.bankAccount), 'conta cifrada em repouso');
    assert.equal(stored.phone, '21999', 'telefone fica em texto puro (busca)');
    assert.equal(stored.campaignId, CAMP);
    assert.equal(stored.addedBy, 'admin-1');
  });

  test('GET decifra para Admin e respeita escopo por papel', async () => {
    const supabase = createMockSupabase({ team_members: [] });
    // cria duas linhas: uma do líder, outra de um apoiador comum
    await req(buildApp(admin, supabase), 'POST', '/api/v1/team-members', {
      name: 'Liderado', role: 'Apoiador', email: 'lid@x.com', assignedLeaderId: 'leader-9', cpf: 'AAA',
    });
    await req(buildApp(admin, supabase), 'POST', '/api/v1/team-members', {
      name: 'Outro', role: 'Apoiador', email: 'outro@x.com', cpf: 'BBB',
    });

    // Admin vê tudo, decifrado
    const all = await req(buildApp(admin, supabase), 'GET', '/api/v1/team-members');
    assert.equal(all.body.members.length, 2);
    assert.deepEqual(all.body.members.map((m: any) => m.cpf).sort(), ['AAA', 'BBB']);

    // Líder vê só os liderados dele (assignedLeaderId === seu id)
    const leader = { id: 'leader-9', email: 'leader@x.com', campaignId: CAMP, userType: 'Líder' };
    const leaderView = await req(buildApp(leader, supabase), 'GET', '/api/v1/team-members');
    assert.equal(leaderView.body.members.length, 1);
    assert.equal(leaderView.body.members[0].name, 'Liderado');

    // Membro comum vê só a própria linha (email)
    const member = { id: 'u-outro', email: 'outro@x.com', campaignId: CAMP, userType: 'Apoiador' };
    const memberView = await req(buildApp(member, supabase), 'GET', '/api/v1/team-members');
    assert.equal(memberView.body.members.length, 1);
    assert.equal(memberView.body.members[0].cpf, 'BBB');
  });

  test('PATCH cifra na edição e não vaza pra outra campanha', async () => {
    const supabase = createMockSupabase({
      team_members: [
        { id: 'm1', campaignId: CAMP, name: 'X', cpf: 'enc-old', rg: null },
        { id: 'foreign', campaignId: 'other', name: 'Y', cpf: 'plain' },
      ],
    });
    const res = await req(buildApp(admin, supabase), 'PATCH', '/api/v1/team-members/m1', { rg: '99.888.777-6' });
    assert.equal(res.status, 200);
    assert.equal(res.body.member.rg, '99.888.777-6');
    assert.ok(isEncrypted((supabase as any)._store.get('team_members')[0].rg));

    // tentar editar linha de outra campanha não acha (escopo) → erro do single()
    const foreign = await req(buildApp(admin, supabase), 'PATCH', '/api/v1/team-members/foreign', { rg: 'hack' });
    assert.notEqual(foreign.status, 200);
    assert.equal((supabase as any)._store.get('team_members')[1].cpf, 'plain', 'linha de outra campanha intacta');
  });

  test('migrate-encrypt cifra legado, idempotente e Admin-only', async () => {
    const supabase = createMockSupabase({
      team_members: [
        { id: 't1', campaignId: CAMP, cpf: '123', rg: null, bankAccount: '9', pixKey: null, bankName: null, bankAgency: null },
      ],
    });
    const denied = await req(buildApp({ ...admin, userType: 'Apoiador' }, supabase), 'POST', '/api/v1/team-members/migrate-encrypt');
    assert.equal(denied.status, 403);

    const r1 = await req(buildApp(admin, supabase), 'POST', '/api/v1/team-members/migrate-encrypt');
    assert.equal(r1.status, 200);
    assert.equal(r1.body.migrated, 1);
    const row = (supabase as any)._store.get('team_members')[0];
    assert.ok(isEncrypted(row.cpf));
    assert.ok(isEncrypted(row.bankAccount));
    assert.equal(row.rg, null, 'nulos não são cifrados');

    const r2 = await req(buildApp(admin, supabase), 'POST', '/api/v1/team-members/migrate-encrypt');
    assert.equal(r2.body.migrated, 0); // idempotente
  });
});
