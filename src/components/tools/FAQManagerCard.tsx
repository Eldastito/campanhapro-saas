/**
 * Banco de Respostas Aprovadas (#140).
 *
 * Admin cadastra perguntas/respostas. Ao aprovar, entry é indexada no RAG
 * (knowledge_chunks com source=faq:approved). Aurora consulta naturalmente
 * antes de inventar resposta — fonte oficial da campanha.
 */
import React, { useEffect, useState } from 'react';
import { BookOpen, Plus, Edit2, Trash2, CheckCircle2, X, RefreshCw, AlertCircle } from 'lucide-react';
import Card from '../ui/Card';
import { supabase } from '../../lib/supabaseClient';

interface FAQEntry {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  tags: string[] | null;
  status: 'draft' | 'approved' | 'archived';
  approvedBy: string | null;
  approvedAt: string | null;
  lastIndexedAt: string | null;
  createdAt: string;
}

async function authFetch(url: string, init: RequestInit = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const r = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

const FAQManagerCard: React.FC = () => {
  const [entries, setEntries] = useState<FAQEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FAQEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'all' | 'draft' | 'approved'>('all');

  const load = async () => {
    setLoading(true);
    try {
      const r = await authFetch('/api/v1/toolbox/faq');
      setEntries(r.entries || []);
    } catch (err) {
      console.error('[faq] load:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = entries.filter(e => filter === 'all' || e.status === filter);
  const counts = {
    all: entries.length,
    draft: entries.filter(e => e.status === 'draft').length,
    approved: entries.filter(e => e.status === 'approved').length,
  };

  const handleSave = async (data: Partial<FAQEntry>) => {
    try {
      if (editing) {
        await authFetch(`/api/v1/toolbox/faq/${editing.id}`, {
          method: 'PATCH', body: JSON.stringify(data),
        });
      } else {
        await authFetch('/api/v1/toolbox/faq', { method: 'POST', body: JSON.stringify(data) });
      }
      setEditing(null); setShowForm(false);
      load();
    } catch (err: any) {
      alert('Falha: ' + (err?.message || 'erro'));
    }
  };

  const handleApprove = async (id: string) => {
    if (!confirm('Aprovar essa resposta? Ela será indexada no RAG e a Aurora vai começar a usar.')) return;
    try {
      await authFetch(`/api/v1/toolbox/faq/${id}/approve`, { method: 'POST', body: '{}' });
      load();
    } catch (err: any) { alert(err?.message); }
  };

  const handleUnapprove = async (id: string) => {
    try {
      await authFetch(`/api/v1/toolbox/faq/${id}/unapprove`, { method: 'POST', body: '{}' });
      load();
    } catch (err: any) { alert(err?.message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover essa resposta? Não desindexa do RAG (chunks ficam até próximo refresh).')) return;
    try {
      await authFetch(`/api/v1/toolbox/faq/${id}`, { method: 'DELETE' });
      load();
    } catch (err: any) { alert(err?.message); }
  };

  return (
    <Card className="border-l-4 border-l-cyan-500">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-cyan-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Banco de Respostas Aprovadas</h3>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-1.5 hover:bg-slate-800 rounded text-slate-400">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" /> Nova
          </button>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 mb-3">
        Quando uma resposta é <b>aprovada</b>, ela vai pro RAG da campanha. Aurora consulta antes de gerar resposta no WhatsApp — material APROVADO, sem alucinação.
      </p>

      <div className="flex gap-1 mb-3 border-b border-slate-800">
        {(['all', 'draft', 'approved'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-2 text-[11px] font-semibold ${filter === f ? 'text-white border-b-2 border-cyan-500' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {f === 'all' ? `Tudo (${counts.all})` : f === 'draft' ? `Rascunhos (${counts.draft})` : `Aprovadas (${counts.approved})`}
          </button>
        ))}
      </div>

      {loading && entries.length === 0 ? (
        <p className="text-xs text-slate-500 italic py-3">Carregando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-slate-500 italic py-4 text-center">
          {filter === 'all' ? 'Sem perguntas cadastradas ainda. Clique "Nova" pra começar.' : `Sem entradas nessa categoria.`}
        </p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filtered.map(e => (
            <div key={e.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{e.question}</p>
                  {e.category && (
                    <span className="text-[9px] uppercase tracking-wide bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded mt-1 inline-block">
                      {e.category}
                    </span>
                  )}
                </div>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                  e.status === 'approved' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                }`}>
                  {e.status === 'approved' ? '✓ APROVADA' : '📝 RASCUNHO'}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 line-clamp-3">{e.answer}</p>
              <div className="flex gap-1 mt-2">
                {e.status === 'draft' ? (
                  <button
                    onClick={() => handleApprove(e.id)}
                    className="flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold rounded"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Aprovar e Indexar
                  </button>
                ) : (
                  <button
                    onClick={() => handleUnapprove(e.id)}
                    className="flex items-center gap-1 px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold rounded"
                  >
                    Desaprovar
                  </button>
                )}
                <button
                  onClick={() => { setEditing(e); setShowForm(true); }}
                  className="flex items-center gap-1 px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold rounded"
                >
                  <Edit2 className="w-3 h-3" /> Editar
                </button>
                <button
                  onClick={() => handleDelete(e.id)}
                  className="flex items-center gap-1 px-2 py-1 bg-red-600/70 hover:bg-red-600 text-white text-[10px] font-bold rounded ml-auto"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <FAQForm
          initial={editing}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setShowForm(false); }}
        />
      )}
    </Card>
  );
};

const FAQForm: React.FC<{
  initial: FAQEntry | null;
  onSave: (d: Partial<FAQEntry>) => void;
  onCancel: () => void;
}> = ({ initial, onSave, onCancel }) => {
  const [question, setQuestion] = useState(initial?.question || '');
  const [answer, setAnswer] = useState(initial?.answer || '');
  const [category, setCategory] = useState(initial?.category || '');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-bold text-white">{initial ? 'Editar resposta' : 'Nova resposta'}</h4>
          <button onClick={onCancel} className="text-slate-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Pergunta típica</label>
            <input
              value={question} onChange={(e) => setQuestion(e.target.value)}
              placeholder="ex: Quais são as propostas para saúde?"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Resposta oficial</label>
            <textarea
              value={answer} onChange={(e) => setAnswer(e.target.value)}
              placeholder="Texto que será indexado no RAG e usado pela Aurora..."
              rows={6}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm resize-y"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Categoria</label>
            <input
              value={category} onChange={(e) => setCategory(e.target.value)}
              placeholder="saúde / educação / segurança / economia..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm"
            />
          </div>
        </div>
        {initial && initial.status === 'approved' && (
          <div className="mt-3 flex gap-2 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Editar volta esta entrada pra rascunho. Você precisa reaprovar pra ela ir pro RAG de novo.</span>
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold">
            Cancelar
          </button>
          <button
            onClick={() => onSave({ question, answer, category: category || undefined })}
            disabled={!question.trim() || !answer.trim()}
            className="flex-1 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl font-bold"
          >
            Salvar como rascunho
          </button>
        </div>
      </div>
    </div>
  );
};

export default FAQManagerCard;
