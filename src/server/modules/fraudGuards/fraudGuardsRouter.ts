/**
 * Endpoint stateless pros frontends chamarem antes de INSERT (#121).
 *
 * NÃO insere nada — só devolve o veredicto pro frontend decidir como
 * apresentar (alert vermelho, banner amarelo, segue normal).
 *
 * O cliente DEVE chamar isso antes de gravar contato no banco. Frontends
 * que pulam essa etapa são pegos pelo Auditor IA depois (camada 4 — paga).
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validateContact, ContactValidationInput } from '../../../lib/fraudGuards';

export function createFraudGuardsRouter(supabase: SupabaseClient): Router {
  const router = Router();

  router.post('/contact/validate', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      const userId = (req as any).user?.id;
      if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

      const body = req.body || {};
      const input: ContactValidationInput = {
        campaignId,
        phone: body.phone,
        email: body.email,
        birthDate: body.birthDate,
        zipCode: body.zipCode,
        neighborhood: body.neighborhood,
        city: body.city,
        createdByUserId: userId, // p/ heurística de volume
      };

      const result = await validateContact(supabase, input);
      return res.json(result);
    } catch (err: any) {
      console.error('[fraudGuards] validate:', err);
      // Se a validação falhar, deixa passar como 'pass' — não bloqueia o usuário
      // por falha nossa. O painel ainda pega depois.
      return res.json({ severity: 'pass', reasons: [], error: err?.message });
    }
  });

  return router;
}
