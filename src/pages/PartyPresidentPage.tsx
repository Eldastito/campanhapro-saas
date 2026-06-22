import * as React from 'react';
import {
  Landmark, Users, Wallet, Target, Plus, MapPinned,
  Loader2, LogOut, X, CheckCircle2, Upload, Link2, Check, Trophy, Activity, MessageCircle, Search, Pencil, Trash2,
  Eye, EyeOff, Sparkles, FileText,
} from 'lucide-react';
import { authedFetch } from '../lib/authedFetch';
import { useAuth } from '../contexts/AuthContext';
import WeeklyDigestCard from '../components/party/WeeklyDigestCard';
import PartyEmergencyWipe from '../components/party/PartyEmergencyWipe';
import PartyBackup from '../components/party/PartyBackup';
import PartyRestore from '../components/party/PartyRestore';
import DuplicateResolutionCard from '../components/party/DuplicateResolutionCard';
import PartyAIOrb from '../components/party/PartyAIOrb';

/**
 * Centro de Comando do Presidente de Partido (produto PARTIDO).
 * Padrão visual da aba CRM (tema escuro, cards arredondados). O presidente só vê
 * as abas dele. Fase 1: provisão do partido + lista de candidatos + adicionar.
 */
interface Candidate {
  id: string; displayName: string; cargo?: string | null; regiao?: string | null; estado?: string | null; phone?: string | null;
  status: string; valorRecebido?: number; campaignId?: string | null; inviteToken?: string | null;
  metas?: { label: string; done: boolean }[]; metasDone?: number; metasTotal?: number;
  coordCount?: number; leaderCount?: number; valorAlocado?: number;
  committee?: { address?: string; lat?: number; lng?: number; hasPhoto?: boolean; geoSource?: string | null } | null;
  checkinCount?: number; lastCheckinAt?: string | null;
  score?: ScoreInfo;
  repasseStatus?: string; valveNote?: string | null;
}
interface ScoreInfo {
  score: number; level: 'green' | 'yellow' | 'red'; emoji: string; reasons: string[];
  breakdown?: { cadastro: number; comite: number; atividade: number; equipe: number; contas: number };
}
interface ProofData {
  committee?: { address?: string | null; lat?: number | null; lng?: number | null; photo?: string | null; photos?: string[]; geoSource?: string | null; updatedAt?: string | null } | null;
  checkins?: { id: string; tipo?: string; lat?: number | null; lng?: number | null; photo?: string | null; nota?: string | null; createdAt?: string }[];
  valveLog?: { decision: string; note?: string | null; createdAt: string }[];
}

const DEFAULT_CATS = ['Coordenador', 'Líder 1', 'Líder 2', 'Líder 3', 'Líder 4', 'Aluguel de comitê', 'Aluguel de carro', 'Combustível', 'Gráfica', 'Material de campanha'];
// 27 UFs do Brasil (preparação nacional #147b). Seletor evita "rj"/"Rio de Janeiro" misturados.
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
// Cargos eletivos (lista fixa pra escolher no formulário e pra IA mapear).
const CARGOS = ['Presidente', 'Senador', 'Deputado Federal', 'Deputado Estadual', 'Prefeito', 'Vereador'];
const parseBRL = (s: string) => Number(String(s || '').replace(/\./g, '').replace(',', '.')) || 0;
// Busca tolerante: ignora maiúsc/minúsc E acentos (usuário não lembra se
// cadastrou "João" ou "joao"). NFD separa o acento do caractere e o range
// ̀-ͯ remove os diacríticos.
const normalizeText = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
interface Party { id: string; name: string; numero?: string | null; telaoToken?: string | null; plan?: string | null; }
interface RecurringRepasse {
  id: string; candidateId: string; candidateName?: string; valor: number;
  descricao?: string | null; frequencia: 'mensal' | 'quinzenal' | 'semanal';
  proximaData: string; dataFim?: string | null; ativo: boolean;
  pausadoPelaValvula?: boolean; totalLancado?: number; lastRunAt?: string | null;
}

// Cálculo da próxima ocorrência — espelha o motor do backend (recurringRepasses.ts)
// pra exibir/agendar coerente sem ida ao servidor.
const addDaysISO = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};
const addMonthsISO = (iso: string, months: number) => {
  const d = new Date(iso + 'T00:00:00Z'); const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months); if (d.getUTCDate() < day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};
const nextOccurrence = (iso: string, freq: string) =>
  freq === 'semanal' ? addDaysISO(iso, 7) : freq === 'quinzenal' ? addDaysISO(iso, 14) : addMonthsISO(iso, 1);
const FREQ_LABEL: Record<string, string> = { mensal: 'Mensal', quinzenal: 'Quinzenal (a cada 15 dias)', semanal: 'Semanal' };

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  concluded: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};
const STATUS_LABEL: Record<string, string> = { pending: 'Aguardando cadastro', active: 'Cadastrado', concluded: 'Concluído' };

const TABS = ['Candidatos', 'Ranking', 'Repasses', 'Comprovação', 'Telão', 'Segurança'];

