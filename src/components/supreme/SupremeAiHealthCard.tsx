import * as React from 'react';
import { Brain, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import Card from '../ui/Card';
import { authedFetch } from '../../lib/authedFetch';

/**
 * AI Health visível APENAS pro Supreme Control (regra #111). Mostra:
 *  • custo total do mês em R$ (USD→BRL convertido)
 *  • tokens in/out
 *  • top 10 agentes por custo (R$ + chamadas + erros)
 *  • top 10 campanhas por custo (R$ + chamadas)
 *
 * É AQUI que se decide quando recarregar créditos do provider de IA.
 */
interface AgentRow { agentId: string; runs: number; costCents: number; errors: number }
interface CampaignRow { campaignId: string; name: string; runs: number; costCents: number }
interface AiHealth {
  month: string;
  totals: { runs: number; errors: number; costCentsUsd: number; tokensIn: number; tokensOut: number };
  topAgents: AgentRow[];
  topCampaigns: CampaignRow[];
}

const BRL_PER_USD = 5.50;
const toBRL = (cents: number) => 'R$ ' + ((cents / 100) * BRL_PER_USD).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toUSD = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SupremeAiHealthCard: React.FC = () => {
  const [data, setData] = React.useState<AiHealth | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await authedFetch('/api/v1/supreme/ai-health');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.detail || j?.error || 'Falha');
      setData(j);
    } catch (e: any) { setErr(e?.message || 'Erro'); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  return (
    <Card className="bg-slate-900/50 border-white/5 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-indigo-400" />
          <h3 className="text-base font-bold text-white">AI Health (todas campanhas)</h3>
          {data && data.totals.errors > 0 && (
            <span className="ml-1 text-xs text-rose-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {data.totals.errors} erro(s)
            </span>
          )}
        </div>
        <button onClick={load} disabled={loading} className="text-xs text-slate-400 hover:text-white flex items-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Atualizar
        </button>
      </div>

      {err && <p className="text-xs text-rose-400 mb-2">{err}</p>}

      {data && (
        <div className="space-y-4">
          {/* Totais — em USD e BRL pra o Supreme decidir recarga */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Mini label="Gasto mês (BRL)" value={toBRL(data.totals.costCentsUsd)} accent="text-emerald-400" />
            <Mini label="Gasto mês (USD)" value={toUSD(data.totals.costCentsUsd)} accent="text-amber-400" />
            <Mini label="Chamadas" value={data.totals.runs.toLocaleString('pt-BR')} />
            <Mini label="Tokens (in+out)" value={(data.totals.tokensIn + data.totals.tokensOut).toLocaleString('pt-BR')} />
          </div>

          {/* Top agentes — onde a IA mais queima */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Top 10 agentes por custo</p>
            <div className="space-y-1">
              {data.topAgents.map((a) => {
                const max = data.topAgents[0]?.costCents || 1;
                const w = Math.max(2, Math.round((a.costCents / max) * 100));
                return (
                  <div key={a.agentId} className="flex items-center gap-2 text-xs">
                    <div className="w-32 truncate text-slate-300 font-bold shrink-0">{a.agentId}</div>
                    <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500" style={{ width: `${w}%` }} />
                    </div>
                    <div className="w-20 text-right text-slate-400 shrink-0">{a.runs}c</div>
                    <div className="w-24 text-right text-emerald-400 font-bold shrink-0">{toBRL(a.costCents)}</div>
                    {a.errors > 0 && <div className="text-rose-400 shrink-0">⚠️{a.errors}</div>}
                  </div>
                );
              })}
              {data.topAgents.length === 0 && <p className="text-xs text-slate-500">Sem chamadas este mês.</p>}
            </div>
          </div>

          {/* Top campanhas — quem mais consome */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Top 10 campanhas por custo</p>
            <div className="space-y-1">
              {data.topCampaigns.map((c) => {
                const max = data.topCampaigns[0]?.costCents || 1;
                const w = Math.max(2, Math.round((c.costCents / max) * 100));
                return (
                  <div key={c.campaignId} className="flex items-center gap-2 text-xs">
                    <div className="w-32 truncate text-slate-300 font-bold shrink-0" title={c.campaignId}>{c.name}</div>
                    <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-sky-500 to-cyan-500" style={{ width: `${w}%` }} />
                    </div>
                    <div className="w-20 text-right text-slate-400 shrink-0">{c.runs}c</div>
                    <div className="w-24 text-right text-emerald-400 font-bold shrink-0">{toBRL(c.costCents)}</div>
                  </div>
                );
              })}
              {data.topCampaigns.length === 0 && <p className="text-xs text-slate-500">Sem chamadas este mês.</p>}
            </div>
          </div>

          <p className="text-[10px] text-slate-500 pt-2 border-t border-white/5">
            BRL ≈ USD × {BRL_PER_USD}. Mês atual: {data.month}. Recarregue Anthropic/OpenAI quando o gasto se aproximar do crédito disponível.
          </p>
        </div>
      )}
    </Card>
  );
};

const Mini: React.FC<{ label: string; value: string; accent?: string }> = ({ label, value, accent = 'text-white' }) => (
  <div className="bg-slate-800/40 border border-white/5 rounded-lg p-2.5">
    <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
    <p className={`text-base font-black ${accent} mt-0.5`}>{value}</p>
  </div>
);

export default SupremeAiHealthCard;
