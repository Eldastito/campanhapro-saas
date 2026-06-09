import * as React from 'react';
import { LOGO_MONO_BASE64 } from '../../constants';
import { Swords, Printer, X, TrendingUp, AlertTriangle, CheckCircle2, Target, Newspaper, Megaphone, Globe } from 'lucide-react';

/**
 * Relatório imprimível de Inteligência Competitiva — mesmo padrão dos outros
 * relatórios da plataforma (overlay branco, logo, seções, @media print isolado,
 * rodapé com CNPJ). Renderizado pelo CompetitiveIntelPanel.
 */
interface Props {
  intel: any;            // { name, cargo, cidade, uf, dossier, createdAt }
  cnpj?: string | null;
  onClose: () => void;
}

const Block: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <section className="report-section">
    <h3 className="text-xl font-bold border-l-4 border-rose-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">{n}. {title}</h3>
    {children}
  </section>
);
const UL: React.FC<{ items?: any[]; color?: string }> = ({ items, color = 'text-slate-700' }) => (
  (items && items.length) ? <ul className="space-y-1.5">{items.map((x, i) => <li key={i} className={`text-sm flex gap-1.5 ${color}`}><span>•</span>{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}</ul>
    : <p className="text-sm text-slate-400">—</p>
);

const CompetitiveIntelReport: React.FC<Props> = ({ intel, cnpj, onClose }) => {
  const d = intel?.dossier || {};
  let n = 0;
  return (
    <div id="intel-report" className="fixed inset-0 bg-white text-slate-900 z-[9999] overflow-y-auto p-8 print:p-0 print:static">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #intel-report, #intel-report * { visibility: visible !important; }
          #intel-report { position: absolute !important; inset: 0 !important; padding: 0 !important; overflow: visible !important; }
          .no-print { display: none !important; }
          .report-section { break-inside: avoid; page-break-inside: avoid; margin-bottom: 18px; }
          .print-footer { position: fixed; bottom: 0; left: 0; right: 0; display: block !important; }
          @page { margin: 14mm 12mm 20mm 12mm; }
        }
      `}</style>

      <div className="print-footer hidden text-[9px] text-slate-500 border-t border-slate-300 pt-1 px-2">
        {cnpj
          ? `CNPJ da campanha: ${cnpj} · Inteligência competitiva (fontes públicas) · CampanhaPro · campanhapro2.tesseractauto.com.br`
          : `Inteligência competitiva (fontes públicas) · CampanhaPro · campanhapro2.tesseractauto.com.br`}
      </div>

      <div className="no-print mb-8 flex justify-between items-center">
        <button onClick={onClose} className="px-4 py-2 bg-slate-800 text-slate-200 rounded-md hover:bg-slate-700 flex items-center gap-2"><X className="h-4 w-4" /> Fechar</button>
        <button onClick={() => window.print()} className="px-4 py-2 bg-rose-600 text-white rounded-md hover:bg-rose-500 flex items-center gap-2"><Printer className="h-4 w-4" /> Imprimir / PDF</button>
      </div>

      <div className="flex justify-between items-start border-b-2 border-slate-200 pb-6 mb-8">
        <div className="flex items-center gap-4">
          <img src={LOGO_MONO_BASE64} alt="Logo" className="h-16 w-16 object-contain" referrerPolicy="no-referrer" />
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-tight">{intel?.name}{intel?.cargo ? ` · ${intel.cargo}` : ''}</h1>
            <p className="text-sm text-slate-500 flex items-center gap-1.5"><Swords className="h-4 w-4 text-rose-600" /> Inteligência Competitiva {intel?.cidade ? `· ${intel.cidade}/${intel.uf || ''}` : ''}</p>
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-lg font-bold text-rose-700">Dossiê do Adversário</h2>
          <p className="text-xs text-slate-500">Gerado em {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}</p>
          <p className="text-[10px] text-slate-400">Baseado em fontes públicas</p>
        </div>
      </div>

      <div className="space-y-10">
        {d.resumo && <Block n={++n} title="Resumo Executivo"><p className="text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200">{d.resumo}</p></Block>}

        {(d.redesSociais?.length) > 0 && (
          <Block n={++n} title="Presença Digital">
            <ul className="space-y-1.5">{d.redesSociais.map((r: any, i: number) => <li key={i} className="text-sm text-slate-700"><Globe className="h-3.5 w-3.5 inline text-slate-500" /> <b>{r.rede}</b> {r.handle} <span className="text-slate-500">— {r.observacao}</span></li>)}</ul>
          </Block>
        )}

        {(d.pautasPrincipais?.length || d.narrativas?.length) > 0 && (
          <Block n={++n} title="Pautas & Narrativas">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs font-bold uppercase text-slate-500 mb-1">Pautas principais</p><UL items={d.pautasPrincipais} /></div>
              <div><p className="text-xs font-bold uppercase text-slate-500 mb-1">Narrativas</p><UL items={d.narrativas} /></div>
            </div>
          </Block>
        )}

        <Block n={++n} title="SWOT Competitivo">
          <div className="grid grid-cols-2 gap-4">
            <div className="border rounded-xl p-4 bg-emerald-50 border-emerald-200"><p className="text-sm font-bold uppercase text-emerald-700 mb-2 flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> Forças (dele)</p><UL items={d.pontosFortes} color="text-slate-700" /></div>
            <div className="border rounded-xl p-4 bg-rose-50 border-rose-200"><p className="text-sm font-bold uppercase text-rose-700 mb-2 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Fraquezas (dele)</p><UL items={d.pontosFracos} color="text-slate-700" /></div>
            <div className="border rounded-xl p-4 bg-amber-50 border-amber-200"><p className="text-sm font-bold uppercase text-amber-700 mb-2 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Ameaças (p/ nós)</p><UL items={d.ameacasParaNos} color="text-slate-700" /></div>
            <div className="border rounded-xl p-4 bg-sky-50 border-sky-200"><p className="text-sm font-bold uppercase text-sky-700 mb-2 flex items-center gap-1.5"><TrendingUp className="h-4 w-4" /> Oportunidades (p/ nós)</p><UL items={d.oportunidadesParaNos} color="text-slate-700" /></div>
          </div>
        </Block>

        {d.historicoEleitoral && (d.historicoEleitoral.resumo || d.historicoEleitoral.ondeForte?.length) && (
          <Block n={++n} title="Histórico Eleitoral">
            <p className="text-slate-700">{d.historicoEleitoral.resumo}</p>
            {d.historicoEleitoral.ondeForte?.length ? <p className="text-sm text-emerald-700 mt-1"><b>Forte:</b> {d.historicoEleitoral.ondeForte.join(', ')}</p> : null}
            {d.historicoEleitoral.ondeFraco?.length ? <p className="text-sm text-rose-700"><b>Fraco:</b> {d.historicoEleitoral.ondeFraco.join(', ')}</p> : null}
          </Block>
        )}

        {d.patrimonio && (d.patrimonio.resumo || d.patrimonio.empresas?.length) && (
          <Block n={++n} title="Patrimônio & Empresas"><p className="text-slate-700">{d.patrimonio.resumo}</p><UL items={d.patrimonio.empresas} /></Block>
        )}

        {d.processos?.length > 0 && <Block n={++n} title="Processos / Sanções"><UL items={d.processos} /></Block>}

        {d.anunciosMeta && (
          <Block n={++n} title="Anúncios (Biblioteca da Meta)">
            <p className="text-slate-700"><Megaphone className="h-4 w-4 inline text-slate-500" /> {d.anunciosMeta.resumo}</p>
            {(d.anunciosMeta.exemplos || []).length > 0 && (
              <ul className="mt-2 space-y-1.5">{d.anunciosMeta.exemplos.map((a: any, i: number) => (
                <li key={i} className="text-sm text-slate-700">{typeof a === 'string' ? a : <><b>{a.pagina}</b>{a.gasto ? ` · ${a.gasto}` : ''}{a.impressoes ? ` · ${a.impressoes} impr.` : ''} — {a.texto}</>}</li>
              ))}</ul>
            )}
          </Block>
        )}

        {d.tendencia && <Block n={++n} title="Tendência (busca & pesquisas)"><p className="text-slate-700">{d.tendencia}</p></Block>}

        {(d.noticiasRecentes?.length) > 0 && (
          <Block n={++n} title="Notícias Recentes">
            <ul className="space-y-1.5">{d.noticiasRecentes.map((nws: any, i: number) => <li key={i} className="text-sm text-slate-700"><Newspaper className="h-3.5 w-3.5 inline text-slate-500" /> <b>{nws.titulo}</b> <span className="text-slate-500">({nws.fonte}{nws.data ? `, ${nws.data}` : ''})</span></li>)}</ul>
          </Block>
        )}

        {(d.recomendacoes?.length) > 0 && (
          <Block n={++n} title="Recomendações para Nós">
            <div className="space-y-2">{d.recomendacoes.map((r: string, i: number) => <div key={i} className="report-block bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex items-start gap-2"><Target className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" /><span className="text-sm text-slate-700">{r}</span></div>)}</div>
          </Block>
        )}

        {(d.fontes?.length) > 0 && (
          <section className="report-section"><p className="text-[10px] text-slate-400">Fontes consultadas: {d.fontes.slice(0, 15).join(' · ')}</p></section>
        )}

        <p className="text-center text-xs text-slate-400 pt-6 border-t border-slate-200">Inteligência competitiva por fontes públicas · CampanhaPro · {new Date().getFullYear()}</p>
      </div>
    </div>
  );
};

export default CompetitiveIntelReport;
