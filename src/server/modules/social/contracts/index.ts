/**
 * Ponto único de import para o contrato Social — F1 do PRD Social Intelligence.
 *
 *   import { SocialProvider, SocialProviderAdapter, SocialCapabilities } from '../contracts';
 *
 * Mantido leve (só re-exports) para o consumidor não precisar aprender a
 * geografia do módulo.
 */

export type {
  SocialProvider,
} from './socialProvider.js';

export {
  SOCIAL_PROVIDERS,
  SOCIAL_PROVIDER_LABEL,
  isSocialProvider,
} from './socialProvider.js';

export type {
  CapabilityLevel,
  SocialCapabilities,
  SocialProviderCapabilitySnapshot,
} from './socialCapabilities.js';

export {
  CAPABILITY_KEYS,
} from './socialCapabilities.js';

export type {
  SocialProviderAdapter,
  ConnectInput,
  ConnectionResult,
  NormalizedSocialProfile,
  NormalizedSocialPost,
  NormalizedSocialComment,
  NormalizedSocialMetrics,
  SocialProvenance,
  GetPostsParams,
  GetCommentsParams,
  MetricsParams,
  PublishPayload,
  PublishResult,
} from './socialProviderAdapter.js';

export {
  isCapabilityAvailable,
} from './socialProviderAdapter.js';
