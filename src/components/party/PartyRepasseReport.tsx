/**
 * Relatório de Repasses imprimível (#144).
 *
 * Overlay full-screen com a lista de repasses do partido formatada pra
 * impressão. Usa window.print() (decisão: sem backend PDF) com CSS de
 * impressão isolado — só o relatório vai pro papel/PDF do navegador.
 */
import React, { useEffect, useState } from 'react';
import { X, Printer, Loader2, FileText } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

interface ReportItem {
  candidato: string;
  cargo: string;
  regiao: string;
  valor: number;
  data: string | null;
  descricao: string;
}
interface ReportData {
  partyName: string;
  geradoEm: string;
  totalGeral: number;
  totalRepasses: number;
  items: ReportItem[];
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

const PartyRepasseReport: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetch('/api/v1/party/repasses-report')
      .then((r) => r.json())
      .then((j) => { if (j.error) setError(j.error); else setData(j); })
      .catch((e) => setError(e?.message || 'erro'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4 print:bg-white print:p-0 print:block">
      <div className="bg-white text-slate-900 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col print:max-w-none print:max-h-none print:rounded-none print:shadow-none">
        {/* Toolbar (não imprime) */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50 print:hidden">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-slate-800">Relatório de Repasses</h3>
          </div>
          <div className="flex gap-2">
            <button onClick={() => window.print()} disabled={!data}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
              <Printer className="w-4 h-4" /> Imprimir / Salvar PDF
            </button>
            <button onClick={onClose} className="p-2 text-slate-500 hover:text-slate-800"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Conteúdo imprimível */}
        <div className="flex-1 overflow-y-auto p-8 print:overflow-visible print:p-10" id="repasse-report-print">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-indigo-600 animate-spin" /></div>
          ) : error ? (
            <p className="text-red-600 text-sm py-8 text-center">Erro ao gerar relatório: {error}</p>
          ) : data ? (
            <>
              <div className="border-b-2 border-slate-800 pb-4 mb-5">
                <h1 className="text-2xl font-black text-slate-900">{data.partyName}</h1>
                <p className="text-sm text-slate-600 mt-0.5">Relatório de Repasses</p>
                <p className="text-xs text-slate-500 mt-1">Gerado em {new Date(data.geradoEm).toLocaleString('pt-BR')}</p>
              </div>

              <div className="flex gap-6 mb-5 text-sm">
                <div><span className="text-slate-500">Total de repasses:</span> <b>{data.totalRepasses}</b></div>
                <div><span className="text-slate-500">Valor total:</span> <b className="text-emerald-700">{brl(data.totalGeral)}</b></div>
              </div>

              {data.items.length === 0 ? (
                <p className="text-slate-500 text-sm py-8 text-center">Nenhum repasse registrado.</p>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b-2 border-slate-300 text-left text-slate-600">
                      <th className="py-2 pr-3">Data</th>
                      <th className="py-2 pr-3">Candidato</th>
                      <th className="py-2 pr-3">Cargo / Região</th>
                      <th className="py-2 pr-3">Finalidade</th>
                      <th className="py-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it, i) => (
                      <tr key={i} className="border-b border-slate-200">
                        <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(it.data)}</td>
                        <td className="py-2 pr-3 font-medium">{it.candidato}</td>
                        <td className="py-2 pr-3 text-slate-600 text-xs">{[it.cargo, it.regiao].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="py-2 pr-3 text-slate-600">{it.descricao || '—'}</td>
                        <td className="py-2 text-right font-semibold whitespace-nowrap">{brl(it.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-800 font-bold">
                      <td className="py-3" colSpan={4}>TOTAL</td>
                      <td className="py-3 text-right text-emerald-700">{brl(data.totalGeral)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}

              <p className="text-[10px] text-slate-400 mt-8 pt-4 border-t border-slate-200">
                Documento gerado pelo CampanhaPro · {data.partyName} · uso interno do partido.
              </p>
            </>
          ) : null}
        </div>
      </div>

      {/* CSS de impressão: isola só o relatório */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #repasse-report-print, #repasse-report-print * { visibility: visible; }
          #repasse-report-print { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
    </div>
  );
};

export default PartyRepasseReport;
