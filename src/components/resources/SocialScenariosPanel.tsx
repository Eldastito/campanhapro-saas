/**
 * Painel de Cenários Históricos de Redes Sociais (#124).
 *
 * Lista as últimas análises IA disparadas pelo Quartel General em cima
 * de dados de redes sociais (manager_runs.source LIKE 'social%'). Mostra:
 *   - Última mudança detectada (do sync noturno) — banner no topo
 *   - Lista de cenários com finalSummary expandível
 *
 * Localização: aparece dentro do SocialConnectionsHub, abaixo dos cards.
 */
import React, { useEffect, useState } from 'react';
import { Sparkles, ChevronDown, ChevronRight, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import Card from '../ui/Card';
import { supabase } from '../../lib/supabaseClient';

interface ScenarioRun {
  id: string;
  intent: string;
  finalSummary: string | null;
  iterations: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  source: string | null;
}

interface LastChange {
  lastSyncedDate?: string;
  lastSyncedAt?: string;
  lastChangeDetected?: { detectedAt: string; summary: string; reasons: string[] } | null;
}

async function authGet(url: string): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

const SocialScenariosPanel: React.FC = () => {
  const [runs, setRuns] = useState<ScenarioRun[]>([]);
  const [lastChange, setLastChange] = useState<LastChange>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [h, c] = await Promise.all([
        authGet('/api/v1/social/history'),
        authGet('/api/v1/social/last-change'),
      ]);
      setRuns(h.runs || []);
      setLastChange(c || {});
    } catch (err) {
      console.error('[social-scenarios] fetch:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id: string) => {
    setExpanded(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const change = lastChange.lastChangeDetected;

  return (
    <Card className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-fuchsia-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Cenários gerados pela IA</h3>
        </div>
        <button
          onClick={fetchAll}
          className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
          title="Recarregar"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {change ? (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-bold text-amber-300 uppercase tracking-wider mb-1">
                Última mudança detectada no sync noturno
              </p>
              <p className="text-sm text-amber-100">{change.summary}</p>
              <p className="text-[10px] text-amber-200/60 mt-1.5">
                Detectada em {new Date(change.detectedAt).toLocaleString('pt-BR')}
              </p>
            </div>
          </div>
        </div>
      ) : lastChange.lastSyncedAt ? (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 mb-4 text-[11px] text-emerald-300">
          ✓ Último sync noturno: {new Date(lastChange.lastSyncedAt).toLocaleString('pt-BR')} — sem mudanças relevantes detectadas.
        </div>
      ) : null}

      {loading ? (
        <p className="text-xs text-slate-500 italic py-6 text-center">Carregando histórico...</p>
      ) : runs.length === 0 ? (
        <div className="text-center py-8 text-xs text-slate-500">
          <p>Nenhum cenário gerado ainda.</p>
          <p className="mt-1">Clique em <b className="text-fuchsia-400">"ANALISAR COM IA"</b> ou aguarde o sync noturno detectar mudanças.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => {
            const isOpen = expanded.has(r.id);
            const sourceTag =
              r.source === 'social_auto_sync' ? { label: '🌙 Auto', cls: 'bg-blue-500/20 text-blue-300' } :
              r.source === 'social_connections_hub' ? { label: '👤 Manual', cls: 'bg-emerald-500/20 text-emerald-300' } :
              { label: r.source || 'IA', cls: 'bg-slate-700 text-slate-300' };
            return (
              <div key={r.id} className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => toggle(r.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/50 transition-colors text-left"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-200 truncate">{r.intent}</p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                      <span className={`px-1.5 py-0.5 rounded ${sourceTag.cls}`}>{sourceTag.label}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {new Date(r.startedAt).toLocaleString('pt-BR')}
                      </span>
                      <span>·</span>
                      <span>{r.iterations} iter.</span>
                      <span>·</span>
                      <span className={r.status === 'done' ? 'text-emerald-400' : r.status === 'budget_exceeded' ? 'text-orange-400' : 'text-slate-400'}>
                        {r.status}
                      </span>
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-slate-800">
                    {r.finalSummary ? (
                      <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{r.finalSummary}</p>
                    ) : (
                      <p className="text-xs text-slate-500 italic">Sem resumo final ({r.status}).</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

export default SocialScenariosPanel;
