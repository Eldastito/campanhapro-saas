/**
 * Resolução de tenant (campanha) à prova de IDOR.
 *
 * INCIDENTE: vários endpoints liam `campaignId` de `req.query`/`req.body`
 * (ou caíam nisso via `req.user?.campaignId ?? req.query.campaignId`). Como o
 * `campaignId` do perfil pode ser nulo (conta recém-criada / pré-onboarding /
 * falha transitória ao carregar o perfil), qualquer conta autenticada conseguia
 * passar `?campaignId=<vítima>` e ler/escrever dados de OUTRA campanha.
 *
 * Regra única agora:
 *   - usuário com campanha própria → SEMPRE a própria (query/body são ignorados);
 *   - admin supremo SEM campanha → pode indicar uma campanha (impersonação legítima);
 *   - qualquer outro sem campanha → sem acesso (undefined).
 *
 * Use SEMPRE isto para escopar queries multi-tenant no backend autenticado.
 */
import type { Request } from 'express';

export function tenantCampaignId(req: Request): string | undefined {
  const own = (req as any).user?.campaignId as string | undefined | null;
  if (own) return own;
  // Sem campanha própria: só o admin supremo pode operar sobre outra campanha.
  if ((req as any).user?.isSupremeAdmin) {
    const override = (req.query?.campaignId as string | undefined)
      ?? (req.body?.campaignId as string | undefined);
    return override || undefined;
  }
  return undefined;
}
