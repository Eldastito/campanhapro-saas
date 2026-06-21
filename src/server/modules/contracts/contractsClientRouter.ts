/**
 * Contracts (cliente) — leitura dos contratos da PRÓPRIA campanha.
 *
 *   GET /api/v1/contracts   lista contratos onde campaignId = campanha do usuário
 *
 * Montado atrás de requireAuth (qualquer membro autenticado da campanha). É
 * read-only: a criação/edição/assinatura continua no Supreme
 * (/api/v1/supreme/contracts, atrás de requireSupremeAdmin). Escopo por
 * campaignId garante isolamento entre tenants.
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createContractsClientRouter(supabase: SupabaseClient): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

    const { data, error } = await supabase
      .from('contracts')
      .select('*')
      .eq('campaignId', campaignId)
      .order('createdAt', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ contracts: data ?? [] });
  });

  return router;
}
