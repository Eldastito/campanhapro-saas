import * as React from 'react';
import { authedFetch } from '../../lib/authedFetch';
import { Newspaper, TrendingUp, TrendingDown, AlertTriangle, Sparkles, Loader2, X } from 'lucide-react';

/**
 * Digest Semanal IA do Partido (#85). Card destacado no topo do painel do
 * presidente. Botão "Gerar digest" chama callAgent (#110) que devolve resumo
 * + highlights + ações. Custo de tokens NÃO exposto (regra #111).
 */
interface DigestData {
  party: string;
  analyzedAt: string;
  stats: { total: number; greens: number; reds: number; retidos: number; cortados: number;
           totalReceived: number; totalAllocated: number };
  summary: string;
  highlights: Array<{ type: 'subiu' | 'caiu' | 'risco' | 'destaque'; candidateId: string; title: string; body: string }>;
  actions: string[];
}

const TYPE_META: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
  subiu: { icon: <TrendingUp className="w-4 h-4" />, cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', label: 'SUBIU' },
  caiu: { icon: <TrendingDown className="w-4 h-4" />, cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300', label: 'CAIU' },
  risco: { icon: <AlertTriangle className="w-4 h-4" />, cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300', label: 'RISCO' },
  destaque: { icon: <Sparkles className="w-4 h-4" />, cls: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300', label: 'DESTAQUE' },
};

const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

const WeeklyDigestCard: React.FC = () => {
  const [data, setData] = React.useState<DigestData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  const run = async () => {
    setLoading(true); setError(null);
    try {
      const r = await authedFetch('/api/v1/party/digest-weekly', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Falha ao gerar digest');
      setData(j); setOpen(true);
    } catch (e: any) { setError(e?.message || 'Erro'); }
    finally { setLoading(false); }
  };

  return (
    <div className="bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent border border-indigo-500/20 rounded-3xl p-5 mb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl">
            <Newspaper className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Digest Semanal do Partido</h3>
            <p className="text-xs text-slate-400">A IA olha o que mudou e te entrega só o que importa.</p>
          </div>
        </div>
        <button onClick={run} disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2 shrink-0">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Newspaper className="w-4 h-4" />}
          {data ? 'Atualizar' : 'Gerar digest'}
        </button>
      </div>

      {error && <p className="text-xs text-rose-400 mt-3">{error}</p>}

      {data && open && (
        <div className="mt-4 space-y-4">
          {/* Stats numericas — visual de cabeçalho */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Stat label="Candidatos" value={data.stats.total} />
            <Stat label="🟢 Em dia" value={data.stats.greens} cls="text-emerald-300" />
            <Stat label="🔴 Risco" value={data.stats.reds} cls="text-rose-300" />
            <Stat label="Recebido" value={brl(data.stats.totalReceived)} small />
            <Stat label="Alocado" value={brl(data.stats.totalAllocated)} small />
          </div>

          {/* Resumo da IA */}
          {data.summary && (
            <div className="bg-slate-900/60 border border-white/10 rounded-xl p-3.5">
              <p className="text-sm text-slate-200 leading-relaxed">{data.summary}</p>
            </div>
          )}

          {/* Highlights */}
          {data.highlights.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-slate-400 font-bold mb-2">Destaques da semana</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {data.highlights.map((h, i) => {
                  const meta = TYPE_META[h.type] || TYPE_META.destaque;
                  return (
                    <div key={i} className={`border rounded-xl p-3 ${meta.cls}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        {meta.icon}
                        <span className="text-[10px] uppercase tracking-wider font-black">{meta.label}</span>
                      </div>
                      <p className="text-sm font-bold mb-1">{h.title}</p>
                      <p className="text-xs opacity-80">{h.body}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Ações */}
          {data.actions.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-emerald-400 font-bold mb-2">🎯 Faça essa semana</h4>
              <ol className="space-y-1.5">
                {data.actions.map((a, i) => (
                  <li key={i} className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2.5 text-sm text-emerald-100 flex gap-2">
                    <span className="font-bold text-emerald-400">{i + 1}.</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2 border-t border-white/5">
            <span>Gerado {new Date(data.analyzedAt).toLocaleString('pt-BR')}</span>
            <button onClick={() => setOpen(false)} className="hover:text-white flex items-center gap-1">
              <X className="w-3 h-3" /> Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number | string; cls?: string; small?: boolean }> = ({ label, value, cls = 'text-white', small }) => (
  <div className="bg-slate-900/40 border border-white/5 rounded-xl p-2.5">
    <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
    <p className={`font-black ${cls} ${small ? 'text-sm mt-1' : 'text-2xl'}`}>{value}</p>
  </div>
);

export default WeeklyDigestCard;
