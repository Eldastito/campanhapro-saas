import * as React from 'react';
import { BookOpen, Plus, Trash2, Loader2 } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

/**
 * Argumentário de Conversão — base de conhecimento que mantém a IA ancorada
 * (anti-alucinação) e focada em conversão de voto. Cadastra propostas (com fonte),
 * comparativos nosso×opositor por tema, respostas a objeções, FAQ e LIMITES.
 * Tudo é indexado no RAG e consumido pelos agentes (e, no futuro, pelo
 * atendimento ao eleitor).
 */
interface Entry {
  id: string; type: string; tema?: string | null; titulo: string; conteudo: string;
  fonte?: string | null; adversario?: string | null; ativo: boolean; updatedAt: string;
}

const TYPES: { key: string; label: string; badge: string; hint: string }[] = [
  { key: 'proposta', label: 'Proposta/Realização', badge: 'bg-emerald-500/20 text-emerald-300', hint: 'O que o NOSSO candidato propõe ou já fez (com fonte).' },
  { key: 'comparativo', label: 'Comparativo (nós × opositor)', badge: 'bg-indigo-500/20 text-indigo-300', hint: 'Tema onde levamos vantagem sobre um opositor.' },
  { key: 'objecao', label: 'Resposta a objeção', badge: 'bg-amber-500/20 text-amber-300', hint: 'Eleitor diz X → respondemos Y.' },
  { key: 'faq', label: 'FAQ', badge: 'bg-sky-500/20 text-sky-300', hint: 'Perguntas frequentes e respostas oficiais.' },
  { key: 'limite', label: 'Limite (pode/não pode)', badge: 'bg-rose-500/20 text-rose-300', hint: 'O que a IA NÃO pode prometer ou dizer.' },
];
const typeMeta = (k: string) => TYPES.find((t) => t.key === k) || TYPES[1];

const empty = { type: 'comparativo', tema: '', titulo: '', conteudo: '', fonte: '', adversario: '' };

const PlaybookPanel: React.FC = () => {
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [filter, setFilter] = React.useState<string>('todos');
  const [form, setForm] = React.useState({ ...empty });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await authedFetch('/api/v1/playbook');
      const j = await r.json();
      if (r.ok) setEntries(j.entries || []);
    } catch { /* */ }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const salvar = async () => {
    if (!form.titulo.trim() || !form.conteudo.trim()) { setError('Preencha título e conteúdo.'); return; }
    setError(null); setSaving(true);
    try {
      const r = await authedFetch('/api/v1/playbook', { method: 'POST', body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Falha ao salvar.');
      setForm({ ...empty });
      await load();
    } catch (e: any) { setError(e?.message || 'Falha ao salvar.'); }
    finally { setSaving(false); }
  };

  const remover = async (id: string) => {
    if (!confirm('Remover esta entrada do argumentário?')) return;
    await authedFetch(`/api/v1/playbook/${id}`, { method: 'DELETE' });
    load();
  };

  const visiveis = filter === 'todos' ? entries : entries.filter((e) => e.type === filter);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-black text-white flex items-center gap-2"><BookOpen className="w-5 h-5 text-indigo-400" /> Argumentário de Conversão</h3>
        <p className="text-xs text-slate-500">A base que mantém a IA focada em conversão e ancorada em fatos. Os agentes consultam isto para responder com vantagem comparativa — sem inventar.</p>
      </div>

      {/* Formulário de nova entrada */}
      <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="md:col-span-4 bg-slate-950 border border-white/10 rounded px-3 py-2 text-sm text-white">
            {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <input value={form.tema} onChange={(e) => setForm({ ...form, tema: e.target.value })} placeholder="Tema (ex.: segurança, saúde)" className="md:col-span-4 bg-slate-950 border border-white/10 rounded px-3 py-2 text-sm text-white" />
          <input value={form.adversario} onChange={(e) => setForm({ ...form, adversario: e.target.value })} placeholder="Opositor (se comparativo)" className="md:col-span-4 bg-slate-950 border border-white/10 rounded px-3 py-2 text-sm text-white" />
        </div>
        <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Título (resumo da ideia)" className="w-full bg-slate-950 border border-white/10 rounded px-3 py-2 text-sm text-white" />
        <textarea value={form.conteudo} onChange={(e) => setForm({ ...form, conteudo: e.target.value })} placeholder="Conteúdo: o argumento / resposta / regra (seja específico e verdadeiro)" rows={3} className="w-full bg-slate-950 border border-white/10 rounded px-3 py-2 text-sm text-white" />
        <div className="flex items-center gap-2">
          <input value={form.fonte} onChange={(e) => setForm({ ...form, fonte: e.target.value })} placeholder="Fonte (link/veículo — recomendado para propostas e comparativos)" className="flex-1 bg-slate-950 border border-white/10 rounded px-3 py-2 text-sm text-white" />
          <button onClick={salvar} disabled={saving} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Adicionar
          </button>
        </div>
        <p className="text-[11px] text-slate-500">{typeMeta(form.type).hint}</p>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter('todos')} className={`text-xs px-3 py-1 rounded-full border ${filter === 'todos' ? 'bg-white/10 border-white/30 text-white' : 'border-white/10 text-slate-400'}`}>Todos ({entries.length})</button>
        {TYPES.map((t) => {
          const n = entries.filter((e) => e.type === t.key).length;
          return <button key={t.key} onClick={() => setFilter(t.key)} className={`text-xs px-3 py-1 rounded-full border ${filter === t.key ? 'bg-white/10 border-white/30 text-white' : 'border-white/10 text-slate-400'}`}>{t.label} ({n})</button>;
        })}
      </div>

      {/* Lista */}
      {visiveis.length === 0 ? (
        <p className="text-slate-500 text-sm">Nenhuma entrada {filter !== 'todos' ? 'deste tipo' : ''} ainda. Comece cadastrando as propostas do candidato e os comparativos onde vocês levam vantagem.</p>
      ) : (
        <div className="space-y-2">
          {visiveis.map((e) => {
            const m = typeMeta(e.type);
            return (
              <div key={e.id} className="bg-slate-900/40 border border-white/5 rounded-xl p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${m.badge}`}>{m.label}</span>
                      {e.tema && <span className="text-[10px] text-slate-400">#{e.tema}</span>}
                      {e.adversario && <span className="text-[10px] text-rose-300">× {e.adversario}</span>}
                    </div>
                    <p className="text-sm font-bold text-white mt-1">{e.titulo}</p>
                    <p className="text-sm text-slate-300 whitespace-pre-wrap">{e.conteudo}</p>
                    {e.fonte && <p className="text-[10px] text-slate-500 mt-1">Fonte: {e.fonte}</p>}
                  </div>
                  <button onClick={() => remover(e.id)} className="shrink-0 text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PlaybookPanel;
