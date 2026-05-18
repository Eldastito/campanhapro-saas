import * as React from 'react';
import {
  Upload, Trash2, Search, FileText, Loader2, X, AlertCircle,
  BookOpen, Plus, ChevronRight, Database, Sparkles, RefreshCw
} from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

interface KnowledgeDoc {
  source: string;
  chunkCount: number;
  createdAt: string;
}

interface SearchResult {
  id: string;
  content: string;
  source: string;
  similarity: number;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export const ExaForgePanel: React.FC = () => {
  const [docs, setDocs] = React.useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Upload form
  const [showUpload, setShowUpload] = React.useState(false);
  const [uploadTitle, setUploadTitle] = React.useState('');
  const [uploadContent, setUploadContent] = React.useState('');
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Delete
  const [deletingSource, setDeletingSource] = React.useState<string | null>(null);

  // Search
  const [query, setQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [results, setResults] = React.useState<SearchResult[] | null>(null);

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  const loadDocs = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch('/api/v1/rag/documents');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar documentos');
      setDocs(json.documents ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { loadDocs(); }, [loadDocs]);

  // ---------------------------------------------------------------------------
  // File picker → fill textarea
  // ---------------------------------------------------------------------------

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!uploadTitle.trim()) setUploadTitle(file.name.replace(/\.[^.]+$/, ''));
    const reader = new FileReader();
    reader.onload = (ev) => {
      setUploadContent(String(ev.target?.result ?? ''));
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  // ---------------------------------------------------------------------------
  // Upload / ingest
  // ---------------------------------------------------------------------------

  const uploadDoc = async () => {
    if (!uploadTitle.trim() || !uploadContent.trim()) return;
    setUploading(true);
    setError(null);
    try {
      const res = await authedFetch('/api/v1/rag/documents', {
        method: 'POST',
        body: JSON.stringify({ title: uploadTitle.trim(), content: uploadContent }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao ingerir documento');
      setShowUpload(false);
      setUploadTitle('');
      setUploadContent('');
      await loadDocs();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const deleteDoc = async (source: string) => {
    if (!confirm(`Remover "${source}" da base de conhecimento?`)) return;
    setDeletingSource(source);
    setError(null);
    try {
      const res = await authedFetch(`/api/v1/rag/documents/${encodeURIComponent(source)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? 'Erro ao remover');
      }
      await loadDocs();
      if (results) setResults(results.filter(r => r.source !== source));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeletingSource(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  const doSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/v1/rag/search?q=${encodeURIComponent(query)}&limit=8`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro na busca');
      setResults(json.results ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Database className="w-5 h-5 text-violet-400" />
            <h3 className="text-base font-semibold text-slate-200">Base de Conhecimento</h3>
          </div>
          <p className="text-xs text-slate-400">
            Documentos ingeridos alimentam os agentes de IA com contexto da campanha (pgvector + embeddings).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={loadDocs}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            title="Atualizar"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar documento
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Document list */}
        <div>
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Documentos ingestion ({docs.length})
          </h4>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
            </div>
          ) : docs.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-slate-700 rounded-xl">
              <BookOpen className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nenhum documento ainda.</p>
              <p className="text-xs text-slate-600 mt-1">
                Adicione documentos para os agentes aprenderem com eles.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {docs.map(doc => (
                <li
                  key={doc.source}
                  className="flex items-center gap-3 p-3 rounded-lg border border-slate-800 bg-slate-900/60"
                >
                  <FileText className="w-4 h-4 text-violet-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{doc.source}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {doc.chunkCount} fragmentos · {fmtDate(doc.createdAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteDoc(doc.source)}
                    disabled={deletingSource === doc.source}
                    className="p-1.5 rounded text-red-400 hover:bg-red-500/20 disabled:opacity-40 flex-shrink-0"
                    title="Remover"
                  >
                    {deletingSource === doc.source
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Semantic search */}
        <div>
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Busca Semântica
          </h4>

          <form onSubmit={doSearch} className="flex gap-2 mb-3">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="O que você quer encontrar?"
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
            />
            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm disabled:opacity-50"
            >
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </button>
          </form>

          {results === null ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              <Sparkles className="w-7 h-7 mx-auto mb-2 text-slate-600" />
              Digite uma consulta para buscar no conhecimento da campanha.
            </div>
          ) : results.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">
              Nenhum resultado encontrado.
            </p>
          ) : (
            <ul className="space-y-2">
              {results.map((r) => (
                <li
                  key={r.id}
                  className="p-3 rounded-lg border border-slate-800 bg-slate-900/60"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-medium text-violet-400 truncate max-w-[60%]">
                      {r.source}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {(r.similarity * 100).toFixed(0)}% sim.
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed line-clamp-4">
                    {r.content}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Upload modal */}
      {showUpload && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => !uploading && setShowUpload(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-5 max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold text-slate-200 flex items-center gap-2">
                <Upload className="w-4 h-4 text-violet-400" />
                Adicionar Documento à Base de Conhecimento
              </h4>
              <button
                onClick={() => !uploading && setShowUpload(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              Cole o texto ou carregue um arquivo TXT / Markdown. O sistema divide automaticamente em fragmentos e gera embeddings.
              Se já existir um documento com o mesmo título, ele será substituído.
            </p>

            <div className="space-y-3 flex-1 overflow-y-auto">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Título do documento</label>
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={e => setUploadTitle(e.target.value)}
                  placeholder="ex: Plataforma Eleitoral 2026"
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400">Conteúdo</label>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
                  >
                    <Upload className="w-3 h-3" />
                    Carregar arquivo TXT/MD
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.csv,.text"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
                <textarea
                  value={uploadContent}
                  onChange={e => setUploadContent(e.target.value)}
                  placeholder="Cole o texto aqui…"
                  rows={12}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 font-mono resize-y"
                />
                {uploadContent.length > 0 && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    {uploadContent.split(/\s+/).filter(Boolean).length} palavras ·{' '}
                    ~{Math.ceil(uploadContent.split(/\s+/).filter(Boolean).length / 360)} fragmentos estimados
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-800">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <ChevronRight className="w-3 h-3" />
                Somente TXT/Markdown. Para PDFs, copie e cole o texto.
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowUpload(false)}
                  disabled={uploading}
                  className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
                >
                  Cancelar
                </button>
                <button
                  onClick={uploadDoc}
                  disabled={uploading || !uploadTitle.trim() || !uploadContent.trim()}
                  className="flex items-center gap-2 px-4 py-1.5 text-sm rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {uploading ? 'Ingerindo…' : 'Ingerir documento'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExaForgePanel;
