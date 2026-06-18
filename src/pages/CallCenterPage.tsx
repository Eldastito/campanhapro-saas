import * as React from 'react';
import {
  Headset, Loader2, LogOut, Clock, Send, CheckCircle2, RotateCcw,
  Users, Plus, Link2, Check, MessageCircle, Sparkles, Inbox,
} from 'lucide-react';
import { authedFetch } from '../lib/authedFetch';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';
import CallCenterReports from '../components/callcenter/CallCenterReports';

/**
 * Estação de trabalho do CALL CENTER (Líder + Operador de telemarketing).
 *
 * - FILA: conversas aguardando humano (mais antigas primeiro) → botão Assumir.
 * - MEUS ATENDIMENTOS: conversas que EU assumi (IA pausada).
 * - CHAT: histórico + responder; card "Transição Invisível" com o resumo da IA.
 * - LÍDER: além da fila, gerencia a equipe (convida operadores por link).
 *
 * Tempo real: Supabase Broadcast no canal callcenter-<campaignId> (mesmo padrão
 * do telão do partido) — a fila atualiza sozinha quando entra eleitor novo.
 */
interface Convo {
  id: string; channel: string; externalId: string; contactId: string | null;
  stage: string; priority: string; lastInboundAt: string | null;
  assignedUserId: string | null; aiPaused?: boolean;
  handoffSummary?: string | null; handoffReason?: string | null;
  whatsappInstanceId?: string | null;
}
interface Msg { id: string; direction: 'inbound' | 'outbound'; body: string; createdAt: string; }
interface Invite { id: string; displayName: string; role: string; token: string; status: string; }

const waitTime = (iso?: string | null) => {
  if (!iso) return '—';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
};

