/**
 * Testes da migração em lote (todas as campanhas): cifra legado em incomes,
 * team_members e settings.campaignDetails; idempotente; cobre múltiplas
 * campanhas. Define a chave ANTES de importar (fieldCrypto resolve lazy).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';

process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);

import { encryptMigrateAll } from '../src/server/lib/encryptMigration';
import { isEncrypted } from '../src/server/lib/fieldCrypto';

describe('encryptMigrateAll', () => {
  test('cifra incomes/team_members/settings em várias campanhas', async () => {
    const supabase = createMockSupabase({
      incomes: [
        { id: 'i1', campaignId: 'A', documentoDoador: '111' },
        { id: 'i2', campaignId: 'B', documentoDoador: null },
      ],
      team_members: [
        { id: 't1', campaignId: 'A', cpf: '222', voterId: '333', rg: null, bankName: null, bankAgency: null, bankAccount: null, pixKey: null },
      ],
      settings: [
        { campaignId: 'A', campaignDetails: { nomeUrna: 'X', cpf: '444', cnpj: '555', identidade: null } },
        { campaignId: 'B', campaignDetails: null },
      ],
    });

    const r = await encryptMigrateAll(supabase);
    assert.equal(r.incomes.migrated, 1);
    assert.equal(r.team_members.migrated, 1);
    assert.equal(r.settings.migrated, 1);

    const store = (supabase as any)._store;
    assert.ok(isEncrypted(store.get('incomes')[0].documentoDoador));
    assert.equal(store.get('incomes')[1].documentoDoador, null);
    assert.ok(isEncrypted(store.get('team_members')[0].cpf));
    assert.ok(isEncrypted(store.get('team_members')[0].voterId));
    const cd = store.get('settings')[0].campaignDetails;
    assert.ok(isEncrypted(cd.cpf));
    assert.ok(isEncrypted(cd.cnpj));
    assert.equal(cd.nomeUrna, 'X');
  });

  test('idempotente: segunda passada não re-cifra', async () => {
    const supabase = createMockSupabase({
      incomes: [{ id: 'i1', campaignId: 'A', documentoDoador: '111' }],
      team_members: [],
      settings: [],
    });
    await encryptMigrateAll(supabase);
    const r2 = await encryptMigrateAll(supabase);
    assert.equal(r2.incomes.migrated, 0);
    assert.equal(r2.incomes.scanned, 1);
  });

  test('pagina além de 1000 linhas (não perde campanhas)', async () => {
    const incomes = Array.from({ length: 1500 }, (_, i) => ({
      id: 'id-' + i, campaignId: 'A', documentoDoador: 'doc' + i,
    }));
    const supabase = createMockSupabase({ incomes, team_members: [], settings: [] });
    const r = await encryptMigrateAll(supabase);
    assert.equal(r.incomes.scanned, 1500);
    assert.equal(r.incomes.migrated, 1500);
    assert.ok(isEncrypted((supabase as any)._store.get('incomes')[1499].documentoDoador));
  });
});
