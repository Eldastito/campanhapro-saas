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

  // ── ROI: custo × produção por membro (#138) ───────────────────────────
  router.get('/team-roi', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

      const days = Math.max(7, Math.min(365, Number(req.query.days) || 30));
      const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const monthsInPeriod = +(days / 30).toFixed(2);

      // 1) Membros + custo mensal
      const { data: members } = await supabase
        .from('team_members')
        .select('id, name, role, cost')
        .eq('campaignId', campaignId);

      // 2) Visitas no período
      const { data: visits } = await supabase
        .from('visits')
        .select('lider, resp, apoiador, votos, "leaderId"')
        .eq('campaignId', campaignId)
        .eq('realizada', 'sim')
        .gte('data', sinceIso);

      // 3) Follow-ups convertidos no período
      const { data: followups } = await supabase
        .from('engagement_followups')
        .select('assignedTo, status, "resolvedAt"')
        .eq('campaignId', campaignId)
        .eq('status', 'converted')
        .gte('resolvedAt', sinceIso);

      const byMember = new Map<string, any>();
      const ensure = (name: string, id?: string | null, role?: string | null, cost?: number | null) => {
        const key = (name || '').trim();
        if (!key) return null;
        if (!byMember.has(key)) {
          byMember.set(key, {
            name: key,
            id: id || null,
            role: role || null,
            costMensal: cost ?? null,
            visitas: 0, apoiadores: 0, votos: 0, followupsConvertidos: 0,
          });
        }
        return byMember.get(key);
      };

      // Seed: todos os membros cadastrados (mesmo sem atividade aparecem)
      for (const m of (members || []) as any[]) {
        ensure(m.name, m.id, m.role, Number(m.cost) || 0);
      }

      // Agrega visitas
      for (const v of (visits || []) as any[]) {
        const name = (v.lider || v.resp || '').trim();
        const s = ensure(name);
        if (!s) continue;
        s.visitas += 1;
        s.votos += Number(v.votos) || 0;
        const a = String(v.apoiador || '').toLowerCase();
        if (a === 'apoiador' || a === 'sim' || a.includes('apoiad')) s.apoiadores += 1;
      }

      // Agrega follow-ups
      for (const f of (followups || []) as any[]) {
        const name = (f.assignedTo || '').trim();
        const s = ensure(name);
        if (!s) continue;
        s.followupsConvertidos += 1;
      }

      // Calcula ROI métricas
      const roiList = [...byMember.values()].map(s => {
        const custoNoPeriodo = (s.costMensal != null ? s.costMensal : 0) * monthsInPeriod;
        const totalApoiadoresEquivalente = s.apoiadores + s.followupsConvertidos * 1.5; // follow-up convertido pesa 1.5×
        const custoPorApoiador = totalApoiadoresEquivalente > 0
          ? +(custoNoPeriodo / totalApoiadoresEquivalente).toFixed(2)
          : null;
        const custoPorVoto = s.votos > 0
          ? +(custoNoPeriodo / s.votos).toFixed(2)
          : null;
        // ROI score: apoiadores equivalentes por R$1000 gastos. Sem custo = null.
        const roiScore = custoNoPeriodo > 0
          ? +((totalApoiadoresEquivalente / custoNoPeriodo) * 1000).toFixed(2)
          : null;
        return {
          ...s,
          custoNoPeriodo: +custoNoPeriodo.toFixed(2),
          totalApoiadoresEquivalente: +totalApoiadoresEquivalente.toFixed(1),
          custoPorApoiador,
          custoPorVoto,
          roiScore,
        };
      });

      // Ordena por ROI (melhor → pior). Sem custo vai pro fim.
      roiList.sort((a, b) => {
        if (a.roiScore == null && b.roiScore == null) return b.visitas - a.visitas;
        if (a.roiScore == null) return 1;
        if (b.roiScore == null) return -1;
        return b.roiScore - a.roiScore;
      });

      // Totais da campanha
      const totalCusto = roiList.reduce((s, m) => s + m.custoNoPeriodo, 0);
      const totalApoiadores = roiList.reduce((s, m) => s + m.totalApoiadoresEquivalente, 0);
      const totalVotos = roiList.reduce((s, m) => s + m.votos, 0);

      return res.json({
        members: roiList,
        totals: {
          custo: +totalCusto.toFixed(2),
          apoiadoresEquivalentes: +totalApoiadores.toFixed(1),
          votos: totalVotos,
          custoPorApoiador: totalApoiadores > 0 ? +(totalCusto / totalApoiadores).toFixed(2) : null,
          custoPorVoto: totalVotos > 0 ? +(totalCusto / totalVotos).toFixed(2) : null,
        },
        period: { days, monthsInPeriod, since: sinceIso },
      });
    } catch (err: any) {
      console.error('[field-ops] team-roi:', err);
      return res.status(500).json({ error: err?.message });
    }
  });

  // ── INACTIVITY: líderes parados há ≥N dias (#139) ─────────────────────
  router.get('/inactivity', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
      const cutoffDays = Math.max(2, Math.min(60, Number(req.query.days) || 7));
      const sinceCutoff = new Date(Date.now() - cutoffDays * 86_400_000).toISOString().slice(0, 10);

      const { data: members } = await supabase
        .from('team_members')
        .select('id, name, role')
        .eq('campaignId', campaignId)
        .in('role', ['Líder', 'Coordenador']);

      const { data: visits } = await supabase
        .from('visits')
        .select('lider, "leaderId", data')
        .eq('campaignId', campaignId)
        .eq('realizada', 'sim')
        .order('data', { ascending: false });

      // Última visita por nome do líder
      const lastByLeader = new Map<string, string>();
      for (const v of (visits || []) as any[]) {
        const name = (v.lider || '').trim();
        if (!name) continue;
        if (!lastByLeader.has(name)) lastByLeader.set(name, v.data);
      }

      const today = new Date().toISOString().slice(0, 10);
      const inactive: Array<{ name: string; role: string | null; lastVisit: string | null; daysInactive: number | null }> = [];
      for (const m of (members || []) as any[]) {
        const last = lastByLeader.get((m.name || '').trim()) || null;
        if (!last) {
          inactive.push({ name: m.name, role: m.role, lastVisit: null, daysInactive: null });
          continue;
        }
        if (last < sinceCutoff) {
          const days = Math.floor((new Date(today).getTime() - new Date(last).getTime()) / 86_400_000);
          inactive.push({ name: m.name, role: m.role, lastVisit: last, daysInactive: days });
        }
      }
      inactive.sort((a, b) => (b.daysInactive ?? 9999) - (a.daysInactive ?? 9999));

      return res.json({ inactive, cutoffDays, total: inactive.length });
    } catch (err: any) {
      console.error('[field-ops] inactivity:', err);
      return res.status(500).json({ error: err?.message });
    }
  });

  return router;
}
