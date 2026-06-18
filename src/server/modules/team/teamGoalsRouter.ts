/**
 * Metas por membro × bairro (#53).
 *
 *   GET    /api/v1/team/goals               lista metas + progresso atual
 *   POST   /api/v1/team/goals               cria/edita meta (Admin/Coordenador)
 *   DELETE /api/v1/team/goals/:id           remove meta (Admin/Coordenador)
 *
 * Progresso NUNCA é gravado — é computado em runtime cruzando visits/contacts/
 * engagement_actions. Evita drift entre "meta" e "feito".
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

interface GoalRow {
  id: string;
  campaignId: string;
  memberId: string | null;
  bairro: string | null;
  visitTarget: number;
  contactTarget: number;
  supporterTarget: number;
  deadline: string | null;
  notes: string | null;
  createdAt: string;
}

function isAdminLike(type: any) {
  return type === 'Admin' || type === 'Coordenador';
}

export function createTeamGoalsRouter(supabase: SupabaseClient) {
  const router = Router();

  router.get('/goals', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

      const { data: goals, error } = await supabase
        .from('team_goals')
        .select('*')
        .eq('campaignId', campaignId)
        .order('createdAt', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });

      // Progresso: 1 query por dimensão, agrega em memória.
      // Carrega só o necessário pra computar progresso de TODAS as metas em paralelo.
      const [visitsRes, contactsRes, engagementsRes, membersRes] = await Promise.all([
        supabase.from('visits')
          .select('id, bairro, realizada, "createdBy"')
          .eq('campaignId', campaignId).limit(20000),
        supabase.from('contacts')
          .select('id, neighborhood, "supportLevel", "createdBy"')
          .eq('campaignId', campaignId).limit(50000),
        supabase.from('engagement_actions')
          .select('id, "createdBy", "novosApoiadores", "contatosColetados"')
          .eq('campaignId', campaignId).limit(20000),
        supabase.from('team_members')
          .select('id, name, role, "userId", neighborhood')
          .eq('campaignId', campaignId).limit(2000),
      ]);

      const visits = (visitsRes.data ?? []) as any[];
      const contacts = (contactsRes.data ?? []) as any[];
      const engs = (engagementsRes.data ?? []) as any[];
      const members = (membersRes.data ?? []) as any[];

      // Resolve memberId → userId (createdBy nas tabelas é geralmente o auth.uid).
      const memberByUid = new Map<string, any>();
      for (const m of members) {
        if (m.userId) memberByUid.set(m.userId, m);
      }

      const computeProgress = (g: GoalRow) => {
        const matchesMember = (createdBy: any) => {
          if (!g.memberId) return true;
          const mem = members.find(m => m.id === g.memberId);
          if (!mem) return false;
          return mem.userId && createdBy === mem.userId;
        };
        const matchesBairro = (b: string | null | undefined) => {
          if (!g.bairro) return true;
          return String(b || '').trim().toLowerCase() === g.bairro.trim().toLowerCase();
        };

        let visitDone = 0, contactDone = 0, supporterDone = 0;
        for (const v of visits) {
          if (v.realizada && matchesMember(v.createdBy) && matchesBairro(v.bairro)) visitDone++;
        }
        for (const c of contacts) {
          if (matchesMember(c.createdBy) && matchesBairro(c.neighborhood)) {
            contactDone++;
            if (c.supportLevel === 'apoiador' || c.supportLevel === 'multiplicador') supporterDone++;
          }
        }
        // engajamentos só contam o agregado (não têm bairro estruturado)
        if (!g.bairro) {
          for (const e of engs) {
            if (matchesMember(e.createdBy)) {
              contactDone += Number(e.contatosColetados || 0);
              supporterDone += Number(e.novosApoiadores || 0);
            }
          }
        }
        return { visitDone, contactDone, supporterDone };
      };

      const enriched = (goals as GoalRow[] || []).map(g => {
        const mem = g.memberId ? members.find(m => m.id === g.memberId) : null;
        return {
          ...g,
          memberName: mem?.name || (g.memberId ? 'Membro removido' : null),
          memberRole: mem?.role || null,
          progress: computeProgress(g),
        };
      });

      return res.json({ goals: enriched, members: members.map((m: any) => ({ id: m.id, name: m.name, role: m.role })) });
    } catch (err: any) {
      console.error('[team_goals] list:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/goals', async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const campaignId = (req as any).user?.campaignId;
      const userType = (req as any).user?.userType;
      if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
      if (!isAdminLike(userType)) return res.status(403).json({ error: 'admin_required' });

      const { id, memberId, bairro, visitTarget, contactTarget, supporterTarget, deadline, notes } = req.body || {};
      const row: any = {
        campaignId,
        memberId: memberId || null,
        bairro: bairro ? String(bairro).trim().slice(0, 80) : null,
        visitTarget: Math.max(0, Number(visitTarget) || 0),
        contactTarget: Math.max(0, Number(contactTarget) || 0),
        supporterTarget: Math.max(0, Number(supporterTarget) || 0),
        deadline: deadline || null,
        notes: notes ? String(notes).slice(0, 300) : null,
        updatedAt: new Date().toISOString(),
      };

      let data, error;
      if (id) {
        ({ data, error } = await supabase.from('team_goals').update(row).eq('id', id).eq('campaignId', campaignId).select('*').single());
      } else {
        row.createdBy = userId;
        ({ data, error } = await supabase.from('team_goals').insert(row).select('*').single());
      }
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ goal: data });
    } catch (err: any) {
      console.error('[team_goals] upsert:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  router.delete('/goals/:id', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      const userType = (req as any).user?.userType;
      if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
      if (!isAdminLike(userType)) return res.status(403).json({ error: 'admin_required' });

      const { error } = await supabase.from('team_goals').delete().eq('id', req.params.id).eq('campaignId', campaignId);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[team_goals] delete:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
