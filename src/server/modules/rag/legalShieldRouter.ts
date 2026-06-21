/**
 * Legal Shield Router — módulo Blindagem Jurídico-Contábil (por campanha).
 *
 *   POST /api/v1/legal-shield/review        roda Contábil→Jurídico e persiste o parecer
 *   GET  /api/v1/legal-shield/opinions      lista pareceres (resumo)
 *   GET  /api/v1/legal-shield/opinions/:id  detalhe + citações
 *   GET  /api/v1/legal-shield/dashboard     resumo de risco
 *
 * Add-on avulso: montado atrás de requireFeature('legal_shield'). Acesso restrito
 * a Admin/Coordenador (dados de arrecadação/gastos e pareceres são sensíveis).
 */
import { Router, Request, Response, NextFunction } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAiBudget } from '../../middleware/featureGate';
import { BudgetExceededError } from '../../../lib/aiCallAgent';
import {
  runComplianceReview,
  saveComplianceOpinion,
  type ComplianceSubject,
  type ComplianceSubjectKind,
} from './complianceReview';

const VALID_KINDS: ComplianceSubjectKind[] = [
  'transaction', 'expense', 'donation', 'contract', 'free_query', 'accounts_rendering',
];

// Dados sensíveis → só gestão da campanha.
function requireCampaignAdmin(req: Request, res: Response, next: NextFunction) {
  const t = (req as any).user?.userType;
  if (t !== 'Admin' && t !== 'Coordenador') return res.status(403).json({ error: 'admin_required' });
  next();
}

export function createLegalShieldRouter(supabase: SupabaseClient): Router {
  const router = Router();
  router.use(requireCampaignAdmin);

  // Valida o input ANTES do gate de orçamento — pedido malformado não deve gastar
  // a checagem de budget nem virar 402.
  function validateReview(req: Request, res: Response, next: NextFunction) {
    if (!(req as any).user?.campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { kind, description } = req.body || {};
    if (!kind || !VALID_KINDS.includes(kind)) {
      return res.status(400).json({ error: 'invalid_kind', allowed: VALID_KINDS });
    }
    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: 'description_required' });
    }
    next();
  }

  // Roda o pipeline e persiste. Gateado por orçamento de IA (custa 2 chamadas).
  router.post('/review', validateReview, requireAiBudget(supabase), async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    const userId = (req as any).user?.id ?? null;
    const { kind, description, data, electionYear } = req.body || {};

    const subject: ComplianceSubject = {
      kind,
      description: description.slice(0, 8000),
      data: data && typeof data === 'object' ? data : undefined,
    };

    try {
      const result = await runComplianceReview(supabase, {
        campaignId, userId, subject,
        electionYear: Number.isInteger(electionYear) ? electionYear : undefined,
      });
      const saved = await saveComplianceOpinion(supabase, {
        campaignId, userId, subject,
        electionYear: Number.isInteger(electionYear) ? electionYear : undefined,
        result,
      });
      return res.status(201).json({ id: saved.id, ...result });
    } catch (err: any) {
      if (err instanceof BudgetExceededError) {
        return res.status(402).json({ error: 'ai_budget_exceeded', detail: err.message });
      }
      console.error('[LegalShield] review:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  router.get('/opinions', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { data, error } = await supabase
      .from('legal_opinions')
      .select('id, title, "subjectType", "riskLevel", status, "createdAt"')
      .eq('campaignId', campaignId)
      .order('createdAt', { ascending: false })
      .limit(500);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ opinions: data ?? [] });
  });

  router.get('/opinions/:id', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { data: opinion, error } = await supabase
      .from('legal_opinions')
      .select('*')
      .eq('id', req.params.id)
      .eq('campaignId', campaignId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!opinion) return res.status(404).json({ error: 'not_found' });

    const { data: citations } = await supabase
      .from('legal_opinion_citations')
      .select('*')
      .eq('opinionId', req.params.id);

    return res.json({ opinion, citations: citations ?? [] });
  });

  router.get('/dashboard', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('legal_opinions')
      .select('id, title, "riskLevel", "createdAt"')
      .eq('campaignId', campaignId)
      .order('createdAt', { ascending: false })
      .limit(500);
    if (error) return res.status(500).json({ error: error.message });

    const rows = data ?? [];
    const byRisk: Record<string, number> = { baixo: 0, 'médio': 0, alto: 0, 'crítico': 0, indefinido: 0 };
    for (const r of rows) byRisk[(r as any).riskLevel ?? 'indefinido'] = (byRisk[(r as any).riskLevel ?? 'indefinido'] ?? 0) + 1;
    const openHighRisk = rows.filter((r: any) => r.riskLevel === 'alto' || r.riskLevel === 'crítico').slice(0, 10);

    return res.json({ total: rows.length, byRisk, openHighRisk });
  });

  return router;
}
