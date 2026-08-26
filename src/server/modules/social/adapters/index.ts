/**
 * Registry dos SocialProviderAdapters. Consumidores importam SOMENTE daqui,
 * nunca dos arquivos individuais — assim futuras trocas de implementação
 * (ex.: XAdapter passar a usar API v3) ficam invisíveis a jusante.
 *
 * Cada entrada é lazy — as fábricas só são executadas quando o adapter é
 * pedido. Isso evita side-effects em módulos que não usam sockets/env vars
 * indisponíveis em teste.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SocialProvider } from '../contracts/socialProvider.js';
import type { SocialProviderAdapter } from '../contracts/socialProviderAdapter.js';
import { createXAdapter, type XAdapterDeps } from './xAdapter.js';
import { createLinkedInAdapter, type LinkedInAdapterDeps } from './linkedInAdapter.js';
import { createKwaiAdapter, type KwaiAdapterDeps } from './kwaiAdapter.js';
import { createInstagramMetaAdapter, type InstagramMetaAdapterDeps } from './instagramMetaAdapter.js';
import { createFacebookMetaAdapter, type FacebookMetaAdapterDeps } from './facebookMetaAdapter.js';

export {
  SocialCapabilityNotAvailableError,
  SocialConnectionNotFoundError,
} from './errors.js';

export type {
  XAdapterDeps,
  LinkedInAdapterDeps,
  KwaiAdapterDeps,
  InstagramMetaAdapterDeps,
  FacebookMetaAdapterDeps,
};

export interface CreateSocialAdaptersDeps {
  x?: XAdapterDeps;
  linkedin?: LinkedInAdapterDeps;
  kwai?: KwaiAdapterDeps;
  instagram?: InstagramMetaAdapterDeps;
  facebook?: FacebookMetaAdapterDeps;
}

/**
 * Retorna o mapa de adapters disponíveis. Providers ainda não implementados
 * (Instagram, Facebook, YouTube, TikTok) ficam ausentes do objeto — o caller
 * deve tratar `adapters[provider] === undefined` como "não implementado
 * ainda" e cair na UI apropriada.
 *
 * IMPORTANTE: NÃO retornamos objetos stub para providers ausentes. Preferimos
 * `undefined` explícito para não induzir o caller a esconder ausência atrás
 * de um throw runtime.
 */
export function createSocialAdapters(
  supabase: SupabaseClient,
  deps: CreateSocialAdaptersDeps = {},
): Partial<Record<SocialProvider, SocialProviderAdapter>> {
  return {
    x: createXAdapter(supabase, deps.x),
    linkedin: createLinkedInAdapter(supabase, deps.linkedin),
    kwai: createKwaiAdapter(supabase, deps.kwai),
    instagram: createInstagramMetaAdapter(supabase, deps.instagram),
    facebook: createFacebookMetaAdapter(supabase, deps.facebook),
    // youtube: PR 6-7
    // tiktok: PR 8
  };
}

/**
 * Helper: providers implementados. Útil para o endpoint
 * `/api/v1/social/adapters` (que ainda não existe) listar rapidamente.
 */
export const IMPLEMENTED_PROVIDERS: readonly SocialProvider[] = Object.freeze([
  'x',
  'linkedin',
  'kwai',
  'instagram',
  'facebook',
] as const);
