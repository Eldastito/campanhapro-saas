import * as React from 'react';
import { Loader2, BarChart3, Headset, Phone } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

/**
 * Relatórios do Call Center (F5 — supervisão estratégica).
 * Audiência: coordenador / candidato / líder. Mostra o receptivo (conversas por
 * estágio) e o ativo (progresso das campanhas + produtividade por operador).
 * Componente reutilizado na InboxPage (modal do coordenador) e na CallCenterPage
 * (aba do líder).
 */
interface ReportData {
  receptivo: { total: number; open: number; byStage: Record<string, number> };
  ativo: {
    byStatus: Record<string, number>;
    byDisposition: Record<string, number>;
    operators: { userId: string; name: string; worked: number; interested: number }[];
    campaigns: { id: string; name: string; status: string; counts: any }[];
  };
  teamSize: number;
}

const STAGE_LABEL: Record<string, string> = {
  novo_lead: 'Novo Lead', ia_atendendo: '🤖 IA', aguardando_humano: '⏳ Fila',
  em_atendimento_humano: '🧑 Operador', em_atendimento: '🧑 Operador', proposta: '🧑 Operador',
  fechado: 'Fechado',
};

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({ label, value, tone }) => (
  <div className="bg-slate-950/60 border border-white/5 rounded-2xl p-3 text-center">
    <p className={`text-2xl font-black ${tone || 'text-white'}`}>{value}</p>
    <p className="text-[11px] text-slate-400 mt-0.5">{label}</p>
  </div>
);

const CallCenterReports: React.FC = () => {
  const [data, setData] = React.useState<ReportData | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      try {
        const r = await authedFetch('/api/v1/callcenter/reports');
        if (r.ok) setData(await r.json());
      } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 text-indigo-400 animate-spin" /></div>;
  if (!data) return <p className="text-sm text-slate-500 py-6 text-center">Sem dados de atendimento ainda.</p>;

  const { receptivo, ativo } = data;
  const ativoWorked = (ativo.byStatus.concluido || 0) + (ativo.byStatus.sem_resposta || 0);
  const ativoTotal = Object.values(ativo.byStatus).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      {/* RECEPTIVO */}
      <div>
        <p className="text-sm font-bold text-slate-200 mb-2 flex items-center gap-2"><Headset className="w-4 h-4 text-indigo-300" /> Receptivo (eleitor → você)</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          <Stat label="Conversas" value={receptivo.total} />
          <Stat label="Abertas" value={receptivo.open} tone="text-emerald-300" />
          {Object.entries(receptivo.byStage).map(([s, n]) => (
            <Stat key={s} label={STAGE_LABEL[s] || s} value={n} />
          ))}
        </div>
      </div>

      {/* ATIVO */}
      <div>
        <p className="text-sm font-bold text-slate-200 mb-2 flex items-center gap-2"><Phone className="w-4 h-4 text-emerald-300" /> Ativo (telemarketing)</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
          <Stat label="Contatos" value={ativoTotal} />
          <Stat label="Trabalhados" value={ativoWorked} tone="text-emerald-300" />
          <Stat label="Pendentes" value={ativo.byStatus.pendente || 0} tone="text-amber-300" />
          <Stat label="Retornos" value={ativo.byStatus.retorno || 0} tone="text-orange-300" />
        </div>

        {/* Disposições */}
        {Object.keys(ativo.byDisposition).length > 0 && (
          <div className="bg-slate-950/60 border border-white/5 rounded-2xl p-3 mb-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Resultados das abordagens</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(ativo.byDisposition).sort((a, b) => b[1] - a[1]).map(([d, n]) => (
                <span key={d} className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-200">{d}: <b>{n}</b></span>
              ))}
            </div>
          </div>
        )}

        {/* Produtividade por operador */}
        {ativo.operators.length > 0 && (
          <div className="bg-slate-950/60 border border-white/5 rounded-2xl p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Produtividade por operador</p>
            <div className="space-y-1">
              {ativo.operators.map((o, i) => (
                <div key={o.userId} className="flex items-center justify-between gap-2 text-sm py-1 border-b border-white/5 last:border-0">
                  <span className="truncate">{['🥇', '🥈', '🥉'][i] || `${i + 1}.`} {o.name}</span>
                  <span className="text-slate-400 shrink-0">{o.worked} contatos · <span className="text-emerald-300">{o.interested} interessados</span></span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Campanhas */}
        {ativo.campaigns.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {ativo.campaigns.map((c) => {
              const worked = (c.counts.concluido || 0) + (c.counts.sem_resposta || 0);
              const pct = c.counts.total ? Math.round(worked / c.counts.total * 100) : 0;
              return (
                <div key={c.id} className="bg-slate-950/60 border border-white/5 rounded-xl px-3 py-2">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-bold truncate">{c.name}</span>
                    <span className="text-[11px] text-slate-400 shrink-0">{worked}/{c.counts.total} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CallCenterReports;
