/**
 * Painel de Follow-ups de Engajamento (#135).
 *
 * Lista pessoas identificadas em ações de engajamento que precisam de
 * re-contato em até 3 dias. Botões: Convertido | Não interessado |
 * Sem resposta | Adiar 3 dias.
 */
import React, { useEffect, useState } from 'react';
import { UserCheck, Clock, AlertCircle, CheckCircle2, XCircle, RefreshCw, Phone } from 'lucide-react';
import Card from '../ui/Card';
import { supabase } from '../../lib/supabaseClient';

interface Followup {
  id: string;
  engagementActionId: string | null;
  contactId: string | null;
  personName: string;
  personPhone: string | null;
  personNeighborhood: string | null;
  personType: 'apoiador' | 'indeciso' | null;
  dueDate: string;
  status: string;
  assignedTo: string | null;
  outcome: string | null;
  createdAt: string;
}

interface Counts {
  pending: number;
  atrasados: number;
  converted: number;
  lost: number;
  total: number;
}

async function authFetch(url: string, init: RequestInit = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const r = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

const EngagementFollowupPanel: React.FC = () => {
  const [items, setItems] = useState<Followup[]>([]);
  const [counts, setCounts] = useState<Counts>({ pending: 0, atrasados: 0, converted: 0, lost: 0, total: 0 });
  const [filter, setFilter] = useState<'all' | 'pending' | 'converted' | 'lost'>('pending');
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const r = await authFetch(`/api/v1/field-ops/followups?status=${filter}`);
      setItems(r.followups || []);
      setCounts(r.counts || counts);
    } catch (err) {
      console.error('[followups] load:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filter]);

  const resolve = async (id: string, status: 'converted' | 'lost' | 'no_answer' | 'postponed', outcome?: string) => {
    setBusyIds(prev => new Set(prev).add(id));
    try {
      await authFetch(`/api/v1/field-ops/followups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, outcome }),
      });
      setItems(prev => prev.filter(f => f.id !== id));
      // Recarrega contadores
      load();
    } catch (err: any) {
      alert('Falha: ' + (err?.message || 'erro'));
    } finally {
      setBusyIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card className="border-l-4 border-l-emerald-500">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-emerald-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Follow-up de Pessoas Identificadas</h3>
        </div>
        <button onClick={load} className="p-1.5 hover:bg-slate-800 rounded text-slate-400">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Contadores */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <StatCard label="Pendentes" value={counts.pending} cls="bg-blue-500/10 text-blue-300 border-blue-500/30" />
        <StatCard label="Atrasados" value={counts.atrasados} cls="bg-red-500/10 text-red-300 border-red-500/30" alert />
        <StatCard label="Convertidos" value={counts.converted} cls="bg-emerald-500/10 text-emerald-300 border-emerald-500/30" />
        <StatCard label="Perdidos" value={counts.lost} cls="bg-slate-700/30 text-slate-300 border-slate-700" />
      </div>

      {/* Filtro */}
      <div className="flex gap-1 mb-3 border-b border-slate-800">
        {(['pending', 'converted', 'lost', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-2 text-[11px] font-semibold ${filter === f ? 'text-white border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {f === 'pending' ? 'Pendentes' : f === 'converted' ? 'Convertidos' : f === 'lost' ? 'Perdidos' : 'Tudo'}
          </button>
        ))}
      </div>

      {loading && items.length === 0 ? (
        <p className="text-xs text-slate-500 italic py-4">Carregando...</p>
      ) : items.length === 0 ? (
        <div className="text-center py-6 text-xs text-slate-500">
          <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500/40 mb-2" />
          <p>Sem follow-ups {filter === 'pending' ? 'pendentes' : 'neste filtro'}.</p>
          <p className="mt-1">As pessoas identificadas em ações de engajamento aparecem aqui automaticamente.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {items.map(f => {
            const isAtrasado = f.dueDate < today && f.status === 'pending';
            const tipoLabel = f.personType === 'apoiador' ? '🟢 Apoiador' : '🟡 Indeciso';
            return (
              <div key={f.id} className={`rounded-xl p-3 border ${isAtrasado ? 'bg-red-500/5 border-red-500/30' : 'bg-slate-900/60 border-slate-800'}`}>
                <div className="flex justify-between items-start mb-1">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{f.personName}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{tipoLabel} {f.personNeighborhood ? `· ${f.personNeighborhood}` : ''}</p>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isAtrasado ? 'bg-red-500 text-white' : 'bg-blue-500/20 text-blue-300'}`}>
                    {isAtrasado ? '⚠️ ATRASADO' : new Date(f.dueDate).toLocaleDateString('pt-BR')}
                  </span>
                </div>
                {f.personPhone && (
                  <a href={`https://wa.me/${f.personPhone.replace(/\D+/g, '')}`} target="_blank" rel="noreferrer"
                    className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1 mt-1">
                    <Phone className="w-3 h-3" /> {f.personPhone}
                  </a>
                )}
                {f.assignedTo && (
                  <p className="text-[10px] text-slate-500 italic mt-1">Indicado por: {f.assignedTo}</p>
                )}
                {f.status === 'pending' && (
                  <div className="grid grid-cols-4 gap-1 mt-2">
                    <ActionBtn busy={busyIds.has(f.id)} onClick={() => resolve(f.id, 'converted')} cls="bg-emerald-600 hover:bg-emerald-500" icon={<CheckCircle2 className="w-3 h-3" />} label="Convertido" />
                    <ActionBtn busy={busyIds.has(f.id)} onClick={() => resolve(f.id, 'no_answer')} cls="bg-amber-600 hover:bg-amber-500" icon={<Clock className="w-3 h-3" />} label="Sem resp." />
                    <ActionBtn busy={busyIds.has(f.id)} onClick={() => resolve(f.id, 'lost')} cls="bg-red-600/70 hover:bg-red-600" icon={<XCircle className="w-3 h-3" />} label="Perdido" />
                    <ActionBtn busy={busyIds.has(f.id)} onClick={() => resolve(f.id, 'postponed')} cls="bg-slate-700 hover:bg-slate-600" icon={<RefreshCw className="w-3 h-3" />} label="Adiar 3d" />
                  </div>
                )}
                {f.status !== 'pending' && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    Resolvido como <b>{f.status === 'converted' ? 'Convertido' : f.status === 'no_answer' ? 'Sem resposta' : 'Perdido'}</b>
                    {f.outcome ? ` · ${f.outcome}` : ''}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

const StatCard: React.FC<{ label: string; value: number; cls: string; alert?: boolean }> = ({ label, value, cls, alert }) => (
  <div className={`rounded-lg border p-2 ${cls}`}>
    <p className="text-[9px] uppercase tracking-widest font-bold opacity-70">{label}</p>
    <p className="text-xl font-bold flex items-center gap-1">
      {alert && value > 0 && <AlertCircle className="w-4 h-4" />}
      {value}
    </p>
  </div>
);

const ActionBtn: React.FC<{ busy: boolean; onClick: () => void; cls: string; icon: React.ReactNode; label: string }> = ({ busy, onClick, cls, icon, label }) => (
  <button
    onClick={onClick} disabled={busy}
    className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded text-white text-[9px] font-bold transition-all disabled:opacity-40 ${cls}`}
  >
    {icon}
    {busy ? '...' : label}
  </button>
);

export default EngagementFollowupPanel;
