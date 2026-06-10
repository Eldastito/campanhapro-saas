import * as React from 'react';
import {
  Landmark, Users, Wallet, Target, Plus, MapPinned, ShieldCheck,
  Loader2, LogOut, X, CheckCircle2,
} from 'lucide-react';
import { authedFetch } from '../lib/authedFetch';
import { useAuth } from '../contexts/AuthContext';

/**
 * Centro de Comando do Presidente de Partido (produto PARTIDO).
 * Padrão visual da aba CRM (tema escuro, cards arredondados). O presidente só vê
 * as abas dele. Fase 1: provisão do partido + lista de candidatos + adicionar.
 */
interface Candidate {
  id: string; displayName: string; cargo?: string | null; regiao?: string | null;
  status: string; valorRecebido?: number; campaignId?: string | null;
}
interface Party { id: string; name: string; }

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  concluded: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};
const STATUS_LABEL: Record<string, string> = { pending: 'Aguardando cadastro', active: 'Cadastrado', concluded: 'Concluído' };

const TABS = ['Candidatos', 'Repasses', 'Comprovação', 'Telão'];

const Stat: React.FC<{ icon: any; label: string; value: React.ReactNode; from: string; to: string }> = ({ icon: Icon, label, value, from, to }) => (
  <div className={`bg-gradient-to-br ${from} ${to} p-5 rounded-3xl border border-white/10`}>
    <div className="flex items-center justify-between">
      <p className="text-xs text-slate-300 font-bold uppercase tracking-wider">{label}</p>
      <Icon className="w-5 h-5 text-white/70" />
    </div>
    <p className="text-3xl font-black text-white mt-2">{value}</p>
  </div>
);

const PartyPresidentPage: React.FC = () => {
  const { user, logout } = useAuth();
  const [loading, setLoading] = React.useState(true);
  const [party, setParty] = React.useState<Party | null>(null);
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [tab, setTab] = React.useState('Candidatos');
  const [provName, setProvName] = React.useState('');
  const [provBusy, setProvBusy] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [form, setForm] = React.useState({ displayName: '', cargo: '', regiao: '', phone: '' });
  const [adding, setAdding] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/api/v1/party/me');
      const j = await r.json();
      if (r.ok) { setParty(j.party); setCandidates(j.candidates || []); }
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const provision = async () => {
    if (provName.trim().length < 2) return;
    setProvBusy(true);
    try {
      const r = await authedFetch('/api/v1/party/provision', { method: 'POST', body: JSON.stringify({ name: provName.trim() }) });
      if (r.ok) await load();
    } finally { setProvBusy(false); }
  };

  const addCandidate = async () => {
    if (!form.displayName.trim()) return;
    setAdding(true);
    try {
      const r = await authedFetch('/api/v1/party/candidates', { method: 'POST', body: JSON.stringify(form) });
      if (r.ok) { setForm({ displayName: '', cargo: '', regiao: '', phone: '' }); setAddOpen(false); await load(); }
    } finally { setAdding(false); }
  };

  const totalRepassado = candidates.reduce((s, c) => s + (Number(c.valorRecebido) || 0), 0);
  const cadastrados = candidates.filter((c) => c.status === 'active').length;
  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (loading) {
    return <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>;
  }

  // Sem partido provisionado → tela de criação.
  if (!party) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900/60 border border-white/10 rounded-3xl p-8 text-center">
          <Landmark className="w-12 h-12 text-indigo-400 mx-auto mb-3" />
          <h1 className="text-2xl font-black">Bem-vindo ao Centro de Comando</h1>
          <p className="text-sm text-slate-400 mt-1 mb-5">Dê um nome ao seu partido para começar a cadastrar e acompanhar seus candidatos.</p>
          <input value={provName} onChange={(e) => setProvName(e.target.value)} placeholder="Nome do partido"
            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-white mb-3" />
          <button onClick={provision} disabled={provBusy || provName.trim().length < 2}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-4 py-3 font-bold flex items-center justify-center gap-2">
            {provBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Criar partido
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-[#0a0a0b] min-h-screen text-white font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3"><Landmark className="text-indigo-400" /> Centro de Comando</h1>
          <p className="text-gray-400">{party.name} · {user?.name}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setAddOpen(true)} className="bg-indigo-600 hover:bg-indigo-500 px-5 py-2 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/20">
            <Plus className="w-4 h-4" /> Novo candidato
          </button>
          <button onClick={() => logout?.()} className="bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl text-slate-300 flex items-center gap-2"><LogOut className="w-4 h-4" /> Sair</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Stat icon={Users} label="Candidatos" value={candidates.length} from="from-indigo-600/20" to="to-blue-600/10" />
        <Stat icon={CheckCircle2} label="Já cadastrados" value={cadastrados} from="from-emerald-600/20" to="to-teal-600/10" />
        <Stat icon={Wallet} label="Total repassado" value={brl(totalRepassado)} from="from-amber-600/20" to="to-orange-600/10" />
        <Stat icon={Target} label="Metas cumpridas" value="—" from="from-purple-600/20" to="to-fuchsia-600/10" />
      </div>

      {/* Tabs (isoladas — presidente só vê o que é dele) */}
      <div className="flex gap-2 mb-6 border-b border-white/5">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors ${tab === t ? 'border-indigo-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Candidatos' && (
        candidates.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-white/10 rounded-3xl">
            <Users className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-400">Nenhum candidato ainda. Clique em <b>"Novo candidato"</b> para começar — ou, em breve, importe sua planilha.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {candidates.map((c) => (
              <div key={c.id} className="bg-[#1c2128] p-4 rounded-2xl border border-white/5 flex items-center justify-between">
                <div>
                  <p className="font-bold text-white">{c.displayName}</p>
                  <p className="text-xs text-slate-400">{[c.cargo, c.regiao].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-slate-300">{brl(Number(c.valorRecebido) || 0)}</span>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${STATUS_BADGE[c.status] || STATUS_BADGE.pending}`}>{STATUS_LABEL[c.status] || c.status}</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab !== 'Candidatos' && (
        <div className="text-center py-16 border border-dashed border-white/10 rounded-3xl text-slate-500">
          {tab === 'Repasses' && <Wallet className="w-10 h-10 mx-auto mb-2 opacity-50" />}
          {tab === 'Comprovação' && <ShieldCheck className="w-10 h-10 mx-auto mb-2 opacity-50" />}
          {tab === 'Telão' && <MapPinned className="w-10 h-10 mx-auto mb-2 opacity-50" />}
          <p>Em breve nesta fase do produto.</p>
        </div>
      )}

      {/* Modal: novo candidato */}
      {addOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => !adding && setAddOpen(false)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-white">Novo candidato</h4>
              <button onClick={() => setAddOpen(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-2">
              <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Nome do candidato *" className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white" />
              <div className="grid grid-cols-2 gap-2">
                <input value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} placeholder="Cargo" className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white" />
                <input value={form.regiao} onChange={(e) => setForm({ ...form, regiao: e.target.value })} placeholder="Cidade/Região" className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white" />
              </div>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Telefone (WhatsApp)" className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white" />
            </div>
            <button onClick={addCandidate} disabled={adding || !form.displayName.trim()} className="w-full mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Adicionar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PartyPresidentPage;
