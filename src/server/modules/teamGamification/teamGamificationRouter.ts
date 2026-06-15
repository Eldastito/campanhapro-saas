/**
 * Gamificação da Equipe (#136).
 *
 *   GET  /api/v1/team-gamification/profile     → XP + nível + badges por membro
 *   POST /api/v1/team-gamification/evaluate    → varre regras e atribui badges
 *
 * Tudo SQL puro — zero IA.
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

interface MemberStats {
  memberName: string;
  visitas: number;
  apoiadores: number;
  diasAtivos: number;
  followupsConvertidos: number;
  xp: number;
  level: { num: number; label: string; minXp: number; nextXp: number; progressPct: number };
}

const LEVELS = [
  { num: 1, label: 'Aprendiz', minXp: 0 },
  { num: 2, label: 'Apoiador', minXp: 50 },
  { num: 3, label: 'Líder de Quadra', minXp: 150 },
  { num: 4, label: 'Coordenador', minXp: 400 },
  { num: 5, label: 'Veterano', minXp: 1000 },
  { num: 6, label: 'Mestre', minXp: 2500 },
];

function computeLevel(xp: number) {
  let current = LEVELS[0];
  let next = LEVELS[1];
  for (let i = 0; i < LEVELS.length; i++) {
    if (xp >= LEVELS[i].minXp) {
      current = LEVELS[i];
      next = LEVELS[i + 1] || LEVELS[LEVELS.length - 1];
    }
  }
  const nextXp = next.minXp;
  const span = Math.max(1, nextXp - current.minXp);
  const progressPct = current === next ? 100 : Math.min(100, Math.round(((xp - current.minXp) / span) * 100));
  return { num: current.num, label: current.label, minXp: current.minXp, nextXp, progressPct };
}

const BADGES = [
  { key: 'first_visit', label: '👣 Primeira Visita', desc: 'Registrou a primeira visita', rule: (s: MemberStats) => s.visitas >= 1 },
  { key: 'rookie_10', label: '🌱 Iniciante (10 visitas)', desc: '10 visitas realizadas', rule: (s: MemberStats) => s.visitas >= 10 },
  { key: 'veteran_50', label: '🏅 Veterano (50 visitas)', desc: '50 visitas realizadas', rule: (s: MemberStats) => s.visitas >= 50 },
  { key: 'centurion_100', label: '⚔️ Centurião (100 visitas)', desc: '100 visitas realizadas', rule: (s: MemberStats) => s.visitas >= 100 },
  { key: 'converter_10', label: '🎯 Convertedor (10 apoiadores)', desc: 'Convenceu 10 apoiadores', rule: (s: MemberStats) => s.apoiadores >= 10 },
  { key: 'converter_50', label: '🚀 Convertedor Master (50)', desc: 'Convenceu 50 apoiadores', rule: (s: MemberStats) => s.apoiadores >= 50 },
  { key: 'active_7d', label: '🔥 Ativo 7 dias', desc: 'Visitou em 7 dias diferentes', rule: (s: MemberStats) => s.diasAtivos >= 7 },
  { key: 'active_30d', label: '🔥🔥 Ativo 30 dias', desc: 'Visitou em 30 dias diferentes', rule: (s: MemberStats) => s.diasAtivos >= 30 },
  { key: 'followup_5', label: '📞 Closer (5 follow-ups)', desc: 'Converteu 5 follow-ups em apoiadores', rule: (s: MemberStats) => s.followupsConvertidos >= 5 },
];

async function collectStats(supabase: SupabaseClient, campaignId: string): Promise<Map<string, MemberStats>> {
  // 1) Agrega visits por responsável + líder
  const { data: visits } = await supabase
    .from('visits')
    .select('lider, resp, apoiador, data, realizada')
    .eq('campaignId', campaignId)
    .eq('realizada', 'sim');

  const byMember = new Map<string, MemberStats>();
  const ensure = (name: string): MemberStats => {
    const key = name.trim();
    if (!key) return null as any;
    if (!byMember.has(key)) {
      byMember.set(key, {
        memberName: key,
        visitas: 0, apoiadores: 0, diasAtivos: 0,
        followupsConvertidos: 0, xp: 0,
        level: { num: 1, label: 'Aprendiz', minXp: 0, nextXp: 50, progressPct: 0 },
      });
    }
    return byMember.get(key)!;
  };

  const datasByMember = new Map<string, Set<string>>();
  for (const v of (visits || []) as any[]) {
    const name = v.lider || v.resp || '';
    const s = ensure(name);
    if (!s) continue;
    s.visitas += 1;
    const a = String(v.apoiador || '').toLowerCase();
    if (a === 'apoiador' || a === 'sim' || a.includes('apoiad')) s.apoiadores += 1;
    if (v.data) {
      const set = datasByMember.get(name) || new Set<string>();
      set.add(v.data);
      datasByMember.set(name, set);
    }
  }
  for (const [name, set] of datasByMember) {
    const s = byMember.get(name);
    if (s) s.diasAtivos = set.size;
  }

  // 2) Follow-ups convertidos por assignedTo
  const { data: followups } = await supabase
    .from('engagement_followups')
    .select('assignedTo, status')
    .eq('campaignId', campaignId)
    .eq('status', 'converted');
  for (const f of (followups || []) as any[]) {
    const name = (f.assignedTo || '').trim();
    if (!name) continue;
    const s = ensure(name);
    if (s) s.followupsConvertidos += 1;
  }

  // 3) Calcula XP + nível
  for (const s of byMember.values()) {
    s.xp = s.visitas * 1 + s.apoiadores * 5 + s.followupsConvertidos * 10 + s.diasAtivos * 2;
    s.level = computeLevel(s.xp);
  }

  return byMember;
}

export function createTeamGamificationRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // ── GET /profile — perfil + badges de TODOS os membros ─────────────────
  router.get('/profile', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

      const byMember = await collectStats(supabase, campaignId);

      // Badges já conquistados no banco
      const { data: earnedRaw } = await supabase
        .from('team_badges')
        .select('memberName, badgeKey, earnedAt')
        .eq('campaignId', campaignId);
      const earnedByMember = new Map<string, Set<string>>();
      for (const e of (earnedRaw || []) as any[]) {
        const set = earnedByMember.get(e.memberName) || new Set();
        set.add(e.badgeKey);
        earnedByMember.set(e.memberName, set);
      }

      const profiles = [...byMember.values()].map(s => {
        const earned = earnedByMember.get(s.memberName) || new Set<string>();
        const badges = BADGES.map(b => ({
          key: b.key,
          label: b.label,
          desc: b.desc,
          earned: earned.has(b.key) || b.rule(s),
        }));
        return { ...s, badges };
      }).sort((a, b) => b.xp - a.xp);

      return res.json({
        members: profiles,
        catalog: BADGES.map(b => ({ key: b.key, label: b.label, desc: b.desc })),
        levels: LEVELS,
      });
    } catch (err: any) {
      console.error('[team-gamification] profile:', err);
      return res.status(500).json({ error: err?.message });
    }
  });

  // ── POST /evaluate — varre regras e persiste badges novos ──────────────
  router.post('/evaluate', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

      const byMember = await collectStats(supabase, campaignId);
      const { data: earnedRaw } = await supabase
        .from('team_badges')
        .select('memberName, badgeKey')
        .eq('campaignId', campaignId);
      const earnedSet = new Set<string>();
      for (const e of (earnedRaw || []) as any[]) {
        earnedSet.add(`${e.memberName}::${e.badgeKey}`);
      }

      const novos: any[] = [];
      for (const s of byMember.values()) {
        for (const b of BADGES) {
          if (b.rule(s) && !earnedSet.has(`${s.memberName}::${b.key}`)) {
            novos.push({
              campaignId,
              memberName: s.memberName,
              badgeKey: b.key,
              context: { xp: s.xp, visitas: s.visitas, apoiadores: s.apoiadores },
            });
          }
        }
      }

      if (novos.length > 0) {
        await supabase.from('team_badges').insert(novos);
      }

      return res.json({ ok: true, novos: novos.length, total: BADGES.length });
    } catch (err: any) {
      console.error('[team-gamification] evaluate:', err);
      return res.status(500).json({ error: err?.message });
    }
  });

  return router;
}
