/**
 * socialSignalsBatchRunner — roda o pipeline para MÚLTIPLAS campanhas
 * em UM único call, com isolamento de erro por campanha.
 *
 * Uso típico:
 *   const summary = await runSignalsForCampaigns(supabase, {
 *     campaignIds: ['c1', 'c2', 'c3'],
 *     persist: true,
 *     broadcast: true,
 *   });
 *
 * REGRA §35 aplicada — cada iteração é escopada por campaignId
 * dentro do runner de campanha (que já filtra tudo pelo tenant). Este
 * batch runner NUNCA cruza dados entre campanhas.
 *
 * ISOLAMENTO DE ERRO: se `computeCampaignSocialSignals` de C1 lança,
 * C2 e C3 continuam. O erro fica em `results[C1].error` — nunca
 * propaga para o caller como throw. Isso permite ao scheduler ficar
 * up mesmo com uma campanha problemática.
 *
 * Nesta versão o helper NÃO descobre campanhas — o caller passa a
 * lista. Discovery (query `campaign_configs.limits.social_intel` ou
 * similar) fica pra próxima camada; ele pode variar por deployment.
 *
 * REGRA §39: pura orquestração, delegando decisão pro runner puro.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  computeCampaignSocialSignals,
  type ComputeCampaignSignalsOptions,
  type ComputeCampaignSignalsResult,
} from './socialSignalsRunner.js';

// ── Tipos ────────────────────────────────────────────────────────────

/**
 * Config compartilhada — todos os campos do
 * `ComputeCampaignSignalsOptions` exceto os que só fazem sentido no
 * escopo per-campaign (nenhum atualmente; se surgirem, filtra aqui).
 */
export type BatchSignalsOptions = ComputeCampaignSignalsOptions;

export interface BatchSignalsInput {
  campaignIds: readonly string[];
  options?: BatchSignalsOptions;
}

export interface PerCampaignResult {
  campaignId: string;
  result?: ComputeCampaignSignalsResult;
  error?: {
    message: string;
    kind: string;
  };
}

export interface BatchSignalsSummary {
  attempted: number;
  ok: number;
  failed: number;
  totalSignals: number;
  perCampaign: PerCampaignResult[];
  batchRunnerVersion: string;
}

export const SOCIAL_SIGNALS_BATCH_RUNNER_VERSION = '2026-08-27.v1';

// ── API pública ─────────────────────────────────────────────────────

/**
 * Roda o pipeline para uma lista de campanhas. Erros por campanha ficam
 * isolados no result — nunca propagam para o caller. Executa em série
 * por default (evita hammer no Supabase); parallelismo controlado é
 * follow-up (adicionar `concurrency` opt se precisar).
 */
export async function runSignalsForCampaigns(
  supabase: SupabaseClient,
  input: BatchSignalsInput,
): Promise<BatchSignalsSummary> {
  const uniqueIds = Array.from(new Set(input.campaignIds.filter(Boolean)));

  const perCampaign: PerCampaignResult[] = [];
  let ok = 0;
  let failed = 0;
  let totalSignals = 0;

  for (const campaignId of uniqueIds) {
    try {
      const result = await computeCampaignSocialSignals(
        supabase,
        campaignId,
        input.options ?? {},
      );
      perCampaign.push({ campaignId, result });
      totalSignals += result.signals.length;
      ok += 1;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const kind = err instanceof Error ? err.constructor.name : 'unknown';
      perCampaign.push({ campaignId, error: { message, kind } });
      failed += 1;
      // Log defensivo — não deixa o erro sumir mesmo que o caller
      // não olhe pro summary
      console.warn(
        `[socialSignalsBatchRunner] campanha ${campaignId} falhou: ${kind}: ${message}`,
      );
    }
  }

  return {
    attempted: uniqueIds.length,
    ok,
    failed,
    totalSignals,
    perCampaign,
    batchRunnerVersion: SOCIAL_SIGNALS_BATCH_RUNNER_VERSION,
  };
}

// ── Discovery helper (opcional; caller pode ignorar) ────────────────

/**
 * Descobre campaignIds com social intelligence habilitada. A convenção
 * aqui é conservadora — retorna TODAS as campanhas ativas em
 * `campaign_configs`, e o caller filtra depois se precisar.
 *
 * Simplifica bootstrap: rodar `runSignalsForCampaigns(supabase, {
 *   campaignIds: await discoverActiveCampaigns(supabase), ...
 * })`.
 *
 * Se `campaign_configs` não existir ou tiver estrutura diferente
 * dependendo do deploy, o caller pode pular esta função e passar sua
 * própria lista.
 */
export async function discoverActiveCampaigns(
  supabase: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<string[]> {
  const { data, error } = await supabase
    .from('campaign_configs')
    .select('campaignId')
    .limit(opts.limit ?? 500);
  if (error) {
    console.warn(
      `[socialSignalsBatchRunner] discoverActiveCampaigns falhou: ${error.message}`,
    );
    return [];
  }
  const rows = (data ?? []) as Array<{ campaignId?: string | null }>;
  return rows
    .map(r => r.campaignId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}
