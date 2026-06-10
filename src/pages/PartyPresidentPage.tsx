import * as React from 'react';
import {
  Landmark, Users, Wallet, Target, Plus, MapPinned, ShieldCheck,
  Loader2, LogOut, X, CheckCircle2, Upload, Link2, Check,
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
  status: string; valorRecebido?: number; campaignId?: string | null; inviteToken?: string | null;
  metas?: { label: string; done: boolean }[]; metasDone?: number; metasTotal?: number;
  coordCount?: number; leaderCount?: number; valorAlocado?: number;
  committee?: { address?: string; lat?: number; lng?: number; hasPhoto?: boolean; geoSource?: string | null } | null;
  checkinCount?: number;
}
interface ProofData {
  committee?: { address?: string | null; lat?: number | null; lng?: number | null; photo?: string | null; geoSource?: string | null; updatedAt?: string | null } | null;
  checkins?: { id: string; tipo?: string; lat?: number | null; lng?: number | null; photo?: string | null; nota?: string | null; createdAt?: string }[];
}

const DEFAULT_CATS = ['Coordenador', 'Líder 1', 'Líder 2', 'Líder 3', 'Líder 4', 'Aluguel de comitê', 'Aluguel de carro', 'Combustível', 'Gráfica', 'Material de campanha'];
const parseBRL = (s: string) => Number(String(s || '').replace(/\./g, '').replace(',', '.')) || 0;
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
  const [importOpen, setImportOpen] = React.useState(false);
  const [importText, setImportText] = React.useState('');
  const [importing, setImporting] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [repasseFor, setRepasseFor] = React.useState<Candidate | null>(null);
  const [repForm, setRepForm] = React.useState({ valor: '', data: '', descricao: '' });
  const [repItems, setRepItems] = React.useState<{ categoria: string; valor: string }[]>([]);
  const [savingRep, setSavingRep] = React.useState(false);
  const [proofFor, setProofFor] = React.useState<Candidate | null>(null);
  const [proofData, setProofData] = React.useState<ProofData | null>(null);
  const [proofLoading, setProofLoading] = React.useState(false);
  const [lightbox, setLightbox] = React.useState<string | null>(null);

  const openProof = async (c: Candidate) => {
    setProofFor(c); setProofData(null); setProofLoading(true);
    try {
      const r = await authedFetch(`/api/v1/party/candidates/${c.id}/proof`);
      const j = await r.json();
      if (r.ok) setProofData(j);
    } catch { /* */ }
    finally { setProofLoading(false); }
  };

  const openRepasse = (c: Candidate) => {
    setRepasseFor(c);
    setRepForm({ valor: '', data: '', descricao: '' });
    setRepItems(DEFAULT_CATS.map((categoria) => ({ categoria, valor: '' })));
  };

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

  const importRows = async () => {
    const rows = importText.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [displayName, cargo, regiao, phone] = line.split(/[;,\t]/).map((s) => (s || '').trim());
      return { displayName, cargo, regiao, phone };
    }).filter((r) => r.displayName);
    if (!rows.length) return;
    setImporting(true);
    try {
      const r = await authedFetch('/api/v1/party/candidates/import', { method: 'POST', body: JSON.stringify({ rows }) });
      if (r.ok) { setImportText(''); setImportOpen(false); await load(); }
    } finally { setImporting(false); }
  };

  const copyLink = (token?: string | null) => {
    if (!token) return;
    const url = `${window.location.origin}/cadastro/partido/${token}`;
    navigator.clipboard?.writeText(url).then(() => { setCopied(token); setTimeout(() => setCopied(null), 1500); }, () => {});
  };

  const saveRepasse = async () => {
    if (!repasseFor) return;
    const v = parseBRL(repForm.valor);
    if (!(v > 0)) return;
    const itens = repItems.map((it) => ({ categoria: it.categoria.trim(), valor: parseBRL(it.valor) })).filter((it) => it.categoria && it.valor > 0);
    setSavingRep(true);
    try {
      const r = await authedFetch(`/api/v1/party/candidates/${repasseFor.id}/repasses`, {
        method: 'POST', body: JSON.stringify({ valor: v, data: repForm.data, descricao: repForm.descricao, itens }),
      });
      if (r.ok) { setRepasseFor(null); await load(); }
    } finally { setSavingRep(false); }
  };

  const totalRepassado = candidates.reduce((s, c) => s + (Number(c.valorRecebido) || 0), 0);
  const cadastrados = candidates.filter((c) => c.status === 'active').length;
  const metasDoneTotal = candidates.reduce((s, c) => s + (c.metasDone || 0), 0);
  const metasTotalTotal = candidates.reduce((s, c) => s + (c.metasTotal || 0), 0);
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
          <button onClick={() => setImportOpen(true)} className="bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl text-slate-200 font-bold flex items-center gap-2"><Upload className="w-4 h-4" /> Importar</button>
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
        <Stat icon={Target} label="Metas cumpridas" value={`${metasDoneTotal}/${metasTotalTotal || 0}`} from="from-purple-600/20" to="to-fuchsia-600/10" />
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
              <div key={c.id} className="bg-[#1c2128] p-4 rounded-2xl border border-white/5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-white truncate">{c.displayName}</p>
                  <p className="text-xs text-slate-400">{[c.cargo, c.regiao].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {typeof c.metasDone === 'number' && (
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${c.metasDone === c.metasTotal ? 'bg-emerald-500/15 text-emerald-300' : 'bg-purple-500/15 text-purple-300'}`} title={(c.metas || []).map((m) => `${m.done ? '✅' : '⬜'} ${m.label}`).join('\n')}>
                      🎯 {c.metasDone}/{c.metasTotal}
                    </span>
                  )}
                  {c.status === 'pending' && c.inviteToken && (
                    <button onClick={() => copyLink(c.inviteToken)} title="Copiar link de cadastro"
                      className="text-xs flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300">
                      {copied === c.inviteToken ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copiado</> : <><Link2 className="w-3.5 h-3.5" /> Link</>}
                    </button>
                  )}
                  <button onClick={() => openRepasse(c)}
                    className="text-xs flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300" title="Registrar repasse">
                    <Wallet className="w-3.5 h-3.5" /> Repasse
                  </button>
                  <span className="text-sm text-slate-300 w-24 text-right">{brl(Number(c.valorRecebido) || 0)}</span>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${STATUS_BADGE[c.status] || STATUS_BADGE.pending}`}>{STATUS_LABEL[c.status] || c.status}</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'Repasses' && (
        candidates.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-white/10 rounded-3xl text-slate-500">Cadastre candidatos para registrar repasses.</div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-400 mb-1">
              Total repassado: <b className="text-white">{brl(totalRepassado)}</b>
              {' · '}A justificar: <b className="text-rose-400">{brl(candidates.reduce((s, c) => s + Math.max(0, (Number(c.valorRecebido) || 0) - (Number(c.valorAlocado) || 0)), 0))}</b>
            </p>
            {[...candidates].sort((a, b) => (Number(b.valorRecebido) || 0) - (Number(a.valorRecebido) || 0)).map((c) => {
              const recebido = Number(c.valorRecebido) || 0;
              const restante = recebido - (Number(c.valorAlocado) || 0);
              return (
              <div key={c.id} className="bg-[#1c2128] p-4 rounded-2xl border border-white/5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-white truncate">{c.displayName}</p>
                  <p className="text-xs text-slate-400">{[c.cargo, c.regiao].filter(Boolean).join(' · ') || '—'} · 🎯 {c.metasDone}/{c.metasTotal} metas</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-lg font-black text-white leading-none">{brl(recebido)}</p>
                    {recebido > 0 && <p className={`text-[11px] font-bold ${restante > 0.005 ? 'text-rose-400' : 'text-emerald-400'}`}>{restante > 0.005 ? `${brl(restante)} a justificar` : 'tudo alocado ✅'}</p>}
                  </div>
                  <button onClick={() => openRepasse(c)}
                    className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300"><Wallet className="w-3.5 h-3.5" /> Repasse</button>
                </div>
              </div>
              );
            })}
          </div>
        )
      )}

      {tab === 'Comprovação' && (
        candidates.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-white/10 rounded-3xl text-slate-500">Cadastre candidatos para acompanhar a comprovação.</div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-400 mb-1">Comitês geolocalizados e check-ins por candidato — a prova de que a estrutura existe.</p>
            {candidates.map((c) => {
              const com = c.committee;
              const strong = !!(com && com.lat && com.hasPhoto && com.geoSource === 'gps');
              const approx = !!(com && com.lat && com.hasPhoto && com.geoSource === 'address');
              const badge = strong
                ? { cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', txt: '✅ GPS no local' }
                : approx
                  ? { cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', txt: '📍 Aproximado (endereço)' }
                  : { cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30', txt: '⚠️ Sem comprovação' };
              const hasMedia = !!(com?.hasPhoto || (c.checkinCount || 0) > 0);
              return (
                <button key={c.id} onClick={() => openProof(c)}
                  className="w-full text-left bg-[#1c2128] p-4 rounded-2xl border border-white/5 hover:border-white/20 flex items-center justify-between gap-3 transition-colors">
                  <div className="min-w-0">
                    <p className="font-bold text-white truncate">{c.displayName}</p>
                    <p className="text-xs text-slate-400 truncate">{com?.address || (com?.lat ? 'Comitê com localização' : 'Sem comitê cadastrado')}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-slate-400">📸 {c.checkinCount || 0} check-ins</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.txt}</span>
                    {hasMedia && <span className="text-[11px] text-indigo-300 font-bold whitespace-nowrap">Ver fotos →</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )
      )}

      {tab === 'Telão' && (
        <div className="text-center py-16 border border-dashed border-white/10 rounded-3xl text-slate-500">
          <MapPinned className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p>Mapa ao vivo do partido — em breve (Fase 7).</p>
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

      {/* Modal: importar planilha (cola) */}
      {importOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => !importing && setImportOpen(false)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-white">Importar candidatos</h4>
              <button onClick={() => setImportOpen(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-400 mb-2">Cole uma linha por candidato, separando por vírgula:<br /><span className="text-slate-500">Nome, Cargo, Cidade, Telefone</span></p>
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={8}
              placeholder={'João Silva, Vereador, Niterói, 21999990000\nMaria Souza, Prefeita, São Gonçalo, 21988880000'}
              className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white text-sm font-mono" />
            <button onClick={importRows} disabled={importing || !importText.trim()} className="w-full mt-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2">
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Importar candidatos
            </button>
          </div>
        </div>
      )}

      {/* Modal: registrar repasse com RATEIO */}
      {repasseFor && (() => {
        const total = parseBRL(repForm.valor);
        const alocado = repItems.reduce((s, it) => s + parseBRL(it.valor), 0);
        const restante = total - alocado;
        return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => !savingRep && setRepasseFor(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h4 className="font-bold text-white">Registrar repasse</h4>
              <button onClick={() => setRepasseFor(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-400 mb-3">Para <b className="text-slate-200">{repasseFor.displayName}</b></p>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <input value={repForm.valor} onChange={(e) => setRepForm({ ...repForm, valor: e.target.value })} placeholder="Valor total recebido *" className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white font-bold" />
              <input value={repForm.data} onChange={(e) => setRepForm({ ...repForm, data: e.target.value })} type="date" className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white" />
            </div>

            <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Como o dinheiro será aplicado</p>
            <div className="space-y-1.5 mb-2">
              {repItems.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={it.categoria} onChange={(e) => setRepItems(repItems.map((x, j) => j === i ? { ...x, categoria: e.target.value } : x))}
                    placeholder="Item" className="flex-1 bg-slate-950 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-200" />
                  <input value={it.valor} onChange={(e) => setRepItems(repItems.map((x, j) => j === i ? { ...x, valor: e.target.value } : x))}
                    placeholder="R$" className="w-28 bg-slate-950 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white text-right" />
                  <button onClick={() => setRepItems(repItems.filter((_, j) => j !== i))} className="text-slate-500 hover:text-rose-400"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
            <button onClick={() => setRepItems([...repItems, { categoria: '', valor: '' }])} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 mb-3"><Plus className="w-3.5 h-3.5" /> Adicionar item</button>

            {/* Resumo: alocado × restante (o sinal de alerta) */}
            <div className="rounded-xl bg-slate-950 border border-white/10 p-3 mb-3 text-sm">
              <div className="flex justify-between text-slate-400"><span>Recebido</span><span className="text-white font-bold">{brl(total)}</span></div>
              <div className="flex justify-between text-slate-400"><span>Alocado</span><span className="text-slate-200">{brl(alocado)}</span></div>
              <div className={`flex justify-between font-black mt-1 pt-1 border-t border-white/5 ${restante > 0.005 ? 'text-rose-400' : restante < -0.005 ? 'text-amber-400' : 'text-emerald-400'}`}>
                <span>{restante < -0.005 ? 'Excede o recebido!' : 'Restante a justificar'}</span><span>{brl(restante)}</span>
              </div>
            </div>

            <button onClick={saveRepasse} disabled={savingRep || !(total > 0)} className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2">
              {savingRep ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />} Registrar repasse
            </button>
          </div>
        </div>
        );
      })()}

      {/* Modal: prova visual (comitê + check-ins com fotos) */}
      {proofFor && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setProofFor(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="min-w-0">
                <h4 className="font-bold text-white truncate">{proofFor.displayName}</h4>
                <p className="text-xs text-slate-400">Comprovação de campo</p>
              </div>
              <button onClick={() => setProofFor(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>

            {proofLoading ? (
              <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 text-indigo-400 animate-spin" /></div>
            ) : (
              <div className="space-y-4">
                {/* Comitê */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Comitê</p>
                  {proofData?.committee ? (
                    <div className="bg-[#1c2128] rounded-2xl border border-white/5 p-3">
                      {proofData.committee.photo
                        ? <img src={proofData.committee.photo} alt="comitê" onClick={() => setLightbox(proofData.committee!.photo!)} className="w-full max-h-56 object-cover rounded-xl mb-2 cursor-zoom-in" />
                        : <div className="text-xs text-slate-500 mb-2">Sem foto do comitê.</div>}
                      <p className="text-sm text-white">{proofData.committee.address || 'Endereço não informado'}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {proofData.committee.lat ? (
                          <a href={`https://www.google.com/maps?q=${proofData.committee.lat},${proofData.committee.lng}`} target="_blank" rel="noreferrer"
                            className="text-[11px] text-indigo-300 hover:text-indigo-200 underline">Ver no mapa</a>
                        ) : <span className="text-[11px] text-slate-500">Sem localização</span>}
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                          proofData.committee.geoSource === 'gps' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : proofData.committee.geoSource === 'address' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                          : 'bg-rose-500/15 text-rose-300 border-rose-500/30'}`}>
                          {proofData.committee.geoSource === 'gps' ? '✅ GPS no local' : proofData.committee.geoSource === 'address' ? '📍 Aproximado (endereço)' : '⚠️ Sem GPS'}
                        </span>
                      </div>
                    </div>
                  ) : <div className="text-xs text-slate-500">Comitê ainda não cadastrado.</div>}
                </div>

                {/* Check-ins */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Check-ins ({proofData?.checkins?.length || 0})</p>
                  {proofData?.checkins?.length ? (
                    <div className="grid grid-cols-2 gap-2">
                      {proofData.checkins.map((ck) => (
                        <div key={ck.id} className="bg-[#1c2128] rounded-xl border border-white/5 overflow-hidden">
                          {ck.photo
                            ? <img src={ck.photo} alt="check-in" onClick={() => setLightbox(ck.photo!)} className="w-full h-28 object-cover cursor-zoom-in" />
                            : <div className="w-full h-28 flex items-center justify-center text-[11px] text-slate-600">sem foto</div>}
                          <div className="p-2">
                            <p className="text-[10px] text-slate-400">{ck.createdAt ? new Date(ck.createdAt).toLocaleString('pt-BR') : ''}</p>
                            {ck.lat ? (
                              <a href={`https://www.google.com/maps?q=${ck.lat},${ck.lng}`} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-300 underline">📍 mapa</a>
                            ) : <span className="text-[10px] text-rose-300">sem GPS</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <div className="text-xs text-slate-500">Nenhum check-in registrado ainda.</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lightbox de foto em tela cheia */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="foto" className="max-w-full max-h-full object-contain rounded-xl" />
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white/80 hover:text-white"><X className="w-6 h-6" /></button>
        </div>
      )}
    </div>
  );
};

export default PartyPresidentPage;
