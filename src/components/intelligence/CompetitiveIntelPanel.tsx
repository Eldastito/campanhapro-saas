import * as React from 'react';
import { Swords, Search, Loader2, Trash2, Newspaper, Megaphone, ShieldAlert, Target, TrendingUp, Globe, ChevronDown } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

/**
 * Inteligência Competitiva — coleta dados de adversários por FONTES PÚBLICAS
 * (redes sociais públicas, portais de notícias, TSE/DivulgaCand e a Biblioteca
 * de Anúncios da Meta). Usa o web_search do agente; não depende dos "3C" privados.
 */
interface Intel {
  id: string; name: string; cargo?: string; cidade?: string; uf?: string;
  dossier?: any; narrative?: string; createdAt: string;
}

const Section: React.FC<{ icon: any; title: string; children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <div className="mb-3">
    <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-1"><Icon className="w-3.5 h-3.5" /> {title}</p>
    {children}
  </div>
);
const List: React.FC<{ items?: any[] }> = ({ items }) => (
  (items && items.length) ? <ul className="list-disc list-inside text-sm text-slate-300 space-y-0.5">{items.map((x, i) => <li key={i}>{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}</ul>
    : <p className="text-xs text-slate-600">—</p>
);

const CompetitiveIntelPanel: React.FC = () => {
  const [list, setList] = React.useState<Intel[]>([]);
  const [form, setForm] = React.useState({ name: '', cargo: '', cidade: '', uf: '' });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [memory, setMemory] = React.useState<{ total: number; bySource: Record<string, number>; recent: any[] } | null>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await authedFetch('/api/v1/intel/adversaries');
      const j = await r.json();
      if (r.ok) setList(j.adversaries || []);
    } catch { /* */ }
    try {
      const m = await authedFetch('/api/v1/intel/memory');
      const mj = await m.json();
      if (m.ok) setMemory(mj);
    } catch { /* */ }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const SOURCE_LABEL: Record<string, string> = {
    'intel:adversary': 'Inteligência competitiva', 'consultant:report': 'Consultor IA', 'meeting:summary': 'Reuniões',
  };

  const analisar = async () => {
    if (!form.name.trim()) { setError('Informe o nome do adversário.'); return; }
    setError(null); setLoading(true);
    try {
      const r = await authedFetch('/api/v1/intel/adversary', { method: 'POST', body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error === 'ai_budget_exceeded' ? 'Orçamento de IA esgotado.' : (j.detail || j.error || 'Falha na análise'));
      setForm({ name: '', cargo: '', cidade: '', uf: '' });
      setOpen(j.intel?.id || null);
      await load();
    } catch (e: any) { setError(e?.message || 'Falha na análise.'); }
    finally { setLoading(false); }
  };

  const remover = async (id: string) => {
    if (!confirm('Remover este dossiê?')) return;
    await authedFetch(`/api/v1/intel/adversaries/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-black text-white flex items-center gap-2"><Swords className="w-5 h-5 text-rose-400" /> Inteligência Competitiva</h3>
        <p className="text-xs text-slate-500">Dossiê de adversários por fontes públicas: redes sociais, portais de notícias, TSE/DivulgaCand e Biblioteca de Anúncios da Meta (7 anos).</p>
      </div>

      <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome do adversário *" className="md:col-span-4 bg-slate-950 border border-white/10 rounded px-3 py-2 text-sm text-white" />
        <input value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} placeholder="Cargo (ex: Prefeito)" className="md:col-span-3 bg-slate-950 border border-white/10 rounded px-3 py-2 text-sm text-white" />
        <input value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} placeholder="Cidade" className="md:col-span-2 bg-slate-950 border border-white/10 rounded px-3 py-2 text-sm text-white" />
        <input value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value })} placeholder="UF" maxLength={2} className="md:col-span-1 bg-slate-950 border border-white/10 rounded px-3 py-2 text-sm text-white uppercase" />
        <button onClick={analisar} disabled={loading} className="md:col-span-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded px-3 py-2 text-sm flex items-center justify-center gap-2 disabled:opacity-50">
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Pesquisando…</> : <><Search className="w-4 h-4" /> Analisar</>}
        </button>
      </div>
      {error && <p className="text-sm bg-red-500/10 text-red-400 rounded-lg p-3">{error}</p>}
      {loading && <p className="text-xs text-slate-500">A IA está consultando fontes públicas (notícias, redes, TSE, Biblioteca de Anúncios). Pode levar até ~1 minuto.</p>}

      {list.length === 0 ? (
        <p className="text-slate-500 text-sm">Nenhum adversário analisado ainda.</p>
      ) : (
        <div className="space-y-3">
          {list.map((it) => {
            const d = it.dossier || {};
            const isOpen = open === it.id;
            return (
              <div key={it.id} className="bg-slate-900/50 border border-white/5 rounded-xl overflow-hidden">
                <button onClick={() => setOpen(isOpen ? null : it.id)} className="w-full flex items-center justify-between gap-3 p-4 text-left">
                  <div className="min-w-0">
                    <p className="font-bold text-white">{it.name} {it.cargo && <span className="text-slate-500 font-normal">· {it.cargo}</span>}</p>
                    <p className="text-xs text-slate-500 truncate">{d.resumo || it.narrative?.slice(0, 120) || 'Dossiê gerado.'}</p>
                  </div>
                  <ChevronDown className={`w-5 h-5 text-slate-500 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 border-t border-white/5 pt-3">
                    {!it.dossier && it.narrative ? (
                      <pre className="text-xs text-slate-300 whitespace-pre-wrap">{it.narrative}</pre>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                        <div>
                          <Section icon={Globe} title="Redes sociais">
                            {(d.redesSociais || []).length ? <ul className="text-sm text-slate-300 space-y-0.5">{d.redesSociais.map((r: any, i: number) => <li key={i}><b>{r.rede}</b> {r.handle} <span className="text-slate-500">— {r.observacao}</span></li>)}</ul> : <p className="text-xs text-slate-600">—</p>}
                          </Section>
                          <Section icon={Target} title="Pautas principais"><List items={d.pautasPrincipais} /></Section>
                          <Section icon={Megaphone} title="Narrativas"><List items={d.narrativas} /></Section>
                          <Section icon={Megaphone} title="Anúncios (Biblioteca da Meta)">
                            <p className="text-sm text-slate-300">{d.anunciosMeta?.resumo || '—'}{d.anunciosMeta?.fonte ? <span className="text-[10px] text-emerald-400 ml-1">• {d.anunciosMeta.fonte}</span> : null}</p>
                            {(d.anunciosMeta?.exemplos || []).length > 0 && (
                              <ul className="mt-1 space-y-1.5">
                                {d.anunciosMeta.exemplos.map((a: any, i: number) => (
                                  <li key={i} className="text-xs bg-slate-950/50 rounded p-2">
                                    {typeof a === 'string' ? a : (<>
                                      <b className="text-slate-200">{a.pagina || '—'}</b>
                                      {a.gasto ? <span className="text-amber-400"> · {a.gasto}</span> : null}
                                      {a.impressoes ? <span className="text-sky-400"> · {a.impressoes} impr.</span> : null}
                                      {a.periodo ? <span className="text-slate-500"> · {a.periodo}</span> : null}
                                      {a.texto ? <p className="text-slate-400 mt-0.5">"{a.texto}"</p> : null}
                                      {a.link ? <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">ver anúncio</a> : null}
                                    </>)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </Section>
                        </div>
                        <div>
                          <Section icon={TrendingUp} title="Pontos fortes"><List items={d.pontosFortes} /></Section>
                          <Section icon={ShieldAlert} title="Pontos fracos"><List items={d.pontosFracos} /></Section>
                          <Section icon={ShieldAlert} title="Ameaças p/ nós"><List items={d.ameacasParaNos} /></Section>
                          <Section icon={Target} title="Oportunidades p/ nós"><List items={d.oportunidadesParaNos} /></Section>
                          <Section icon={TrendingUp} title="Recomendações"><List items={d.recomendacoes} /></Section>
                        </div>
                        <div className="md:col-span-2">
                          <Section icon={Newspaper} title="Notícias recentes">
                            {(d.noticiasRecentes || []).length ? <ul className="text-sm text-slate-300 space-y-1">{d.noticiasRecentes.map((n: any, i: number) => <li key={i}>📰 <b>{n.titulo}</b> <span className="text-slate-500">({n.fonte}{n.data ? `, ${n.data}` : ''})</span> {n.url && <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">link</a>}</li>)}</ul> : <p className="text-xs text-slate-600">—</p>}
                          </Section>
                          {(d.fontes || []).length > 0 && <p className="text-[10px] text-slate-600 mt-2">Fontes: {d.fontes.slice(0, 8).join(' · ')}</p>}
                        </div>
                      </div>
                    )}
                    <div className="flex justify-end mt-3">
                      <button onClick={() => remover(it.id)} className="text-rose-400 hover:text-rose-300 text-xs flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Remover</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Memória da Campanha (RAG) — o que os agentes já aprenderam */}
      {memory && memory.total > 0 && (
        <div className="bg-slate-900/40 border border-white/5 rounded-xl p-4 mt-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-emerald-400 mb-2">🧠 Memória da Campanha · {memory.total} item(ns) indexado(s)</p>
          <div className="flex flex-wrap gap-2 mb-2">
            {Object.entries(memory.bySource).map(([s, n]) => (
              <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">{SOURCE_LABEL[s] || s}: {n}</span>
            ))}
          </div>
          <p className="text-[10px] text-slate-600">A IA consulta esta memória antes de gerar dossiês e análises. Cresce a cada uso dos agentes.</p>
        </div>
      )}
    </div>
  );
};

export default CompetitiveIntelPanel;