const Stat: React.FC<{
  icon: any; label: string; value: React.ReactNode; from: string; to: string;
  // Campo sensível (#141): mostra olho + render condicional (valor real NÃO vai pro DOM quando oculto).
  sensitive?: boolean; hidden?: boolean; onToggleHidden?: () => void;
}> = ({ icon: Icon, label, value, from, to, sensitive, hidden, onToggleHidden }) => (
  <div className={`bg-gradient-to-br ${from} ${to} p-4 sm:p-5 rounded-2xl sm:rounded-3xl border border-white/10`}>
    <div className="flex items-center justify-between gap-2">
      <p className="text-[10px] sm:text-xs text-slate-300 font-bold uppercase tracking-wider truncate">{label}</p>
      <div className="flex items-center gap-1.5 shrink-0">
        {sensitive && (
          <button onClick={onToggleHidden} className="text-white/60 hover:text-white transition-colors" title={hidden ? 'Mostrar valor' : 'Ocultar valor'}>
            {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
        <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-white/70" />
      </div>
    </div>
    <p className="text-xl sm:text-3xl font-black text-white mt-1 sm:mt-2 break-words leading-tight">
      {sensitive && hidden ? 'R$ ••••••' : value}
    </p>
  </div>
);

const SCORE_CLS: Record<string, string> = {
  green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  yellow: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  red: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};
const VALVE_META: Record<string, { label: string; cls: string; emoji: string }> = {
  liberado: { label: 'Repasse liberado', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', emoji: '✅' },
  retido: { label: 'Repasse segurado', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', emoji: '⏸️' },
  cortado: { label: 'Repasse cortado', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30', emoji: '⛔' },
};
const ValveChip: React.FC<{ status?: string }> = ({ status }) => {
  if (!status || status === 'liberado') return null;
  const m = VALVE_META[status]; if (!m) return null;
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${m.cls}`}>{m.emoji} {status === 'retido' ? 'Segurado' : 'Cortado'}</span>;
};

const ScoreChip: React.FC<{ s?: ScoreInfo; size?: 'sm' | 'md' }> = ({ s, size = 'sm' }) => {
  if (!s) return null;
  const tip = s.reasons.length ? s.reasons.map((r) => `• ${r}`).join('\n') : 'Tudo em dia ✅';
  return (
    <span title={tip}
      className={`font-bold rounded-full border whitespace-nowrap ${SCORE_CLS[s.level]} ${size === 'md' ? 'text-sm px-3 py-1' : 'text-[11px] px-2 py-0.5'}`}>
      {s.emoji} {s.score}
    </span>
  );
};

// Campo de busca reutilizado nas abas Candidatos/Ranking/Comprovação. Inclui o
// X pra limpar quando há termo — evita o usuário ter que apagar caractere a
// caractere e some com o "estado vazio" sem explicação.
const SearchBar: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string; className?: string }> =
  ({ value, onChange, placeholder, className }) => (
  <div className={`relative ${className || ''}`}>
    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || 'Buscar…'}
      className="w-full bg-[#1c2128] border border-white/10 rounded-xl pl-9 pr-9 py-2 text-white text-sm" />
    {value && (
      <button onClick={() => onChange('')} title="Limpar busca"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-500 hover:text-white hover:bg-white/10">
        <X className="w-4 h-4" />
      </button>
    )}
  </div>
);

const PartyPresidentPage: React.FC = () => {
  const { user, logout } = useAuth();
  const [loading, setLoading] = React.useState(true);
  const [authExpired, setAuthExpired] = React.useState(false);
  const [party, setParty] = React.useState<Party | null>(null);
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [tab, setTab] = React.useState('Candidatos');
  // Sigilo financeiro (#141): oculto por padrão, preferência por navegador.
  const [financialVisible, setFinancialVisible] = React.useState<boolean>(() => {
    try { return localStorage.getItem('party_financial_visible') === 'true'; } catch { return false; }
  });
  const toggleFinancial = () => setFinancialVisible((v) => {
    const nv = !v;
    try { localStorage.setItem('party_financial_visible', String(nv)); } catch { /* ok */ }
    return nv;
  });
  const [provName, setProvName] = React.useState('');
  const [provBusy, setProvBusy] = React.useState(false);
  // Editar nome + número do partido (cabeçalho).
  const [partyEditOpen, setPartyEditOpen] = React.useState(false);
  const [partyForm, setPartyForm] = React.useState({ name: '', numero: '' });
  const [partySaving, setPartySaving] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [form, setForm] = React.useState({ displayName: '', cargo: '', regiao: '', estado: '', phone: '' });
  const [adding, setAdding] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [importText, setImportText] = React.useState('');
  const [importing, setImporting] = React.useState(false);
  // Import assistido por IA (#147d): cola planilha "suja" → IA extrai → preview → confirma.
  const [importMode, setImportMode] = React.useState<'manual' | 'ia'>('manual');
  const [aiParsing, setAiParsing] = React.useState(false);
  const [aiPreview, setAiPreview] = React.useState<{ displayName: string; cargo: string; regiao: string; estado: string; phone: string; valor: string; data: string }[] | null>(null);
  const [aiIgnored, setAiIgnored] = React.useState<string[]>([]);
  const [aiError, setAiError] = React.useState<string | null>(null);
  // Arquivo arrastado (imagem/PDF) que vai direto pra IA multimodal; CSV/Excel
  // viram texto e caem em importText.
  const [aiFile, setAiFile] = React.useState<{ base64: string; mimeType: string; name: string } | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [importSummary, setImportSummary] = React.useState<{ created: number; duplicates: number; invalid: number } | null>(null);
  // Grupos de duplicatas detectados pela IA (ANTES do preview). O usuário decide
  // o que fazer com cada grupo (unificar / manter todos / manter só um).
  type DupReason = 'identical' | 'name_city_state_phone' | 'name_city' | 'phone_diff_name';
  const [aiDupGroups, setAiDupGroups] = React.useState<{ reason: DupReason; indexes: number[] }[]>([]);
  const [aiDecisions, setAiDecisions] = React.useState<Record<number, { action: 'unify' | 'keep_all' | 'keep_one'; keepIdx?: number; outcomeText?: string }>>({});
  const [showDupCard, setShowDupCard] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [copiedAll, setCopiedAll] = React.useState(false);
  const [repasseFor, setRepasseFor] = React.useState<Candidate | null>(null);
  const [repForm, setRepForm] = React.useState({ valor: '', data: '', descricao: '' });
  const [repItems, setRepItems] = React.useState<{ categoria: string; valor: string }[]>([]);
  const [savingRep, setSavingRep] = React.useState(false);
  // Repasse recorrente (#147): flag "repetir até a eleição" + frequência.
  const [repRecurring, setRepRecurring] = React.useState(false);
  const [repFreq, setRepFreq] = React.useState<'mensal' | 'quinzenal' | 'semanal'>('mensal');
  const [repUntil, setRepUntil] = React.useState('');
  const [recurring, setRecurring] = React.useState<RecurringRepasse[]>([]);
  const [recBusy, setRecBusy] = React.useState<string | null>(null);
  const [proofFor, setProofFor] = React.useState<Candidate | null>(null);
  const [proofData, setProofData] = React.useState<ProofData | null>(null);
  const [proofLoading, setProofLoading] = React.useState(false);
  const [lightbox, setLightbox] = React.useState<string | null>(null);
  const [valveBusy, setValveBusy] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'green' | 'yellow' | 'red' | 'pending'>('all');
  const [estadoFilter, setEstadoFilter] = React.useState<string>('all');
  const [editFor, setEditFor] = React.useState<Candidate | null>(null);
  const [editForm, setEditForm] = React.useState({ displayName: '', cargo: '', regiao: '', estado: '', phone: '' });
  const [editing, setEditing] = React.useState(false);

  const openEdit = (c: Candidate) => { setEditFor(c); setEditForm({ displayName: c.displayName, cargo: c.cargo || '', regiao: c.regiao || '', estado: c.estado || '', phone: c.phone || '' }); };

  // Toast: feedback leve de sucesso/erro. Antes a página usava alert() (bloqueia
  // e destoa) e vários saves fechavam o modal em silêncio. Some sozinho em ~3s.
  const [toast, setToast] = React.useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  const toastTimer = React.useRef<number | null>(null);
  const showToast = (msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  };

  // Diálogo de confirmação estilizado (promessa) — substitui window.confirm em
  // ações destrutivas (excluir candidato, cancelar recorrente) pra combinar com
  // o tema escuro e dar destaque ao botão perigoso.
  const [confirmState, setConfirmState] = React.useState<
    { title: string; body?: string; confirmLabel: string; danger?: boolean; resolve: (v: boolean) => void } | null
  >(null);
  const askConfirm = (opts: { title: string; body?: string; confirmLabel?: string; danger?: boolean }) =>
    new Promise<boolean>((resolve) => setConfirmState({ confirmLabel: 'Confirmar', ...opts, resolve }));
  const closeConfirm = (v: boolean) => { confirmState?.resolve(v); setConfirmState(null); };

  // M7: feedback padronizado de erro. Antes, vários saves do presidente falhavam
  // em silêncio (fechavam o modal sem avisar).
  const notifyFail = async (r: Response, what: string) => {
    const j = await r.json().catch(() => ({}));
    showToast(`${what} (${j?.detail || j?.error || `HTTP ${r.status}`}).`, 'err');
  };
  const saveEdit = async () => {
    if (!editFor || !editForm.displayName.trim()) return;
    setEditing(true);
    try {
      const r = await authedFetch(`/api/v1/party/candidates/${editFor.id}`, { method: 'PATCH', body: JSON.stringify(editForm) });
      if (r.ok) { setEditFor(null); await load(); showToast('Alterações salvas ✅'); }
      else await notifyFail(r, 'Não consegui salvar as alterações');
    } catch { showToast('Falha de rede ao salvar. Tente de novo.', 'err'); }
    finally { setEditing(false); }
  };
  const deleteCandidate = async (c: Candidate) => {
    const ok = await askConfirm({
      title: `Excluir "${c.displayName}"?`,
      body: `Isso remove o candidato e todos os dados dele (comitê, check-ins, repasses).${c.status === 'active' ? ' A conta de acesso dele também será apagada.' : ''}`,
      confirmLabel: 'Excluir', danger: true,
    });
    if (!ok) return;
    try {
      const r = await authedFetch(`/api/v1/party/candidates/${c.id}`, { method: 'DELETE' });
      if (r.ok) {
        setCandidates((prev) => prev.filter((x) => x.id !== c.id));
        showToast('Candidato excluído.');
      } else {
        // Antes falhava em silêncio (o item "voltava" no reload). Agora avisa.
        const j = await r.json().catch(() => ({}));
        showToast(j?.error === 'not_found'
          ? 'Não consegui excluir: candidato não encontrado ou fora do seu partido.'
          : `Não consegui excluir (${j?.error || r.status}).`, 'err');
      }
    } catch {
      showToast('Falha de rede ao excluir. Tente de novo.', 'err');
    }
  };

  // Válvula de repasse — funciona tanto no modal de prova quanto inline (aba Repasses).
  const setValve = async (decision: 'liberado' | 'retido' | 'cortado', cand?: Candidate) => {
    const target = cand || proofFor;
    if (!target) return;
    let note: string | null = null;
    if (decision !== 'liberado') {
      note = window.prompt(decision === 'retido' ? 'Motivo para SEGURAR o repasse (opcional):' : 'Motivo para CORTAR o repasse (opcional):') || null;
    }
    setValveBusy(target.id);
    try {
      const r = await authedFetch(`/api/v1/party/candidates/${target.id}/valve`, { method: 'POST', body: JSON.stringify({ decision, note }) });
      if (r.ok) {
        setCandidates((prev) => prev.map((c) => (c.id === target.id ? { ...c, repasseStatus: decision, valveNote: note } : c)));
        if (proofFor && proofFor.id === target.id) { setProofFor({ ...proofFor, repasseStatus: decision, valveNote: note }); await openProof({ ...proofFor, repasseStatus: decision }); }
        showToast(decision === 'liberado' ? 'Repasse liberado ✅' : decision === 'retido' ? 'Repasse segurado ⏸️' : 'Repasse cortado ⛔');
      } else await notifyFail(r, 'Não consegui atualizar a válvula');
    } catch { showToast('Falha de rede ao atualizar a válvula. Tente de novo.', 'err'); }
    finally { setValveBusy(null); }
  };

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
    setRepRecurring(false); setRepFreq('mensal'); setRepUntil('');
  };

  const loadRecurring = React.useCallback(async () => {
    try {
      const r = await authedFetch('/api/v1/party/recurring-repasses');
      const j = await r.json();
      if (r.ok) setRecurring(j.recurring || []);
    } catch { /* */ }
  }, []);

  // silent=true: atualiza os dados SEM trocar a página inteira pelo spinner
  // (evita o "flash/loop" e não desmonta o ORB/modais durante refresh pós-ação).
  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await authedFetch('/api/v1/party/me');
      // 401 = sessão expirada. NÃO é "sem partido" — não mostrar tela de criação
      // (senão o presidente acha que perdeu o partido). Pede login de novo.
      if (r.status === 401) { setAuthExpired(true); return; }
      const j = await r.json();
      if (r.ok) { setAuthExpired(false); setParty(j.party); setCandidates(j.candidates || []); }
      await loadRecurring();
    } catch { /* rede instável: mantém estado atual */ }
    finally { if (!silent) setLoading(false); }
  }, [loadRecurring]);
  React.useEffect(() => { load(); }, [load]);

  const provision = async () => {
    if (provName.trim().length < 2) return;
    setProvBusy(true);
    try {
      const r = await authedFetch('/api/v1/party/provision', { method: 'POST', body: JSON.stringify({ name: provName.trim() }) });
      if (r.ok) { await load(); showToast('Partido criado ✅'); }
      else await notifyFail(r, 'Não consegui criar o partido');
    } catch { showToast('Falha de rede ao criar o partido. Tente de novo.', 'err'); }
    finally { setProvBusy(false); }
  };

  const openPartyEdit = () => { setPartyForm({ name: party?.name || '', numero: party?.numero || '' }); setPartyEditOpen(true); };
  const savePartyProfile = async () => {
    if (!partyForm.name.trim()) return;
    setPartySaving(true);
    try {
      const r = await authedFetch('/api/v1/party/profile', { method: 'PATCH', body: JSON.stringify({ name: partyForm.name.trim(), numero: partyForm.numero }) });
      if (r.ok) { setPartyEditOpen(false); await load(true); showToast('Partido atualizado ✅'); }
      else await notifyFail(r, 'Não consegui salvar o perfil do partido');
    } catch { showToast('Falha de rede ao salvar o perfil. Tente de novo.', 'err'); }
    finally { setPartySaving(false); }
  };

  const addCandidate = async () => {
    if (!form.displayName.trim() || !form.regiao.trim() || !form.estado || form.phone.replace(/\D/g, '').length < 10) return;
    setAdding(true);
    try {
      const r = await authedFetch('/api/v1/party/candidates', { method: 'POST', body: JSON.stringify(form) });
      if (r.ok) { setForm({ displayName: '', cargo: '', regiao: '', estado: '', phone: '' }); setAddOpen(false); await load(); showToast('Candidato adicionado ✅'); }
      else await notifyFail(r, 'Não consegui adicionar o candidato');
    } catch { showToast('Falha de rede ao adicionar o candidato. Tente de novo.', 'err'); }
    finally { setAdding(false); }
  };

  const importRows = async () => {
    // Formato novo: Nome, Cargo, Cidade, Estado, Telefone. Mantém compatibilidade
    // com o formato antigo (sem Estado): detecta o telefone pelo excesso de dígitos.
    const isPhone = (s?: string) => (s || '').replace(/\D/g, '').length >= 8;
    const rows = importText.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [displayName, cargo, regiao, p4, p5] = line.split(/[;,\t]/).map((s) => (s || '').trim());
      let estado = '', phone = '';
      for (const t of [p4, p5].filter(Boolean)) {
        if (isPhone(t)) phone = t; else if (!estado) estado = t;
      }
      return { displayName, cargo, regiao, estado, phone };
    }).filter((r) => r.displayName);
    if (!rows.length) return;
    setImporting(true); setImportSummary(null);
    try {
      const r = await authedFetch('/api/v1/party/candidates/import', { method: 'POST', body: JSON.stringify({ rows }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { setImportSummary({ created: j.created || 0, duplicates: j.duplicates || 0, invalid: j.invalid || 0 }); await load(true); }
    } finally { setImporting(false); }
  };

  // Lê o arquivo arrastado/escolhido. CSV/TXT e Excel viram texto (no navegador);
  // imagem e PDF vão como base64 pra IA ler nativamente (multimodal).
  const handleDroppedFile = async (file: File) => {
    setAiError(null); setAiPreview(null); setAiIgnored([]); setAiFile(null);
    const name = file.name.toLowerCase();
    const isExcel = /\.(xlsx|xls)$/.test(name) || /sheet|excel/.test(file.type);
    const isText = file.type.startsWith('text/') || /\.(csv|tsv|txt)$/.test(name);
    const isImg = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf' || /\.pdf$/.test(name);
    try {
      if (isExcel) {
        const XLSX = await import('xlsx');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const csv = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n');
        setImportText(csv);
        setAiError(csv.trim() ? null : 'A planilha veio vazia. Confira o arquivo.');
      } else if (isText) {
        setImportText(await file.text());
      } else if (isImg || isPdf) {
        const dataUrl: string = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(new Error('read_fail'));
          fr.readAsDataURL(file);
        });
        const base64 = dataUrl.split(',')[1] || '';
        setAiFile({ base64, mimeType: file.type || (isPdf ? 'application/pdf' : 'image/jpeg'), name: file.name });
        setImportText('');
      } else {
        setAiError('Formato não suportado. Use CSV, TXT, Excel, PDF ou imagem.');
      }
    } catch {
      setAiError('Não consegui ler o arquivo. Tente outro formato ou cole o texto.');
    }
  };

  // IA: extrai candidatos de planilha colada OU de arquivo (imagem/PDF) → preview.
  const parseWithAI = async () => {
    if (!importText.trim() && !aiFile) return;
    setAiParsing(true); setAiError(null); setAiPreview(null); setAiIgnored([]);
    setAiDupGroups([]); setAiDecisions({}); setShowDupCard(false);
    try {
      const payload = aiFile
        ? { fileBase64: aiFile.base64, mimeType: aiFile.mimeType }
        : { text: importText };
      const r = await authedFetch('/api/v1/party/candidates/parse-ai', { method: 'POST', body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || j?.error || 'Falha ao organizar');
      const candidates = j.candidates || [];
      const groups = Array.isArray(j.duplicateGroups) ? j.duplicateGroups : [];
      setAiIgnored(j.ignored || []);
      if (groups.length > 0) {
        // Tem duplicatas → guarda os candidatos crus e abre o card de resolução.
        // Só depois que o presidente decidir cada grupo o preview é montado.
        setAiPreview(candidates);
        setAiDupGroups(groups);
        setShowDupCard(true);
      } else {
        setAiPreview(candidates);
      }
      if (!(j.candidates || []).length) setAiError('Não encontrei candidatos. Confira o conteúdo colado ou o arquivo.');
    } catch (e: any) {
      setAiError(e?.message || 'Erro ao organizar com IA.');
    } finally { setAiParsing(false); }
  };
  // Confirma o preview da IA → grava de fato via o mesmo endpoint de import.
  const importParsed = async () => {
    if (!aiPreview?.length) return;
    setImporting(true); setImportSummary(null);
    try {
      const rows = aiPreview.filter((c) => c.displayName.trim());
      const r = await authedFetch('/api/v1/party/candidates/import', { method: 'POST', body: JSON.stringify({ rows }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setAiPreview(null); setAiIgnored([]); setImportText('');
        setImportSummary({ created: j.created || 0, duplicates: j.duplicates || 0, invalid: j.invalid || 0 });
        await load(true);
      }
    } finally { setImporting(false); }
  };
  // edição inline da prévia da IA (#147e)
  const updatePreviewRow = (i: number, field: 'displayName' | 'cargo' | 'regiao' | 'estado' | 'phone' | 'valor' | 'data', value: string) => {
    setAiPreview((prev) => prev ? prev.map((r, j) => (j === i ? { ...r, [field]: value } : r)) : prev);
  };
  const removePreviewRow = (i: number) => setAiPreview((prev) => (prev ? prev.filter((_, j) => j !== i) : prev));

  const closeImport = () => {
    setImportOpen(false); setImportText(''); setImportMode('manual');
    setAiPreview(null); setAiIgnored([]); setAiError(null); setImportSummary(null);
    setAiFile(null); setDragOver(false);
    setAiDupGroups([]); setAiDecisions({}); setShowDupCard(false);
  };

  const inviteUrl = (token: string) => `${window.location.origin}/cadastro/partido/${token}`;
  const copyLink = (token?: string | null) => {
    if (!token) return;
    navigator.clipboard?.writeText(inviteUrl(token)).then(() => { setCopied(token); setTimeout(() => setCopied(null), 1500); }, () => {});
  };
  // Abre o WhatsApp já com a mensagem e o link de cadastro. Usa o telefone do
  // candidato se houver; senão abre o WhatsApp pra escolher o contato.
  const sendWhatsApp = (c: Candidate) => {
    if (!c.inviteToken) return;
    const phone = (c.phone || '').replace(/\D/g, '');
    // Sem telefone válido → não abre o WhatsApp "vazio" (confuso). Orienta a editar.
    if (phone.length < 10) {
      window.alert(`"${c.displayName}" está sem telefone. Edite o candidato (lápis) e adicione o WhatsApp pra abrir a conversa direto — ou use "Copiar link" e envie por outro meio.`);
      return;
    }
    const msg = `Olá, ${c.displayName}! Faça seu cadastro no ${party?.name || 'partido'} por este link (seu nome já está reservado, é só criar a senha): ${inviteUrl(c.inviteToken)}`;
    const wa = `https://wa.me/${phone.length <= 11 ? '55' + phone : phone}?text=${encodeURIComponent(msg)}`;
    window.open(wa, '_blank');
  };

  // Convite ainda em aberto: 'pending' OU 'registering' (estado transitório do
  // autocadastro; se travar no meio, o candidato fica visível e re-convidável
  // em vez de sumir da lista). 'active' = já concluiu.
  const isInviteOpen = (c: Candidate) => (c.status === 'pending' || c.status === 'registering') && !!c.inviteToken;
  // Candidatos ainda não cadastrados (pendentes) que têm link de convite.
  const pendentesConvite = candidates.filter(isInviteOpen);
  // Copia "Nome: link" de todos os pendentes pra colar numa lista de transmissão.
  const copyAllInvites = () => {
    if (!pendentesConvite.length) return;
    const txt = pendentesConvite.map((c) => `${c.displayName}: ${inviteUrl(c.inviteToken!)}`).join('\n');
    navigator.clipboard?.writeText(txt).then(() => { setCopiedAll(true); setTimeout(() => setCopiedAll(false), 1800); }, () => {});
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
      if (r.ok) {
        // Flag "repetir até a eleição": cria o modelo recorrente. O repasse de
        // HOJE já foi lançado acima — o recorrente agenda a PRÓXIMA ocorrência
        // (data base avançada uma vez) pra não duplicar neste período.
        if (repRecurring) {
          const base = /^\d{4}-\d{2}-\d{2}$/.test(repForm.data) ? repForm.data : new Date().toISOString().slice(0, 10);
          await authedFetch(`/api/v1/party/candidates/${repasseFor.id}/recurring-repasses`, {
            method: 'POST',
            body: JSON.stringify({
              valor: v, descricao: repForm.descricao, frequencia: repFreq,
              proximaData: nextOccurrence(base, repFreq),
              dataFim: repUntil || undefined,
            }),
          });
        }
        setRepasseFor(null); await load(); showToast(repRecurring ? 'Repasse lançado e recorrência criada ✅' : 'Repasse lançado ✅');
      } else await notifyFail(r, 'Não consegui lançar o repasse');
    } catch { showToast('Falha de rede ao lançar o repasse. Tente de novo.', 'err'); }
    finally { setSavingRep(false); }
  };

  // Pausar/reativar/cancelar recorrente (#147).
  const toggleRecurring = async (rec: RecurringRepasse) => {
    setRecBusy(rec.id);
    try {
      const r = await authedFetch(`/api/v1/party/recurring-repasses/${rec.id}`, { method: 'PATCH', body: JSON.stringify({ ativo: !rec.ativo }) });
      if (r.ok) { await loadRecurring(); showToast(rec.ativo ? 'Recorrência pausada.' : 'Recorrência retomada.'); }
      else await notifyFail(r, 'Não consegui atualizar a recorrência');
    } catch { showToast('Falha de rede. Tente de novo.', 'err'); }
    finally { setRecBusy(null); }
  };
  const cancelRecurring = async (rec: RecurringRepasse) => {
    const ok = await askConfirm({
      title: 'Cancelar repasse automático?',
      body: `Cancelar o repasse automático de ${brl(rec.valor)} para ${rec.candidateName || 'este candidato'}? Os repasses já lançados continuam no histórico.`,
      confirmLabel: 'Cancelar recorrência', danger: true,
    });
    if (!ok) return;
    setRecBusy(rec.id);
    try {
      const r = await authedFetch(`/api/v1/party/recurring-repasses/${rec.id}`, { method: 'DELETE' });
      if (r.ok) { await loadRecurring(); showToast('Recorrência cancelada.'); }
      else await notifyFail(r, 'Não consegui cancelar a recorrência');
    } catch { showToast('Falha de rede. Tente de novo.', 'err'); }
    finally { setRecBusy(null); }
  };

  const totalRepassado = candidates.reduce((s, c) => s + (Number(c.valorRecebido) || 0), 0);
  const cadastrados = candidates.filter((c) => c.status === 'active').length;
  const metasDoneTotal = candidates.reduce((s, c) => s + (c.metasDone || 0), 0);
  const metasTotalTotal = candidates.reduce((s, c) => s + (c.metasTotal || 0), 0);
  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  // Cidade/UF combinados (ex: "Niterói/RJ"). Preparado pra todo o Brasil (#147b).
  const localOf = (c: Candidate) => [c.regiao, c.estado].filter(Boolean).join('/');

  if (loading) {
    return <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>;
  }

  // Sessão expirada (401): NÃO mostrar criação de partido — pedir login de novo.
  if (authExpired) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900/60 border border-white/10 rounded-3xl p-8 text-center">
          <LogOut className="w-12 h-12 text-amber-400 mx-auto mb-3" />
          <h1 className="text-2xl font-black">Sessão expirada</h1>
          <p className="text-sm text-slate-400 mt-1 mb-5">Seu login expirou por inatividade. Entre de novo para voltar ao Centro de Comando — seus dados estão salvos.</p>
          <button onClick={() => logout?.()}
            className="w-full bg-indigo-600 hover:bg-indigo-500 rounded-xl px-4 py-3 font-bold flex items-center justify-center gap-2">
            <LogOut className="w-4 h-4" /> Fazer login novamente
          </button>
        </div>
      </div>
    );
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
    <div className="p-4 sm:p-6 bg-[#0a0a0b] min-h-screen text-white font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 sm:mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2 sm:gap-3 flex-wrap">
            <span className="flex items-center gap-2"><Landmark className="text-indigo-400 w-6 h-6 shrink-0" /> Centro de Comando</span>
            {party.plan && party.plan !== 'pending_payment' && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">Plano Partido</span>
            )}
          </h1>
          <p className="text-gray-400 text-sm truncate flex items-center gap-1.5">
            <span className="truncate">{party.name}{party.numero ? ` · nº ${party.numero}` : ''} · {user?.name}</span>
            <button onClick={openPartyEdit} title="Editar nome e número do partido" className="text-slate-500 hover:text-white shrink-0"><Pencil className="w-3.5 h-3.5" /></button>
          </p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button onClick={() => setImportOpen(true)} className="flex-1 md:flex-none justify-center bg-white/5 hover:bg-white/10 px-3 sm:px-4 py-2 rounded-xl text-slate-200 font-bold flex items-center gap-2 text-sm"><Upload className="w-4 h-4" /> Importar</button>
          <button onClick={() => setAddOpen(true)} className="flex-1 md:flex-none justify-center bg-indigo-600 hover:bg-indigo-500 px-3 sm:px-5 py-2 rounded-xl font-bold flex items-center gap-2 text-sm shadow-lg shadow-indigo-600/20">
            <Plus className="w-4 h-4" /> <span className="whitespace-nowrap">Novo</span>
          </button>
          <button onClick={() => logout?.()} className="bg-white/5 hover:bg-white/10 px-3 py-2 rounded-xl text-slate-300 flex items-center gap-2 text-sm" title="Sair"><LogOut className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
        <Stat icon={Users} label="Candidatos" value={candidates.length} from="from-indigo-600/20" to="to-blue-600/10" />
        <Stat icon={CheckCircle2} label="Já cadastrados" value={cadastrados} from="from-emerald-600/20" to="to-teal-600/10" />
        <Stat icon={Wallet} label="Total repassado" value={brl(totalRepassado)} from="from-amber-600/20" to="to-orange-600/10"
          sensitive hidden={!financialVisible} onToggleHidden={toggleFinancial} />
        <Stat icon={Target} label="Metas cumpridas" value={`${metasDoneTotal}/${metasTotalTotal || 0}`} from="from-purple-600/20" to="to-fuchsia-600/10" />
      </div>

      {/* Digest Semanal IA (#85) — sumário automático que o presidente vê sem abrir aba */}
      {candidates.length > 0 && <WeeklyDigestCard />}

      {/* Tabs (isoladas — presidente só vê o que é dele) */}
      <div className="flex gap-1 sm:gap-2 mb-6 border-b border-white/5 overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 sm:px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 ${tab === t ? 'border-indigo-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
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
        ) : (() => {
          const q = normalizeText(search.trim());
          const filtered = candidates.filter((c) => {
            if (q && !normalizeText(`${c.displayName} ${c.cargo || ''} ${c.regiao || ''} ${c.estado || ''} ${c.phone || ''}`).includes(q)) return false;
            if (estadoFilter !== 'all' && (c.estado || '') !== estadoFilter) return false;
            if (statusFilter === 'pending' && !(c.status === 'pending' || c.status === 'registering')) return false;
            if ((statusFilter === 'green' || statusFilter === 'yellow' || statusFilter === 'red') && c.score?.level !== statusFilter) return false;
            return true;
          });
          const estadosPresentes = [...new Set(candidates.map((c) => c.estado).filter(Boolean) as string[])].sort();
          const FILTERS: { k: typeof statusFilter; label: string; title: string }[] = [
            { k: 'all', label: 'Todos', title: 'Todos os candidatos' },
            { k: 'green', label: '🟢 Em dia', title: 'Score verde — em dia' },
            { k: 'yellow', label: '🟡 Atenção', title: 'Score amarelo — atenção' },
            { k: 'red', label: '🔴 Risco', title: 'Score vermelho — risco' },
            { k: 'pending', label: 'Pendentes', title: 'Ainda não concluíram o cadastro' },
          ];
          return (
          <div className="space-y-2">
            {/* Busca + filtro */}
            <div className="flex flex-col sm:flex-row gap-2 mb-2">
              <SearchBar value={search} onChange={setSearch} placeholder="Buscar candidato (nome, telefone, cargo, cidade, UF)…" className="flex-1" />
              {estadosPresentes.length > 1 && (
                <select value={estadoFilter} onChange={(e) => setEstadoFilter(e.target.value)}
                  className="bg-[#1c2128] border border-white/10 rounded-xl px-3 py-2 text-white text-sm shrink-0">
                  <option value="all">Todos os estados</option>
                  {estadosPresentes.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              )}
              <div className="flex gap-1 overflow-x-auto no-scrollbar">
                {FILTERS.map((f) => (
                  <button key={f.k} onClick={() => setStatusFilter(f.k)} title={f.title}
                    className={`text-xs font-bold px-3 py-2 rounded-xl whitespace-nowrap shrink-0 border ${statusFilter === f.k ? 'bg-indigo-600 border-transparent text-white' : 'bg-[#1c2128] border-white/10 text-slate-400'}`}>{f.label}</button>
                ))}
              </div>
            </div>
            {pendentesConvite.length > 0 && (
              <div className="flex items-center justify-between gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-3 py-2 mb-1">
                <p className="text-xs text-emerald-200"><b>{pendentesConvite.length}</b> candidato(s) ainda não concluíram o cadastro.</p>
                <button onClick={() => setInviteOpen(true)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shrink-0">
                  <MessageCircle className="w-3.5 h-3.5" /> Convidar pendentes
                </button>
              </div>
            )}
            <p className="text-xs text-slate-500 mb-1">{filtered.length} de {candidates.length} candidato(s)</p>
            {filtered.map((c) => (
              <div key={c.id} className="bg-[#1c2128] p-4 rounded-2xl border border-white/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-white truncate">{c.displayName}</p>
                  <p className="text-xs text-slate-400 truncate">{[c.cargo, localOf(c)].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                  <ScoreChip s={c.score} />
                  {typeof c.metasDone === 'number' && (
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${c.metasDone === c.metasTotal ? 'bg-emerald-500/15 text-emerald-300' : 'bg-purple-500/15 text-purple-300'}`} title={(c.metas || []).map((m) => `${m.done ? '✅' : '⬜'} ${m.label}`).join('\n')}>
                      🎯 {c.metasDone}/{c.metasTotal}
                    </span>
                  )}
                  {isInviteOpen(c) && (
                    <button onClick={() => sendWhatsApp(c)} title="Enviar convite no WhatsApp"
                      className="text-xs flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 font-bold">
                      <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                    </button>
                  )}
                  {isInviteOpen(c) && (
                    <button onClick={() => copyLink(c.inviteToken)} title="Copiar link de cadastro"
                      className="text-xs flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300">
                      {copied === c.inviteToken ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copiado</> : <><Link2 className="w-3.5 h-3.5" /> Link</>}
                    </button>
                  )}
                  <button onClick={() => openRepasse(c)}
                    className="text-xs flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300" title="Registrar repasse">
                    <Wallet className="w-3.5 h-3.5" /> Repasse
                  </button>
                  <span className="text-sm text-slate-300 text-right">{brl(Number(c.valorRecebido) || 0)}</span>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${STATUS_BADGE[c.status] || STATUS_BADGE.pending}`}>{STATUS_LABEL[c.status] || c.status}</span>
                  <button onClick={() => openEdit(c)} title="Editar" className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => deleteCandidate(c)} title="Excluir" className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-12 border border-dashed border-white/10 rounded-3xl">
                <Search className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">
                  Nenhum candidato encontrado{search ? <> para "<b className="text-slate-300">{search}</b>"</> : ' com esses filtros'}.
                </p>
                <button onClick={() => { setSearch(''); setStatusFilter('all'); setEstadoFilter('all'); }}
                  className="mt-3 text-xs font-bold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300">
                  Limpar filtros
                </button>
              </div>
            )}
          </div>
          );
        })()
      )}

      {tab === 'Ranking' && (
        candidates.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-white/10 rounded-3xl text-slate-500">Cadastre candidatos para ver o ranking.</div>
        ) : (<>
          <AntifraudButton />
          {(() => {
          const ranked = [...candidates].sort((a, b) => (b.score?.score || 0) - (a.score?.score || 0));
          const greens = candidates.filter((c) => c.score?.level === 'green').length;
          const yellows = candidates.filter((c) => c.score?.level === 'yellow').length;
          const reds = candidates.filter((c) => c.score?.level === 'red').length;
          const aJustificar = candidates.reduce((s, c) => s + Math.max(0, (Number(c.valorRecebido) || 0) - (Number(c.valorAlocado) || 0)), 0);
          const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`);
          const lastSeen = (iso?: string | null) => {
            if (!iso) return 'nunca';
            const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
            return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `${d}d`;
          };
          // Busca filtra a TABELA mas preserva a posição real (medalha) do ranking
          // completo — buscar não "promove" ninguém ao 🥇.
          const q = normalizeText(search.trim());
          const shownRanked = ranked
            .map((c, idx) => ({ c, idx }))
            .filter(({ c }) => !q || normalizeText(`${c.displayName} ${c.cargo || ''} ${c.regiao || ''} ${c.estado || ''} ${c.phone || ''}`).includes(q));
          return (
            <div className="space-y-4">
              {/* Resumo do partido */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-3 text-center"><p className="text-2xl font-black text-emerald-300">{greens}</p><p className="text-[11px] text-slate-400">🟢 Em dia</p></div>
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 text-center"><p className="text-2xl font-black text-amber-300">{yellows}</p><p className="text-[11px] text-slate-400">🟡 Atenção</p></div>
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-3 text-center"><p className="text-2xl font-black text-rose-300">{reds}</p><p className="text-[11px] text-slate-400">🔴 Risco</p></div>
                <div className="bg-slate-800/60 border border-white/10 rounded-2xl p-3 text-center"><p className="text-lg font-black text-rose-300 leading-tight mt-1">{brl(aJustificar)}</p><p className="text-[11px] text-slate-400">a justificar</p></div>
              </div>

              <SearchBar value={search} onChange={setSearch} placeholder="Buscar no ranking (nome, telefone, cargo, cidade, UF)…" />

              {/* Pódio top 3 — escondido durante a busca (não faz sentido com filtro) */}
              {ranked.length >= 3 && !q && (
                <div className="bg-gradient-to-br from-indigo-600/15 to-purple-600/10 border border-white/10 rounded-3xl p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-300 mb-3 flex items-center gap-1.5"><Trophy className="w-4 h-4" /> Destaques do partido</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {ranked.slice(0, 3).map((c, i) => (
                      <button key={c.id} onClick={() => openProof(c)} className="text-center bg-[#1c2128] rounded-2xl border border-white/5 hover:border-white/20 p-3 transition-colors">
                        <div className="text-2xl">{medal(i)}</div>
                        <p className="text-sm font-bold text-white truncate mt-1">{c.displayName}</p>
                        <ScoreChip s={c.score} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Tabela lado a lado: recebeu × entregou × score */}
              <div className="bg-[#1c2128] border border-white/5 rounded-3xl overflow-hidden">
                <div className="hidden sm:grid grid-cols-[2rem_1fr_5rem_6rem_6rem_5rem] gap-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-white/5">
                  <span>#</span><span>Candidato</span><span className="text-center">Score</span><span className="text-right">Recebeu</span><span className="text-right">A justificar</span><span className="text-center">Ativo</span>
                </div>
                {shownRanked.map(({ c, idx }) => {
                  const recebido = Number(c.valorRecebido) || 0;
                  const restante = recebido - (Number(c.valorAlocado) || 0);
                  return (
                    <button key={c.id} onClick={() => openProof(c)}
                      className="w-full grid grid-cols-[2rem_1fr_5rem] sm:grid-cols-[2rem_1fr_5rem_6rem_6rem_5rem] gap-2 px-4 py-3 items-center text-left hover:bg-white/5 border-b border-white/5 last:border-0 transition-colors">
                      <span className="font-black text-slate-400">{medal(idx)}</span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5"><span className="font-bold text-white truncate">{c.displayName}</span><ValveChip status={c.repasseStatus} /></span>
                        <span className="block text-[11px] text-slate-500 truncate">{[c.cargo, localOf(c)].filter(Boolean).join(' · ') || '—'}</span>
                      </span>
                      <span className="text-center"><ScoreChip s={c.score} /></span>
                      <span className="hidden sm:block text-right text-sm text-white">{brl(recebido)}</span>
                      <span className={`hidden sm:block text-right text-sm font-bold ${restante > 0.005 ? 'text-rose-400' : 'text-emerald-400'}`}>{restante > 0.005 ? brl(restante) : '—'}</span>
                      <span className="hidden sm:flex items-center justify-center gap-1 text-[11px] text-slate-400"><Activity className="w-3 h-3" /> {lastSeen(c.lastCheckinAt)}</span>
                    </button>
                  );
                })}
                {shownRanked.length === 0 && (
                  <div className="text-center py-10 px-4">
                    <p className="text-slate-400 text-sm">Nenhum candidato encontrado para "<b className="text-slate-300">{search}</b>".</p>
                    <button onClick={() => setSearch('')} className="mt-3 text-xs font-bold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300">Limpar busca</button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        </>)
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

            {/* Repasses automáticos (#147) — modelos recorrentes ativos/pausados */}
            {recurring.length > 0 && (
              <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-2xl p-3 mb-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-300 mb-2 flex items-center gap-1.5">🔁 Repasses automáticos ({recurring.filter((r) => r.ativo).length} ativos)</p>
                <div className="space-y-1.5">
                  {recurring.map((rec) => (
                    <div key={rec.id} className="flex items-center justify-between gap-2 bg-[#1c2128] rounded-xl border border-white/5 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate flex items-center gap-1.5">
                          {rec.candidateName || '—'}
                          {!rec.ativo && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-600/40 text-slate-300">pausado</span>}
                          {rec.ativo && rec.pausadoPelaValvula && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">⏸️ válvula</span>}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate">
                          {brl(rec.valor)} · {FREQ_LABEL[rec.frequencia] || rec.frequencia}
                          {rec.ativo ? ` · próximo ${new Date(rec.proximaData + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}
                          {rec.dataFim ? ` · até ${new Date(rec.dataFim + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}
                          {rec.totalLancado ? ` · ${rec.totalLancado} lançado(s)` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => toggleRecurring(rec)} disabled={recBusy === rec.id}
                          className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-50">
                          {rec.ativo ? '⏸️ Pausar' : '▶️ Retomar'}
                        </button>
                        <button onClick={() => cancelRecurring(rec)} disabled={recBusy === rec.id} title="Cancelar"
                          className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500 mt-2">Lançam sozinhos na data agendada. Se a válvula do candidato estiver segurada/cortada, pausam automaticamente e voltam quando você liberar.</p>
              </div>
            )}

            {[...candidates].sort((a, b) => (Number(b.valorRecebido) || 0) - (Number(a.valorRecebido) || 0)).map((c) => {
              const recebido = Number(c.valorRecebido) || 0;
              const restante = recebido - (Number(c.valorAlocado) || 0);
              return (
              <div key={c.id} className="bg-[#1c2128] p-4 rounded-2xl border border-white/5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-white truncate flex items-center gap-2">{c.displayName} <ValveChip status={c.repasseStatus} /></p>
                    <p className="text-xs text-slate-400">{[c.cargo, localOf(c)].filter(Boolean).join(' · ') || '—'} · 🎯 {c.metasDone}/{c.metasTotal} metas</p>
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
                {/* Válvula inline: liberar / segurar / cortar o repasse */}
                <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-slate-500 mr-1">Válvula:</span>
                  {(['liberado', 'retido', 'cortado'] as const).map((d) => {
                    const active = (c.repasseStatus || 'liberado') === d;
                    return (
                      <button key={d} onClick={() => setValve(d, c)} disabled={valveBusy === c.id}
                        className={`text-[11px] font-bold rounded-lg px-2.5 py-1 border disabled:opacity-50 ${active ? VALVE_META[d].cls : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}>
                        {d === 'liberado' ? '✅ Liberar' : d === 'retido' ? '⏸️ Segurar' : '⛔ Cortar'}
                      </button>
                    );
                  })}
                  {valveBusy === c.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
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
        ) : (() => {
          const q = normalizeText(search.trim());
          const shown = candidates.filter((c) => !q || normalizeText(`${c.displayName} ${c.cargo || ''} ${c.regiao || ''} ${c.estado || ''} ${c.phone || ''} ${c.committee?.address || ''}`).includes(q));
          return (
          <div className="space-y-2">
            <p className="text-sm text-slate-400 mb-1">Comitês geolocalizados e check-ins por candidato — a prova de que a estrutura existe.</p>
            <SearchBar value={search} onChange={setSearch} placeholder="Buscar candidato (nome, cargo, cidade, endereço)…" />
            {shown.length === 0 ? (
              <div className="text-center py-10 px-4">
                <p className="text-slate-400 text-sm">Nenhum candidato encontrado para "<b className="text-slate-300">{search}</b>".</p>
                <button onClick={() => setSearch('')} className="mt-3 text-xs font-bold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300">Limpar busca</button>
              </div>
            ) : shown.map((c) => {
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
                  className="w-full text-left bg-[#1c2128] p-4 rounded-2xl border border-white/5 hover:border-white/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 transition-colors">
                  <div className="min-w-0">
                    <p className="font-bold text-white truncate">{c.displayName}</p>
                    <p className="text-xs text-slate-400 truncate">{com?.address || (com?.lat ? 'Comitê com localização' : 'Sem comitê cadastrado')}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 sm:shrink-0">
                    <ScoreChip s={c.score} />
                    <span className="text-xs text-slate-400">📸 {c.checkinCount || 0} check-ins</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.txt}</span>
                    {hasMedia && <span className="text-[11px] text-indigo-300 font-bold whitespace-nowrap">Ver fotos →</span>}
                  </div>
                </button>
              );
            })}
          </div>
          );
        })()
      )}

      {tab === 'Telão' && (() => {
        const telaoUrl = party?.telaoToken ? `${window.location.origin}/telao/partido/${party.telaoToken}` : '';
        return (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-indigo-600/15 to-purple-600/10 border border-white/10 rounded-3xl p-5">
              <p className="font-bold flex items-center gap-2 mb-1"><MapPinned className="w-5 h-5 text-indigo-300" /> Telão ao vivo do partido</p>
              <p className="text-sm text-slate-400 mb-4">Mapa em tela cheia com os comitês (cor = saúde do candidato), check-ins e o placar 🟢🟡🔴. Abra numa TV/projetor — atualiza sozinho. O link é público (sem login) e não mostra valores em R$.</p>
              {telaoUrl ? (
                <>
                  <div className="flex items-center gap-2 bg-slate-950 border border-white/10 rounded-xl px-3 py-2 mb-3">
                    <input readOnly value={telaoUrl} className="flex-1 bg-transparent text-xs text-slate-300 outline-none" onFocus={(e) => e.target.select()} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={telaoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm"><MapPinned className="w-4 h-4" /> Abrir telão em nova aba</a>
                    <button onClick={() => { navigator.clipboard?.writeText(telaoUrl).then(() => { setCopied(party!.telaoToken!); setTimeout(() => setCopied(null), 1500); }, () => {}); }}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 font-bold text-sm">
                      {copied === party?.telaoToken ? <><Check className="w-4 h-4 text-emerald-400" /> Copiado</> : <><Link2 className="w-4 h-4" /> Copiar link</>}
                    </button>
                  </div>
                </>
              ) : <p className="text-sm text-slate-500">Gerando link do telão… recarregue a página.</p>}
            </div>
          </div>
        );
      })()}

      {tab === 'Segurança' && (
        <>
          <PartyBackup />
          <PartyRestore onRestored={() => load(true)} />
          <PartyEmergencyWipe
            partyName={party.name}
            hasData={candidates.length > 0 || totalRepassado > 0}
            onWiped={() => { setTab('Candidatos'); load(); }}
          />
        </>
      )}

      {/* ORB Conversacional (#142) — assistente flutuante do partido */}
      <PartyAIOrb onRepasseDone={() => load(true)} />

      {/* Card flutuante de resolução de duplicatas — aparece ANTES do preview
          quando a IA detecta linhas potencialmente repetidas na planilha. */}
      {showDupCard && aiDupGroups.length > 0 && aiPreview && (
        <DuplicateResolutionCard
          groups={aiDupGroups}
          decisions={aiDecisions}
          rows={aiPreview}
          onDecide={(groupIdx, decision) => setAiDecisions((d) => {
            if (!decision) { const next = { ...d }; delete next[groupIdx]; return next; }
            return { ...d, [groupIdx]: decision };
          })}
          onContinue={() => {
            // Aplica as decisões e monta a lista final do preview.
            const removeIdx = new Set<number>();
            const inserts: { afterIdx: number; row: typeof aiPreview[number] }[] = [];
            aiDupGroups.forEach((g, gi) => {
              const dec = aiDecisions[gi];
              if (!dec) return; // mantém todos por padrão
              if (dec.action === 'keep_all') return;
              if (dec.action === 'keep_one') {
                const keep = dec.keepIdx ?? g.indexes[0];
                g.indexes.forEach((i) => { if (i !== keep) removeIdx.add(i); });
                return;
              }
              if (dec.action === 'unify') {
                // Soma valores, pega primeiro não-vazio dos demais campos.
                const rows = g.indexes.map((i) => aiPreview[i]);
                const merged = { ...rows[0] };
                const valores: number[] = [];
                for (const r of rows) {
                  const v = Number(r.valor) || 0;
                  if (v > 0) valores.push(v);
                  if (!merged.cargo && r.cargo) merged.cargo = r.cargo;
                  if (!merged.estado && r.estado) merged.estado = r.estado;
                  if (!merged.phone && r.phone) merged.phone = r.phone;
                  if (!merged.data && r.data) merged.data = r.data;
                }
                const soma = valores.reduce((a, b) => a + b, 0);
                merged.valor = soma > 0 ? String(soma) : '';
                // Remove originais; insere o merged na posição da primeira.
                g.indexes.forEach((i) => removeIdx.add(i));
                inserts.push({ afterIdx: g.indexes[0], row: merged });
              }
            });
            const final: typeof aiPreview = [];
            aiPreview.forEach((r, i) => {
              if (!removeIdx.has(i)) final.push(r);
              const ins = inserts.find((x) => x.afterIdx === i);
              if (ins) final.push(ins.row);
            });
            setAiPreview(final);
            setShowDupCard(false);
          }}
        />
      )}

      {/* Modal: editar nome + número do partido */}
      {partyEditOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => !partySaving && setPartyEditOpen(false)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-white">Editar partido</h4>
              <button onClick={() => setPartyEditOpen(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <label className="block text-[11px] text-slate-400 mb-1">Nome do partido</label>
            <input value={partyForm.name} onChange={(e) => setPartyForm({ ...partyForm, name: e.target.value })} placeholder="Nome do partido"
              className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white mb-3" />
            <label className="block text-[11px] text-slate-400 mb-1">Número eleitoral (opcional)</label>
            <input value={partyForm.numero} onChange={(e) => setPartyForm({ ...partyForm, numero: e.target.value.replace(/\D/g, '').slice(0, 5) })}
              placeholder="Ex: 13" inputMode="numeric"
              className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white mb-4" />
            <button onClick={savePartyProfile} disabled={partySaving || !partyForm.name.trim()} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2">
              {partySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
            </button>
          </div>
        </div>
      )}

      {/* Modal: convidar pendentes (WhatsApp 1 a 1 + copiar todos os links) */}
      {inviteOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setInviteOpen(false)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-lg w-full p-5 max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-white">Convidar pendentes ({pendentesConvite.length})</h4>
              <button onClick={() => setInviteOpen(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              <b>Jeito recomendado:</b> toque no botão de WhatsApp de cada candidato — abre a conversa dele já com a mensagem e o link prontos, é só enviar.
              <br /><b>Atalho:</b> "Copiar lista" copia <i>Nome + link</i> de todos pra você <b>colar numa mensagem ou grupo</b>.
              <span className="block mt-1 text-slate-500">Obs: a "lista de transmissão" do WhatsApp é montada escolhendo os contatos salvos no seu celular — não dá pra colar texto nela. Por isso o ideal é o botão de WhatsApp um a um.</span>
            </p>
            <button onClick={copyAllInvites} className="w-full mb-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2 text-sm">
              {copiedAll ? <><Check className="w-4 h-4 text-emerald-300" /> Lista copiada!</> : <><Link2 className="w-4 h-4" /> Copiar lista (nome + link) dos {pendentesConvite.length}</>}
            </button>
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {pendentesConvite.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 bg-[#1c2128] rounded-xl border border-white/5 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{c.displayName}</p>
                    <p className="text-[11px] text-slate-400 truncate">{[localOf(c), c.phone].filter(Boolean).join(' · ') || 'sem telefone'}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => sendWhatsApp(c)} title="Enviar convite no WhatsApp"
                      className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 font-bold"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</button>
                    <button onClick={() => copyLink(c.inviteToken)} title="Copiar link"
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300">
                      {copied === c.inviteToken ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Link2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white">
                  <option value="">Cargo</option>
                  {CARGOS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={form.regiao} onChange={(e) => setForm({ ...form, regiao: e.target.value })} placeholder="Cidade *" className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white" />
              </div>
              <div className="grid grid-cols-[5.5rem_1fr] gap-2">
                <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} className={`bg-slate-950 border rounded-xl px-2 py-2 text-white ${form.estado ? 'border-white/10' : 'border-amber-500/40'}`}>
                  <option value="">UF *</option>
                  {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                </select>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Telefone (WhatsApp) *" className={`bg-slate-950 border rounded-xl px-3 py-2 text-white ${form.phone.replace(/\D/g, '').length >= 10 ? 'border-white/10' : 'border-amber-500/40'}`} />
              </div>
              <p className="text-[11px] text-slate-500">* Nome, cidade, UF e telefone são obrigatórios (mapa + convite por WhatsApp). Cargo é opcional.</p>
            </div>
            <button onClick={addCandidate} disabled={adding || !form.displayName.trim() || !form.regiao.trim() || !form.estado || form.phone.replace(/\D/g, '').length < 10} className="w-full mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Adicionar
            </button>
          </div>
        </div>
      )}

      {/* Modal: editar candidato */}
      {editFor && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => !editing && setEditFor(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-white">Editar candidato</h4>
              <button onClick={() => setEditFor(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-2">
              <input value={editForm.displayName} onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })} placeholder="Nome do candidato *" className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select value={editForm.cargo} onChange={(e) => setEditForm({ ...editForm, cargo: e.target.value })} className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white">
                  <option value="">Cargo</option>
                  {CARGOS.map((c) => <option key={c} value={c}>{c}</option>)}
                  {editForm.cargo && !CARGOS.includes(editForm.cargo) && <option value={editForm.cargo}>{editForm.cargo}</option>}
                </select>
                <input value={editForm.regiao} onChange={(e) => setEditForm({ ...editForm, regiao: e.target.value })} placeholder="Cidade" className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white" />
              </div>
              <div className="grid grid-cols-[5.5rem_1fr] gap-2">
                <select value={editForm.estado} onChange={(e) => setEditForm({ ...editForm, estado: e.target.value })} className="bg-slate-950 border border-white/10 rounded-xl px-2 py-2 text-white">
                  <option value="">UF</option>
                  {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                </select>
                <input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="Telefone (WhatsApp)" className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white" />
              </div>
            </div>
            <button onClick={saveEdit} disabled={editing || !editForm.displayName.trim()} className="w-full mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2">
              {editing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
            </button>
          </div>
        </div>
      )}

      {/* Modal: importar planilha (cola simples OU organizada por IA) */}
      {importOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => !importing && !aiParsing && closeImport()}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-white">Importar candidatos</h4>
              <button onClick={closeImport} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>

            {/* Resumo pós-import (dedup) — substitui o formulário quando concluído */}
            {importSummary ? (
              <div className="text-center py-4">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                <p className="text-white font-bold mb-1">{importSummary.created} candidato(s) importado(s)</p>
                <div className="text-sm text-slate-400 space-y-0.5">
                  {importSummary.duplicates > 0 && <p>⏭️ {importSummary.duplicates} já existiam (ignorados)</p>}
                  {importSummary.invalid > 0 && <p>⚠️ {importSummary.invalid} sem nome (ignorados)</p>}
                  {importSummary.created === 0 && importSummary.duplicates > 0 && <p className="text-amber-300">Todos já estavam cadastrados.</p>}
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => { setImportSummary(null); setImportText(''); }} className="flex-1 bg-white/5 hover:bg-white/10 rounded-xl px-4 py-2.5 font-bold text-slate-200 text-sm">Importar mais</button>
                  <button onClick={closeImport} className="flex-1 bg-indigo-600 hover:bg-indigo-500 rounded-xl px-4 py-2.5 font-bold text-sm">Concluído</button>
                </div>
              </div>
            ) : (<>
            {/* Seletor de modo */}
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 border border-white/10 rounded-xl mb-3">
              {([['manual', 'Colar simples'], ['ia', '🤖 Organizar com IA']] as const).map(([m, label]) => (
                <button key={m} onClick={() => { setImportMode(m); setAiPreview(null); setAiError(null); setAiFile(null); }}
                  className={`text-xs font-bold py-2 rounded-lg transition-colors ${importMode === m ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>{label}</button>
              ))}
            </div>

            {importMode === 'manual' ? (
              <>
                <p className="text-xs text-slate-400 mb-2">Cole uma linha por candidato, separando por vírgula:<br /><span className="text-slate-500">Nome, Cargo, Cidade, Estado (UF), Telefone</span></p>
                <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={8}
                  placeholder={'João Silva, Vereador, Niterói, RJ, 21999990000\nMaria Souza, Prefeita, São Gonçalo, RJ, 21988880000'}
                  className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white text-sm font-mono" />
                <p className="text-[11px] text-slate-500 mt-1">O partido pode ter candidatos em qualquer estado do Brasil. Se não informar a UF, importa sem estado (você edita depois).</p>
                <button onClick={importRows} disabled={importing || !importText.trim()} className="w-full mt-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2">
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Importar candidatos
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-slate-400 mb-2">Arraste um arquivo (CSV, Excel, PDF ou foto da lista) <b>ou</b> cole a planilha do jeito que ela está. A IA acha sozinha o nome, cargo, cidade, UF e telefone, limpa o resto, e você confere antes de salvar.</p>

                {/* Zona de arrastar/soltar arquivo */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleDroppedFile(f); }}
                  className={`mb-2 rounded-xl border border-dashed px-3 py-4 text-center transition-colors ${dragOver ? 'border-fuchsia-400 bg-fuchsia-500/10' : 'border-white/15 bg-slate-950/50'}`}
                >
                  {aiFile ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-emerald-300">
                      <FileText className="w-4 h-4" /> {aiFile.name}
                      <button onClick={() => setAiFile(null)} className="text-slate-400 hover:text-rose-400"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-5 h-5 text-slate-500 mx-auto mb-1" />
                      <p className="text-xs text-slate-400">Arraste o arquivo aqui ou{' '}
                        <label className="text-fuchsia-400 hover:text-fuchsia-300 underline cursor-pointer">
                          escolha
                          <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,image/*" className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleDroppedFile(f); e.currentTarget.value = ''; }} />
                        </label>
                      </p>
                      <p className="text-[10px] text-slate-600 mt-0.5">CSV · Excel · PDF · imagem</p>
                    </>
                  )}
                </div>

                {!aiFile && (
                  <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={6} disabled={aiParsing}
                    placeholder={'…ou cole aqui (copie direto do Excel/Google Sheets)\nNome\tCPF\tCargo\tCidade\tUF\tWhatsApp\tObs\nJoão Silva\t000...\tVereador\tNiterói\tRJ\t21999990000\tamigo do diretório'}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white text-sm font-mono disabled:opacity-60" />
                )}

                {!aiPreview && (
                  <button onClick={parseWithAI} disabled={aiParsing || (!importText.trim() && !aiFile)} className="w-full mt-3 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2">
                    {aiParsing ? <><Loader2 className="w-4 h-4 animate-spin" /> Organizando…</> : <><Sparkles className="w-4 h-4" /> Organizar com IA</>}
                  </button>
                )}
                {aiError && <p className="text-xs text-rose-400 mt-2">{aiError}</p>}

                {/* Preview EDITÁVEL do que a IA extraiu (#147e) */}
                {aiPreview && aiPreview.length > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-bold text-emerald-300">✅ {aiPreview.length} candidato(s) — confira e corrija se precisar:</p>
                      <button onClick={() => { setAiPreview(null); setAiIgnored([]); }} className="text-[11px] text-slate-400 hover:text-white underline">Refazer</button>
                    </div>
                    {aiIgnored.length > 0 && (
                      <p className="text-[11px] text-slate-500 mb-1.5">Colunas ignoradas: {aiIgnored.join(', ')}.</p>
                    )}
                    {Object.keys(aiDecisions).length > 0 && (
                      <p className="text-[11px] text-emerald-300 mb-1.5">✔️ {Object.keys(aiDecisions).length} grupo{Object.keys(aiDecisions).length > 1 ? 's' : ''} de duplicatas resolvido{Object.keys(aiDecisions).length > 1 ? 's' : ''}.</p>
                    )}
                    <div className="max-h-64 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
                      {aiPreview.map((c, i) => (
                        <div key={i} className="p-2 flex items-start gap-1.5">
                          <div className="flex-1 grid grid-cols-2 gap-1">
                            <input value={c.displayName} onChange={(e) => updatePreviewRow(i, 'displayName', e.target.value)} placeholder="Nome *"
                              className="col-span-2 bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-[12px] text-white" />
                            <input value={c.cargo} onChange={(e) => updatePreviewRow(i, 'cargo', e.target.value)} placeholder="Cargo"
                              className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200" />
                            <input value={c.regiao} onChange={(e) => updatePreviewRow(i, 'regiao', e.target.value)} placeholder="Cidade"
                              className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200" />
                            <select value={UFS.includes(c.estado) ? c.estado : ''} onChange={(e) => updatePreviewRow(i, 'estado', e.target.value)}
                              className="bg-slate-950 border border-white/10 rounded-lg px-1 py-1 text-[11px] text-slate-200">
                              <option value="">UF</option>
                              {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                            </select>
                            <input value={c.phone} onChange={(e) => updatePreviewRow(i, 'phone', e.target.value)} placeholder="Telefone"
                              className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200" />
                            <input value={c.valor} onChange={(e) => updatePreviewRow(i, 'valor', e.target.value)} placeholder="Valor R$ (repasse)"
                              className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-emerald-200" />
                            <input type="date" value={c.data} onChange={(e) => updatePreviewRow(i, 'data', e.target.value)}
                              className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-emerald-200" title="Data do repasse" />
                          </div>
                          <button onClick={() => removePreviewRow(i)} title="Remover" className="p-1 text-slate-500 hover:text-rose-400 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                    </div>
                    <button onClick={importParsed} disabled={importing || !aiPreview.some((c) => c.displayName.trim())} className="w-full mt-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2">
                      {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Confirmar e importar {aiPreview.filter((c) => c.displayName.trim()).length}
                    </button>
                    <p className="text-[10px] text-slate-500 mt-1.5 text-center">A IA só organiza — nada é salvo até você confirmar. Duplicados são ignorados automaticamente.</p>
                  </div>
                )}
              </>
            )}
            </>)}
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

            {repasseFor.repasseStatus && repasseFor.repasseStatus !== 'liberado' && (
              <div className={`mb-3 rounded-xl p-3 text-xs border ${VALVE_META[repasseFor.repasseStatus]?.cls}`}>
                {VALVE_META[repasseFor.repasseStatus]?.emoji} Atenção: você marcou o repasse deste candidato como <b>{repasseFor.repasseStatus === 'retido' ? 'SEGURADO' : 'CORTADO'}</b>{repasseFor.valveNote ? ` (${repasseFor.valveNote})` : ''}. Registrar mesmo assim ficará no histórico.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
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

            {/* Repasse recorrente (#147): repete sozinho até a eleição */}
            <div className={`rounded-xl border p-3 mb-3 transition-colors ${repRecurring ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-slate-950 border-white/10'}`}>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked={repRecurring} onChange={(e) => setRepRecurring(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-indigo-500" />
                <span>
                  <span className="text-sm font-bold text-white flex items-center gap-1.5">🔁 Repetir este repasse automaticamente</span>
                  <span className="block text-[11px] text-slate-400 mt-0.5">O mesmo valor é lançado sozinho na frequência escolhida — você não precisa refazer o formulário todo mês.</span>
                </span>
              </label>
              {repRecurring && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Frequência</label>
                    <select value={repFreq} onChange={(e) => setRepFreq(e.target.value as any)}
                      className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                      <option value="mensal">Mensal</option>
                      <option value="quinzenal">Quinzenal (15 dias)</option>
                      <option value="semanal">Semanal</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Repetir até (opcional)</label>
                    <input type="date" value={repUntil} onChange={(e) => setRepUntil(e.target.value)}
                      className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
                  </div>
                  <p className="sm:col-span-2 text-[11px] text-indigo-300">
                    Próximo lançamento automático: <b>{new Date(nextOccurrence(/^\d{4}-\d{2}-\d{2}$/.test(repForm.data) ? repForm.data : new Date().toISOString().slice(0, 10), repFreq) + 'T00:00:00').toLocaleDateString('pt-BR')}</b>
                    {repUntil ? ` · até ${new Date(repUntil + 'T00:00:00').toLocaleDateString('pt-BR')}` : ' · até você cancelar'}.
                    {' '}Se a válvula deste candidato estiver segurada/cortada, o repasse pausa sozinho.
                  </p>
                </div>
              )}
            </div>

            <button onClick={saveRepasse} disabled={savingRep || !(total > 0)} className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2">
              {savingRep ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />} {repRecurring ? 'Registrar + agendar repasse' : 'Registrar repasse'}
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
              <div className="min-w-0 flex items-center gap-2">
                <ScoreChip s={proofFor.score} size="md" />
                <div className="min-w-0">
                  <h4 className="font-bold text-white truncate">{proofFor.displayName}</h4>
                  <p className="text-xs text-slate-400">Comprovação de campo</p>
                </div>
              </div>
              <button onClick={() => setProofFor(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>

            {/* Por que esse score — os alertas do motor anti-fraude */}
            {proofFor.score && proofFor.score.reasons.length > 0 && (
              <div className="mb-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300 mb-1">Pontos de atenção</p>
                <ul className="space-y-0.5">
                  {proofFor.score.reasons.map((r, i) => <li key={i} className="text-xs text-amber-100/90 flex gap-1.5"><span>•</span><span>{r}</span></li>)}
                </ul>
              </div>
            )}
            {proofFor.score && proofFor.score.reasons.length === 0 && (
              <div className="mb-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-3 text-xs text-emerald-200 font-bold">✅ Tudo em dia — comprovação completa e contas alocadas.</div>
            )}

            {/* VÁLVULA — decisão do presidente sobre o repasse */}
            <div className="mb-4 bg-slate-950/60 border border-white/10 rounded-2xl p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Válvula de repasse</p>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${VALVE_META[proofFor.repasseStatus || 'liberado']?.cls}`}>
                  {VALVE_META[proofFor.repasseStatus || 'liberado']?.emoji} {VALVE_META[proofFor.repasseStatus || 'liberado']?.label}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(['liberado', 'retido', 'cortado'] as const).map((d) => (
                  <button key={d} onClick={() => setValve(d)} disabled={!!valveBusy}
                    className={`text-xs font-bold rounded-lg px-2 py-2 border disabled:opacity-50 transition-colors ${
                      proofFor.repasseStatus === d || (!proofFor.repasseStatus && d === 'liberado')
                        ? VALVE_META[d].cls
                        : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}>
                    {d === 'liberado' ? '✅ Liberar' : d === 'retido' ? '⏸️ Segurar' : '⛔ Cortar'}
                  </button>
                ))}
              </div>
              {proofFor.valveNote && <p className="text-[11px] text-slate-400 mt-2">Motivo: {proofFor.valveNote}</p>}
              {proofData?.valveLog && proofData.valveLog.length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/5 space-y-0.5">
                  {proofData.valveLog.slice(0, 4).map((l, i) => (
                    <p key={i} className="text-[10px] text-slate-500">{new Date(l.createdAt).toLocaleString('pt-BR')} — {VALVE_META[l.decision]?.emoji} {l.decision}{l.note ? ` · ${l.note}` : ''}</p>
                  ))}
                </div>
              )}
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
                      {(() => {
                        const fotos = (proofData.committee!.photos && proofData.committee!.photos!.length)
                          ? proofData.committee!.photos! : (proofData.committee!.photo ? [proofData.committee!.photo] : []);
                        return fotos.length
                          ? <div className="grid grid-cols-2 gap-1.5 mb-2">
                              {fotos.map((f, i) => <img key={i} src={f} alt={`comitê ${i + 1}`} onClick={() => setLightbox(f)} className="w-full h-24 object-cover rounded-lg cursor-zoom-in" />)}
                            </div>
                          : <div className="text-xs text-slate-500 mb-2">Sem fotos do comitê.</div>;
                      })()}
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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

      {/* Toast flutuante — feedback visual pra ações (substitui alert()) */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-5 py-3 rounded-2xl border shadow-lg text-sm font-bold flex items-center gap-2 animate-[fadeIn_0.15s_ease-out] ${
          toast.kind === 'ok' ? 'bg-emerald-950 border-emerald-500/40 text-emerald-200' : 'bg-rose-950 border-rose-500/40 text-rose-200'
        }`}>
          {toast.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <X className="w-4 h-4 shrink-0" />}
          {toast.msg}
        </div>
      )}

      {/* Confirm dialog estilizado — substitui window.confirm() */}
      {confirmState && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4" onClick={() => closeConfirm(false)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-bold text-white text-lg mb-1">{confirmState.title}</h4>
            {confirmState.body && <p className="text-sm text-slate-400 mb-4">{confirmState.body}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => closeConfirm(false)} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-300 bg-white/5 hover:bg-white/10">Cancelar</button>
              <button onClick={() => closeConfirm(true)} className={`px-4 py-2 rounded-xl text-sm font-bold text-white ${confirmState.danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}>
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Botão "🕵️ Análise Antifraude IA" — chama o callAgent no servidor pra
 * detectar candidatos absorvendo recurso sem entregar. Mostra os alertas
 * em um painel inline expansível. Custo escondido (regra #111).
 */
const AntifraudButton: React.FC = () => {
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<{ analyzedAt: string; alerts: any[]; candidatesAnalyzed: number } | null>(null);
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null);
    try {
      const r = await authedFetch('/api/v1/party/antifraud-analysis', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Falha na análise');
      setResult(j); setOpen(true);
    } catch (e: any) { setError(e?.message || 'Erro'); }
    finally { setLoading(false); }
  };

  const priorityCls = (p: string) =>
    p === 'alta' ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
    : p === 'media' ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500">Auditoria assistida</p>
          <p className="text-sm text-slate-300">Análise antifraude cruza repasse × atividade × score.</p>
        </div>
        <button onClick={run} disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2">
          {loading ? '🔄 Analisando…' : '🕵️ Análise Antifraude IA'}
        </button>
      </div>
      {error && <p className="text-xs text-rose-400 mt-2">{error}</p>}
      {result && open && (
        <div className="mt-3 bg-slate-900/60 border border-white/10 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              {result.candidatesAnalyzed} candidatos · {new Date(result.analyzedAt).toLocaleString('pt-BR')}
            </p>
            <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white text-xs">Fechar</button>
          </div>
          {result.alerts.length === 0 ? (
            <p className="text-xs text-slate-500 italic">Sem alertas — partido em ordem.</p>
          ) : result.alerts.map((a, i) => (
            <div key={i} className={`border rounded-xl p-3 ${priorityCls(a.priority)}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-black uppercase tracking-wider">
                  {a.priority} · {a.pattern}
                </p>
                <p className="text-[10px] font-mono opacity-70">{a.candidateId?.slice(0, 8)}…</p>
              </div>
              <p className="text-xs mt-1.5">{a.justification}</p>
              <p className="text-[11px] mt-1.5 font-bold">→ {a.suggested_action}</p>
            </div>
          ))}
          <p className="text-[10px] text-slate-600 pt-2 border-t border-white/5">
            Sugestões são da IA. Decisão final é sua — use a válvula no card do candidato para liberar/segurar/cortar repasse.
          </p>
        </div>
      )}
    </div>
  );
};

export default PartyPresidentPage;
