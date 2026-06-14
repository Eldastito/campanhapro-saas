/**
 * Config do roteador 2-IAs no WhatsApp (#125).
 *
 * Permite configurar:
 *  - On/off do roteador (default off — preserva fluxo legado)
 *  - Nome da Aurora + tópicos políticos
 *  - Nome do Orquestrador + lista de telefones autorizados
 *  - Nome do Zapp + URL de forward do ZappFlow + segredo HMAC
 *
 * Mostra também log das últimas 50 decisões pra debug.
 */
import React, { useEffect, useState } from 'react';
import { Bot, Plus, X, Save, RefreshCw, Activity, AlertCircle } from 'lucide-react';
import Card from '../ui/Card';
import { supabase } from '../../lib/supabaseClient';

interface Config {
  enabled: boolean;
  voterAgentName: string;
  voterAgentTopics: string[];
  orchestratorWakeWord: string | null;
  orchestratorAuthorizedPhones: string[];
  zapflowWakeWord: string;
  zapflowForwardUrl: string | null;
  zapflowForwardSecretSet: boolean;
}

interface LogEntry {
  id: string;
  remoteJid: string;
  message: string;
  decision: string;
  classification: { intent: string; confidence: number; source: string } | null;
  latencyMs: number | null;
  createdAt: string;
}

