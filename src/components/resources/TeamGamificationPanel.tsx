/**
 * Painel de Gamificação da Equipe (#136).
 *
 * Mostra ranking por XP + badges conquistados + próximas conquistas. Botão
 * "Avaliar conquistas" varre regras e atribui novos badges.
 */
import React, { useEffect, useState } from 'react';
import { Trophy, Star, RefreshCw, Award, Sparkles } from 'lucide-react';
import Card from '../ui/Card';
import { supabase } from '../../lib/supabaseClient';

interface BadgeView {
  key: string;
  label: string;
  desc: string;
  earned: boolean;
}

interface LevelInfo {
  num: number;
  label: string;
  minXp: number;
  nextXp: number;
  progressPct: number;
}

interface MemberProfile {
  memberName: string;
  visitas: number;
  apoiadores: number;
  diasAtivos: number;
  followupsConvertidos: number;
  xp: number;
  level: LevelInfo;
  badges: BadgeView[];
}

async function authFetch(url: string, init: RequestInit = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const r = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

interface TeamGamificationPanelProps {
  /** Reservado pra rodadas futuras de filtro temporal — hoje calcula tudo do histórico. */
  daysProp?: number;
}

const TeamGamificationPanel: React.FC<TeamGamificationPanelProps> = (_props) => {
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await authFetch('/api/v1/team-gamification/profile');
      setMembers(r.members || []);
    } catch (err) {
      console.error('[gamification] load:', err);
    } finally {
      setLoading(false);
    }
  };

  const evaluate = async () => {
    setEvaluating(true);
    try {
      const r = await authFetch('/api/v1/team-gamification/evaluate', { method: 'POST', body: '{}' });
      alert(`✨ ${r.novos} nova(s) conquista(s) atribuída(s)!`);
      load();
    } catch (err: any) {
      alert('Falha: ' + (err?.message || 'erro'));
    } finally {
      setEvaluating(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <Card className="border-l-4 border-l-violet-500">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-violet-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Conquistas da Equipe</h3>
        </div>
        <div className="flex gap-1">
          <button onClick={load} className="p-1.5 hover:bg-slate-800 rounded text-slate-400">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={evaluate}
            disabled={evaluating}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold rounded-lg transition-all"
          >
            <Sparkles className={`w-3.5 h-3.5 ${evaluating ? 'animate-spin' : ''}`} />
            {evaluating ? '...' : 'Avaliar'}
          </button>
        </div>
      </div>

      {loading && members.length === 0 ? (
        <p className="text-xs text-slate-500 italic py-4">Carregando estatísticas da equipe...</p>
      ) : members.length === 0 ? (
        <div className="text-center py-6 text-xs text-slate-500">
          <Award className="w-8 h-8 mx-auto text-violet-500/40 mb-2" />
          <p>Sem dados de atividade da equipe ainda.</p>
          <p className="mt-1">Conforme líderes registram visitas e fazem follow-ups, eles aparecem aqui.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((m, i) => {
            const isOpen = expanded === m.memberName;
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`;
            const earnedCount = m.badges.filter(b => b.earned).length;
            return (
              <div key={m.memberName} className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : m.memberName)}
                  className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-slate-800/40 transition-colors text-left"
                >
                  <span className="text-lg w-7 text-center">{medal}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="text-sm font-bold text-white truncate">{m.memberName}</p>
                      <span className="text-[10px] font-bold text-violet-300 bg-violet-500/20 px-2 py-0.5 rounded-full">
                        Nv {m.level.num} · {m.level.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] text-slate-500">
                        {m.visitas} visitas · {m.apoiadores} apoiadores
                      </span>
                      <span className="text-[10px] text-amber-300 flex items-center gap-0.5">
                        <Star className="w-2.5 h-2.5" /> {m.xp} XP
                      </span>
                      <span className="text-[10px] text-violet-300">
                        {earnedCount}/{m.badges.length} conquistas
                      </span>
                    </div>
                    {/* Barra de progresso pro próximo nível */}
                    <div className="mt-1.5 w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                           style={{ width: `${m.level.progressPct}%` }} />
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 pt-1 border-t border-slate-800">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                      Conquistas ({earnedCount}/{m.badges.length})
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {m.badges.map(b => (
                        <div
                          key={b.key}
                          className={`text-[10px] p-1.5 rounded border ${
                            b.earned
                              ? 'bg-violet-500/10 border-violet-500/30 text-violet-200'
                              : 'bg-slate-800/40 border-slate-800 text-slate-500'
                          }`}
                          title={b.desc}
                        >
                          {b.earned ? '✓ ' : '○ '}{b.label}
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2 italic">
                      Próximo nível: {m.level.nextXp} XP (faltam {Math.max(0, m.level.nextXp - m.xp)})
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-slate-500 italic mt-3">
        XP = visitas × 1 + apoiadores × 5 + follow-ups convertidos × 10 + dias ativos × 2
      </p>
    </Card>
  );
};

export default TeamGamificationPanel;