const CallCenterPage: React.FC = () => {
  const { user, logout } = useAuth();
  const isLeader = user?.type === 'Líder Call Center';
  const [mode, setMode] = React.useState<'receptivo' | 'ativo' | 'relatorios'>('receptivo');
  const [waiting, setWaiting] = React.useState<Convo[]>([]);
  const [mine, setMine] = React.useState<Convo[]>([]);
  const [selected, setSelected] = React.useState<Convo | null>(null);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msgFlash, setMsgFlash] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  // equipe (líder)
  const [teamOpen, setTeamOpen] = React.useState(false);
  const [invites, setInvites] = React.useState<Invite[]>([]);
  const [newName, setNewName] = React.useState('');
  const [copied, setCopied] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const flash = (t: string) => { setMsgFlash(t); setTimeout(() => setMsgFlash(null), 3500); };

  const loadQueue = React.useCallback(async () => {
    try {
      const r = await authedFetch('/api/v1/callcenter/queue');
      if (r.ok) {
        const j = await r.json();
        setWaiting(j.waiting || []); setMine(j.mine || []);
        // mantém a seleção atualizada
        setSelected((cur) => cur ? ([...(j.mine || []), ...(j.waiting || [])].find((c: Convo) => c.id === cur.id) || cur) : cur);
      }
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  const loadMessages = React.useCallback(async (convoId: string) => {
    try {
      const r = await authedFetch(`/api/v1/channels/conversations/${convoId}/messages`);
      if (r.ok) { const j = await r.json(); setMessages(j.messages || []); }
    } catch { /* */ }
  }, []);

  React.useEffect(() => { loadQueue(); }, [loadQueue]);
  React.useEffect(() => { if (selected?.id) loadMessages(selected.id); }, [selected?.id, loadMessages]);
  React.useEffect(() => { scrollRef.current?.scrollTo({ top: 999999 }); }, [messages]);

  // Tempo real: fila + novas mensagens chegam por Broadcast.
  React.useEffect(() => {
    if (!user?.campaignId) return;
    const ch = supabase.channel(`callcenter-${user.campaignId}`)
      .on('broadcast', { event: 'queue_changed' }, () => loadQueue())
      .on('broadcast', { event: 'new_message' }, (p: any) => {
        loadQueue();
        const cid = p?.payload?.conversationId;
        setSelected((cur) => { if (cur && cid === cur.id) loadMessages(cur.id); return cur; });
      })
      .subscribe();
    const safety = setInterval(loadQueue, 60_000); // rede de segurança
    return () => { supabase.removeChannel(ch); clearInterval(safety); };
  }, [user?.campaignId, loadQueue, loadMessages]);

  const assumir = async (c: Convo) => {
    setBusy(c.id);
    try {
      const r = await authedFetch(`/api/v1/callcenter/assume/${c.id}`, { method: 'POST' });
      const j = await r.json();
      if (r.ok) { flash('✅ Atendimento assumido — a IA pausou.'); setSelected({ ...c, stage: 'em_atendimento_humano', handoffSummary: j.summary || c.handoffSummary }); await loadQueue(); }
      else flash(`⚠️ ${j.detail || j.error || 'Não foi possível assumir.'}`);
    } catch { flash('Erro de conexão.'); } finally { setBusy(null); }
  };

  const devolver = async (c: Convo) => {
    setBusy(c.id);
    try {
      const r = await authedFetch(`/api/v1/callcenter/release/${c.id}`, { method: 'POST' });
      if (r.ok) { flash('↩️ Devolvido.'); setSelected(null); await loadQueue(); }
    } catch { /* */ } finally { setBusy(null); }
  };

  const encerrar = async (c: Convo) => {
    if (!window.confirm('Encerrar este atendimento?')) return;
    setBusy(c.id);
    try {
      const r = await authedFetch(`/api/v1/callcenter/close/${c.id}`, { method: 'POST' });
      if (r.ok) { flash('✅ Atendimento encerrado.'); setSelected(null); await loadQueue(); }
    } catch { /* */ } finally { setBusy(null); }
  };

  const send = async () => {
    if (!selected || !input.trim()) return;
    setBusy('send');
    try {
      const r = await authedFetch('/api/v1/channels/send', {
        method: 'POST',
        body: JSON.stringify({
          channel: selected.channel || 'whatsapp', to: selected.externalId,
          text: input.trim(), contactId: selected.contactId || undefined,
          whatsappInstanceId: selected.whatsappInstanceId || undefined,
        }),
      });
      if (r.ok) { setInput(''); await loadMessages(selected.id); }
      else { const j = await r.json().catch(() => ({})); flash(`⚠️ ${j.error || 'Falha ao enviar.'}`); }
    } catch { flash('Erro de conexão.'); } finally { setBusy(null); }
  };

  // ----- equipe (líder) -----
  const loadInvites = React.useCallback(async () => {
    try { const r = await authedFetch('/api/v1/callcenter/invites'); if (r.ok) { const j = await r.json(); setInvites(j.invites || []); } } catch { /* */ }
  }, []);
  React.useEffect(() => { if (teamOpen) loadInvites(); }, [teamOpen, loadInvites]);

  const createInvite = async () => {
    if (!newName.trim()) return;
    const r = await authedFetch('/api/v1/callcenter/invites', {
      method: 'POST', body: JSON.stringify({ displayName: newName.trim(), role: 'Operador Call Center' }),
    });
    if (r.ok) { setNewName(''); await loadInvites(); }
  };
  const copyInvite = (token: string) => {
    navigator.clipboard?.writeText(`${window.location.origin}/cadastro/callcenter/${token}`)
      .then(() => { setCopied(token); setTimeout(() => setCopied(null), 1500); }, () => {});
  };

  if (loading) return <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white font-sans p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2"><Headset className="w-6 h-6 text-indigo-400 shrink-0" /> Central de Atendimento</h1>
          <p className="text-xs text-slate-400 truncate">{user?.name} · {user?.type}</p>
        </div>
        <div className="flex gap-2">
          {/* Receptivo (entra eleitor) × Ativo (operador liga a lista) */}
          <div className="flex rounded-xl bg-white/5 p-0.5">
            <button onClick={() => setMode('receptivo')} className={`px-3 py-1.5 rounded-lg text-sm font-bold ${mode === 'receptivo' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Receptivo</button>
            <button onClick={() => setMode('ativo')} className={`px-3 py-1.5 rounded-lg text-sm font-bold ${mode === 'ativo' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>📞 Ativo</button>
            {isLeader && <button onClick={() => setMode('relatorios')} className={`px-3 py-1.5 rounded-lg text-sm font-bold ${mode === 'relatorios' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>📊 Relatórios</button>}
          </div>
          {isLeader && mode === 'receptivo' && (
            <button onClick={() => setTeamOpen(!teamOpen)} className={`px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 ${teamOpen ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-300'}`}>
              <Users className="w-4 h-4" /> Equipe
            </button>
          )}
          <button onClick={() => logout?.()} className="bg-white/5 hover:bg-white/10 px-3 py-2 rounded-xl text-slate-300" title="Sair"><LogOut className="w-4 h-4" /></button>
        </div>
      </div>

      {msgFlash && <div className="mb-4 text-sm bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 rounded-xl px-3 py-2">{msgFlash}</div>}

      {/* Equipe (líder) */}
      {isLeader && teamOpen && (
        <div className="mb-5 bg-[#1c2128] border border-white/5 rounded-3xl p-4">
          <p className="font-bold mb-2 flex items-center gap-2"><Users className="w-4 h-4 text-indigo-300" /> Convidar operador</p>
          <div className="flex gap-2 mb-3">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome do operador" className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white text-sm" />
            <button onClick={createInvite} disabled={!newName.trim()} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-1.5"><Plus className="w-4 h-4" /> Gerar link</button>
          </div>
          <div className="space-y-1.5">
            {invites.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-2 text-sm bg-slate-950/60 rounded-xl px-3 py-2">
                <span className="truncate">{i.displayName} <span className="text-[11px] text-slate-500">· {i.status === 'used' ? '✅ cadastrado' : i.status === 'revoked' ? 'revogado' : 'pendente'}</span></span>
                {i.status === 'pending' && (
                  <button onClick={() => copyInvite(i.token)} className="text-xs flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 shrink-0">
                    {copied === i.token ? <><Check className="w-3 h-3 text-emerald-400" /> Copiado</> : <><Link2 className="w-3 h-3" /> Link</>}
                  </button>
                )}
              </div>
            ))}
            {invites.length === 0 && <p className="text-xs text-slate-500">Nenhum convite ainda.</p>}
          </div>
        </div>
      )}

      {mode === 'ativo' && <ActiveTelemarketingPanel isLeader={isLeader} flash={flash} />}

      {mode === 'relatorios' && (
        <div className="bg-[#1c2128] border border-white/5 rounded-3xl p-4 sm:p-6 max-w-3xl mx-auto">
          <CallCenterReports />
        </div>
      )}

      {mode === 'receptivo' && (
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* Coluna fila + meus */}
        <div className="space-y-4">
          <div className="bg-[#1c2128] border border-white/5 rounded-3xl p-4">
            <p className="font-bold text-sm mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2"><Inbox className="w-4 h-4 text-amber-300" /> Fila de espera</span>
              <span className="text-xs bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded-full">{waiting.length}</span>
            </p>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {waiting.map((c) => (
                <button key={c.id} onClick={() => setSelected(c)}
                  className={`w-full text-left rounded-xl px-3 py-2 text-sm border transition-colors ${selected?.id === c.id ? 'bg-indigo-600/20 border-indigo-500/40' : 'bg-slate-950/60 border-transparent hover:border-white/10'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold truncate">📱 {c.externalId}</span>
                    <span className="text-[11px] text-amber-300 flex items-center gap-1 shrink-0"><Clock className="w-3 h-3" /> {waitTime(c.lastInboundAt)}</span>
                  </div>
                  {c.handoffReason && <p className="text-[11px] text-slate-400 truncate mt-0.5">{c.handoffReason}</p>}
                </button>
              ))}
              {waiting.length === 0 && <p className="text-xs text-slate-500 py-3 text-center">Fila vazia 🎉</p>}
            </div>
          </div>

          <div className="bg-[#1c2128] border border-white/5 rounded-3xl p-4">
            <p className="font-bold text-sm mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2"><MessageCircle className="w-4 h-4 text-emerald-300" /> Meus atendimentos</span>
              <span className="text-xs bg-emerald-500/15 text-emerald-300 px-2 py-0.5 rounded-full">{mine.length}</span>
            </p>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {mine.map((c) => (
                <button key={c.id} onClick={() => setSelected(c)}
                  className={`w-full text-left rounded-xl px-3 py-2 text-sm border transition-colors ${selected?.id === c.id ? 'bg-indigo-600/20 border-indigo-500/40' : 'bg-slate-950/60 border-transparent hover:border-white/10'}`}>
                  <span className="font-bold">📱 {c.externalId}</span>
                </button>
              ))}
              {mine.length === 0 && <p className="text-xs text-slate-500 py-3 text-center">Assuma uma conversa da fila.</p>}
            </div>
          </div>
        </div>

        {/* Chat */}
        <div className="bg-[#1c2128] border border-white/5 rounded-3xl flex flex-col min-h-[480px]">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm p-8 text-center">Selecione uma conversa na fila para ver o histórico e assumir o atendimento.</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/5">
                <div className="min-w-0">
                  <p className="font-bold truncate">📱 {selected.externalId}</p>
                  <p className="text-[11px] text-slate-500">{selected.stage === 'em_atendimento_humano' ? '🧑 você está atendendo · IA pausada' : selected.stage === 'aguardando_humano' ? '⏳ aguardando atendimento' : selected.stage}</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {selected.stage !== 'em_atendimento_humano' ? (
                    <button onClick={() => assumir(selected)} disabled={busy === selected.id}
                      className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1.5">
                      {busy === selected.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Headset className="w-3.5 h-3.5" />} Assumir
                    </button>
                  ) : (
                    <>
                      <button onClick={() => devolver(selected)} disabled={busy === selected.id} title="Devolver"
                        className="bg-white/5 hover:bg-white/10 px-2.5 py-1.5 rounded-lg text-sm"><RotateCcw className="w-3.5 h-3.5" /></button>
                      <button onClick={() => encerrar(selected)} disabled={busy === selected.id} title="Encerrar"
                        className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 px-2.5 py-1.5 rounded-lg text-sm flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Encerrar</button>
                    </>
                  )}
                </div>
              </div>

              {/* TRANSIÇÃO INVISÍVEL — resumo da IA pra quem assume */}
              {selected.handoffSummary && (
                <div className="mx-4 mt-3 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-300 mb-1 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Contexto do eleitor (resumo da IA)</p>
                  <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{selected.handoffSummary}</p>
                </div>
              )}

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.map((m) => (
                  <div key={m.id} className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.direction === 'inbound' ? 'bg-slate-800 mr-auto' : 'bg-indigo-600/70 ml-auto'}`}>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className="text-[10px] opacity-50 mt-1">{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                ))}
                {messages.length === 0 && <p className="text-xs text-slate-500 text-center py-6">Sem mensagens ainda.</p>}
              </div>

              <div className="p-3 border-t border-white/5 flex gap-2">
                <input value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={selected.stage === 'em_atendimento_humano' ? 'Escreva sua resposta…' : 'Assuma a conversa para responder'}
                  disabled={selected.stage !== 'em_atendimento_humano' || busy === 'send'}
                  className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm disabled:opacity-50" />
                <button onClick={send} disabled={selected.stage !== 'em_atendimento_humano' || !input.trim() || busy === 'send'}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 rounded-xl font-bold">
                  {busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
};

// ───────────────────────── TELEMARKETING ATIVO (F4) ─────────────────────────
interface ActiveCampaign {
  id: string; name: string; script: string | null; status: string;
  counts: { total: number; pendente: number; concluido: number; sem_resposta: number; em_andamento: number; retorno: number };
}
interface ActiveTarget {
  id: string; phone: string | null; name: string | null; attempts: number; status: string;
}
const DISPOSITIONS = ['Interessado', 'Vai votar', 'Indeciso', 'Recusou', 'Agendar retorno', 'Número errado'];

const ActiveTelemarketingPanel: React.FC<{ isLeader: boolean; flash: (t: string) => void }> = ({ isLeader, flash }) => {
  const [campaigns, setCampaigns] = React.useState<ActiveCampaign[]>([]);
  const [selected, setSelected] = React.useState<ActiveCampaign | null>(null);
  const [target, setTarget] = React.useState<ActiveTarget | null>(null);
  const [script, setScript] = React.useState('');
  const [disposition, setDisposition] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newScript, setNewScript] = React.useState('');

  const load = React.useCallback(async () => {
    try {
      const r = await authedFetch('/api/v1/callcenter/active');
      if (r.ok) { const j = await r.json(); setCampaigns(j.campaigns || []); }
    } catch { /* */ }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const createCampaign = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const r = await authedFetch('/api/v1/callcenter/active', {
        method: 'POST', body: JSON.stringify({ name: newName.trim(), script: newScript.trim() || undefined }),
      });
      if (r.ok) { const j = await r.json(); flash(`✅ Campanha criada — ${j.seeded} contatos na fila.`); setNewName(''); setNewScript(''); setCreating(false); await load(); }
      else { const j = await r.json().catch(() => ({})); flash(`⚠️ ${j.error || 'Falha ao criar.'}`); }
    } finally { setBusy(false); }
  };

  const pullNext = async (camp: ActiveCampaign) => {
    setBusy(true); setTarget(null); setDisposition(''); setNotes('');
    try {
      const r = await authedFetch(`/api/v1/callcenter/active/${camp.id}/next`, { method: 'POST' });
      const j = await r.json();
      if (r.ok && j.target) { setTarget(j.target); setScript(j.script || camp.script || ''); }
      else if (j.done) { flash('🎉 Lista concluída — sem contatos pendentes.'); await load(); }
      else flash(`⚠️ ${j.error || 'Sem contato disponível.'}`);
    } catch { flash('Erro de conexão.'); } finally { setBusy(false); }
  };

  const saveResult = async (status: 'concluido' | 'sem_resposta' | 'retorno') => {
    if (!target || !selected) return;
    setBusy(true);
    try {
      await authedFetch(`/api/v1/callcenter/active/targets/${target.id}/result`, {
        method: 'POST', body: JSON.stringify({ status, disposition: disposition || undefined, notes: notes || undefined }),
      });
      setTarget(null);
      await pullNext(selected); // já puxa o próximo
    } finally { setBusy(false); }
  };

  const waLink = (phone: string | null) => phone ? `https://wa.me/${phone.replace(/\D+/g, '')}` : '#';
  const pct = (c: ActiveCampaign) => c.counts.total ? Math.round((c.counts.concluido + c.counts.sem_resposta) / c.counts.total * 100) : 0;

  // Detalhe de uma campanha selecionada (área de trabalho do operador)
  if (selected) {
    return (
      <div className="bg-[#1c2128] border border-white/5 rounded-3xl p-4 sm:p-6 max-w-2xl mx-auto">
        <button onClick={() => { setSelected(null); setTarget(null); }} className="text-xs text-slate-400 hover:text-white mb-3">← Voltar às campanhas</button>
        <h2 className="text-lg font-black mb-1">{selected.name}</h2>
        <p className="text-xs text-slate-400 mb-4">
          {selected.counts.pendente} pendentes · {selected.counts.concluido} concluídos · {selected.counts.sem_resposta} sem resposta · {selected.counts.retorno} retorno
        </p>

        {!target ? (
          <button onClick={() => pullNext(selected)} disabled={busy || selected.counts.pendente === 0}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-2xl px-4 py-3 font-bold flex items-center justify-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {selected.counts.pendente === 0 ? 'Sem contatos pendentes' : 'Próximo contato'}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="bg-slate-950/60 rounded-2xl p-4">
              <p className="text-lg font-black">{target.name || 'Contato'}</p>
              <p className="text-sm text-slate-300">📱 {target.phone}{target.attempts > 1 ? ` · tentativa ${target.attempts}` : ''}</p>
              <a href={waLink(target.phone)} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 mt-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl px-3 py-2 text-sm font-bold">
                <MessageCircle className="w-4 h-4" /> Abrir no WhatsApp
              </a>
            </div>

            {script && (
              <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-2xl p-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-300 mb-1">📋 Script</p>
                <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{script}</p>
              </div>
            )}

            <div>
              <p className="text-xs font-bold text-slate-400 mb-1.5">Resultado</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {DISPOSITIONS.map((d) => (
                  <button key={d} onClick={() => setDisposition(d)}
                    className={`text-xs px-2.5 py-1 rounded-full border ${disposition === d ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white/5 border-white/10 text-slate-300'}`}>{d}</button>
                ))}
              </div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Observações (opcional)"
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white text-sm mb-2" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => saveResult('concluido')} disabled={busy}
                className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 rounded-xl px-2 py-2.5 text-sm font-bold flex items-center justify-center gap-1"><CheckCircle2 className="w-4 h-4" /> Concluir</button>
              <button onClick={() => saveResult('sem_resposta')} disabled={busy}
                className="bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl px-2 py-2.5 text-sm font-bold">Sem resposta</button>
              <button onClick={() => saveResult('retorno')} disabled={busy}
                className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 rounded-xl px-2 py-2.5 text-sm font-bold flex items-center justify-center gap-1"><RotateCcw className="w-4 h-4" /> Retorno</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Lista de campanhas + criar (líder)
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {isLeader && (
        <div className="bg-[#1c2128] border border-white/5 rounded-3xl p-4">
          {!creating ? (
            <button onClick={() => setCreating(true)} className="w-full text-sm font-bold text-indigo-300 flex items-center justify-center gap-2 py-1"><Plus className="w-4 h-4" /> Nova campanha ativa</button>
          ) : (
            <div className="space-y-2">
              <p className="font-bold text-sm">Nova campanha de telemarketing</p>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome (ex.: Pesquisa zona norte)"
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white text-sm" />
              <textarea value={newScript} onChange={(e) => setNewScript(e.target.value)} rows={3} placeholder="Script que o operador vai seguir"
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white text-sm" />
              <p className="text-[11px] text-slate-500">A lista é semeada automaticamente com os contatos do CRM que têm telefone.</p>
              <div className="flex gap-2">
                <button onClick={createCampaign} disabled={!newName.trim() || busy} className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-4 py-2 font-bold text-sm">{busy ? 'Criando…' : 'Criar'}</button>
                <button onClick={() => setCreating(false)} className="bg-white/5 rounded-xl px-4 py-2 text-sm">Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}

      {campaigns.map((c) => (
        <button key={c.id} onClick={() => setSelected(c)}
          className="w-full text-left bg-[#1c2128] border border-white/5 hover:border-indigo-500/40 rounded-3xl p-4 transition-colors">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="font-bold">{c.name}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${c.status === 'ativa' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-400'}`}>{c.status}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden mb-1.5">
            <div className="h-full bg-indigo-500" style={{ width: `${pct(c)}%` }} />
          </div>
          <p className="text-[11px] text-slate-400">{c.counts.pendente} pendentes · {c.counts.concluido + c.counts.sem_resposta}/{c.counts.total} trabalhados ({pct(c)}%)</p>
        </button>
      ))}
      {campaigns.length === 0 && <p className="text-sm text-slate-500 text-center py-8">Nenhuma campanha ativa.{isLeader ? ' Crie uma acima.' : ' Aguarde o líder criar uma lista.'}</p>}
    </div>
  );
};

export default CallCenterPage;
