import * as React from 'react';
import { LOGO_MONO_BASE64 } from '../../constants';
import { Brain, TrendingUp, AlertTriangle, CheckCircle2, Target, Printer, X } from 'lucide-react';

/**
 * Full-screen, printable consultant report — matches the platform's report
 * standard (white theme, logo header, numbered sections with a left accent
 * bar, print support), instead of a cramped dark modal.
 *
 * Rendered by SupremeAdminPage when an analysis is ready.
 */

interface ConsultantReportProps {
  campaignName: string;
  result: any; // { provider, model, analysis, snapshot, rawText? }
  onClose: () => void;
}

const scoreColor = (s: number) =>
  s >= 60 ? '#059669' : s >= 35 ? '#d97706' : '#dc2626';

const SectionTitle: React.FC<{ n: number; children: React.ReactNode }> = ({ n, children }) => (
  <h3 className="text-xl font-bold border-l-4 border-indigo-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
    {n}. {children}
  </h3>
);

const ConsultantReport: React.FC<ConsultantReportProps> = ({ campaignName, result, onClose }) => {
  const a = result?.analysis;
  const snap = result?.snapshot;
  // Quando há seção de Evolução (2), as demais deslocam +1.
  const off = a?.evolucao?.comparavel ? 1 : 0;

  const cnpj = snap?.campaign?.cnpj;

  return (
    <div id="consultant-report" className="fixed inset-0 bg-white text-slate-900 z-[9999] overflow-y-auto p-8 print:p-0 print:static">
      <style>{`
        @media print {
          /* Imprime APENAS o relatório — ancora o início na logo/nome,
             escondendo a tela por trás (header SUPREME CONTROL, tabela, etc). */
          body * { visibility: hidden !important; }
          #consultant-report, #consultant-report * { visibility: visible !important; }
          #consultant-report {
            position: absolute !important;
            inset: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }
          .no-print { display: none !important; }
          /* Mantém cada bloco inteiro na mesma página (empurra pra próxima
             se não couber, em vez de cortar no meio). */
          .report-block { break-inside: avoid; page-break-inside: avoid; }
          .report-section { break-inside: avoid; page-break-inside: avoid; margin-bottom: 18px; }
          /* Rodapé fixo repetido em todas as páginas (CNPJ — TRE/TSE). */
          .print-footer { position: fixed; bottom: 0; left: 0; right: 0; display: block !important; }
          @page { margin: 14mm 12mm 20mm 12mm; }
        }
      `}</style>

      {/* Rodapé que repete em toda página impressa (CNPJ obrigatório TRE/TSE) */}
      <div className="print-footer hidden text-[9px] text-slate-500 border-t border-slate-300 pt-1 px-2">
        {cnpj
          ? `CNPJ da campanha: ${cnpj} · Documento gerado por CampanhaPro · campanhapro2.tesseractauto.com.br`
          : `⚠ CNPJ da campanha não cadastrado (obrigatório TSE) · CampanhaPro · campanhapro2.tesseractauto.com.br`}
      </div>

      {/* Toolbar (não imprime) */}
      <div className="no-print mb-8 flex justify-between items-center">
        <button onClick={onClose} className="px-4 py-2 bg-slate-800 text-slate-200 rounded-md hover:bg-slate-700 flex items-center gap-2">
          <X className="h-4 w-4" /> Fechar
        </button>
        <button onClick={() => window.print()} className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-500 flex items-center gap-2">
          <Printer className="h-4 w-4" /> Imprimir / PDF
        </button>
      </div>

      {/* Cabeçalho */}
      <div className="flex justify-between items-start border-b-2 border-slate-200 pb-6 mb-8">
        <div className="flex items-center gap-4">
          <img src={LOGO_MONO_BASE64} alt="Logo" className="h-16 w-16 object-contain" referrerPolicy="no-referrer" />
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-tight">{campaignName || 'Campanha'}</h1>
            <p className="text-sm text-slate-500 flex items-center gap-1.5"><Brain className="h-4 w-4 text-indigo-600" /> Consultoria Estratégica de Campanha</p>
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-lg font-bold text-indigo-700">Relatório de Conversão & SWOT</h2>
          <p className="text-xs text-slate-500">Gerado em {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}</p>
          {result?.provider && <p className="text-xs text-slate-400">IA: {result.provider} / {result.model}</p>}
        </div>
      </div>

      {!a ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="font-bold text-amber-800 mb-2">A IA não retornou um relatório estruturado.</p>
          {result?.rawText && <pre className="text-sm text-slate-700 whitespace-pre-wrap">{result.rawText}</pre>}
        </div>
      ) : (
        <div className="space-y-10">
          {/* 1. Panorama */}
          <section className="report-section">
            <SectionTitle n={1}>Panorama Estratégico</SectionTitle>
            <div className="flex items-center gap-6 bg-slate-50 p-6 rounded-xl border border-slate-200">
              <div className="shrink-0 w-28 h-28 rounded-full flex flex-col items-center justify-center border-8"
                   style={{ borderColor: scoreColor(a.scoreConversao ?? 0) }}>
                <span className="text-4xl font-black" style={{ color: scoreColor(a.scoreConversao ?? 0) }}>{a.scoreConversao ?? '—'}</span>
                <span className="text-[9px] uppercase font-bold text-slate-400">Score</span>
              </div>
              <div>
                <p className="text-xs uppercase font-bold text-slate-500 tracking-wider mb-1">Resumo Executivo</p>
                <p className="text-slate-700 leading-relaxed">{a.resumoExecutivo}</p>
              </div>
            </div>
          </section>

          {/* Evolução vs análise anterior */}
          {a.evolucao?.comparavel && (
            <section className="report-section">
              <SectionTitle n={2}>Evolução desde a Última Análise</SectionTitle>
              <div className={`rounded-xl border p-6 ${
                a.evolucao.tendencia === 'avanco' ? 'bg-emerald-50 border-emerald-200'
                : a.evolucao.tendencia === 'retrocesso' ? 'bg-rose-50 border-rose-200'
                : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex items-center gap-4 mb-4">
                  <span className={`text-xs font-black uppercase px-3 py-1 rounded-full ${
                    a.evolucao.tendencia === 'avanco' ? 'bg-emerald-600 text-white'
                    : a.evolucao.tendencia === 'retrocesso' ? 'bg-rose-600 text-white'
                    : 'bg-slate-500 text-white'}`}>
                    {a.evolucao.tendencia === 'avanco' ? '▲ Avanço' : a.evolucao.tendencia === 'retrocesso' ? '▼ Retrocesso' : '＝ Estável'}
                  </span>
                  {typeof a.evolucao.scoreAnterior === 'number' && (
                    <span className="text-sm text-slate-600 font-mono">
                      Score: {a.evolucao.scoreAnterior} → <strong style={{ color: scoreColor(a.scoreConversao ?? 0) }}>{a.scoreConversao}</strong>
                    </span>
                  )}
                </div>
                {a.evolucao.resumoComparativo && <p className="text-slate-700 mb-4">{a.evolucao.resumoComparativo}</p>}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 mb-2">Avanços</p>
                    <ul className="space-y-1.5">
                      {(a.evolucao.avancos ?? []).map((x: string, i: number) => (
                        <li key={i} className="text-sm text-slate-700 flex gap-1.5"><span className="text-emerald-600">▲</span>{x}</li>
                      ))}
                      {!(a.evolucao.avancos?.length) && <li className="text-sm text-slate-400">—</li>}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-rose-700 mb-2">Retrocessos / Estagnação</p>
                    <ul className="space-y-1.5">
                      {(a.evolucao.retrocessos ?? []).map((x: string, i: number) => (
                        <li key={i} className="text-sm text-slate-700 flex gap-1.5"><span className="text-rose-600">▼</span>{x}</li>
                      ))}
                      {!(a.evolucao.retrocessos?.length) && <li className="text-sm text-slate-400">—</li>}
                    </ul>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Funil */}
          {a.funilConversao && (
            <section className="report-section">
              <SectionTitle n={2 + off}>Funil de Conversão (Eleitor → Apoiador → Votante)</SectionTitle>
              <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 space-y-3">
                <p className="text-slate-700 leading-relaxed">{a.funilConversao.diagnostico}</p>
                {a.funilConversao.maiorGargalo && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800"><strong>Maior gargalo:</strong> {a.funilConversao.maiorGargalo}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 3. SWOT */}
          {a.swot && (
            <section className="report-section">
              <SectionTitle n={3 + off}>Análise SWOT</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { k: 'forcas', label: 'Forças', cls: 'bg-emerald-50 border-emerald-200', tcls: 'text-emerald-700', icon: <CheckCircle2 className="h-4 w-4" /> },
                  { k: 'fraquezas', label: 'Fraquezas', cls: 'bg-rose-50 border-rose-200', tcls: 'text-rose-700', icon: <AlertTriangle className="h-4 w-4" /> },
                  { k: 'oportunidades', label: 'Oportunidades', cls: 'bg-sky-50 border-sky-200', tcls: 'text-sky-700', icon: <TrendingUp className="h-4 w-4" /> },
                  { k: 'ameacas', label: 'Ameaças', cls: 'bg-amber-50 border-amber-200', tcls: 'text-amber-700', icon: <AlertTriangle className="h-4 w-4" /> },
                ].map(({ k, label, cls, tcls, icon }) => (
                  <div key={k} className={`border rounded-xl p-4 ${cls}`}>
                    <p className={`text-sm font-bold uppercase tracking-wide mb-2 flex items-center gap-1.5 ${tcls}`}>{icon} {label}</p>
                    <ul className="space-y-1.5">
                      {(a.swot[k] ?? []).map((item: string, i: number) => (
                        <li key={i} className="text-sm text-slate-700 flex gap-1.5"><span className={tcls}>•</span>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 4. Diagnóstico por fase */}
          {Array.isArray(a.diagnosticoPorFase) && a.diagnosticoPorFase.length > 0 && (
            <section className="report-section">
              <SectionTitle n={4 + off}>Diagnóstico por Fase</SectionTitle>
              <div className="space-y-2">
                {a.diagnosticoPorFase.map((f: any, i: number) => (
                  <div key={i} className="report-block flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <span className={`mt-1 w-3 h-3 rounded-full shrink-0 ${f.status === 'bom' ? 'bg-emerald-500' : f.status === 'critico' ? 'bg-rose-500' : 'bg-amber-500'}`} />
                    <div>
                      <p className="font-bold text-slate-800">{f.fase}</p>
                      <p className="text-sm text-slate-600">{f.observacao}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 5. Recomendações */}
          {Array.isArray(a.recomendacoes) && a.recomendacoes.length > 0 && (
            <section className="report-section">
              <SectionTitle n={5 + off}>Plano de Ação Recomendado</SectionTitle>
              <div className="space-y-3">
                {a.recomendacoes.map((r: any, i: number) => (
                  <div key={i} className="report-block bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-start gap-3">
                    <Target className="h-5 w-5 text-indigo-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${r.prioridade === 'alta' ? 'bg-rose-100 text-rose-700' : r.prioridade === 'media' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{r.prioridade}</span>
                        <span className="font-bold text-slate-800">{r.acao}</span>
                      </div>
                      {r.impactoEsperado && <p className="text-sm text-slate-600">{r.impactoEsperado}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Apêndice: dados analisados */}
          {snap && (
            <section className="report-section">
              <SectionTitle n={6 + off}>Dados Analisados (Apêndice)</SectionTitle>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                {[
                  { l: 'Contatos', v: snap.contacts?.total ?? 0 },
                  { l: 'Visitas', v: snap.visits?.total ?? 0 },
                  { l: 'Reportes', v: snap.streetReports?.total ?? 0 },
                  { l: 'Pesquisas', v: snap.pesquisas?.total ?? 0 },
                  { l: 'Engajamento', v: snap.engagement?.total ?? 0 },
                  { l: 'WhatsApp msgs', v: snap.whatsapp?.messages ?? 0 },
                  { l: 'Tokens IA', v: (snap.ai?.tokens ?? 0).toLocaleString('pt-BR') },
                  { l: 'Custo IA', v: `$${(snap.ai?.costUsd ?? 0).toFixed(2)}` },
                ].map((s, i) => (
                  <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <p className="text-2xl font-black text-slate-800">{s.v}</p>
                    <p className="text-[10px] uppercase font-bold text-slate-500">{s.l}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <p className="text-center text-xs text-slate-400 pt-6 border-t border-slate-200">
            Relatório gerado por IA · CampanhaPro · {new Date().getFullYear()}
          </p>
        </div>
      )}
    </div>
  );
};

export default ConsultantReport;
