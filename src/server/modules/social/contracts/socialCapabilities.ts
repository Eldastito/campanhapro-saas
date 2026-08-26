/**
 * Capability model do CampanhaPro Social Intelligence — §12/§13 do PRD.
 *
 * Regra inegociável (§13): NUNCA transformar `unsupported` em `0`. Se o
 * provider não expõe watch time, a UI mostra "não disponível", não `0`.
 * Regra §20/§103: métricas indisponíveis ficam `null` — nunca `0`.
 */

/**
 * Estado real de cada capability em um provider. Nenhum boolean solto:
 * a diferença entre "não implementamos ainda", "provider não permite",
 * "usuário não autorizou o escopo" e "está temporariamente fora" é
 * observável e precisa aparecer na UI e nos alertas.
 */
export type CapabilityLevel =
  /** Capability implementada e funcional para este provider. */
  | 'supported'
  /** Provider não oferece isso (ex.: X não tem carrossel; LinkedIn não tem
   *  publish de vídeo pela API pública). Terminal — não vai virar `supported`
   *  sozinho. */
  | 'unsupported'
  /** Provider oferece, mas o usuário/campanha ainda não deu o escopo OAuth
   *  necessário. Corrigível pedindo reautorização. */
  | 'permission_required'
  /** Provider tem restrição comercial ou de tier (ex.: X Free tier bloqueia
   *  `/users/:id/tweets`; Meta bloqueia comentários de terceiros). Corrigível
   *  pagando upgrade ou solicitando app review. */
  | 'provider_restricted'
  /** Precisa de env var, chave de app, ou setup no dashboard do provider que
   *  o operador da campanha ainda não fez. Corrigível internamente. */
  | 'not_configured'
  /** Rate limit atingido, provider está degraded ou circuit breaker aberto
   *  (§85). Auto-recuperável. */
  | 'temporarily_unavailable'
  /** Ainda não testado empiricamente para este provider — o registry deve
   *  evitar isto ao máximo, mas serve para novos providers ou versões de
   *  API em rollout. */
  | 'unknown';

/**
 * Todas as capabilities que um provider social pode expor. Somente as que
 * fazem sentido para o produto — evitamos surface de tudo que a API oferece.
 * Cada entrada é acompanhada por um `CapabilityLevel` no registry.
 */
export interface SocialCapabilities {
  /** Ler perfil (nome, handle, bio, avatar). */
  profileRead: CapabilityLevel;
  /** Ler posts próprios (content + métricas). */
  postsRead: CapabilityLevel;
  /** Ler comentários no conteúdo próprio. */
  ownCommentsRead: CapabilityLevel;
  /** Ler comentários em conteúdo de terceiros (para inteligência competitiva
   *  / Pulso dos Bairros). Meta hoje só devolve contagem, nunca texto. */
  thirdPartyCommentsRead: CapabilityLevel;
  /** Ler métricas agregadas do perfil (followers, reach, impressions, etc.). */
  metricsRead: CapabilityLevel;
  /** Insights de audiência (demografia, geografia agregada). */
  audienceInsights: CapabilityLevel;
  /** Ler menções ao candidato (@handle ou termos monitorados). */
  mentionsRead: CapabilityLevel;
  /** Descobrir competidores por username (Business Discovery, etc.). */
  competitorDiscovery: CapabilityLevel;
  /** Publicar texto puro. */
  publishText: CapabilityLevel;
  /** Publicar imagem estática. */
  publishImage: CapabilityLevel;
  /** Publicar vídeo (feed ou reel/short). */
  publishVideo: CapabilityLevel;
  /** Agendar publicação nativamente (sem depender do nosso scheduler). */
  schedule: CapabilityLevel;
  /** Provider oferece webhook de eventos (novo comentário, novo follower,
   *  etc.). Se `supported`, o worker preferece webhook sobre polling (§82). */
  webhook: CapabilityLevel;
}

/** Chaves canônicas — útil para iterar e para testes. */
export const CAPABILITY_KEYS: readonly (keyof SocialCapabilities)[] = Object.freeze([
  'profileRead',
  'postsRead',
  'ownCommentsRead',
  'thirdPartyCommentsRead',
  'metricsRead',
  'audienceInsights',
  'mentionsRead',
  'competitorDiscovery',
  'publishText',
  'publishImage',
  'publishVideo',
  'schedule',
  'webhook',
] as const);

/**
 * Snapshot completo de um provider, incluindo o nível global do adapter
 * (`limited` para providers que só temos scraping ou paste manual).
 *
 * `adapterMaturity`:
 *   - `production`     — OAuth completo, refresh, sync, RAG, tests.
 *   - `beta`           — funcional mas com gaps conhecidos.
 *   - `limited`        — sem API estável (scraping) ou só paste manual.
 *   - `not_implemented`— só o card na UI, sem backend real.
 */
export interface SocialProviderCapabilitySnapshot {
  adapterMaturity: 'production' | 'beta' | 'limited' | 'not_implemented';
  /** Justificativa curta para o maturity level acima (aparece no admin). */
  maturityNote?: string;
  capabilities: SocialCapabilities;
}
