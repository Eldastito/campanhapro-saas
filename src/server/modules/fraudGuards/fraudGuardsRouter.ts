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

  /**
   * Resolve um alerta: confirma como fraude ou marca como falso positivo.
   * type = 'log' (fraud_audit_logs) | 'contact' (contacts.auditStatus).
   * decision = 'confirmed' | 'false_positive'.
   */
  router.post('/resolve/:type/:id', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      const userId = (req as any).user?.id;
      const userType = (req as any).user?.type;
      if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
      if (userType !== 'Admin' && userType !== 'Coordenador' && userType !== 'Líder') {
        return res.status(403).json({ error: 'admin_required' });
      }

      const { type, id } = req.params;
      const decision = String((req.body || {}).decision || '').toLowerCase();
      if (!['confirmed', 'false_positive'].includes(decision)) {
        return res.status(400).json({ error: 'decision_invalid', detail: 'use confirmed ou false_positive' });
      }
      const nowIso = new Date().toISOString();

      if (type === 'log') {
        // fraud_audit_logs: marca isResolved + metadata
        const { data: existing } = await supabase.from('fraud_audit_logs')
          .select('id, metadata').eq('id', id).eq('campaignId', campaignId).maybeSingle();
        if (!existing) return res.status(404).json({ error: 'not_found' });
        const newMeta = {
          ...((existing as any).metadata || {}),
          resolution: decision,
          resolved_by: userId,
          resolved_at: nowIso,
          source: decision === 'confirmed' ? 'ai_confirmed' : 'ai_dismissed',
          requires_human_confirmation: false,
        };
        const { error } = await supabase.from('fraud_audit_logs')
          .update({ isResolved: true, resolvedBy: userId, resolvedAt: nowIso, metadata: newMeta })
          .eq('id', id).eq('campaignId', campaignId);
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ ok: true });
      }

      if (type === 'contact') {
        // contacts: muda auditStatus
        const newStatus = decision === 'confirmed' ? 'rejected' : 'approved';
        const { error } = await supabase.from('contacts')
          .update({ auditStatus: newStatus, auditedAt: nowIso })
          .eq('id', id).eq('campaignId', campaignId);
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ ok: true, newStatus });
      }

      return res.status(400).json({ error: 'type_invalid' });
    } catch (err: any) {
      console.error('[fraudGuards] resolve:', err);
      return res.status(500).json({ error: err?.message });
    }
  });

  return router;
}
