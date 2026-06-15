/**
 * ORB Conversacional do Partido (#142) — Fase 2+3 do PRD.
 *
 * Bolinha flutuante no Centro de Comando. Abre um painel de chat onde o
 * presidente pergunta por texto OU voz (Web Speech API). A IA é CONSULTIVA
 * nesta fase (só leitura — total repassado, repasses, pendências, candidatos).
 *
 * Estados: idle | listening | thinking | error.
 * Segurança: backend valida role + escopa tudo ao partido. IA nunca escreve.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send, Mic, Loader2, Bot, User, CheckCircle2, XCircle } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

interface RepasseDraft {
  type: 'create_repasse';
  candidateId: string;
  candidateName: string;
  valor: number;
  descricao: string;
  data: string;
}
interface Msg { role: 'user' | 'assistant'; text: string; draft?: RepasseDraft | null }

// Web Speech API (sem types nativos no TS) — acessa via window com any.
type SpeechRec = any;
function getRecognition(): SpeechRec | null {
  const w = window as any;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = 'pt-BR';
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  return rec;
}

const SUGESTOES = [
  'Qual o total repassado até agora?',
  'Quais os repasses mais recentes?',
  'Quais candidatos estão pendentes?',
  'Quem recebeu mais até agora?',
];

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PartyAIOrb: React.FC<{ onRepasseDone?: () => void }> = ({ onRepasseDone }) => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'listening' | 'thinking' | 'error'>('idle');
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [executing, setExecuting] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setVoiceSupported(!!getRecognition()); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, state]);

  const ask = async (text: string, inputType: 'text' | 'voice' = 'text') => {
    const q = text.trim();
    if (!q || state === 'thinking') return;
    setMsgs((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setState('thinking');
    try {
      const r = await authedFetch('/api/v1/party/ai/command', {
        method: 'POST', body: JSON.stringify({ text: q, inputType }),
      });
      const j = await r.json().catch(() => ({}));
      const reply = j.message || j.error || 'Não consegui responder agora.';
      // Se a IA propôs um lançamento, anexa o draft à mensagem (vira card de confirmação)
      const draft: RepasseDraft | null = j.intent === 'lancar_repasse' && j.draft ? j.draft : null;
      setMsgs((m) => [...m, { role: 'assistant', text: reply, draft }]);
      setState('idle');
    } catch (err: any) {
      setMsgs((m) => [...m, { role: 'assistant', text: 'Erro de conexão. Tente de novo.' }]);
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    }
  };

  // Executa o draft confirmado pelo presidente (reusa o endpoint de repasse existente)
  const confirmDraft = async (draft: RepasseDraft, msgIdx: number) => {
    setExecuting(true);
    try {
      const r = await authedFetch(`/api/v1/party/candidates/${draft.candidateId}/repasses`, {
        method: 'POST',
        body: JSON.stringify({ valor: draft.valor, data: draft.data, descricao: draft.descricao, itens: [] }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setMsgs((m) => [...m, { role: 'assistant', text: `Não consegui lançar: ${j.error || 'erro'}.` }]);
      } else {
        // Remove o draft da mensagem (vira confirmado) + mensagem de sucesso
        setMsgs((m) => m.map((msg, i) => i === msgIdx ? { ...msg, draft: null } : msg)
          .concat({ role: 'assistant', text: `✅ Repasse de ${brl(draft.valor)} lançado para ${draft.candidateName}.` }));
        onRepasseDone?.();
      }
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', text: 'Erro de conexão ao lançar.' }]);
    } finally {
      setExecuting(false);
    }
  };

  const cancelDraft = (msgIdx: number) => {
    setMsgs((m) => m.map((msg, i) => i === msgIdx ? { ...msg, draft: null } : msg)
      .concat({ role: 'assistant', text: 'Ok, cancelei. Nada foi lançado.' }));
  };

  const startVoice = () => {
    const rec = getRecognition();
    if (!rec) return;
    recRef.current = rec;
    setState('listening');
    rec.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript || '';
      if (transcript) ask(transcript, 'voice');
      else setState('idle');
    };
    rec.onerror = () => setState('idle');
    rec.onend = () => { if (state === 'listening') setState('idle'); };
    try { rec.start(); } catch { setState('idle'); }
  };

  const stopVoice = () => { try { recRef.current?.stop(); } catch { /* ok */ } setState('idle'); };

  return (
    <>
      {/* Bolinha flutuante */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600 shadow-xl shadow-indigo-600/40 flex items-center justify-center hover:scale-105 transition-transform animate-pulse-subtle"
          title="Assistente do partido"
        >
          <Sparkles className="w-6 h-6 text-white" />
        </button>
      )}

      {/* Painel de chat */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[calc(100vw-3rem)] sm:w-96 h-[32rem] max-h-[80vh] bg-slate-900 border border-indigo-500/30 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-gradient-to-r from-indigo-600/20 to-fuchsia-600/10">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-white leading-tight">Assistente do Partido</p>
                <p className="text-[10px] text-slate-400 leading-tight">
                  {state === 'listening' ? '🎙️ Ouvindo...' : state === 'thinking' ? 'Pensando...' : 'Consulta · só leitura'}
                </p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
          </div>

          {/* Mensagens */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {msgs.length === 0 && (
              <div className="text-center py-6">
                <Bot className="w-10 h-10 text-indigo-400/50 mx-auto mb-2" />
                <p className="text-xs text-slate-400 mb-3">Pergunte sobre repasses, candidatos e totais do partido.</p>
                <div className="space-y-1.5">
                  {SUGESTOES.map((s) => (
                    <button key={s} onClick={() => ask(s)}
                      className="block w-full text-left text-[11px] bg-slate-800/60 hover:bg-slate-800 text-slate-300 rounded-lg px-3 py-2 transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex flex-col gap-2 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`flex gap-2 w-full ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'assistant' && <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0 mt-0.5"><Bot className="w-3.5 h-3.5 text-indigo-300" /></div>}
                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs whitespace-pre-wrap leading-relaxed ${
                    m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-200'
                  }`}>{m.text}</div>
                  {m.role === 'user' && <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center shrink-0 mt-0.5"><User className="w-3.5 h-3.5 text-slate-300" /></div>}
                </div>
                {/* Card de confirmação de lançamento (Fase 4) */}
                {m.draft && (
                  <div className="ml-8 w-[85%] bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                    <p className="text-[10px] font-bold text-amber-300 uppercase tracking-widest mb-1.5">Confirmar lançamento</p>
                    <div className="text-xs text-slate-200 space-y-0.5 mb-2.5">
                      <p><b>{brl(m.draft.valor)}</b> para <b>{m.draft.candidateName}</b></p>
                      {m.draft.descricao && <p className="text-slate-400">Finalidade: {m.draft.descricao}</p>}
                      <p className="text-slate-500 text-[10px]">Data: {new Date(m.draft.data).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => confirmDraft(m.draft!, i)} disabled={executing}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg">
                        {executing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Confirmar
                      </button>
                      <button onClick={() => cancelDraft(i)} disabled={executing}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-[11px] font-bold rounded-lg">
                        <XCircle className="w-3 h-3" /> Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {state === 'thinking' && (
              <div className="flex gap-2 justify-start">
                <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0"><Bot className="w-3.5 h-3.5 text-indigo-300" /></div>
                <div className="bg-slate-800 rounded-2xl px-3 py-2"><Loader2 className="w-4 h-4 text-indigo-300 animate-spin" /></div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-3 border-t border-white/10">
            <div className="flex items-center gap-2 bg-slate-950 border border-white/10 rounded-xl px-2 py-1.5">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') ask(input); }}
                placeholder="Pergunte algo sobre o partido..."
                disabled={state === 'thinking'}
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600 px-1"
              />
              {voiceSupported && (
                <button
                  onClick={state === 'listening' ? stopVoice : startVoice}
                  className={`p-1.5 rounded-lg transition-colors ${state === 'listening' ? 'bg-red-500/20 text-red-400 animate-pulse' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                  title="Falar"
                >
                  <Mic className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => ask(input)}
                disabled={!input.trim() || state === 'thinking'}
                className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[9px] text-slate-600 mt-1.5 text-center">Assistente automatizado · só consulta (não altera dados)</p>
          </div>
        </div>
      )}
    </>
  );
};

export default PartyAIOrb;
