/**
 * Testes do settingsRouter: cifra CPF/CNPJ/RG do candidato dentro do JSON
 * campaignDetails, decifra na leitura, preserva campos não-sensíveis, e migra
 * legado. Define a chave ANTES de importar (fieldCrypto resolve a chave lazy).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';

process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);

import { createSettingsRouter } from '../src/server/modules/settings/settingsRouter';
import { isEncrypted } from '../src/server/lib/fieldCrypto';

const CAMP = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const admin = { id: 'admin-1', email: 'a@x.com', campaignId: CAMP, userType: 'Admin' };

function buildApp(user: any, supabase: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).user = user; next(); });
  app.use('/api/v1/settings', createSettingsRouter(supabase));
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

describe('settingsRouter', () => {
  test('PUT cifra CPF/CNPJ/RG no JSON, mantém o resto em texto puro', async () => {
    const supabase = createMockSupabase({ settings: [] });
    const details = {
      nomeUrna: 'Candidato X', numero: '12345',
      cpf: '111.222.333-44', cnpj: '12.345.678/0001-90', identidade: '99.888.777-6',
      dataNascimento: '1980-01-01',
    };
    const res = await req(buildApp(admin, supabase), 'PUT', '/api/v1/settings/campaign-details', { campaignDetails: details });
    assert.equal(res.status, 200);
    assert.equal(res.body.campaignDetails.cpf, '111.222.333-44'); // resposta decifrada

    const stored = (supabase as any)._store.get('settings')[0].campaignDetails;
    assert.ok(isEncrypted(stored.cpf), 'cpf cifrado');
    assert.ok(isEncrypted(stored.cnpj), 'cnpj cifrado');
    assert.ok(isEncrypted(stored.identidade), 'RG cifrado');
    assert.equal(stored.nomeUrna, 'Candidato X', 'nomeUrna em texto puro');
    assert.equal(stored.dataNascimento, '1980-01-01', 'nascimento em texto puro (fora do escopo)');
  });

  test('GET decifra campaignDetails e retorna logos', async () => {
    const supabase = createMockSupabase({ settings: [] });
    await req(buildApp(admin, supabase), 'PUT', '/api/v1/settings/campaign-details', {
      campaignDetails: { nomeUrna: 'Y', cpf: 'SECRET', cnpj: 'CNPJ1', identidade: 'RG1' },
    });
    // injeta logo direto no store (logos seguem gravando direto no app)
    (supabase as any)._store.get('settings')[0].headerLogo = 'logo.png';

    const res = await req(buildApp(admin, supabase), 'GET', '/api/v1/settings');
    assert.equal(res.status, 200);
    assert.equal(res.body.campaignDetails.cpf, 'SECRET');
    assert.equal(res.body.campaignDetails.cnpj, 'CNPJ1');
    assert.equal(res.body.headerLogo, 'logo.png');
  });

  test('GET sem linha de settings devolve nulls (não quebra)', async () => {
    const supabase = createMockSupabase({ settings: [] });
    const res = await req(buildApp(admin, supabase), 'GET', '/api/v1/settings');
    assert.equal(res.status, 200);
    assert.equal(res.body.campaignDetails, null);
  });

  test('migrate-encrypt cifra legado em texto puro, idempotente e Admin-only', async () => {
    const supabase = createMockSupabase({
      settings: [{ campaignId: CAMP, campaignDetails: { nomeUrna: 'Z', cpf: '000.111.222-33', cnpj: 'C', identidade: null } }],
    });
    const denied = await req(buildApp({ ...admin, userType: 'Apoiador' }, supabase), 'POST', '/api/v1/settings/migrate-encrypt');
    assert.equal(denied.status, 403);

    const r1 = await req(buildApp(admin, supabase), 'POST', '/api/v1/settings/migrate-encrypt');
    assert.equal(r1.status, 200);
    assert.equal(r1.body.migrated, 1);
    const cd = (supabase as any)._store.get('settings')[0].campaignDetails;
    assert.ok(isEncrypted(cd.cpf));
    assert.ok(isEncrypted(cd.cnpj));
    assert.equal(cd.identidade, null);
    assert.equal(cd.nomeUrna, 'Z');

    const r2 = await req(buildApp(admin, supabase), 'POST', '/api/v1/settings/migrate-encrypt');
    assert.equal(r2.body.migrated, 0); // idempotente
  });
});
