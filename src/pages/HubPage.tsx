import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, Megaphone, Landmark, Headphones, LineChart, Brain, ArrowRight, Lock, Loader2, Plus, Building2, ChevronDown } from 'lucide-react';
import { authedFetch } from '../lib/authedFetch';
import { useAuth } from '../contexts/AuthContext';
import type { ModuleDef } from '../lib/modules';
import { LOGO_MONO_BASE64 } from '../constants';

// Resolve o nome do ícone (string no registry) → componente lucide.
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Megaphone, Landmark, Headphones, LayoutGrid, LineChart, Brain,
};
const iconOf = (name: string) => ICONS[name] ?? LayoutGrid;

interface TenantInfo { id: string; kind: 'campaign' | 'party'; role: string; name: string | null }
interface MeResponse { active: string[]; available: string[]; catalog: ModuleDef[]; tenants: TenantInfo[] }

const labelOf = (t: TenantInfo) => t.name || `${t.kind === 'party' ? 'Partido' : 'Campanha'} ${t.id.substring(0, 8)}…`;

/**
 * Hub Central — mostra os apps do usuário e os disponíveis para contratar.
 * Fatia 6: switcher de organização (OrgSwitcher) quando o usuário pertence a
 * mais de um tenant. Persistência só no front (localStorage); o switch troca o
 * filtro de exibição dos módulos, mas não muda identidade/JWT no backend.
 */
const HubPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = React.useState<MeResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [activeTenantId, setActiveTenantId] = React.useState<string | null>(null);

  // Chave estável por usuário — evita vazar a seleção entre contas no mesmo browser.
  const storageKey = user?.id ? `hub:activeTenantId:${user.id}` : null;

  React.useEffect(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored) setActiveTenantId(stored);
    }
  }, [storageKey]);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const qs = activeTenantId ? `?tenantId=${encodeURIComponent(activeTenantId)}` : '';
        const res = await authedFetch(`/api/v1/modules/me${qs}`);
        const json = await res.json().catch(() => ({}));
        if (alive && res.ok) setData(json);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [activeTenantId]);

  const onSwitchTenant = (id: string) => {
    setActiveTenantId(id);
    if (storageKey) localStorage.setItem(storageKey, id);
  };

  const catalog = data?.catalog ?? [];
  const tenants = data?.tenants ?? [];
  const active = (data?.active ?? []).map((k) => catalog.find((m) => m.key === k)).filter(Boolean) as ModuleDef[];
  const available = (data?.available ?? []).map((k) => catalog.find((m) => m.key === k)).filter(Boolean) as ModuleDef[];
  const currentTenant = tenants.find((t) => t.id === activeTenantId) ?? tenants[0];

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex items-center gap-3 mb-8">
          <img src={LOGO_MONO_BASE64} alt="CampanhaPro" className="h-9 w-9" />
          <div className="flex-1">
            <h1 className="text-2xl font-bold flex items-center gap-2"><LayoutGrid className="w-5 h-5 text-indigo-400" /> Seus aplicativos</h1>
            <p className="text-sm text-slate-400">Escolha por onde começar.</p>
          </div>
          {tenants.length > 1 && currentTenant && (
            <OrgSwitcher tenants={tenants} current={currentTenant} onSelect={onSwitchTenant} />
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>
        ) : (
          <>
            {active.length === 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 text-center text-slate-400">
                Nenhum aplicativo ativo nesta organização. Fale com o administrador.
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

interface OrgSwitcherProps { tenants: TenantInfo[]; current: TenantInfo; onSelect: (id: string) => void }

const OrgSwitcher: React.FC<OrgSwitcherProps> = ({ tenants, current, onSelect }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onClickOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOut);
    return () => document.removeEventListener('mousedown', onClickOut);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200">
        <span aria-hidden>{current.kind === 'party' ? '🏛️' : '🏢'}</span>
        <span className="font-semibold max-w-[180px] truncate">{labelOf(current)}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-20 py-1">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
            <Building2 className="w-3 h-3" /> Organização ativa
          </div>
          {tenants.map((t) => (
            <button key={t.id} onClick={() => { onSelect(t.id); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-700/70 flex items-center gap-2 ${t.id === current.id ? 'text-indigo-300' : 'text-slate-200'}`}>
              <span aria-hidden>{t.kind === 'party' ? '🏛️' : '🏢'}</span>
              <span className="flex-1 truncate">{labelOf(t)}</span>
              {t.id === current.id && <span className="text-[10px] text-indigo-400">atual</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default HubPage;
