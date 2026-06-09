import * as React from 'react';
import { Swords, Search, Loader2, Trash2, Newspaper, Megaphone, ShieldAlert, Target, TrendingUp, Globe, ChevronDown, Printer } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import CompetitiveIntelReport from './CompetitiveIntelReport';

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
  const [printing, setPrinting] = React.useState<any | null>(null);
  const [cnpj, setCnpj] = React.useState<string | null>(null);
  const [planLoading, setPlanLoading] = React.useState(false);
  const [planResult, setPlanResult] = React.useState<any | null>(null);
  const { user } = useAuth();

  React.useEffect(() => {
    if (!user?.campaignId) return;
    supabase.from('settings').select('campaignDetails').eq('campaignId', user.campaignId).maybeSingle()
      .then(({ data }) => setCnpj((data as any)?.campaignDetails?.cnpj ?? null), () => {});
  }, [user?.campaignId]);

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

  // Reprocessa dossiês que ficaram como texto cru (parser corrigido, sem custo de IA).
  const triedRef = React.useRef<Set<string>>(new Set());
  const reprocess = React.useCallback(async (id: string) => {
    try {
      const r = await authedFetch(`/api/v1/intel/adversaries/${id}/reprocess`, { method: 'POST' });
      if (r.ok) await load();
    } catch { /* */ }
  }, [load]);
  React.useEffect(() => {
    const raw = list.filter((it) => !it.dossier && it.narrative && !triedRef.current.has(it.id));
    if (raw.length) { raw.forEach((it) => triedRef.current.add(it.id)); raw.forEach((it) => reprocess(it.id)); }
  }, [list, reprocess]);

  const analisar = async () => {
    if (!form.name.trim()) { setError('Informe o nome do adversário.'); return; }
    setError(null); setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 160000); // 160s — não trava pra sempre
    try {
      const r = await authedFetch('/api/v1/intel/adversary', { method: 'POST', body: JSON.stringify(form), signal: ctrl.signal });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error === 'ai_budget_exceeded' ? 'Orçamento de IA esgotado.' : (j.detail || j.error || 'Falha na análise'));
      setForm({ name: '', cargo: '', cidade: '', uf: '' });
      setOpen(j.intel?.id || null);
      await load();
    } catch (e: any) {
      setError(e?.name === 'AbortError'
        ? 'A pesquisa demorou demais e foi interrompida. Tente de novo — costuma funcionar na 2ª tentativa.'
        : (e?.message || 'Falha na análise.'));
    } finally { clearTimeout(timer); setLoading(false); }
  };

  const remover = async (id: string) => {
    if (!confirm('Remover este dossiê?')) return;
    await authedFetch(`/api/v1/intel/adversaries/${id}`, { method: 'DELETE' });
    load();
  };

  // Plano de batalha: Estrategista lê dossiês + funil + gaps e grava Objetivos/Tarefas.
  const gerarPlano = async () => {
    setPlanLoading(true); setError(null); setPlanResult(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 160000);
    try {
      const r = await authedFetch('/api/v1/intel/battle-plan', { method: 'POST', body: JSON.stringify({}), signal: ctrl.signal });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error === 'ai_budget_exceeded' ? 'Orçamento de IA esgotado.' : (j.detail || j.error || 'Falha ao gerar plano.'));
      setPlanResult(j);
    } catch (e: any) {
      setError(e?.name === 'AbortError' ? 'O plano demorou demais e foi interrompido. Tente de novo.' : (e?.message || 'Falha ao gerar plano.'));
    } finally { clearTimeout(timer); setPlanLoading(false); }
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

      {/* Do dossiê à AÇÃO: gera o plano de batalha e grava em Objetivos + Tarefas */}
      <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-indigo-200 flex items-center gap-1.5"><Target className="w-4 h-4" /> Plano de batalha da semana</p>
          <p className="text-xs text-slate-400">O Estrategista cruza os dossiês + funil + gaps territoriais e grava objetivos e tarefas prontos para a equipe.</p>
        </div>
        <button onClick={gerarPlano} disabled={planLoading} className="shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded px-4 py-2 text-sm flex items-center justify-center gap-2 disabled:opacity-50">
          {planLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando…</> : <><Target className="w-4 h-4" /> Gerar plano</>}
        </button>
      </div>
      {planResult && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-2">
          <p className="text-sm text-emerald-200 font-bold">✅ Plano gerado — {planResult.goalsCreated} objetivo(s) e {planResult.tasksCreated} tarefa(s) criados.</p>
          {planResult.plan?.resumo && <p className="text-sm text-slate-300">{planResult.plan.resumo}</p>}
          {Array.isArray(planResult.plan?.tarefas) && planResult.plan.tarefas.length > 0 && (
            <ul className="text-xs text-slate-400 space-y-0.5 mt-1">
              {planResult.plan.tarefas.slice(0, 6).map((t: any, i: number) => <li key={i}>• {t.bairro ? <b className="text-slate-300">{t.bairro}:</b> : null} {t.title}</li>)}
            </ul>
          )}
          <p className="text-[11px] text-slate-500">Veja e atribua na aba <b>Objetivos</b> e em <b>Tarefas &amp; Roteiros da Equipe</b>.</p>
        </div>
      )}

      {list.length === 0 ? (
        <p className="text-slate-500 text-sm">Nenhum adversário analisado ainda.</p>
      ) : (
        <div className="space-y-3">
          {list.map((it) => {
            const d = it.dossier || {};
            // A IA às vezes devolve campos de lista como string única — normaliza p/ evitar .join quebrar
            const arr = (v: any): any[] => Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
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
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[11px] text-amber-400">Este dossiê ficou em texto cru. Clique para estruturar (sem nova pesquisa).</p>
                          <button onClick={() => reprocess(it.id)} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded px-3 py-1 font-bold">Reprocessar</button>
                        </div>
                        <pre className="text-xs text-slate-400 whitespace-pre-wrap max-h-48 overflow-y-auto">{it.narrative}</pre>
                      </div>
                    ) : (
                      <>
                      {d.eleicaoAtual && (d.eleicaoAtual.cargo || d.eleicaoAtual.situacao) && (
                        <div className="mb-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg px-3 py-2 text-sm">
                          <span className="text-indigo-300 font-bold">🗳️ Eleição 2026:</span> <span className="text-slate-200">{d.eleicaoAtual.cargo || '—'}</span>
                          {d.eleicaoAtual.situacao ? <span className="text-slate-400"> · {d.eleicaoAtual.situacao}</span> : null}
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                        <div>
                          <Section icon={Globe} title="Redes sociais">
                            {arr(d.redesSociais).length ? <ul className="text-sm text-slate-300 space-y-0.5">{arr(d.redesSociais).map((r: any, i: number) => typeof r === 'string' ? <li key={i}>{r}</li> : <li key={i}><b>{r.rede}</b> {r.handle} <span className="text-slate-500">— {r.observacao}</span></li>)}</ul> : <p className="text-xs text-slate-600">—</p>}
                          </Section>
                          <Section icon={Target} title="Pautas principais"><List items={d.pautasPrincipais} /></Section>
                          <Section icon={Megaphone} title="Narrativas"><List items={d.narrativas} /></Section>
                          <Section icon={Megaphone} title="Anúncios (Biblioteca da Meta)">
                            <p className="text-sm text-slate-300">{d.anunciosMeta?.resumo || '—'}{d.anunciosMeta?.fonte ? <span className="text-[10px] text-emerald-400 ml-1">• {d.anunciosMeta.fonte}</span> : null}</p>
                            {d.anunciosMeta?.verificarEm && (
                              <a href={d.anunciosMeta.verificarEm} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-400 underline">Conferir na Biblioteca de Anúncios da Meta →</a>
                            )}
                            {arr(d.anunciosMeta?.exemplos).length > 0 && (
                              <ul className="mt-1 space-y-1.5">
                                {arr(d.anunciosMeta.exemplos).map((a: any, i: number) => (
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
                          {d.historicoEleitoral && (d.historicoEleitoral.resumo || d.historicoEleitoral.ondeForte?.length) && (
                            <Section icon={TrendingUp} title="Histórico eleitoral">
                              <p className="text-sm text-slate-300">{d.historicoEleitoral.resumo}</p>
                              {arr(d.historicoEleitoral.ondeForte).length ? <p className="text-xs text-emerald-400 mt-0.5">Forte: {arr(d.historicoEleitoral.ondeForte).join(', ')}</p> : null}
                              {arr(d.historicoEleitoral.ondeFraco).length ? <p className="text-xs text-rose-400">Fraco: {arr(d.historicoEleitoral.ondeFraco).join(', ')}</p> : null}
                            </Section>
                          )}
                          {d.patrimonio && (d.patrimonio.resumo || d.patrimonio.empresas?.length) && (
                            <Section icon={Globe} title="Patrimônio & empresas">
                              <p className="text-sm text-slate-300">{d.patrimonio.resumo}{d.patrimonio.fonte ? <span className="text-[10px] text-slate-500 ml-1">({d.patrimonio.fonte})</span> : null}</p>
                              {arr(d.patrimonio.empresas).length ? <List items={d.patrimonio.empresas} /> : null}
                            </Section>
                          )}
                          {d.tseDivulgacand && (d.tseDivulgacand.resumo || d.tseDivulgacand.numero) && (
                            <Section icon={ShieldAlert} title="TSE / Candidatura">
                              <p className="text-sm text-slate-300">{d.tseDivulgacand.resumo}</p>
                              <p className="text-xs text-slate-400 mt-0.5">
                                {d.tseDivulgacand.numero ? `Nº ${d.tseDivulgacand.numero} ` : ''}{d.tseDivulgacand.partido ? `· ${d.tseDivulgacand.partido} ` : ''}{d.tseDivulgacand.situacao ? `· ${d.tseDivulgacand.situacao}` : ''}
                              </p>
                              {d.tseDivulgacand.bensDeclarados ? <p className="text-xs text-slate-400">Bens: {d.tseDivulgacand.bensDeclarados}</p> : null}
                              {arr(d.tseDivulgacand.doadores).length ? <p className="text-xs text-slate-400">Doadores: {arr(d.tseDivulgacand.doadores).join(', ')}</p> : null}
                              {arr(d.tseDivulgacand.maioresGastos).length ? <p className="text-xs text-slate-400">Maiores gastos: {arr(d.tseDivulgacand.maioresGastos).join(', ')}</p> : null}
                              {d.tseDivulgacand.linkOficial && <a href={d.tseDivulgacand.linkOficial} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-400 underline">Conferir no DivulgaCandContas (TSE) →</a>}
                            </Section>
                          )}
                          {arr(d.processos).length > 0 && <Section icon={ShieldAlert} title="Processos / sanções">
                            <ul className="text-sm text-slate-300 space-y-1">{arr(d.processos).map((p: any, i: number) => (
                              <li key={i}>• {typeof p === 'string' ? p : <>{p.titulo}{(p.fonte || p.data) && <span className="text-[10px] text-slate-500 ml-1">({[p.fonte, p.data].filter(Boolean).join(', ')})</span>}</>}</li>
                            ))}</ul>
                          </Section>}
                          {d.tendencia && <Section icon={TrendingUp} title="Tendência (busca/pesquisas)"><p className="text-sm text-slate-300">{d.tendencia}</p></Section>}
                          <Section icon={Newspaper} title="Notícias recentes">
                            {arr(d.noticiasRecentes).length ? <ul className="text-sm text-slate-300 space-y-1">{arr(d.noticiasRecentes).map((n: any, i: number) => typeof n === 'string' ? <li key={i}>📰 {n}</li> : <li key={i}>📰 <b>{n.titulo}</b> <span className="text-slate-500">({n.fonte}{n.data ? `, ${n.data}` : ''})</span>{n.contexto && <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded ml-1 ${String(n.contexto).includes('2026') ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-700 text-slate-400'}`}>{n.contexto}</span>} {n.url && <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">link</a>}</li>)}</ul> : <p className="text-xs text-slate-600">—</p>}
                          </Section>
                          {arr(d.fontes).length > 0 && <p className="text-[10px] text-slate-600 mt-2">Fontes: {arr(d.fontes).slice(0, 8).join(' · ')}</p>}
                        </div>
                      </div>
                      </>
                    )}
                    <div className="flex justify-end gap-4 mt-3">
                      {it.dossier && (
                        <button onClick={() => setPrinting(it)} className="text-indigo-400 hover:text-indigo-300 text-xs flex items-center gap-1"><Printer className="w-3.5 h-3.5" /> Imprimir / PDF</button>
                      )}
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

      {printing && <CompetitiveIntelReport intel={printing} cnpj={cnpj} onClose={() => setPrinting(null)} />}
    </div>
  );
};

export default CompetitiveIntelPanel;