async function authFetch(url: string, init: RequestInit = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const r = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

const DECISION_LABELS: Record<string, { label: string; cls: string }> = {
  orchestrator: { label: 'Orquestrador (coordenador)', cls: 'bg-purple-500/20 text-purple-300' },
  aurora: { label: 'Aurora respondeu', cls: 'bg-blue-500/20 text-blue-300' },
  forwarded_zapflow: { label: 'Forward → Zapp', cls: 'bg-orange-500/20 text-orange-300' },
  disambiguation: { label: 'Pediu esclarecimento', cls: 'bg-amber-500/20 text-amber-300' },
  silence: { label: 'Silêncio', cls: 'bg-slate-600/20 text-slate-300' },
  wake_unauthorized: { label: 'Wake sem permissão', cls: 'bg-red-500/20 text-red-300' },
  no_classifier: { label: 'Sem classificador', cls: 'bg-slate-600/20 text-slate-400' },
};

const WhatsappRoutingPanel: React.FC = () => {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const [secretEdit, setSecretEdit] = useState<string>('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const c = await authFetch('/api/v1/whatsapp-routing/config');
      setCfg(c);
      const l = await authFetch('/api/v1/whatsapp-routing/log').catch(() => ({ entries: [] }));
      setLogs(l.entries || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const payload: any = { ...cfg };
      if (secretEdit) payload.zapflowForwardSecret = secretEdit;
      await authFetch('/api/v1/whatsapp-routing/config', {
        method: 'PUT', body: JSON.stringify(payload),
      });
      setSecretEdit('');
      await load();
      alert('Configurações salvas!');
    } catch (err: any) {
      alert('Falha ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const addPhone = () => {
    if (!cfg) return;
    const clean = newPhone.replace(/\D+/g, '');
    if (clean.length < 10) return alert('Telefone inválido (mínimo 10 dígitos com DDD).');
    if (cfg.orchestratorAuthorizedPhones.includes(clean)) return;
    setCfg({ ...cfg, orchestratorAuthorizedPhones: [...cfg.orchestratorAuthorizedPhones, clean] });
    setNewPhone('');
  };

  const removePhone = (p: string) => {
    if (!cfg) return;
    setCfg({ ...cfg, orchestratorAuthorizedPhones: cfg.orchestratorAuthorizedPhones.filter(x => x !== p) });
  };

  const addTopic = () => {
    if (!cfg) return;
    const t = newTopic.trim().toLowerCase();
    if (!t || cfg.voterAgentTopics.includes(t)) return;
    setCfg({ ...cfg, voterAgentTopics: [...cfg.voterAgentTopics, t] });
    setNewTopic('');
  };

  const removeTopic = (t: string) => {
    if (!cfg) return;
    setCfg({ ...cfg, voterAgentTopics: cfg.voterAgentTopics.filter(x => x !== t) });
  };

  if (loading || !cfg) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
          <RefreshCw className="w-4 h-4 animate-spin" /> Carregando configurações...
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-violet-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Roteador 2-IAs (WhatsApp)</h3>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-slate-400">{cfg.enabled ? 'Ativo' : 'Desativado'}</span>
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
              className="w-5 h-5 accent-violet-500"
            />
          </label>
        </div>

        {!cfg.enabled && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-4 text-[11px] text-amber-200/80 flex gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Roteador desativado. O voterBot legado responde tudo. Ative pra rotear entre Aurora (campanha), Zapp (ZappFlow) e Orquestrador.</span>
          </div>
        )}

        {/* AURORA */}
        <Section title="🟢 Aurora — IA da campanha">
          <Field label="Nome">
            <input
              type="text" value={cfg.voterAgentName}
              onChange={(e) => setCfg({ ...cfg, voterAgentName: e.target.value })}
              className="input" placeholder="Aurora"
            />
          </Field>
          <Field label="Tópicos políticos (1 palavra cada)">
            <ChipList items={cfg.voterAgentTopics} onRemove={removeTopic} />
            <div className="flex gap-2 mt-2">
              <input
                type="text" value={newTopic} onChange={(e) => setNewTopic(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTopic())}
                className="input flex-1" placeholder="ex: saude, educacao..."
              />
              <button onClick={addTopic} className="btn-sm"><Plus className="w-3.5 h-3.5" /></button>
            </div>
          </Field>
        </Section>

        {/* ORQUESTRADOR */}
        <Section title="🟣 Orquestrador (coordenador via WhatsApp)">
          <Field label="Palavra-chave que ativa o Orquestrador">
            <input
              type="text" value={cfg.orchestratorWakeWord || ''}
              onChange={(e) => setCfg({ ...cfg, orchestratorWakeWord: e.target.value || null })}
              className="input" placeholder="ex: CampanhaPro"
            />
          </Field>
          <Field label="Telefones autorizados (com DDD)">
            <ChipList items={cfg.orchestratorAuthorizedPhones} onRemove={removePhone} mono />
            <div className="flex gap-2 mt-2">
              <input
                type="text" value={newPhone} onChange={(e) => setNewPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPhone())}
                className="input flex-1" placeholder="ex: 5521999998888"
              />
              <button onClick={addPhone} className="btn-sm"><Plus className="w-3.5 h-3.5" /></button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Só esses telefones podem invocar o Orquestrador. Eleitor comum recebe atendimento da Aurora.
            </p>
          </Field>
        </Section>

        {/* ZAPP / ZAPFLOW */}
        <Section title="🟠 Zapp — IA do negócio (ZappFlow)">
          <Field label="Palavra-chave que aciona o Zapp">
            <input
              type="text" value={cfg.zapflowWakeWord}
              onChange={(e) => setCfg({ ...cfg, zapflowWakeWord: e.target.value })}
              className="input" placeholder="Zapp"
            />
          </Field>
          <Field label="URL do webhook do ZappFlow">
            <input
              type="url" value={cfg.zapflowForwardUrl || ''}
              onChange={(e) => setCfg({ ...cfg, zapflowForwardUrl: e.target.value || null })}
              className="input"
              placeholder="https://zapflowia.tesseractauto.com.br/api/webhooks/evolutiongo"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Quando classificarmos como negócio (ou usuário falar "{cfg.zapflowWakeWord}"), repassamos o payload original pra essa URL.
            </p>
          </Field>
          <Field label={`Segredo HMAC ${cfg.zapflowForwardSecretSet ? '(configurado — deixe vazio pra manter)' : ''}`}>
            <input
              type="password" value={secretEdit}
              onChange={(e) => setSecretEdit(e.target.value)}
              className="input" placeholder={cfg.zapflowForwardSecretSet ? '••••••••' : 'Opcional — header x-campanhapro-signature'}
            />
          </Field>
        </Section>

        <div className="flex justify-end mt-6">
          <button
            onClick={save} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Salvando...' : 'Salvar configurações'}
          </button>
        </div>
      </Card>

      {/* LOG */}
      <Card className="mt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Últimas decisões</h3>
          </div>
          <button onClick={load} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {logs.length === 0 ? (
          <p className="text-xs text-slate-500 italic py-4 text-center">Nenhuma decisão registrada ainda.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {logs.map(l => {
              const d = DECISION_LABELS[l.decision] || { label: l.decision, cls: 'bg-slate-700 text-slate-300' };
              return (
                <div key={l.id} className="bg-slate-900/60 rounded-lg p-3 border border-slate-800">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${d.cls}`}>{d.label}</span>
                    <span className="text-[10px] text-slate-500 font-mono">{l.remoteJid.slice(0, 18)}</span>
                    <span className="text-[10px] text-slate-500 ml-auto">{new Date(l.createdAt).toLocaleString('pt-BR')}</span>
                  </div>
                  <p className="text-xs text-slate-200 truncate">{l.message}</p>
                  {l.classification && (
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Classificou como <b>{l.classification.intent}</b> ({(l.classification.confidence * 100).toFixed(0)}% confiança, {l.classification.source}) · {l.latencyMs}ms
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <style>{`
        .input { width: 100%; background: rgb(2 6 23); border: 1px solid rgb(51 65 85); border-radius: 0.75rem; padding: 0.5rem 0.75rem; color: white; font-size: 0.875rem; outline: none; }
        .input:focus { box-shadow: 0 0 0 2px rgb(139 92 246); }
        .btn-sm { padding: 0.5rem 0.75rem; background: rgb(51 65 85); color: white; border-radius: 0.75rem; transition: all 0.2s; }
        .btn-sm:hover { background: rgb(71 85 105); }
      `}</style>
    </>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-5 pb-5 border-b border-slate-800/60 last:border-0 last:pb-0">
    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">{title}</h4>
    <div className="space-y-3">{children}</div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{label}</label>
    {children}
  </div>
);

const ChipList: React.FC<{ items: string[]; onRemove: (x: string) => void; mono?: boolean }> = ({ items, onRemove, mono }) => (
  <div className="flex flex-wrap gap-1.5">
    {items.length === 0 && <span className="text-[11px] text-slate-500 italic">Nenhum</span>}
    {items.map(item => (
      <span key={item} className={`inline-flex items-center gap-1 px-2 py-1 bg-slate-800 rounded-full text-[11px] text-slate-200 ${mono ? 'font-mono' : ''}`}>
        {item}
        <button onClick={() => onRemove(item)} className="text-slate-500 hover:text-red-400">
          <X className="w-3 h-3" />
        </button>
      </span>
    ))}
  </div>
);

export default WhatsappRoutingPanel;
