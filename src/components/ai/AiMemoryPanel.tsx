import React, { useEffect, useState, useCallback } from 'react';
import { authedFetch } from '../../lib/authedFetch';
import { Brain, Trash2, ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react';

/**
 * Memória da IA (RAG control panel).
 *
 * Lista o que a IA salvou de SI MESMA na knowledge_chunks (source agent:*).
 * Permite filtrar por agente, expandir o conteúdo e apagar item por item.
 *
 * Diferença em relação ao "knowledge ancorado" (formulários, settings,
 * configurações): aqui são as saídas geradas pelo callAgent — são o que a
 * IA "lembra" das próprias conclusões. Apagar daqui é seguro: limpa a memória
 * sem afetar dados do usuário.
 */
interface MemoryChunk {
  id: string;
  source: string;
  content: string;
  metadata: any;
  createdAt: string;
}

interface Facet {
  source: string;
  n: number;
}

const AGENT_LABELS: Record<string, string> = {
  strategist: '🎯 Estrategista',
  growth: '📈 Growth',
  manager: '👔 Manager',
  crm: '💬 CRM',
  intelligence: '🕵️ Inteligência',
  consultant: '🧑‍💼 Consultor',
  competitive_intel: '🎯 Intel Competitiva',
  voter_bot: '🤖 Atendimento Eleitor',
  budget: '💰 Budget CEO',
  content: '✍️ Content Studio',
  classifier: '🏷️ Classificador',
};

const labelOf = (source: string) => {
  const agent = source.replace(/^agent:/, '');
  return AGENT_LABELS[agent] ?? `🤖 ${agent}`;
};

const AiMemoryPanel: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const [chunks, setChunks] = useState<MemoryChunk[]>([]);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100', offset: '0' });
      if (filter) params.set('agentId', filter.replace(/^agent:/, ''));
      const r = await authedFetch(`/api/v1/rag/memory?${params}`);
      if (r.ok) {
        const j = await r.json();
        setChunks(j.chunks ?? []);
        setTotal(j.total ?? 0);
        setFacets(j.facets ?? []);
      }
    } finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const remove = async (id: string) => {
    if (!confirm('Apagar este item da memória da IA?\nIsso NÃO afeta dados de usuários — só a "lembrança" que a IA tinha desta resposta.')) return;
    setDeleting(id);
    try {
      const r = await authedFetch(`/api/v1/rag/memory/${id}`, { method: 'DELETE' });
      if (r.ok) { setChunks((cs) => cs.filter((c) => c.id !== id)); setTotal((t) => Math.max(0, t - 1)); }
    } finally { setDeleting(null); }
  };

  const filtered = search.trim()
    ? chunks.filter((c) => c.content.toLowerCase().includes(search.toLowerCase())
        || (c.metadata?.title ?? '').toString().toLowerCase().includes(search.toLowerCase()))
    : chunks;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2"><Brain className="w-5 h-5 text-indigo-400" /> Memória da IA</h2>
          <p className="text-xs text-slate-400 mt-1">
            Respostas que os agentes geraram e foram guardadas como contexto pras próximas chamadas. <b>Apagar daqui não afeta dados de usuários</b> — só limpa o que a IA lembra.
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">✕</button>
        )}
      </div>

      {/* Facets: chip por agente com contagem */}
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setFilter('')}
          className={`text-xs px-3 py-1 rounded-full transition-colors ${filter === '' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
          Todos ({total})
        </button>
        {facets.map((f) => (
          <button key={f.source} onClick={() => setFilter(f.source)}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${filter === f.source ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
            {labelOf(f.source)} ({f.n})
          </button>
        ))}
      </div>

      {/* Busca textual */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar no conteúdo das memórias…"
          className="w-full bg-slate-950 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-white text-sm" />
      </div>

      {/* Lista */}
      <div className="space-y-1.5">
        {loading && (
          <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando memórias…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-slate-500 text-xs italic py-8 text-center">
            {chunks.length === 0
              ? 'Nenhuma memória ainda. A IA vai começar a guardar respostas conforme os agentes forem usados.'
              : 'Nenhum resultado pra esta busca.'}
          </div>
        )}
        {filtered.map((c) => {
          const isOpen = expanded.has(c.id);
          const meta = c.metadata || {};
          const title = meta.title || c.content.slice(0, 80);
          return (
            <div key={c.id} className="bg-slate-900/60 border border-white/5 rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 p-3 cursor-pointer hover:bg-white/[0.02]" onClick={() => toggle(c.id)}>
                {isOpen ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
                <span className="text-[10px] uppercase tracking-wider text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-full shrink-0">{labelOf(c.source)}</span>
                <span className="text-sm text-slate-200 truncate flex-1">{title}</span>
                <span className="text-[10px] text-slate-500 shrink-0">{new Date(c.createdAt).toLocaleString('pt-BR')}</span>
                <button onClick={(e) => { e.stopPropagation(); remove(c.id); }} disabled={deleting === c.id}
                  className="text-rose-400 hover:text-rose-300 disabled:opacity-50 shrink-0"
                  title="Apagar esta memória">
                  {deleting === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
              {isOpen && (
                <div className="px-9 pb-3 space-y-2 border-t border-white/5">
                  <pre className="whitespace-pre-wrap text-xs text-slate-300 font-sans leading-relaxed pt-2">{c.content}</pre>
                  {(meta.provider || meta.model || meta.tokensOut) && (
                    <p className="text-[10px] text-slate-600 pt-1 border-t border-white/5 mt-2">
                      {meta.provider && <span>provider: <code>{meta.provider}</code></span>}
                      {meta.model && <span> · model: <code>{meta.model}</code></span>}
                      {meta.tokensOut != null && <span> · tokens out: <code>{meta.tokensOut}</code></span>}
                      {meta.costCentsUsd != null && <span> · custo: <code>${(meta.costCentsUsd / 100).toFixed(4)}</code></span>}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-600 text-center pt-2 border-t border-white/5">
        Política: respostas com 60+ caracteres são indexadas automaticamente. Items podem ser apagados a qualquer momento (LGPD-friendly).
      </p>
    </div>
  );
};

export default AiMemoryPanel;
