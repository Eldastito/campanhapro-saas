/**
 * Union canônica de providers sociais suportados pelo CampanhaPro.
 *
 * Foi introduzida em F1 (PR 1 do PRD Social Intelligence) para substituir a
 * dispersão atual — hoje o repo tem 3 lugares que enumeram redes:
 *   - `src/lib/socialSyncRunner.ts:20`  → `type SyncProvider = 'x' | 'linkedin' | 'kwai'`
 *   - `src/server/modules/content/contentRouter.ts:27`
 *       → `'instagram' | 'tiktok' | 'whatsapp' | 'facebook' | 'twitter' | 'generic'`
 *   - `src/components/resources/SocialConnectionsHub.tsx` → 7 cards estáticos
 *
 * A auditoria (docs/social/SOCIAL-AS-IS.md §1) mostrou que essa dispersão
 * bloqueia qualquer visão única de "redes conectadas" e obriga cada nova
 * feature a mapear providers na mão. Esta união é o ponto único de verdade.
 *
 * Instagram e Facebook são providers distintos mesmo compartilhando OAuth
 * Meta — a rotulagem separada é intencional para permitir capabilities
 * distintas (§12) e para o Pulso Digital diferenciar origem.
 */
export type SocialProvider =
  | 'instagram'
  | 'facebook'
  | 'youtube'
  | 'tiktok'
  | 'x'
  | 'linkedin'
  | 'kwai';

export const SOCIAL_PROVIDERS: readonly SocialProvider[] = Object.freeze([
  'instagram',
  'facebook',
  'youtube',
  'tiktok',
  'x',
  'linkedin',
  'kwai',
] as const);

/**
 * Type guard runtime — útil quando o valor vem de `req.params.provider`,
 * de webhook externo, ou de coluna de banco (que ainda é `text`).
 */
export function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === 'string' && (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Label localizado (pt-BR) para uso em UI. Mantido junto do type para
 * evitar tabela de tradução paralela.
 */
export const SOCIAL_PROVIDER_LABEL: Record<SocialProvider, string> = Object.freeze({
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  linkedin: 'LinkedIn',
  kwai: 'Kwai',
});
