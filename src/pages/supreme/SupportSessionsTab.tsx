import * as React from 'react';
import { Loader2, ShieldCheck, Clock, Play, Square } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

/**
 * SupportSessionsTab (Control Plane, Fatia 5) — abre/encerra sessões de suporte
 * auditadas (acesso do operador a um cliente, com motivo + expiração). Shadow:
 * registra trilha de auditoria, ainda sem restringir o acesso do supremo.
 */
interface TenantRow { id: string; kind: 'campaign' | 'party'; name: string }
interface Session {
  id: string; tenantId: string; tenantKind: string; reason: string; status: string;
  operatorEmail: string | null; startedAt: string; expiresAt: string; endedAt: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  ended: 'bg-slate-600/30 text-slate-400 border-slate-600/40',
  expired: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

const SupportSessionsTab: React.FC = () => {
  const [tenants, setTenants] = React.useState<TenantRow[]>([]);
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [tenantId, setTenantId] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [minutes, setMinutes] = React.useState(60);

  const load = React.useCallback(async () => {
    try {
      const [tRes, sRes] = await Promise.all([
        authedFetch('/api/v1/supreme/tenants'),
        authedFetch('/api/v1/supreme/support-sessions'),
      ]);
      const tJson = await tRes.json().catch(() => ({}));
      const sJson = await sRes.json().catch(() => ({}));
      if (!tRes.ok) throw new Error(tJson?.error || 'falha ao carregar tenants');
      if (!sRes.ok) throw new Error(sJson?.error || 'falha ao carregar sessões');
      setTenants(tJson.tenants ?? []);
      setSessions(sJson.sessions ?? []);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const open = async () => {
    const t = tenants.find((x) => x.id === tenantId);
    if (!t || !reason.trim()) { setErr('Escolha o cliente e descreva o motivo.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await authedFetch('/api/v1/supreme/support-sessions', {
        method: 'POST',
        body: JSON.stringify({ tenantId: t.id, tenantKind: t.kind, reason: reason.trim(), minutes }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'falha ao abrir sessão');
      setReason(''); setTenantId('');
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const end = async (id: string) => {
    setBusy(true); setErr(null);
    try {
      const res = await authedFetch(`/api/v1/supreme/support-sessions/${id}/end`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'falha ao encerrar');
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (s: Session) => tenants.find((t) => t.id === s.tenantId)?.name || `${s.tenantKind} ${s.tenantId.substring(0, 8)}…`;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-black text-white flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-indigo-400" /> Sessões de suporte</h2>
        <p className="text-xs text-slate-400">Acesso auditado a um cliente, com motivo e expiração. Toda abertura/encerramento fica no log.</p>
      </div>

      {err && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{err}</div>}

      {/* Abrir nova sessão */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-400 flex flex-col gap-1">
          Cliente
          <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white min-w-[220px]">
            <option value="">Selecione…</option>
            {tenants.map((t) => <option key={`${t.kind}-${t.id}`} value={t.id}>{t.kind === 'party' ? '🏛️' : '🏢'} {t.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-400 flex flex-col gap-1 flex-1 min-w-[200px]">
          Motivo
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: investigar erro no envio de WhatsApp"
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
        </label>
        <label className="text-xs text-slate-400 flex flex-col gap-1">
          Duração
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
            <option value={30}>30 min</option>
            <option value={60}>1 hora</option>
            <option value={120}>2 horas</option>
            <option value={240}>4 horas</option>
          </select>
        </label>
        <button onClick={open} disabled={busy}
          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Abrir sessão
        </button>
      </div>

      {/* Histórico */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">Nenhuma sessão de suporte ainda.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">{nameOf(s)} <span className="text-[10px] text-slate-500 font-mono">· {s.tenantKind}</span></p>
                <p className="text-xs text-slate-400 truncate">{s.reason}</p>
                <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3" /> {new Date(s.startedAt).toLocaleString('pt-BR')} → expira {new Date(s.expiresAt).toLocaleTimeString('pt-BR')}
                  {s.operatorEmail ? ` · ${s.operatorEmail}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded border ${STATUS_STYLE[s.status] || STATUS_STYLE.ended}`}>{s.status}</span>
                {s.status === 'active' && (
                  <button onClick={() => end(s.id)} disabled={busy}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-red-300 hover:text-red-200 border border-red-500/30 rounded-lg px-3 py-1.5 disabled:opacity-50">
                    <Square className="w-3 h-3" /> Encerrar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SupportSessionsTab;
