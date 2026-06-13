import * as React from 'react';
import Card from '../ui/Card';
import { authedFetch } from '../../lib/authedFetch';
import { MapPin, AlertTriangle, Loader2, Target, ArrowUpRight, Compass } from 'lucide-react';

/**
 * Foco de Campo IA (#116). Card no Dashboard que responde:
 *   "Coordenador — semana que vem vá nesses bairros, com essa pauta, evite esses."
 *
 * Chama POST /intelligence/field-focus on demand. Resultado é guardado em
 * memória pra evitar regerar dentro da mesma sessão (custa IA).
 */
interface Focus {
  analyzedAt: string;
  daysToElection: number | null;
  summary: string;
  recommendations: Array<{
    bairro: string; municipio: string;
    priority: 'alta' | 'media' | 'baixa';
    reason: string; pauta: string; action: string;
  }>;
  avoidance: Array<{ bairro: string; municipio: string; reason: string }>;
}

const priorityCls = (p: string) =>
  p === 'alta' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
  : p === 'media' ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
  : 'border-slate-700 bg-slate-800/40 text-slate-300';

const FieldFocusCard: React.FC = () => {
  const [data, setData] = React.useState<Focus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null);
    try {
      const r = await authedFetch('/api/v1/intelligence/field-focus', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Falha ao gerar foco');
      setData(j);
    } catch (e: any) { setError(e?.message || 'Erro'); }
    finally { setLoading(false); }
  };

  return (
    <Card className="no-print p-6 border-t-4 border-t-indigo-500">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-lg">
            <Compass className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-100 flex items-center gap-2">Foco de Campo da Semana</h3>
            <p className="text-sm text-slate-400">A IA cruza sentimento + visitas + dias até a eleição.</p>
          </div>
        </div>
        <button onClick={run} disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-bold px-3 py-2 rounded-xl flex items-center gap-2 shrink-0">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
          {data ? 'Recalcular' : 'Gerar foco'}
        </button>
      </div>

      {error && <p className="text-xs text-rose-400 mb-3">{error}</p>}

      {!data && !loading && !error && (
        <div className="text-center py-8 border border-dashed border-white/10 rounded-2xl">
          <p className="text-sm text-slate-400">Clique em <b>Gerar foco</b> para a IA priorizar onde a equipe deve atuar.</p>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          {/* Resumo */}
          {data.summary && (
            <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-3">
              <p className="text-sm text-indigo-200 leading-relaxed">{data.summary}</p>
              {data.daysToElection != null && (
                <p className="text-[11px] text-indigo-400/70 mt-1.5">📅 Faltam {data.daysToElection} dias até a eleição.</p>
              )}
            </div>
          )}

          {/* Onde ir */}
          {data.recommendations.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-emerald-400 font-bold mb-2 flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5" /> Ir essa semana
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {data.recommendations.map((r, i) => (
                  <div key={i} className={`border rounded-xl p-3 ${priorityCls(r.priority)}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="font-bold text-sm">
                        <MapPin className="w-3.5 h-3.5 inline-block -mt-0.5 mr-1" />
                        {r.bairro}{r.municipio ? ` · ${r.municipio}` : ''}
                      </p>
                      <span className="text-[10px] uppercase tracking-wider font-black opacity-70">{r.priority}</span>
                    </div>
                    <p className="text-xs opacity-80 mb-1.5">{r.reason}</p>
                    <p className="text-xs">📋 <b>Pauta:</b> {r.pauta}</p>
                    <p className="text-xs">🎯 <b>Ação:</b> {r.action}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Onde evitar */}
          {data.avoidance.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-rose-400 font-bold mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Evitar agora
              </h4>
              <div className="space-y-1.5">
                {data.avoidance.map((a, i) => (
                  <div key={i} className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-2.5">
                    <p className="text-xs text-rose-200">
                      <b>{a.bairro}{a.municipio ? ` · ${a.municipio}` : ''}</b> — {a.reason}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-slate-500 pt-2 border-t border-white/5">
            Gerado em {new Date(data.analyzedAt).toLocaleString('pt-BR')}. A IA usa os contatos classificados (CRM) e visitas. Quanto mais dados, melhor o foco.
          </p>
        </div>
      )}
    </Card>
  );
};

export default FieldFocusCard;
