/**
 * Card "Recomendação IA" — botão pra disparar Manager IA comparar planejado vs
 * real e propor ações. Lista as últimas análises pra esta campanha (#134).
 */
import React, { useEffect, useState } from 'react';
import { Sparkles, ChevronDown, ChevronRight, Clock, RefreshCw } from 'lucide-react';
import Card from '../ui/Card';
import { supabase } from '../../lib/supabaseClient';

interface AnalysisRun {
  id: string;
  intent: string;
  finalSummary: string | null;
  iterations: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
}

async function authFetch(url: string, init: RequestInit = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const r = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

const CalculatorAnalysisCard: React.FC = () => {
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadHistory = async () => {
    setLoading(true);
    try {
      // Reusa o /api/v1/social/history que retorna manager_runs com source LIKE 'social%'.
      // Aqui queremos source='calculator', mas o endpoint só filtra LIKE 'social%'.
      // Solução: vou fazer um GET direto no manager/runs do server + filtrar no client.
      // (Refactor futuro: parametrizar o source).
      const { data: { session } } = await supabase.auth.getSession();
      const campaignId = (session?.user?.user_metadata as any)?.campaignId || null;
      // Backup: usa o /api/agents/manager/runs (recupera 20 últimos)
      const url = `/api/agents/manager/runs${campaignId ? `?campaign_id=${campaignId}` : ''}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      const j = await r.json();
      // Filtra no client por intent que menciona calculadora
      const filtered = (j.runs || []).filter((run: any) =>
        run.intent && (run.intent.includes('Calculadora') || run.intent.includes('calculator')),
      ).slice(0, 5);
      setRuns(filtered);
    } catch (err) {
      console.error('[calc analysis] load:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadHistory(); }, []);

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const res = await authFetch('/api/v1/calculator/analyze', { method: 'POST', body: '{}' });
      alert(res.message || 'Análise iniciada. Volte em ~1 minuto pra ver o resultado.');
      // Recarrega histórico em 30s
      setTimeout(loadHistory, 30_000);
    } catch (err: any) {
      const msg = err?.message || 'erro';
      if (msg.includes('sem_dados_suficientes')) {
        alert('Você ainda não tem visitas suficientes pra análise. Registre pelo menos 20 visitas realizadas.');
      } else {
        alert('Falha ao iniciar análise: ' + msg);
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const toggle = (id: string) => {
    setExpanded(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  return (
    <Card className="border-l-4 border-l-fuchsia-500/40">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-fuchsia-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Recomendação da IA</h3>
        </div>
        <div className="flex gap-1">
          <button onClick={loadHistory} className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <button
        onClick={analyze}
        disabled={analyzing}
        className="w-full flex items-center justify-center gap-2 py-3 mb-4 bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all"
      >
        <Sparkles className={`w-4 h-4 ${analyzing ? 'animate-spin' : ''}`} />
        {analyzing ? 'Disparando análise...' : 'Gerar análise (planejado vs real)'}
      </button>

      <p className="text-[10px] text-slate-500 mb-3">
        A IA vai comparar seu cenário planejado com os dados reais das visitas e propor 3 ações concretas. Custo: ~R$ 0,03 por análise.
      </p>

      {runs.length === 0 && !loading ? (
        <p className="text-xs text-slate-500 italic text-center py-4">
          Nenhuma análise gerada ainda. Clique no botão acima.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Histórico</p>
          {runs.map(run => {
            const isOpen = expanded.has(run.id);
            return (
              <div key={run.id} className="bg-slate-900/60 rounded-lg border border-slate-800">
                <button
                  onClick={() => toggle(run.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/40"
                >
                  {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span className="text-[11px] text-slate-400">{new Date(run.startedAt).toLocaleString('pt-BR')}</span>
                  <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    run.status === 'done' ? 'bg-emerald-500/20 text-emerald-300' :
                    run.status === 'budget_exceeded' ? 'bg-orange-500/20 text-orange-300' :
                    'bg-slate-700 text-slate-300'
                  }`}>{run.status}</span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 pt-1 border-t border-slate-800">
                    {run.finalSummary ? (
                      <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{run.finalSummary}</p>
                    ) : (
                      <p className="text-xs text-slate-500 italic">Análise ainda processando ou sem resumo final.</p>
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

export default CalculatorAnalysisCard;
