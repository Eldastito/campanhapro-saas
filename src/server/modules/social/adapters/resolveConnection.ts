/**
 * Helper compartilhado pelos adapters: `connectionId` (uuid de
 * `social_tokens.id`) → `{ campaignId }` para chamar o
 * SocialCredentialService que trabalha em `(campaignId, provider)`.
 *
 * O contrato do adapter (§11 do PRD) trata connectionId como opaco.
 * Escolhemos `social_tokens.id` (uuid) como valor porque ele já existe no
 * schema, é único, e não vaza informação de tenant no próprio id.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SocialProvider } from '../contracts/socialProvider.js';
import { SocialConnectionNotFoundError } from './errors.js';

export async function resolveConnection(
  supabase: SupabaseClient,
  provider: SocialProvider,
  connectionId: string,
): Promise<{ campaignId: string }> {
  if (!connectionId) throw new SocialConnectionNotFoundError(provider, connectionId);

  const { data, error } = await supabase
    .from('social_tokens')
    .select('id, "campaignId"')
    .eq('id', connectionId)
    .eq('provider', provider)
    .maybeSingle();

  if (error) throw new Error(`resolveConnection failed: ${error.message}`);
  if (!data) throw new SocialConnectionNotFoundError(provider, connectionId);
  return { campaignId: (data as any).campaignId };
}
