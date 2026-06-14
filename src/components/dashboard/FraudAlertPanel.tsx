/**
 * Painel de Auditoria de Fraudes (#121/#122)
 *
 * 3 abas:
 *  - 🟡 IA suspeita        → fraud_audit_logs com metadata.source='ai_unverified' e !isResolved
 *                            (foram criadas pelo Auditor IA, falta humano confirmar)
 *  - 📝 Contatos em revisão→ contacts.auditStatus='pending_review'
 *                            (filtro estrutural #121 sinalizou — admin decide)
 *  - 🟢 Confirmados        → fraud_audit_logs com isResolved=true e metadata.resolution='confirmed'
 *                            (humano já validou que era fraude mesmo)
 *
 * Em cada item: botão "Confirmar fraude" / "Falso positivo".
 *
 * IMPORTANTE: este painel só renderiza pra Admin/Coordenador/Líder.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { ShieldAlert, CheckCircle, Clock, AlertTriangle, UserCheck } from 'lucide-react';
import Card from '../ui/Card';

async function authPost(url: string, body: unknown): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

interface FraudLog {
  id: string;
  entityType: string;
  entityId?: string | null;
  riskLevel: string;
  reason: string;
  detectedBy: string;
  isResolved: boolean;
  createdAt: string;
  metadata?: any;
}

interface PendingContact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  auditStatus: string;
  auditReasons: any;
  createdAt: string;
}

type TabKey = 'ai' | 'confirmed' | 'contacts';

const FraudAlertPanel: React.FC = () => {
  const { user, userType } = useAuth();
  const [tab, setTab] = useState<TabKey>('ai');
  const [aiLogs, setAiLogs] = useState<FraudLog[]>([]);
  const [confirmedLogs, setConfirmedLogs] = useState<FraudLog[]>([]);
  const [pendingContacts, setPendingContacts] = useState<PendingContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const canView = userType === 'Admin' || userType === 'Coordenador' || userType === 'Líder';

  useEffect(() => {
    if (!canView || !user?.campaignId) {
      setLoading(false);
      return;
    }
    fetchAll();

    const sub = supabase
      .channel(`fraud-alerts-${user.campaignId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'fraud_audit_logs',
        filter: `campaignId=eq.${user.campaignId}`,
      }, () => fetchAll())
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'contacts',
        filter: `campaignId=eq.${user.campaignId}`,
      }, () => fetchPendingContacts())
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, [user?.campaignId, userType]);

  const fetchAll = async () => {
    await Promise.all([fetchAiLogs(), fetchConfirmedLogs(), fetchPendingContacts()]);
    setLoading(false);
  };

  const fetchAiLogs = async () => {
    try {
      const { data } = await supabase
        .from('fraud_audit_logs')
        .select('*')
        .eq('campaignId', user?.campaignId)
        .eq('isResolved', false)
        .order('createdAt', { ascending: false })
        .limit(20);
      // Filtra no client: IA não verificada
      const ai = (data || []).filter((l: any) => l?.metadata?.source === 'ai_unverified' || l?.metadata?.requires_human_confirmation);
      setAiLogs(ai as FraudLog[]);
    } catch (err) {
      console.error('[fraud] ai logs:', err);
    }
  };

  const fetchConfirmedLogs = async () => {
    try {
      const { data } = await supabase
        .from('fraud_audit_logs')
        .select('*')
        .eq('campaignId', user?.campaignId)
        .eq('isResolved', true)
        .order('createdAt', { ascending: false })
        .limit(10);
      const confirmed = (data || []).filter((l: any) => l?.metadata?.resolution === 'confirmed' || l?.metadata?.source === 'ai_confirmed');
      setConfirmedLogs(confirmed as FraudLog[]);
    } catch (err) {
      console.error('[fraud] confirmed logs:', err);
    }
  };

  const fetchPendingContacts = async () => {
    try {
      const { data } = await supabase
        .from('contacts')
        .select('id, name, phone, email, city, auditStatus, auditReasons, createdAt')
        .eq('campaignId', user?.campaignId)
        .eq('auditStatus', 'pending_review')
        .order('createdAt', { ascending: false })
        .limit(20);
      setPendingContacts((data || []) as PendingContact[]);
    } catch (err) {
      console.error('[fraud] pending contacts:', err);
    }
  };

  const resolve = async (type: 'log' | 'contact', id: string, decision: 'confirmed' | 'false_positive') => {
    setBusyIds(prev => new Set(prev).add(id));
    try {
      await authPost(`/api/v1/fraud-guards/resolve/${type}/${id}`, { decision });
      if (type === 'log') {
        setAiLogs(prev => prev.filter(l => l.id !== id));
      } else {
        setPendingContacts(prev => prev.filter(c => c.id !== id));
      }
    } catch (err: any) {
      console.error('[fraud] resolve:', err);
      alert('Falha ao resolver: ' + (err?.message || 'erro desconhecido'));
    } finally {
      setBusyIds(prev => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
    }
  };

  if (!canView) return null;

  const pendingTotal = aiLogs.length + pendingContacts.length;

  return (
    <Card className="border-l-4 border-l-red-500 bg-red-500/5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-red-500" />
          <h3 className="text-sm font-bold text-red-400 uppercase tracking-widest">Auditor de Integridade</h3>
        </div>
        {pendingTotal > 0 && (
          <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            {pendingTotal} PENDENTES
          </span>
        )}
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-3 border-b border-slate-800">
        <TabBtn active={tab === 'ai'} onClick={() => setTab('ai')} icon={<AlertTriangle className="w-3 h-3" />} label="IA suspeita" count={aiLogs.length} color="amber" />
        <TabBtn active={tab === 'contacts'} onClick={() => setTab('contacts')} icon={<UserCheck className="w-3 h-3" />} label="Em revisão" count={pendingContacts.length} color="amber" />
        <TabBtn active={tab === 'confirmed'} onClick={() => setTab('confirmed')} icon={<CheckCircle className="w-3 h-3" />} label="Confirmados" count={confirmedLogs.length} color="emerald" />
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-xs text-slate-500 italic py-4">Escaneando integridade dos dados...</p>
        ) : tab === 'ai' ? (
          aiLogs.length === 0 ? (
            <EmptyState icon={<CheckCircle className="w-4 h-4" />} text="Nenhum alerta da IA aguardando revisão." />
          ) : (
            aiLogs.map((log) => (
              <LogCard
                key={log.id}
                log={log}
                busy={busyIds.has(log.id)}
                onConfirm={() => resolve('log', log.id, 'confirmed')}
                onDismiss={() => resolve('log', log.id, 'false_positive')}
              />
            ))
          )
        ) : tab === 'contacts' ? (
          pendingContacts.length === 0 ? (
            <EmptyState icon={<CheckCircle className="w-4 h-4" />} text="Nenhum contato aguardando revisão estrutural." />
          ) : (
            pendingContacts.map((c) => (
              <ContactCard
                key={c.id}
                contact={c}
                busy={busyIds.has(c.id)}
                onConfirm={() => resolve('contact', c.id, 'confirmed')}
                onDismiss={() => resolve('contact', c.id, 'false_positive')}
              />
            ))
          )
        ) : (
          confirmedLogs.length === 0 ? (
            <EmptyState icon={<Clock className="w-4 h-4" />} text="Nenhuma fraude confirmada por enquanto." />
          ) : (
            confirmedLogs.map((log) => (
              <div key={log.id} className="bg-emerald-500/5 rounded-xl p-3 border border-emerald-500/20">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded uppercase bg-emerald-700 text-white">
                    Confirmada
                  </span>
                  <span className="text-[9px] text-slate-500 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" /> {new Date(log.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-xs text-slate-200 font-medium mb-1">
                  {log.entityType}: {log.reason}
                </p>
                <p className="text-[9px] text-slate-500 italic">Por: {log.detectedBy}</p>
              </div>
            ))
          )
        )}
      </div>
    </Card>
  );
};

// ── helpers visuais ───────────────────────────────────────────────────

const TabBtn: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  color: 'amber' | 'emerald';
}> = ({ active, onClick, icon, label, count, color }) => {
  const activeClasses = active
    ? `text-white border-b-2 ${color === 'amber' ? 'border-amber-500' : 'border-emerald-500'}`
    : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent';
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold transition-all ${activeClasses}`}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && (
        <span className={`ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${color === 'amber' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
          {count}
        </span>
      )}
    </button>
  );
};

const EmptyState: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="flex items-center gap-2 text-xs text-emerald-400 py-2">
    {icon}
    {text}
  </div>
);

const LogCard: React.FC<{
  log: FraudLog;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}> = ({ log, busy, onConfirm, onDismiss }) => (
  <div className="bg-slate-900/60 rounded-xl p-3 border border-amber-500/20 hover:border-amber-500/40 transition-all">
    <div className="flex justify-between items-start mb-1">
      <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${
        log.riskLevel === 'CRÍTICO' ? 'bg-red-600 text-white' :
        log.riskLevel === 'Alto' ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-300'
      }`}>
        Risco {log.riskLevel}
      </span>
      <span className="text-[9px] text-slate-500 flex items-center gap-1">
        <Clock className="w-2.5 h-2.5" /> {new Date(log.createdAt).toLocaleString()}
      </span>
    </div>
    <p className="text-xs text-slate-200 font-medium mb-1">
      {log.entityType === 'voter' ? 'Eleitor Suspeito' : log.entityType}: {log.reason}
    </p>
    <p className="text-[9px] text-slate-500 italic mb-2">Detectado por IA — aguarda confirmação humana</p>
    <div className="flex gap-2">
      <button
        onClick={onConfirm}
        disabled={busy}
        className="flex-1 text-[10px] font-bold py-1.5 px-2 rounded bg-red-600/80 hover:bg-red-600 text-white disabled:opacity-40 transition-all"
      >
        {busy ? '...' : '✓ Confirmar fraude'}
      </button>
      <button
        onClick={onDismiss}
        disabled={busy}
        className="flex-1 text-[10px] font-bold py-1.5 px-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40 transition-all"
      >
        {busy ? '...' : '✗ Falso positivo'}
      </button>
    </div>
  </div>
);

const ContactCard: React.FC<{
  contact: PendingContact;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}> = ({ contact, busy, onConfirm, onDismiss }) => {
  const reasons: Array<{ code?: string; message?: string }> = Array.isArray(contact.auditReasons) ? contact.auditReasons : [];
  return (
    <div className="bg-slate-900/60 rounded-xl p-3 border border-amber-500/20 hover:border-amber-500/40 transition-all">
      <div className="flex justify-between items-start mb-1">
        <span className="text-[9px] font-bold px-2 py-0.5 rounded uppercase bg-amber-700 text-white">
          Contato em revisão
        </span>
        <span className="text-[9px] text-slate-500 flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" /> {new Date(contact.createdAt).toLocaleString()}
        </span>
      </div>
      <p className="text-xs text-slate-200 font-medium mb-1">
        {contact.name || '(sem nome)'} — {contact.phone || contact.email || '(sem contato)'} {contact.city ? `· ${contact.city}` : ''}
      </p>
      {reasons.length > 0 && (
        <ul className="text-[10px] text-amber-300/80 mb-2 list-disc list-inside">
          {reasons.slice(0, 3).map((r, i) => (
            <li key={i}>{r.message || r.code}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={busy}
          className="flex-1 text-[10px] font-bold py-1.5 px-2 rounded bg-red-600/80 hover:bg-red-600 text-white disabled:opacity-40 transition-all"
        >
          {busy ? '...' : '✓ Rejeitar (fraude)'}
        </button>
        <button
          onClick={onDismiss}
          disabled={busy}
          className="flex-1 text-[10px] font-bold py-1.5 px-2 rounded bg-emerald-600/80 hover:bg-emerald-600 text-white disabled:opacity-40 transition-all"
        >
          {busy ? '...' : '✓ Aprovar'}
        </button>
      </div>
    </div>
  );
};

export default FraudAlertPanel;
