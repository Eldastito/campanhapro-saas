import React, { useEffect, useState } from 'react';
import {
  Plus, Trash2, Copy, ExternalLink, Loader2, Globe, Power, PowerOff, Check,
} from 'lucide-react';

/**
 * Painel de Formulários Públicos (F5b) — Supreme Admin cria formulários com
 * URL pública (/f/:slug) para captação de leads. Cada submissão vira um
 * contato na campanha. Lista, ativa/desativa, copia link e exclui.
 */

interface Campaign { id: string; name: string; }
interface Props {
  campaigns: Campaign[];
  supremeFetch: (path: string, init?: RequestInit) => Promise<any>;
}

interface PublicForm {
  id: string;
  slug: string;
  title: string;
  description?: string;
  target: string;
  isActive: boolean;
  submissionsCount: number;
  createdAt: string;
}

const TARGET_LABEL: Record<string, string> = { contacts: 'Contatos', visits: 'Visitas', pesquisa: 'Pesquisa' };

const PublicFormsPanel: React.FC<Props> = ({ campaigns, supremeFetch }) => {
  const [selCampaign, setSelCampaign] = useState<string>(campaigns[0]?.id ?? '');
  const [forms, setForms] = useState<PublicForm[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newTarget, setNewTarget] = useState('contacts');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const load = (campaignId: string) => {
    if (!campaignId) return;
    setLoading(true); setError(null);
    supremeFetch(`/forms/${campaignId}/public`)
      .then((r) => setForms(r?.forms || []))
      .catch((e) => setError(e?.message || 'Falha ao carregar'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(selCampaign); /* eslint-disable-next-line */ }, [selCampaign]);

  const create = async () => {
    if (!selCampaign || !newTitle.trim()) return;
    setCreating(true); setError(null);
    try {
      await supremeFetch(`/forms/${selCampaign}/public`, {
        method: 'POST',
        body: JSON.stringify({ title: newTitle.trim(), target: newTarget }),
      });
      setNewTitle('');
      load(selCampaign);
    } catch (e: any) {
      setError(e?.message || 'Falha ao criar');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (f: PublicForm) => {
    setForms((list) => list.map((x) => (x.id === f.id ? { ...x, isActive: !x.isActive } : x)));
    try {
      await supremeFetch(`/public-forms/${f.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !f.isActive }) });
    } catch { load(selCampaign); }
  };

  const remove = async (f: PublicForm) => {
    if (!window.confirm(`Excluir o formulário "${f.title}"? As submissões também serão apagadas.`)) return;
    setForms((list) => list.filter((x) => x.id !== f.id));
    try {
      await supremeFetch(`/public-forms/${f.id}`, { method: 'DELETE' });
    } catch { load(selCampaign); }
  };

  const copyLink = (slug: string) => {
    const url = `${origin}/f/${slug}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(slug);
      setTimeout(() => setCopied((c) => (c === slug ? null : c)), 1500);
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Globe className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-white">Formulários Públicos</h3>
            <p className="text-[11px] text-slate-500">Páginas de captação (/f/slug) — cada envio vira um contato.</p>
          </div>
        </div>
        <select
          value={selCampaign}
          onChange={(e) => setSelCampaign(e.target.value)}
          className="bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-sm outline-none text-slate-200 min-w-[240px]"
        >
          {campaigns.length === 0 && <option value="">Nenhuma campanha</option>}
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id.substring(0, 8)})</option>)}
        </select>
      </div>

      {/* Criar novo */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-900/50 border border-white/5 rounded-xl p-3">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Título do formulário (ex: Quero apoiar a campanha)"
          className="flex-1 min-w-[200px] bg-slate-950 border border-white/10 rounded px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
        />
        <select value={newTarget} onChange={(e) => setNewTarget(e.target.value)} className="bg-slate-950 border border-white/10 rounded px-2 py-2 text-xs text-slate-300 outline-none">
          <option value="contacts">Contatos</option>
          <option value="visits">Visitas</option>
          <option value="pesquisa">Pesquisa</option>
        </select>
        <button
          onClick={create}
          disabled={creating || !newTitle.trim() || !selCampaign}
          className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 disabled:opacity-40"
        >
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Criar
        </button>
      </div>
      <p className="text-[11px] text-slate-500 -mt-2">Cria com Nome/WhatsApp/E-mail + os campos internos do alvo escolhido. Edite os campos na aba “Campos internos”.</p>

      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</div>}

      {/* Lista */}
      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-xs p-6"><Loader2 className="w-4 h-4 animate-spin" /> carregando…</div>
      ) : forms.length === 0 ? (
        <div className="text-center text-slate-600 text-xs border border-dashed border-white/10 rounded-xl py-10">
          Nenhum formulário público ainda.
        </div>
      ) : (
        <div className="space-y-2">
          {forms.map((f) => (
            <div key={f.id} className="bg-slate-900/60 border border-white/5 rounded-xl p-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{f.title}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${f.isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                    {f.isActive ? 'ATIVO' : 'INATIVO'}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400">{TARGET_LABEL[f.target] || f.target}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-[11px] text-indigo-300">/f/{f.slug}</code>
                  <span className="text-[10px] text-slate-500">· {f.submissionsCount} envio(s)</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => copyLink(f.slug)} title="Copiar link" className="p-1.5 rounded hover:bg-white/10">
                  {copied === f.slug ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                </button>
                <a href={`${origin}/f/${f.slug}`} target="_blank" rel="noopener noreferrer" title="Abrir" className="p-1.5 rounded hover:bg-white/10">
                  <ExternalLink className="w-4 h-4 text-slate-400" />
                </a>
                <button onClick={() => toggleActive(f)} title={f.isActive ? 'Desativar' : 'Ativar'} className="p-1.5 rounded hover:bg-white/10">
                  {f.isActive ? <PowerOff className="w-4 h-4 text-amber-400" /> : <Power className="w-4 h-4 text-emerald-400" />}
                </button>
                <button onClick={() => remove(f)} title="Excluir" className="p-1.5 rounded hover:bg-red-500/20">
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PublicFormsPanel;
