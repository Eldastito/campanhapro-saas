/**
 * Migração de criptografia em LOTE (todas as campanhas) — usada pelo endpoint
 * do Supremo Admin para cifrar dados legados em texto puro de uma vez só.
 *
 * Idempotente: encryptFields pula null/vazio e tokens já cifrados, então rodar
 * de novo é seguro (migrated=0 na segunda passada).
 *
 * Pagina de 1000 em 1000 porque o PostgREST corta a resposta nesse teto — sem
 * paginar, campanhas grandes ficariam de fora silenciosamente.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptFields } from './fieldCrypto';
import { ENCRYPTED_FIELDS, CANDIDATE_DETAIL_FIELDS } from './encryptedFields';

const PAGE = 1000;

export interface MigrateResult { scanned: number; migrated: number; }

/** Cifra colunas top-level (incomes, team_members) em todas as campanhas. */
async function migrateColumns(
  supabase: SupabaseClient,
  table: string,
  fields: readonly string[],
): Promise<MigrateResult> {
  let scanned = 0, migrated = 0, from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(['id', ...fields].join(', '))
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as any[];
    if (rows.length === 0) break;
    scanned += rows.length;

    for (const r of rows) {
      const before: Record<string, any> = {};
      for (const f of fields) before[f] = r[f];
      const after = encryptFields(before, fields);
      const changed: Record<string, any> = {};
      for (const f of fields) if (after[f] !== before[f]) changed[f] = after[f];
      if (Object.keys(changed).length > 0) {
        const { error: upErr } = await supabase.from(table).update(changed).eq('id', r.id);
        if (upErr) throw new Error(`${table} id=${r.id}: ${upErr.message}`);
        migrated++;
      }
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return { scanned, migrated };
}

/** Cifra os campos do candidato aninhados em settings.campaignDetails (JSON). */
async function migrateSettings(supabase: SupabaseClient): Promise<MigrateResult> {
  const fields = CANDIDATE_DETAIL_FIELDS;
  let scanned = 0, migrated = 0, from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('settings')
      .select('campaignId, campaignDetails')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`settings: ${error.message}`);
    const rows = (data ?? []) as any[];
    if (rows.length === 0) break;
    scanned += rows.length;

    for (const r of rows) {
      const cd = r.campaignDetails;
      if (!cd || typeof cd !== 'object') continue;
      const after = encryptFields(cd, fields);
      if (fields.some((f) => after[f] !== cd[f])) {
        const { error: upErr } = await supabase
          .from('settings')
          .update({ campaignDetails: after })
          .eq('campaignId', r.campaignId);
        if (upErr) throw new Error(`settings campaignId=${r.campaignId}: ${upErr.message}`);
        migrated++;
      }
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return { scanned, migrated };
}

/** Roda as 3 migrações em todas as campanhas. Retorna o resumo por tabela. */
export async function encryptMigrateAll(supabase: SupabaseClient) {
  return {
    incomes: await migrateColumns(supabase, 'incomes', ENCRYPTED_FIELDS.incomes),
    team_members: await migrateColumns(supabase, 'team_members', ENCRYPTED_FIELDS.team_members),
    settings: await migrateSettings(supabase),
  };
}
