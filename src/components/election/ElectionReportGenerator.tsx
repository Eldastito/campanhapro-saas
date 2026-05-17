import * as React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTeam } from '../../contexts/TeamContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useFinancial } from '../../contexts/FinancialContext';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { supabase } from '../../lib/supabaseClient';
import { LOGO_MONO_BASE64 } from '../../constants';

interface ElectionReportGeneratorProps {
  reportId: string;
  reportTitle: string;
  onClose: () => void;
}

interface BUData {
  id: string;
  stationId: string;
  votosCandidato: number;
  votosTotalSecao: number;
  createdAt: string;
}

interface FiscalData {
  id: string;
  name: string;
  zone: string;
  section: string;
  status: string;
  votesConfirmed?: number;
  createdAt: string;
}

const ElectionReportGenerator: React.FC<ElectionReportGeneratorProps> = ({ reportId, reportTitle, onClose }) => {
  const { user } = useAuth();
  const { teamMembers } = useTeam();
  const { campaignDetails, headerLogo } = useSettings();
  const { incomes, expenses } = useFinancial();
  const { kpis, bairroRanking, apoiadorRanking } = useDashboardMetrics({
    municipioFilter: '', bairroFilter: '', apoiadorFilter: '', leaderFilter: ''
  });

  const [buData, setBuData] = React.useState<BUData[]>([]);
  const [fiscais, setFiscais] = React.useState<FiscalData[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchElectionData = async () => {
      try {
        const [{ data: bus }, { data: fiscs }] = await Promise.all([
          supabase.from('boletins_urna').select('*').order('createdAt', { ascending: false }),
          supabase.from('election_fiscais').select('*').order('createdAt', { ascending: false }),
        ]);
        setBuData(bus || []);
        setFiscais(fiscs || []);
      } catch (err) {
        console.error('[ElectionReport] Erro ao carregar dados:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchElectionData();
  }, []);

  React.useEffect(() => {
    if (!isLoading) {
      const timer = setTimeout(() => window.print(), 800);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  const totalVotosReais = buData.reduce((acc, b) => acc + (b.votos_candidato || 0), 0);
  const totalSecoesApuradas = buData.length;
  const totalVotosProjetados = kpis.votos;
  const divergencia = totalVotosReais - totalVotosProjetados;

  const totalReceitas = incomes.reduce((s, i) => s + (i.valor || 0), 0);
  const totalDespesas = expenses.reduce((s, e) => s + (e.valor || 0), 0);
  const saldo = totalReceitas - totalDespesas;
  const custoPorVoto = totalVotosReais > 0
    ? (totalDespesas / totalVotosReais).toFixed(2)
    : kpis.votos > 0 ? (totalDespesas / kpis.votos).toFixed(2) : 'N/A';

  const teamROI = teamMembers.map(member => {
    const rankData = apoiadorRanking.find(r => r.name === member.name);
    const visits = rankData?.visits || 0;
    const votes = rankData?.votes || 0;
    const cost = member.cost || 0;
    return {
      name: member.name,
      role: member.role,
      visits,
      votes,
      cost,
      costPerVote: votes > 0 ? (cost / votes).toFixed(2) : '—',
      efficiency: votes >= 10 ? 'Alta' : votes >= 5 ? 'Média' : 'Baixa',
    };
  }).sort((a, b) => b.votes - a.votes);

  const totalTeamCost = teamROI.reduce((s, m) => s + m.cost, 0);

  const bairrosTop10 = bairroRanking.slice(0, 10).map((b, i) => {
    const totalVisitsAll = bairroRanking.reduce((s, x) => s + x.visits, 0) || 1;
    const participacao = ((b.visits / totalVisitsAll) * 100).toFixed(1);
    const conversao = b.visits > 0 ? ((b.votes / b.visits) * 100).toFixed(1) : '0.0';
    return { rank: i + 1, ...b, participacao, conversao };
  });

  const zonas = buData.reduce<Record<string, { secoes: BUData[]; votos: number }>>((acc, bu) => {
    const zona = bu.station_id?.split('-')[0] || 'Zona Não Identificada';
    if (!acc[zona]) acc[zona] = { secoes: [], votos: 0 };
    acc[zona].secoes.push(bu);
    acc[zona].votos += bu.votos_candidato || 0;
    return acc;
  }, {});

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR');
  const timeStr = now.toLocaleTimeString('pt-BR');

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-slate-900/90 z-[10000] flex flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-sky-400 mb-4"></div>
        <h2 className="text-xl font-bold text-white">Carregando Dados do Relatório...</h2>
        <p className="text-slate-400 max-w-sm text-center mt-2">
          Buscando informações da campanha para gerar o relatório.
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-white text-slate-900 z-[9999] overflow-y-auto p-8 print:p-0 print:static print:bg-white print:text-black">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="no-print mb-6">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-slate-800 text-slate-200 rounded-md hover:bg-slate-700 text-sm font-semibold"
        >
          ← Fechar Relatório
        </button>
      </div>

      {/* Header */}
      <div className="flex justify-between items-start border-b-2 border-slate-200 pb-6 mb-8">
        <div className="flex items-center gap-4">
          <img
            src={headerLogo || LOGO_MONO_BASE64}
            alt="Logo"
            className="h-20 w-20 object-contain"
            referrerPolicy="no-referrer"
          />
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tight">
              {campaignDetails.nomeUrna || 'Candidato'}
            </h1>
            <p className="text-xl text-slate-600 font-semibold">
              {campaignDetails.partido || 'Partido'}
            </p>
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-xl font-bold text-sky-700">{reportTitle}</h2>
          <p className="text-sm text-slate-500">Gerado em: {dateStr} às {timeStr}</p>
          <p className="text-sm text-slate-500">Responsável: {user?.name}</p>
          <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider font-semibold">
            Documento Confidencial — Uso Interno
          </p>
        </div>
      </div>

      {/* ====== REPORT 1: Comparativo Geral ====== */}
      {reportId === '1' && (
        <div className="space-y-10">
          <section>
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              1. Resumo Executivo
            </h3>
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div className="bg-sky-50 p-5 rounded-xl border border-sky-200 shadow-sm">
                <p className="text-xs text-sky-600 uppercase font-bold mb-2 tracking-wider">Votos Projetados (Campo)</p>
                <p className="text-4xl font-black text-sky-700">{totalVotosProjetados.toLocaleString('pt-BR')}</p>
                <p className="text-[10px] text-sky-500 mt-2 uppercase font-semibold">Intenções mapeadas em visitas</p>
              </div>
              <div className={`p-5 rounded-xl border shadow-sm ${totalVotosReais > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                <p className={`text-xs uppercase font-bold mb-2 tracking-wider ${totalVotosReais > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                  Votos Reais Apurados
                </p>
                <p className={`text-4xl font-black ${totalVotosReais > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                  {totalVotosReais > 0 ? totalVotosReais.toLocaleString('pt-BR') : 'Aguardando'}
                </p>
                <p className={`text-[10px] mt-2 uppercase font-semibold ${totalVotosReais > 0 ? 'text-emerald-500' : 'text-slate-400'}`}>
                  {totalSecoesApuradas} seções com BU registrado
                </p>
              </div>
              <div className={`p-5 rounded-xl border shadow-sm ${divergencia >= 0 ? 'bg-teal-50 border-teal-200' : 'bg-red-50 border-red-200'}`}>
                <p className={`text-xs uppercase font-bold mb-2 tracking-wider ${divergencia >= 0 ? 'text-teal-600' : 'text-red-600'}`}>
                  Variação Projeção vs Real
                </p>
                <p className={`text-4xl font-black ${divergencia >= 0 ? 'text-teal-700' : 'text-red-600'}`}>
                  {totalVotosReais > 0 ? `${divergencia >= 0 ? '+' : ''}${divergencia.toLocaleString('pt-BR')}` : '—'}
                </p>
                <p className={`text-[10px] mt-2 uppercase font-semibold ${divergencia >= 0 ? 'text-teal-500' : 'text-red-500'}`}>
                  {totalVotosReais > 0
                    ? (divergencia >= 0 ? 'Acima da projeção' : 'Abaixo da projeção')
                    : 'Apuração não iniciada'}
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              2. KPIs de Campo
            </h3>
            <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-800 text-white uppercase text-[10px] tracking-widest font-bold">
                  <tr>
                    <th className="px-6 py-4">Métrica</th>
                    <th className="px-6 py-4 text-center">Valor</th>
                    <th className="px-6 py-4">Descrição</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {[
                    { label: 'Visitas Realizadas', value: kpis.realizadas, desc: 'Total de visitas com status "realizada"' },
                    { label: 'Visitas Pendentes', value: kpis.pendentes, desc: 'Visitas agendadas ainda não realizadas' },
                    { label: 'Votos Mapeados', value: kpis.votos, desc: 'Intenções de voto declaradas em campo' },
                    { label: 'Média Votos/Visita', value: kpis.avgVotos, desc: 'Taxa de conversão por abordagem' },
                    { label: 'Apoiadores Ativos', value: kpis.apoiadoresAtivos, desc: 'Membros com atividade nos últimos 7 dias' },
                    { label: 'Total de Visitas Registradas', value: kpis.total, desc: 'Total de registros de visita no sistema' },
                    { label: 'Materiais Distribuídos', value: kpis.totalMateriais, desc: 'Quantidade de materiais de campanha entregues' },
                  ].map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="px-6 py-4 font-bold text-slate-700">{row.label}</td>
                      <td className="px-6 py-4 text-center font-mono font-black text-sky-700 text-lg">{row.value}</td>
                      <td className="px-6 py-4 text-slate-500 text-xs">{row.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              3. Status da Apuração Paralela
            </h3>
            {buData.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
                <p className="text-amber-700 font-bold">Nenhum Boletim de Urna (BU) registrado ainda.</p>
                <p className="text-amber-600 text-sm mt-1">
                  Os fiscais devem registrar os BUs no Dia D via a tela "Operação Dia D".
                </p>
              </div>
            ) : (
              <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-800 text-white uppercase text-[10px] tracking-widest font-bold">
                    <tr>
                      <th className="px-6 py-4">Seção</th>
                      <th className="px-6 py-4 text-center">Votos Candidato</th>
                      <th className="px-6 py-4 text-center">Total da Seção</th>
                      <th className="px-6 py-4 text-center">% Participação</th>
                      <th className="px-6 py-4">Registrado em</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {buData.slice(0, 20).map((bu, i) => (
                      <tr key={bu.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                        <td className="px-6 py-4 font-bold text-slate-700">{bu.station_id}</td>
                        <td className="px-6 py-4 text-center font-mono font-black text-sky-700">{bu.votos_candidato}</td>
                        <td className="px-6 py-4 text-center font-mono text-slate-600">{bu.votos_total_secao}</td>
                        <td className="px-6 py-4 text-center">
                          <span className="font-bold text-emerald-700">
                            {bu.votos_total_secao > 0
                              ? `${((bu.votos_candidato / bu.votos_total_secao) * 100).toFixed(1)}%`
                              : '—'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-500 text-xs">
                          {new Date(bu.createdAt).toLocaleString('pt-BR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-100 font-black text-slate-800 border-t-2 border-slate-300">
                    <tr>
                      <td className="px-6 py-4 uppercase text-xs tracking-wider">{totalSecoesApuradas} seções</td>
                      <td className="px-6 py-4 text-center font-mono text-sky-700">{totalVotosReais}</td>
                      <td className="px-6 py-4 text-center font-mono">
                        {buData.reduce((s, b) => s + b.votos_total_secao, 0)}
                      </td>
                      <td className="px-6 py-4 text-center font-bold text-emerald-700">
                        {buData.reduce((s, b) => s + b.votos_total_secao, 0) > 0
                          ? `${((totalVotosReais / buData.reduce((s, b) => s + b.votos_total_secao, 0)) * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                      <td className="px-6 py-4"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          <ReportFooter campaignName={campaignDetails.nomeUrna} />
        </div>
      )}

      {/* ====== REPORT 2: Performance por Bairro ====== */}
      {reportId === '2' && (
        <div className="space-y-10">
          <section>
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              1. Visão Geral Geográfica
            </h3>
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div className="bg-sky-50 p-5 rounded-xl border border-sky-200 shadow-sm">
                <p className="text-xs text-sky-600 uppercase font-bold mb-2 tracking-wider">Bairros com Presença</p>
                <p className="text-4xl font-black text-sky-700">{bairroRanking.length}</p>
                <p className="text-[10px] text-sky-500 mt-2 uppercase font-semibold">Territórios mapeados</p>
              </div>
              <div className="bg-emerald-50 p-5 rounded-xl border border-emerald-200 shadow-sm">
                <p className="text-xs text-emerald-600 uppercase font-bold mb-2 tracking-wider">Melhor Bairro</p>
                <p className="text-2xl font-black text-emerald-700 leading-tight">
                  {bairroRanking[0]?.name || '—'}
                </p>
                <p className="text-[10px] text-emerald-500 mt-2 uppercase font-semibold">
                  {bairroRanking[0]?.votes || 0} votos intenção
                </p>
              </div>
              <div className="bg-purple-50 p-5 rounded-xl border border-purple-200 shadow-sm">
                <p className="text-xs text-purple-600 uppercase font-bold mb-2 tracking-wider">Total de Visitas</p>
                <p className="text-4xl font-black text-purple-700">{kpis.realizadas}</p>
                <p className="text-[10px] text-purple-500 mt-2 uppercase font-semibold">Abordagens em campo</p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              2. Ranking Top 10 Bairros
            </h3>
            <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-800 text-white uppercase text-[10px] tracking-widest font-bold">
                  <tr>
                    <th className="px-6 py-4">Pos.</th>
                    <th className="px-6 py-4">Bairro</th>
                    <th className="px-6 py-4 text-center">Visitas</th>
                    <th className="px-6 py-4 text-center">Votos (Intenção)</th>
                    <th className="px-6 py-4 text-center">Conversão</th>
                    <th className="px-6 py-4 text-center">% do Total</th>
                    <th className="px-6 py-4 text-center">Performance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {bairrosTop10.map((b, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="px-6 py-4">
                        <span className={`font-black text-lg ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-amber-700' : 'text-slate-500'}`}>
                          #{b.rank}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-bold text-slate-700">{b.name}</td>
                      <td className="px-6 py-4 text-center font-mono font-semibold">{b.visits}</td>
                      <td className="px-6 py-4 text-center font-mono font-black text-sky-700">{b.votes}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`font-bold ${parseFloat(b.conversao) >= 70 ? 'text-emerald-600' : parseFloat(b.conversao) >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                          {b.conversao}%
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-slate-500">{b.participacao}%</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${
                          parseFloat(b.conversao) >= 70 ? 'bg-green-100 text-green-700' :
                          parseFloat(b.conversao) >= 40 ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {parseFloat(b.conversao) >= 70 ? 'Forte' : parseFloat(b.conversao) >= 40 ? 'Médio' : 'Fraco'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              3. Diagnóstico Territorial
            </h3>
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-teal-50 p-5 rounded-xl border border-teal-100">
                <h5 className="font-bold text-teal-800 text-xs uppercase mb-3 tracking-widest">Territórios Prioritários (Fortalezas)</h5>
                <ul className="space-y-2">
                  {bairroRanking.slice(0, 3).map((b, i) => (
                    <li key={i} className="flex justify-between text-sm border-b border-teal-200 pb-1 last:border-0">
                      <span className="font-medium text-teal-700">{b.name}</span>
                      <span className="font-black text-teal-900">{b.votes} votos</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-teal-600 mt-3 leading-relaxed">
                  Manter presença e reforçar identidade da campanha nestas áreas consolidadas.
                </p>
              </div>
              <div className="bg-red-50 p-5 rounded-xl border border-red-100">
                <h5 className="font-bold text-red-800 text-xs uppercase mb-3 tracking-widest">Territórios de Atenção (Baixo Retorno)</h5>
                <ul className="space-y-2">
                  {[...bairroRanking].sort((a, b) => (a.votes / (a.visits || 1)) - (b.votes / (b.visits || 1))).slice(0, 3).map((b, i) => (
                    <li key={i} className="flex justify-between text-sm border-b border-red-200 pb-1 last:border-0">
                      <span className="font-medium text-red-700">{b.name}</span>
                      <span className="font-black text-red-900">{b.visits} visitas sem retorno</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-red-600 mt-3 leading-relaxed">
                  Revisar estratégia de abordagem ou realocar recursos para áreas mais receptivas.
                </p>
              </div>
            </div>
          </section>

          <ReportFooter campaignName={campaignDetails.nomeUrna} />
        </div>
      )}

      {/* ====== REPORT 3: Detalhamento por Zona Eleitoral ====== */}
      {reportId === '3' && (
        <div className="space-y-10">
          <section>
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              1. Panorama por Zona Eleitoral
            </h3>
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div className="bg-sky-50 p-5 rounded-xl border border-sky-200 shadow-sm">
                <p className="text-xs text-sky-600 uppercase font-bold mb-2 tracking-wider">Zonas com BU Registrado</p>
                <p className="text-4xl font-black text-sky-700">{Object.keys(zonas).length}</p>
                <p className="text-[10px] text-sky-500 mt-2 uppercase font-semibold">
                  {totalSecoesApuradas} seções no total
                </p>
              </div>
              <div className="bg-emerald-50 p-5 rounded-xl border border-emerald-200 shadow-sm">
                <p className="text-xs text-emerald-600 uppercase font-bold mb-2 tracking-wider">Votos Apurados (BU)</p>
                <p className="text-4xl font-black text-emerald-700">{totalVotosReais.toLocaleString('pt-BR')}</p>
                <p className="text-[10px] text-emerald-500 mt-2 uppercase font-semibold">Votos reais confirmados</p>
              </div>
              <div className="bg-amber-50 p-5 rounded-xl border border-amber-200 shadow-sm">
                <p className="text-xs text-amber-600 uppercase font-bold mb-2 tracking-wider">Votos Projetados</p>
                <p className="text-4xl font-black text-amber-700">{totalVotosProjetados.toLocaleString('pt-BR')}</p>
                <p className="text-[10px] text-amber-500 mt-2 uppercase font-semibold">Intenções mapeadas em campo</p>
              </div>
            </div>
          </section>

          {Object.keys(zonas).length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
              <p className="text-amber-700 font-bold text-lg">Nenhum BU registrado ainda</p>
              <p className="text-amber-600 text-sm mt-2">
                Os fiscais precisam registrar os Boletins de Urna na tela "Operação Dia D" após a apuração.
              </p>
            </div>
          ) : (
            Object.entries(zonas).map(([zona, data], zi) => (
              <section key={zona} className={zi > 0 ? 'break-before-page' : ''}>
                <h3 className="text-xl font-bold border-l-4 border-emerald-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
                  {zi + 2}. Zona: {zona}
                </h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-center">
                    <p className="text-xs text-slate-500 uppercase mb-1">Seções Apuradas</p>
                    <p className="text-3xl font-black text-slate-700">{data.secoes.length}</p>
                  </div>
                  <div className="bg-sky-50 p-4 rounded-xl border border-sky-200 text-center">
                    <p className="text-xs text-sky-600 uppercase mb-1">Total de Votos</p>
                    <p className="text-3xl font-black text-sky-700">{data.votos}</p>
                  </div>
                </div>
                <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-800 text-white uppercase text-[10px] tracking-widest font-bold">
                      <tr>
                        <th className="px-6 py-3">Seção</th>
                        <th className="px-6 py-3 text-center">Votos Candidato</th>
                        <th className="px-6 py-3 text-center">Total Seção</th>
                        <th className="px-6 py-3 text-center">% Aprovação</th>
                        <th className="px-6 py-3">Horário do BU</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {data.secoes.map((bu, i) => (
                        <tr key={bu.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          <td className="px-6 py-3 font-bold text-slate-700">{bu.station_id}</td>
                          <td className="px-6 py-3 text-center font-mono font-black text-sky-700">{bu.votos_candidato}</td>
                          <td className="px-6 py-3 text-center font-mono">{bu.votos_total_secao}</td>
                          <td className="px-6 py-3 text-center">
                            <span className={`font-bold ${bu.votos_total_secao > 0 && (bu.votos_candidato / bu.votos_total_secao) >= 0.5 ? 'text-emerald-600' : 'text-slate-500'}`}>
                              {bu.votos_total_secao > 0
                                ? `${((bu.votos_candidato / bu.votos_total_secao) * 100).toFixed(1)}%`
                                : '—'}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-slate-500 text-xs">
                            {new Date(bu.createdAt).toLocaleTimeString('pt-BR')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}

          <ReportFooter campaignName={campaignDetails.nomeUrna} />
        </div>
      )}

      {/* ====== REPORT 4: ROI da Campanha ====== */}
      {reportId === '4' && (
        <div className="space-y-10">
          <section>
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              1. Balanço Financeiro Geral
            </h3>
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div className="bg-emerald-50 p-5 rounded-xl border border-emerald-200 shadow-sm">
                <p className="text-xs text-emerald-600 uppercase font-bold mb-2 tracking-wider">Total Arrecadado</p>
                <p className="text-3xl font-black text-emerald-700">
                  R$ {totalReceitas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-[10px] text-emerald-500 mt-2 uppercase font-semibold">{incomes.length} lançamentos</p>
              </div>
              <div className="bg-red-50 p-5 rounded-xl border border-red-200 shadow-sm">
                <p className="text-xs text-red-600 uppercase font-bold mb-2 tracking-wider">Total Investido</p>
                <p className="text-3xl font-black text-red-700">
                  R$ {totalDespesas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-[10px] text-red-500 mt-2 uppercase font-semibold">{expenses.length} lançamentos</p>
              </div>
              <div className={`p-5 rounded-xl border shadow-sm ${saldo >= 0 ? 'bg-sky-50 border-sky-200' : 'bg-amber-50 border-amber-200'}`}>
                <p className={`text-xs uppercase font-bold mb-2 tracking-wider ${saldo >= 0 ? 'text-sky-600' : 'text-amber-600'}`}>Saldo Disponível</p>
                <p className={`text-3xl font-black ${saldo >= 0 ? 'text-sky-700' : 'text-amber-700'}`}>
                  R$ {saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
                <p className={`text-[10px] mt-2 uppercase font-semibold ${saldo >= 0 ? 'text-sky-500' : 'text-amber-500'}`}>
                  {saldo >= 0 ? 'Superávit' : 'Déficit'}
                </p>
              </div>
            </div>

            <div className="bg-sky-50 p-6 rounded-xl border border-sky-100 mb-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="text-center">
                  <p className="text-xs text-sky-600 uppercase font-bold mb-2">Custo por Voto (Mapeado)</p>
                  <p className="text-5xl font-black text-sky-700">
                    {kpis.votos > 0 ? `R$ ${(totalDespesas / kpis.votos).toFixed(2)}` : '—'}
                  </p>
                  <p className="text-xs text-sky-500 mt-1">Baseado em votos mapeados em campo</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-emerald-600 uppercase font-bold mb-2">Custo por Voto (Real)</p>
                  <p className="text-5xl font-black text-emerald-700">
                    {totalVotosReais > 0 ? `R$ ${custoPorVoto}` : '—'}
                  </p>
                  <p className="text-xs text-emerald-500 mt-1">Baseado em BUs registrados no Dia D</p>
                </div>
              </div>
            </div>
          </section>

          <section className="break-before-page">
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              2. ROI por Colaborador
            </h3>
            <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-800 text-white uppercase text-[10px] tracking-widest font-bold">
                  <tr>
                    <th className="px-6 py-4">Colaborador</th>
                    <th className="px-6 py-4 text-center">Visitas</th>
                    <th className="px-6 py-4 text-center">Votos</th>
                    <th className="px-6 py-4 text-center">Investimento</th>
                    <th className="px-6 py-4 text-center">Custo/Voto</th>
                    <th className="px-6 py-4 text-center">Eficiência</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {teamROI.map((m, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="px-6 py-4">
                        <span className="font-bold text-slate-700">{m.name}</span>
                        <span className="block text-[9px] text-slate-400 uppercase tracking-tight">{m.role}</span>
                      </td>
                      <td className="px-6 py-4 text-center font-mono">{m.visits}</td>
                      <td className="px-6 py-4 text-center font-mono font-black text-sky-700">{m.votes}</td>
                      <td className="px-6 py-4 text-center font-mono">
                        {m.cost > 0 ? `R$ ${m.cost.toLocaleString('pt-BR')}` : '—'}
                      </td>
                      <td className="px-6 py-4 text-center font-mono font-bold text-sky-700">
                        {m.costPerVote !== '—' ? `R$ ${m.costPerVote}` : '—'}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${
                          m.efficiency === 'Alta' ? 'bg-green-100 text-green-700' :
                          m.efficiency === 'Média' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {m.efficiency}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-100 font-black text-slate-800 border-t-2 border-slate-300">
                  <tr>
                    <td className="px-6 py-4 uppercase text-xs tracking-wider">Total da Equipe</td>
                    <td className="px-6 py-4 text-center font-mono">{teamROI.reduce((s, m) => s + m.visits, 0)}</td>
                    <td className="px-6 py-4 text-center font-mono text-sky-700">{kpis.votos}</td>
                    <td className="px-6 py-4 text-center font-mono">
                      R$ {totalTeamCost.toLocaleString('pt-BR')}
                    </td>
                    <td className="px-6 py-4 text-center font-mono text-sky-700">
                      {kpis.votos > 0 ? `R$ ${(totalTeamCost / kpis.votos).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-6 py-4"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              3. Principais Despesas
            </h3>
            <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-800 text-white uppercase text-[10px] tracking-widest font-bold">
                  <tr>
                    <th className="px-6 py-4">Descrição</th>
                    <th className="px-6 py-4">Categoria</th>
                    <th className="px-6 py-4 text-right">Valor</th>
                    <th className="px-6 py-4">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {expenses.slice(0, 15).map((e, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="px-6 py-3 font-medium text-slate-700">{e.descricao || '—'}</td>
                      <td className="px-6 py-3 text-slate-500 text-xs">{e.categoria || '—'}</td>
                      <td className="px-6 py-3 text-right font-mono font-bold text-red-600">
                        R$ {(e.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-3 text-slate-500 text-xs">
                        {e.data ? new Date(e.data).toLocaleDateString('pt-BR') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <ReportFooter campaignName={campaignDetails.nomeUrna} />
        </div>
      )}

      {/* ====== REPORT 5: Seções e Locais de Votação ====== */}
      {reportId === '5' && (
        <div className="space-y-10">
          <section>
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              1. Sumário Operacional
            </h3>
            <div className="grid grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Seções Monitoradas', value: totalSecoesApuradas, color: 'sky' },
                { label: 'BUs Registrados', value: buData.length, color: 'emerald' },
                { label: 'Votos Confirmados', value: totalVotosReais, color: 'teal' },
                { label: 'Fiscais Registrados', value: fiscais.length, color: 'purple' },
              ].map((c, i) => (
                <div key={i} className={`bg-${c.color}-50 p-4 rounded-xl border border-${c.color}-200 text-center`}>
                  <p className={`text-xs text-${c.color}-600 uppercase font-bold mb-1 tracking-wider`}>{c.label}</p>
                  <p className={`text-3xl font-black text-${c.color}-700`}>{c.value}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              2. Registro de Seções e Locais
            </h3>
            {buData.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
                <p className="text-amber-700 font-bold text-lg">Nenhuma seção registrada</p>
                <p className="text-amber-600 text-sm mt-2">
                  As seções são registradas pelos fiscais via scanner de BU no Dia D.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-800 text-white uppercase text-[10px] tracking-widest font-bold">
                    <tr>
                      <th className="px-6 py-4">#</th>
                      <th className="px-6 py-4">ID da Seção</th>
                      <th className="px-6 py-4 text-center">Votos Candidato</th>
                      <th className="px-6 py-4 text-center">Total Eleitores</th>
                      <th className="px-6 py-4 text-center">% Aprovação</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Registro</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {buData.map((bu, i) => (
                      <tr key={bu.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                        <td className="px-6 py-3 text-slate-400 font-mono text-xs">{i + 1}</td>
                        <td className="px-6 py-3 font-bold text-slate-700 font-mono">{bu.station_id}</td>
                        <td className="px-6 py-3 text-center font-mono font-black text-sky-700">{bu.votos_candidato}</td>
                        <td className="px-6 py-3 text-center font-mono text-slate-600">{bu.votos_total_secao}</td>
                        <td className="px-6 py-3 text-center">
                          {bu.votos_total_secao > 0 ? (
                            <span className={`font-bold ${(bu.votos_candidato / bu.votos_total_secao) >= 0.5 ? 'text-emerald-600' : 'text-slate-500'}`}>
                              {((bu.votos_candidato / bu.votos_total_secao) * 100).toFixed(1)}%
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-6 py-3">
                          <span className="px-2 py-1 rounded-full text-[9px] font-black uppercase bg-emerald-100 text-emerald-700">
                            Apurado
                          </span>
                        </td>
                        <td className="px-6 py-3 text-slate-500 text-xs">
                          {new Date(bu.createdAt).toLocaleString('pt-BR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <ReportFooter campaignName={campaignDetails.nomeUrna} />
        </div>
      )}

      {/* ====== REPORT 6: Fidelidade da Base (Fiscais) ====== */}
      {reportId === '6' && (
        <div className="space-y-10">
          <section>
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              1. Visão Geral da Equipe
            </h3>
            <div className="grid grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Total de Membros', value: teamMembers.length, color: 'sky' },
                { label: 'Apoiadores', value: teamMembers.filter(m => m.role === 'Apoiador').length, color: 'emerald' },
                { label: 'Líderes', value: teamMembers.filter(m => m.role === 'Líder').length, color: 'purple' },
                { label: 'Fiscais Registrados', value: fiscais.length, color: 'amber' },
              ].map((c, i) => (
                <div key={i} className={`bg-${c.color}-50 p-4 rounded-xl border border-${c.color}-200 text-center`}>
                  <p className={`text-xs text-${c.color}-600 uppercase font-bold mb-1 tracking-wider`}>{c.label}</p>
                  <p className={`text-3xl font-black text-${c.color}-700`}>{c.value}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              2. Performance da Equipe de Campo
            </h3>
            <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-800 text-white uppercase text-[10px] tracking-widest font-bold">
                  <tr>
                    <th className="px-6 py-4">Colaborador</th>
                    <th className="px-6 py-4">Função</th>
                    <th className="px-6 py-4 text-center">Visitas</th>
                    <th className="px-6 py-4 text-center">Votos Obtidos</th>
                    <th className="px-6 py-4 text-center">Conversão</th>
                    <th className="px-6 py-4 text-center">Fidelidade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {teamROI.map((m, i) => {
                    const conversao = m.visits > 0 ? (m.votes / m.visits) * 100 : 0;
                    const fidelidade = conversao >= 70 ? 'Alta' : conversao >= 40 ? 'Média' : 'Baixa';
                    return (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                        <td className="px-6 py-4 font-bold text-slate-700">{m.name}</td>
                        <td className="px-6 py-4 text-slate-500 text-xs uppercase tracking-wider">{m.role}</td>
                        <td className="px-6 py-4 text-center font-mono">{m.visits}</td>
                        <td className="px-6 py-4 text-center font-mono font-black text-sky-700">{m.votes}</td>
                        <td className="px-6 py-4 text-center font-bold">
                          {m.visits > 0 ? `${conversao.toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${
                            fidelidade === 'Alta' ? 'bg-green-100 text-green-700' :
                            fidelidade === 'Média' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {fidelidade}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {teamMembers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                        Nenhum membro cadastrado na equipe.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {fiscais.length > 0 && (
            <section>
              <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
                3. Fiscais no Dia D
              </h3>
              <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-800 text-white uppercase text-[10px] tracking-widest font-bold">
                    <tr>
                      <th className="px-6 py-4">Fiscal</th>
                      <th className="px-6 py-4">Zona</th>
                      <th className="px-6 py-4">Seção</th>
                      <th className="px-6 py-4 text-center">Status</th>
                      <th className="px-6 py-4 text-center">Votos Confirmados</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {fiscais.map((f, i) => (
                      <tr key={f.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                        <td className="px-6 py-3 font-bold text-slate-700">{f.name}</td>
                        <td className="px-6 py-3 font-mono text-slate-600">{f.zone || '—'}</td>
                        <td className="px-6 py-3 font-mono text-slate-600">{f.section || '—'}</td>
                        <td className="px-6 py-3 text-center">
                          <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase ${
                            f.status === 'active' || f.status === 'ativo' ? 'bg-emerald-100 text-emerald-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {f.status || 'Pendente'}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-center font-mono font-bold text-sky-700">
                          {f.votes_confirmed ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section>
            <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">
              {fiscais.length > 0 ? '4' : '3'}. Análise de Comprometimento
            </h3>
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-teal-50 p-5 rounded-xl border border-teal-100">
                <h5 className="font-bold text-teal-800 text-xs uppercase mb-3 tracking-widest">Top 5 — Maior Engajamento</h5>
                <ul className="space-y-2">
                  {teamROI.slice(0, 5).map((m, i) => (
                    <li key={i} className="flex justify-between text-sm border-b border-teal-200 pb-1 last:border-0">
                      <span className="font-medium text-teal-700">{m.name}</span>
                      <span className="font-black text-teal-900">{m.votes} votos</span>
                    </li>
                  ))}
                  {teamROI.length === 0 && (
                    <li className="text-teal-600 text-xs">Sem dados de campo ainda.</li>
                  )}
                </ul>
              </div>
              <div className="bg-amber-50 p-5 rounded-xl border border-amber-100">
                <h5 className="font-bold text-amber-800 text-xs uppercase mb-3 tracking-widest">Recomendações</h5>
                <ul className="space-y-2 text-xs text-amber-700 leading-relaxed">
                  <li>• Bonificar membros com alta fidelidade e conversão acima de 70%</li>
                  <li>• Realizar reunião de alinhamento com membros com conversão abaixo de 40%</li>
                  <li>• Redistribuir zonas de atuação baseado nos dados de performance</li>
                  <li>• Priorizar capacitação dos apoiadores com menor taxa de engajamento</li>
                </ul>
              </div>
            </div>
          </section>

          <ReportFooter campaignName={campaignDetails.nomeUrna} />
        </div>
      )}

      <div className="fixed bottom-8 right-8 no-print">
        <button
          onClick={onClose}
          className="bg-slate-900 text-white px-6 py-3 rounded-full shadow-2xl hover:bg-slate-800 transition-all font-bold"
        >
          Fechar Relatório
        </button>
      </div>
    </div>
  );
};

const ReportFooter: React.FC<{ campaignName: string | undefined }> = ({ campaignName }) => (
  <div className="pt-12 mt-12 border-t border-slate-200 text-center">
    <p className="text-xs text-slate-400 italic">
      Este relatório é confidencial e de uso exclusivo da coordenação da campanha{' '}
      {campaignName || 'Campanha'}. As informações são baseadas nos dados inseridos na plataforma Campanha Pró.
    </p>
    <div className="mt-8 flex justify-center gap-20">
      <div className="w-48 border-t border-slate-400 pt-2 text-xs text-slate-500">Coordenação de Campanha</div>
      <div className="w-48 border-t border-slate-400 pt-2 text-xs text-slate-500">Candidato(a)</div>
    </div>
  </div>
);

export default ElectionReportGenerator;
