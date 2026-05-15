import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Download, Filter, Map as MapIcon, ChevronRight, LayoutGrid, List, FileSpreadsheet, FileJson } from 'lucide-react';
import ElectionReportGenerator from '../components/election/ElectionReportGenerator';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';

interface ReportDef {
  id: string;
  title: string;
  category: string;
  type: string;
}

const reports: ReportDef[] = [
  { id: '1', title: 'Comparativo Geral: Voto Real vs Projeção', category: 'Macro', type: 'PDF' },
  { id: '2', title: 'Performance por Bairro: Top 10 Bairros', category: 'Geográfico', type: 'Excel' },
  { id: '3', title: 'Detalhamento por Zona Eleitoral', category: 'Técnico', type: 'PDF' },
  { id: '4', title: 'ROI da Campanha: Custo por Voto Real', category: 'Financeiro', type: 'Excel' },
  { id: '5', title: 'Relatório de Seções e Locais de Votação', category: 'Operacional', type: 'CSV' },
  { id: '6', title: 'Análise de Fidelidade da Base (Fiscais)', category: 'Equipe', type: 'PDF' },
];

const ElectionReportsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [activeReport, setActiveReport] = useState<ReportDef | null>(null);

  // Filtros derivados da base do CRM (contacts).
  const [zones, setZones] = useState<string[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<string[]>([]);
  const [filterZone, setFilterZone] = useState('');
  const [filterNeighborhood, setFilterNeighborhood] = useState('');
  const [statusFinalizada, setStatusFinalizada] = useState(true);
  const [statusParcial, setStatusParcial] = useState(false);

  useEffect(() => {
    if (!user?.campaignId) return;
    let alive = true;

    const loadFilterOptions = async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('electoralZone, neighborhood')
        .eq('campaignId', user.campaignId)
        .limit(5000);

      if (error || !alive) return;

      const zoneSet = new Set<string>();
      const bairroSet = new Set<string>();
      (data || []).forEach((row: any) => {
        if (row.electoralZone) zoneSet.add(String(row.electoralZone).trim());
        if (row.neighborhood) bairroSet.add(String(row.neighborhood).trim());
      });
      setZones([...zoneSet].sort());
      setNeighborhoods([...bairroSet].sort());
    };

    loadFilterOptions();
    return () => { alive = false; };
  }, [user?.campaignId]);

  const handleOpenReport = (report: ReportDef) => {
    setActiveReport(report);
  };

  const handleApplyFilters = () => {
    // Persistido no state local; o ElectionReportGenerator pode consumir via prop futuramente.
    console.log('[Analytics] Filtros aplicados:', {
      zone: filterZone || '(todas)',
      neighborhood: filterNeighborhood || '(todos)',
      finalizada: statusFinalizada,
      parcial: statusParcial,
    });
  };

  return (
    <>
      {activeReport && (
        <ElectionReportGenerator
          reportId={activeReport.id}
          reportTitle={activeReport.title}
          onClose={() => setActiveReport(null)}
        />
      )}

      <div className="p-6 bg-[#0a0a0b] min-h-screen text-white">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <FileText className="text-blue-400" />
              Analytics e Relatórios Eleitorais
            </h1>
            <p className="text-gray-400">Dados consolidados para auditoria e prestação de contas.</p>
          </div>

          <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-white'}`}
            >
              <List className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-white'}`}
            >
              <LayoutGrid className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          {/* Sidebar */}
          <div className="md:col-span-1 space-y-6">
            <div className="bg-[#161b22] p-6 rounded-2xl border border-white/5">
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4 flex items-center gap-2">
                <Filter className="w-4 h-4" /> Filtros Avançados
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Zona Eleitoral</label>
                  <select
                    value={filterZone}
                    onChange={e => setFilterZone(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Todas as Zonas</option>
                    {zones.map(z => <option key={z} value={z}>{z}</option>)}
                  </select>
                  {zones.length === 0 && (
                    <p className="text-[10px] text-gray-600 mt-1 italic">
                      Nenhuma zona cadastrada nos eleitores do CRM ainda.
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Bairro</label>
                  <select
                    value={filterNeighborhood}
                    onChange={e => setFilterNeighborhood(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Todos os Bairros</option>
                    {neighborhoods.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  {neighborhoods.length === 0 && (
                    <p className="text-[10px] text-gray-600 mt-1 italic">
                      Nenhum bairro cadastrado nos eleitores do CRM ainda.
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Status de Apuração</label>
                  <div className="space-y-2 mt-2">
                    <label className="flex items-center gap-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={statusFinalizada}
                        onChange={e => setStatusFinalizada(e.target.checked)}
                        className="rounded border-white/10 bg-black/40"
                      />
                      Finalizada (100%)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={statusParcial}
                        onChange={e => setStatusParcial(e.target.checked)}
                        className="rounded border-white/10 bg-black/40"
                      />
                      Parcial
                    </label>
                  </div>
                </div>

                <button
                  onClick={handleApplyFilters}
                  className="w-full bg-blue-600 hover:bg-blue-500 py-2 rounded-lg text-sm font-bold transition-all mt-4"
                >
                  Aplicar Filtros
                </button>
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-600/20 to-emerald-600/20 p-6 rounded-2xl border border-blue-500/20 relative overflow-hidden group">
              <div className="relative z-10">
                <MapIcon className="w-10 h-10 text-blue-400 mb-4" />
                <h4 className="font-bold mb-2">Relatório Geográfico</h4>
                <p className="text-xs text-gray-400 leading-relaxed mb-4">
                  Exporte o mapa de calor completo com a densidade de votos por seção eleitoral.
                </p>
                <button
                  onClick={() => navigate('/app/dia-das-eleicoes')}
                  className="text-xs font-bold text-blue-400 hover:underline flex items-center gap-1"
                >
                  Visualizar no Mapa <ChevronRight className="w-3 h-3" />
                </button>
              </div>
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-blue-500/20 transition-all"></div>
            </div>
          </div>

          {/* Report list */}
          <div className="md:col-span-3">
            <div className="bg-[#161b22] rounded-2xl border border-white/5 overflow-hidden">
              <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                <h3 className="font-bold">Biblioteca de Relatórios</h3>
                <div className="text-xs text-gray-500">Exibindo {reports.length} documentos</div>
              </div>

              <div className={viewMode === 'list' ? 'divide-y divide-white/5' : 'grid grid-cols-1 md:grid-cols-2 gap-4 p-6'}>
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className={`group transition-all cursor-pointer ${
                      viewMode === 'list'
                        ? 'p-4 flex items-center justify-between hover:bg-white/[0.02]'
                        : 'p-6 rounded-xl bg-white/5 border border-white/5 hover:border-blue-500/30 hover:bg-white/[0.08]'
                    }`}
                    onClick={() => handleOpenReport(report)}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-xl ${
                        report.type === 'PDF' ? 'bg-red-500/10 text-red-400' :
                        report.type === 'Excel' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400'
                      }`}>
                        {report.type === 'PDF' ? <FileText className="w-6 h-6" /> :
                         report.type === 'Excel' ? <FileSpreadsheet className="w-6 h-6" /> :
                         <FileJson className="w-6 h-6" />}
                      </div>
                      <div>
                        <h4 className="font-bold text-sm group-hover:text-blue-400 transition-colors">{report.title}</h4>
                        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mt-1">{report.category}</p>
                      </div>
                    </div>

                    <div className={`flex items-center gap-3 ${viewMode === 'grid' ? 'mt-6' : ''}`}>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleOpenReport(report); }}
                        className="p-2 rounded-lg bg-white/5 hover:bg-blue-600 hover:text-white transition-all text-gray-400"
                        title="Gerar Relatório"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-[#161b22] p-6 rounded-2xl border border-white/5">
                <h4 className="font-bold mb-4 flex items-center gap-2 uppercase text-xs tracking-widest text-gray-500">
                  Resumo da Exportação
                </h4>
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-4xl font-black text-white">{reports.length}</div>
                    <p className="text-xs text-gray-500">Relatórios disponíveis nesta campanha</p>
                  </div>
                  <div className="h-2 w-32 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 w-full"></div>
                  </div>
                </div>
              </div>

              <div className="bg-[#161b22] p-6 rounded-2xl border border-white/5">
                <h4 className="font-bold mb-4 flex items-center gap-2 uppercase text-xs tracking-widest text-gray-500">
                  Dados em Tempo Real
                </h4>
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-4xl font-black text-white">Live</div>
                    <p className="text-xs text-gray-500">Todos os relatórios usam dados ao vivo do Supabase</p>
                  </div>
                  <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default ElectionReportsPage;
