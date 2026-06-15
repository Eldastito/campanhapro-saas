/**
 * Field Ops Router (#135) — endpoints pra operação de campo:
 *   GET   /api/v1/field-ops/followups            → follow-ups de engajamento
 *   PATCH /api/v1/field-ops/followups/:id        → muda status/outcome
 *   GET   /api/v1/field-ops/leader-ranking       → ranking de líderes
 *
 * Sem chamada de IA — só agregações SQL.
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

const VALID_OUTCOMES = new Set(['pending', 'converted', 'lost', 'no_answer', 'postponed', 'cancelled']);

export function createFieldOpsRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // ── FOLLOW-UPS: lista pendentes/atrasados/concluídos ──────────────────
  router.get('/followups', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

      const status = String(req.query.status || 'all').toLowerCase();
      let q = supabase.from('engagement_followups')
        .select('id, "engagementActionId", "contactId", "personName", "personPhone", "personNeighborhood", "personType", "dueDate", status, "assignedTo", outcome, "resolvedAt", "createdAt"')
        .eq('campaignId', campaignId)
        .order('dueDate', { ascending: true })
        .limit(200);
      if (status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) return res.status(500).json({ error: error.message });

      // Conta por status (pra mostrar cards no topo)
      const all = data || [];
      const today = new Date().toISOString().slice(0, 10);
      const counts = {
        pending: all.filter(f => f.status === 'pending' && f.dueDate >= today).length,
        atrasados: all.filter(f => f.status === 'pending' && f.dueDate < today).length,
        converted: all.filter(f => f.status === 'converted').length,
        lost: all.filter(f => f.status === 'lost' || f.status === 'no_answer').length,
        total: all.length,
      };

      return res.json({ followups: all, counts });
    } catch (err: any) {
      console.error('[field-ops] followups:', err);
      return res.status(500).json({ error: err?.message });
    }
  });

  // ── PATCH: marca outcome ──────────────────────────────────────────────
  router.patch('/followups/:id', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      const userId = (req as any).user?.id;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

      const status = String((req.body || {}).status || '').toLowerCase();
      if (!VALID_OUTCOMES.has(status)) return res.status(400).json({ error: 'status_invalid' });

      const outcome = (req.body || {}).outcome ? String((req.body || {}).outcome).slice(0, 500) : null;

      const update: any = { status, updatedAt: new Date().toISOString() };
      if (status !== 'pending' && status !== 'postponed') {
        update.resolvedAt = new Date().toISOString();
        update.resolvedBy = userId || null;
        if (outcome) update.outcome = outcome;
      }
      if (status === 'postponed') {
        // adia 3 dias
        const newDue = new Date();
        newDue.setDate(newDue.getDate() + 3);
        update.dueDate = newDue.toISOString().slice(0, 10);
        update.status = 'pending';
      }

      const { error } = await supabase.from('engagement_followups')
        .update(update)
        .eq('id', req.params.id)
        .eq('campaignId', campaignId);
      if (error) return res.status(500).json({ error: error.message });

      // Se converted, atualiza supportLevel no contact
      if (status === 'converted') {
        const { data: f } = await supabase.from('engagement_followups')
          .select('contactId').eq('id', req.params.id).maybeSingle();
        if ((f as any)?.contactId) {
          await supabase.from('contacts')
            .update({ supportLevel: 'apoiador', lastInteractionAt: new Date().toISOString() })
            .eq('id', (f as any).contactId);
        }
      }

      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[field-ops] patch followup:', err);
      return res.status(500).json({ error: err?.message });
    }
  });

  // ── RANKING: líderes top por volume/conversão/vpf ─────────────────────
  router.get('/leader-ranking', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

      const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
      const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

      // Puxa visitas realizadas no período
      const { data: rows, error } = await supabase
        .from('visits')
        .select('lider, "leaderId", apoiador, votos')
        .eq('campaignId', campaignId)
        .eq('realizada', 'sim')
        .gte('data', sinceIso);
      if (error) return res.status(500).json({ error: error.message });

      const byLeader = new Map<string, { lider: string; leaderId: string | null; visitas: number; votos: number; apoiadores: number }>();
      for (const r of (rows || []) as any[]) {
        const key = r.leaderId || r.lider || 'Desconhecido';
        const prev = byLeader.get(key) || { lider: r.lider || 'Desconhecido', leaderId: r.leaderId || null, visitas: 0, votos: 0, apoiadores: 0 };
        prev.visitas += 1;
        prev.votos += Number(r.votos) || 0;
        const a = String(r.apoiador || '').toLowerCase();
        if (a === 'apoiador' || a === 'sim' || a.includes('apoiad')) prev.apoiadores += 1;
        byLeader.set(key, prev);
      }

      const ranking = [...byLeader.values()]
        .filter(l => l.visitas >= 3) // mínimo pra ter sinal
        .map(l => ({
          lider: l.lider,
          leaderId: l.leaderId,
          visitas: l.visitas,
          apoiadores: l.apoiadores,
          conversao: +(l.apoiadores / l.visitas * 100).toFixed(1),
          vpf: +(l.votos / l.visitas).toFixed(2),
          votos: l.votos,
        }))
        .sort((a, b) => b.visitas - a.visitas)
        .slice(0, 20);

      return res.json({ ranking, days, total: ranking.length });
    } catch (err: any) {
      console.error('[field-ops] ranking:', err);
      return res.status(500).json({ error: err?.message });
    }
  });

  return router;
}
