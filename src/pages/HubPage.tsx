import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, Megaphone, Landmark, Headphones, ArrowRight, Lock, Loader2, Plus } from 'lucide-react';
import { authedFetch } from '../lib/authedFetch';
import type { ModuleDef } from '../lib/modules';
import { LOGO_MONO_BASE64 } from '../constants';

// Resolve o nome do ícone (string no registry) → componente lucide.
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Megaphone, Landmark, Headphones, LayoutGrid,
};
const iconOf = (name: string) => ICONS[name] ?? LayoutGrid;

interface MeResponse { active: string[]; available: string[]; catalog: ModuleDef[] }

/**
 * Hub Central (Fatia 1) — mostra os apps que o usuário JÁ tem e os disponíveis
 * para contratar (cross-sell). Fonte autoritativa: GET /api/v1/modules/me.
 * Aditivo: não substitui nenhum fluxo; é um ponto de entrada extra em /app/hub.
 */
const HubPage: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = React.useState<MeResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await authedFetch('/api/v1/modules/me');
        const json = await res.json().catch(() => ({}));
        if (alive && res.ok) setData(json);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const catalog = data?.catalog ?? [];
  const active = (data?.active ?? []).map((k) => catalog.find((m) => m.key === k)).filter(Boolean) as ModuleDef[];
  const available = (data?.available ?? []).map((k) => catalog.find((m) => m.key === k)).filter(Boolean) as ModuleDef[];

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex items-center gap-3 mb-8">
          <img src={LOGO_MONO_BASE64} alt="CampanhaPro" className="h-9 w-9" />
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><LayoutGrid className="w-5 h-5 text-indigo-400" /> Seus aplicativos</h1>
            <p className="text-sm text-slate-400">Escolha por onde começar.</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>
        ) : (
          <>
            {active.length === 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 text-center text-slate-400">
                Nenhum aplicativo ativo nesta conta. Fale com o administrador da sua organização.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {active.map((m) => {
                const Icon = iconOf(m.icon);
                return (
                  <button key={m.key} onClick={() => navigate(m.appRoute)}
                    className="text-left bg-slate-800 hover:bg-slate-700/70 border border-slate-700 hover:border-indigo-500/50 rounded-2xl p-5 transition-colors group">
                    <div className="w-11 h-11 rounded-xl bg-indigo-500/15 flex items-center justify-center mb-3">
                      <Icon className="w-5 h-5 text-indigo-300" />
                    </div>
                    <h3 className="font-semibold text-slate-100">{m.name}</h3>
                    <p className="text-xs text-slate-400 mt-1 leading-snug">{m.description}</p>
                    <span className="inline-flex items-center gap-1 text-xs text-indigo-400 mt-3 group-hover:gap-2 transition-all">Abrir <ArrowRight className="w-3.5 h-3.5" /></span>
                  </button>
                );
              })}
            </div>

            {available.length > 0 && (
              <>
                <h2 className="text-sm font-semibold text-slate-300 mt-10 mb-3 flex items-center gap-2"><Plus className="w-4 h-4 text-emerald-400" /> Disponível para contratar</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {available.map((m) => {
                    const Icon = iconOf(m.icon);
                    return (
                      <div key={m.key} className="bg-slate-800/50 border border-dashed border-slate-700 rounded-2xl p-5">
                        <div className="w-11 h-11 rounded-xl bg-slate-700/40 flex items-center justify-center mb-3">
                          <Icon className="w-5 h-5 text-slate-400" />
                        </div>
                        <h3 className="font-semibold text-slate-300 flex items-center gap-1.5">{m.name} <Lock className="w-3 h-3 text-slate-500" /></h3>
                        <p className="text-xs text-slate-500 mt-1 leading-snug">{m.description}</p>
                        {m.salesRoute && (
                          <a href={m.salesRoute} className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 mt-3">Conhecer <ArrowRight className="w-3.5 h-3.5" /></a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default HubPage;
