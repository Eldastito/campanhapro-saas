import * as React from 'react';
import { Loader2, Search, Plus, Check, X, Building2, Landmark, ShieldAlert, RefreshCw, BarChart3, History } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';
import { MODULES } from '../../lib/modules';

/**
 * ModulesTab (Control Plane, Fatia 3) — console do Supreme pra conceder/revogar
 * módulos por tenant (campanha ou partido). Alavanca de venda/controle modular.
 * Consome /api/v1/supreme/tenants + grant/revoke. Tudo auditado no backend.
 */
interface TenantEntitlement { moduleKey: string; status: string }
interface TenantRow { id: string; kind: 'campaign' | 'party'; name: string; modules: TenantEntitlement[] }

const SELLABLE = MODULES.filter((m) => m.sellable);

const ModulesTab: React.FC = () => {
  const [tenants, setTenants] = React.useState<TenantRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [q, setQ] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [historyFor, setHistoryFor] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await authedFetch('/api/v1/supreme/tenants');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'falha ao carregar');
      setTenants(json.tenants ?? []);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const toggle = async (t: TenantRow, moduleKey: string, active: boolean) => {
    const key = `${t.id}:${moduleKey}`;
    setBusy(key);
    setErr(null);
    try {
      const res = active
        ? await authedFetch(`/api/v1/supreme/tenants/${t.id}/modules/${moduleKey}`, { method: 'DELETE' })
        : await authedFetch(`/api/v1/supreme/tenants/${t.id}/modules`, {
            method: 'POST',
            body: JSON.stringify({ moduleKey, tenantKind: t.kind }),
          });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'falha na operação');
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const filtered = tenants.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()) || t.id.includes(q));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-black text-white">Módulos por cliente</h2>
          <p className="text-xs text-slate-400">Conceda ou revogue aplicativos de cada organização (campanha ou partido).</p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou id…"
            className="bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white w-64" />
        </div>
      </div>

      {err && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{err}</div>}

      <ModuleStatsPanel />

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>
      ) : (
        <div className="space-y-2">
          {filtered.length === 0 && <p className="text-sm text-slate-500 py-8 text-center">Nenhum cliente encontrado.</p>}
          {filtered.map((t) => {
            const activeKeys = new Set(t.modules.filter((m) => m.status === 'active').map((m) => m.moduleKey));
            const KindIcon = t.kind === 'party' ? Landmark : Building2;
            return (
              <div key={`${t.kind}-${t.id}`} className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-slate-700/50 flex items-center justify-center shrink-0"><KindIcon className="w-4 h-4 text-slate-300" /></div>
                    <div className="min-w-0">
                      <p className="font-bold text-white text-sm truncate">{t.name}</p>
                      <p className="text-[10px] text-slate-500 font-mono">{t.kind} · {t.id.substring(0, 12)}…</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {SELLABLE.map((m) => {
                      const active = activeKeys.has(m.key);
                      const isBusy = busy === `${t.id}:${m.key}`;
                      return (
                        <button key={m.key} disabled={isBusy} onClick={() => toggle(t, m.key, active)}
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 ${
                            active
                              ? 'bg-emerald-500/15 text-emerald-300 hover:bg-red-500/15 hover:text-red-300 border border-emerald-500/30'
                              : 'bg-slate-700/40 text-slate-400 hover:bg-indigo-500/15 hover:text-indigo-300 border border-slate-600/50'
                          }`}>
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : active ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                          {m.name}
                          {active && <X className="w-3 h-3 opacity-0 group-hover:opacity-100" />}
                        </button>
                      );
                    })}
                    <button onClick={() => setHistoryFor(historyFor === t.id ? null : t.id)}
                      title="Histórico de concessões"
                      className={`inline-flex items-center gap-1 text-xs rounded-lg px-2.5 py-1.5 border transition-colors ${historyFor === t.id ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' : 'text-slate-400 border-slate-600/50 hover:text-white'}`}>
                      <History className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {historyFor === t.id && <TenantHistory tenantId={t.id} />}
              </div>
            );
          })}
        </div>
      )}

      <ShadowDeniedPanel />
    </div>
  );
};

/**
 * ModuleStatsPanel — métricas de negócio da camada modular (penetração por
 * módulo). Lê só /module-stats (entitlements); NÃO toca em planos/features.
 */
interface ModuleStat { key: string; name: string; sellable: boolean; activeTenants: number; penetration: number }

const ModuleStatsPanel: React.FC = () => {
  const [stats, setStats] = React.useState<ModuleStat[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await authedFetch('/api/v1/supreme/module-stats');
        const json = await res.json().catch(() => ({}));
        if (res.ok) { setStats(json.stats ?? []); setTotal(json.totalTenants ?? 0); }
      } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return null;

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <h3 className="text-xs font-black text-white flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-indigo-400" /> Penetração por módulo
        <span className="text-[10px] font-normal text-slate-500">({total} organizações no total)</span>
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.key} className="bg-slate-800/50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold text-white">{s.name}</span>
              <span className="text-xs text-indigo-300 font-mono">{s.penetration}%</span>
            </div>
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500" style={{ width: `${s.penetration}%` }} />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">{s.activeTenants} {s.activeTenants === 1 ? 'organização' : 'organizações'}{!s.sellable && ' · interno'}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * TenantHistory — timeline de grant/revoke de um tenant (histórico comercial).
 * Lê /tenants/:id/module-history (audit_logs). Somente leitura.
 */
interface HistoryRow { action: string; metadata?: any; createdAt: string }

const TenantHistory: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [rows, setRows] = React.useState<HistoryRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await authedFetch(`/api/v1/supreme/tenants/${tenantId}/module-history`);
        const json = await res.json().catch(() => ({}));
        setRows(res.ok ? (json.history ?? []) : []);
      } finally { setLoading(false); }
    })();
  }, [tenantId]);

  if (loading) return <div className="mt-3 pt-3 border-t border-white/10 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-slate-500" /></div>;

  return (
    <div className="mt-3 pt-3 border-t border-white/10">
      {rows.length === 0 ? (
        <p className="text-[11px] text-slate-500">Sem histórico de concessões para esta organização.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r, i) => {
            const granted = r.action === 'supreme.module.grant';
            return (
              <li key={i} className="text-[11px] flex items-center gap-2">
                <span className={granted ? 'text-emerald-400' : 'text-red-400'}>{granted ? '+ concedeu' : '− revogou'}</span>
                <span className="font-bold text-slate-200">{r.metadata?.moduleKey ?? '?'}</span>
                <span className="text-slate-600 font-mono ml-auto">{new Date(r.createdAt).toLocaleString('pt-BR')}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

/**
 * Painel de observação do enforcement (Etapa A — shadow). Lista tentativas de
 * acesso a módulos que o usuário NÃO possui (registradas, não bloqueadas). Serve
 * pra analisar o que QUEBRARIA antes de ligar o enforcement real (Etapa B).
 * Reusa o feed de auditoria existente filtrando por action.
 */
interface DeniedLog {
  id: string; action: string; severity: string; actor_name?: string | null;
  resourceId?: string | null; createdAt: string; metadata?: any;
}

const ShadowDeniedPanel: React.FC = () => {
  const [logs, setLogs] = React.useState<DeniedLog[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch('/api/v1/supreme/audit-logs?action=module.access.shadow_denied&limit=50');
      const json = await res.json().catch(() => ({}));
      setLogs(res.ok ? (json.logs ?? []) : []);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  return (
    <div className="mt-8 border-t border-white/10 pt-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="text-sm font-black text-white flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400" /> Acessos fora do módulo (shadow)
        </h3>
        <button onClick={load} disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white border border-slate-700 rounded-lg px-2.5 py-1 disabled:opacity-50">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Tentativas registradas (não bloqueadas) de acessar um módulo sem tê-lo. Analise aqui antes de ligar o bloqueio real.
      </p>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>
      ) : logs.length === 0 ? (
        <p className="text-sm text-emerald-400/80 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-3 text-center">
          ✓ Nenhuma tentativa fora do módulo registrada. Seguro pra avançar pro enforcement.
        </p>
      ) : (
        <div className="space-y-1.5">
          {logs.map((l) => (
            <div key={l.id} className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 text-xs">
                <span className="font-bold text-amber-300">{l.resourceId || 'módulo?'}</span>
                <span className="text-slate-400"> — {l.actor_name || 'usuário'}</span>
                {l.metadata?.userType && <span className="text-slate-600"> ({l.metadata.userType})</span>}
                {l.metadata?.path && <code className="block text-[10px] text-slate-500 font-mono truncate">{l.metadata.method} {l.metadata.path}</code>}
              </div>
              <p className="text-[10px] text-slate-500 font-mono shrink-0">{new Date(l.createdAt).toLocaleString('pt-BR')}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ModulesTab;
