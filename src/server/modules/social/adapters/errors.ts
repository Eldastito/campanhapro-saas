/**
 * Erros tipados usados pelos SocialProviderAdapters. Ficam num arquivo próprio
 * para que consumidores possam catchar por classe sem importar o adapter todo.
 */

import type { SocialProvider } from '../contracts/socialProvider.js';
import type { CapabilityLevel, SocialCapabilities } from '../contracts/socialCapabilities.js';

/**
 * Lançado quando o caller pede uma capability que o provider não expõe (ou
 * ainda não temos implementada). `level` diz *por que* — a UI pode renderizar
 * "reautorize", "faça upgrade", "aguarde", ou "esta rede não suporta isto".
 *
 * Contrato §13 do PRD: NUNCA transformar `unsupported` em `0`. Este erro é
 * como esse contrato aparece no runtime — o caller checou `getCapabilities()`
 * e decidiu chamar mesmo assim, ou é um bug.
 */
export class SocialCapabilityNotAvailableError extends Error {
  readonly provider: SocialProvider;
  readonly capability: keyof SocialCapabilities;
  readonly level: CapabilityLevel;
  readonly code = 'social_capability_unavailable';

  constructor(
    provider: SocialProvider,
    capability: keyof SocialCapabilities,
    level: CapabilityLevel,
    hint?: string,
  ) {
    const base = `${provider}.${capability} está em '${level}'.`;
    super(hint ? `${base} ${hint}` : base);
    this.name = 'SocialCapabilityNotAvailableError';
    this.provider = provider;
    this.capability = capability;
    this.level = level;
  }
}

/**
 * Lançado quando um método do adapter recebe um `connectionId` que não bate
 * com nenhuma linha em `social_tokens`. Distinto de credenciais inválidas
 * (que devem ser tratadas como `markError` no serviço de credenciais).
 */
export class SocialConnectionNotFoundError extends Error {
  readonly provider: SocialProvider;
  readonly connectionId: string;
  readonly code = 'social_connection_not_found';

  constructor(provider: SocialProvider, connectionId: string) {
    super(`Nenhuma conexão ${provider} encontrada para o id '${connectionId}'.`);
    this.name = 'SocialConnectionNotFoundError';
    this.provider = provider;
    this.connectionId = connectionId;
  }
}
