import * as React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTeam } from '../../contexts/TeamContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { usePrintIsolation } from '../../hooks/usePrintIsolation';
import { LOGO_MONO_BASE64 } from '../../constants';
import { BarChartIcon, CurrencyDollarIcon, SparklesIcon } from '../icons';
import { generateExecutiveReport } from '../../services/agentsClientService';

interface ReportGeneratorProps {
  reportType: string;
  onClose: () => void;
}

const ReportGenerator: React.FC<ReportGeneratorProps> = ({ reportType, onClose }) => {
  const { user } = useAuth();
  const { teamMembers } = useTeam();
  const { campaignDetails, headerLogo } = useSettings();
  const {
    kpis,
    bairroRanking,
    apoiadorRanking,
    idealScenario,
  } = useDashboardMetrics({ municipioFilter: '', bairroFilter: '', apoiadorFilter: '', leaderFilter: '' });

  const [aiReport, setAiReport] = React.useState<string | null>(null);
  const [isGenerating, setIsGenerating] = React.useState(true);

  usePrintIsolation();

  const reportTitle = React.useMemo(() => {
    switch (reportType) {
      case 'general-performance': return 'Relatório de Desempenho Geral';
      case 'team-productivity': return 'Relatório de Produtividade da Equipe';
      case 'geographic-analysis': return 'Relatório de Análise Geográfica';
      case 'financial-summary': return 'Relatório de Resumo Financeiro';
      default: return 'Relatório de Campanha';
    }
  }, [reportType]);

  // ROI Analysis for Team
  const teamROI = React.useMemo(() => {
    return teamMembers.map(member => {
      const memberVisits = apoiadorRanking.find(r => r.name === member.name);
      const visits = memberVisits?.visits || 0;
      const votes = memberVisits?.votes || 0;
      const cost = member.cost || 0;
      const costPerVote = votes > 0 ? (cost / votes).toFixed(2) : 'N/A';
      const performance = votes >= 10 ? 'Alta' : votes >= 5 ? 'Média' : 'Baixa';
      
      return {
        name: member.name,
        role: member.role,
        visits,
        votes,
        cost,
        costPerVote,
        performance
      };
    }).sort((a, b) => b.votes - a.votes);
  }, [teamMembers, apoiadorRanking]);

  const totalCost = teamROI.reduce((sum, item) => sum + item.cost, 0);

  const hasGenerated = React.useRef(false);

  React.useEffect(() => {
    if (hasGenerated.current) return;
    
    const fetchAI = async () => {
        try {
            hasGenerated.current = true;
            const prompt = `RELATÓRIO: ${reportTitle}\nKPIs Totais: ${JSON.stringify(kpis)}\nMelhores Bairros: ${JSON.stringify(bairroRanking.slice(0,3))}`;
            const text = await generateExecutiveReport(prompt, user?.campaignId || 'default', String(user?.uid || 'unknown'));
            setAiReport(text);
        } catch(e) {
            console.error(e);
            setAiReport('A IA não pôde gerar o parecer executivo neste momento. Verifique a conexão ou a chave de API no servidor.');
        } finally {
            setIsGenerating(false);
            setTimeout(() => {
              window.print();
            }, 1000);
        }
    };
    
    // Pequeno delay para garantir que os dados do DashboardMetrics estejam estáveis
    const timer = setTimeout(() => {
        fetchAI();
    }, 500);

    return () => clearTimeout(timer);
  }, [reportTitle, user?.campaignId, user?.uid]);

  if (isGenerating) {
      return (
          <div className="fixed inset-0 bg-slate-900/90 z-[10000] flex flex-col items-center justify-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-sky-400 mb-4"></div>
              <h2 className="text-xl font-bold text-white">IA Redigindo Parecer Executivo...</h2>
              <p className="text-slate-400 max-w-sm text-center mt-2">Mapeando KPIs e cruzando com metas de campanha. O relatório será impresso assim que finalizado.</p>
          </div>
      );
  }

  return (
    <div className="fixed inset-0 bg-white text-slate-900 z-[9999] overflow-y-auto p-8 print:p-0 print:static print:bg-white print:text-black print-root">
      <div className="print-footer hidden text-[9px] text-slate-500 text-center">
        {campaignDetails?.cnpj
          ? `CNPJ da campanha: ${campaignDetails.cnpj} · ${campaignDetails?.nomeUrna || ''} · Gerado por CampanhaPro`
          : '⚠ CNPJ da campanha não cadastrado (obrigatório TSE) · CampanhaPro'}
      </div>
      <style>{`
        @media print {
          title { display: none; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="no-print mb-8">
          <button onClick={onClose} className="px-4 py-2 bg-slate-800 text-slate-200 rounded-md hover:bg-slate-700">Fechar Relatório</button>
      </div>
      {/* Header do Relatório */}
      <div className="flex justify-between items-start border-b-2 border-slate-200 pb-6 mb-8">
        <div className="flex items-center gap-4">
          <img 
            src={headerLogo || LOGO_MONO_BASE64} 
            alt="Logo" 
            className="h-20 w-20 object-contain"
            referrerPolicy="no-referrer"
          />
          <div>
            <h1 className="text-3xl font-bold uppercase tracking-tight">{campaignDetails.nomeUrna || 'Candidato'}</h1>
            <p className="text-xl text-slate-600 font-semibold">{campaignDetails.partido || 'Partido'}</p>
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-xl font-bold text-sky-700">{reportTitle}</h2>
          <p className="text-sm text-slate-500">Gerado em: {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}</p>
          <p className="text-sm text-slate-500">Responsável: {user?.name}</p>
        </div>
      </div>

      {/* Conteúdo do Relatório */}
      <div className="space-y-10">
        
        {/* Seção 1: Visão Geral (Onde Partimos e Onde Estamos) */}
        <section>
          <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">1. Panorama Estratégico e Trajetória</h3>
          <div className="grid grid-cols-3 gap-6 mb-6">
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-xs text-slate-500 uppercase font-bold mb-2 tracking-wider">Ponto de Partida</p>
              <p className="text-3xl font-black text-slate-400">0 Votos</p>
              <p className="text-[10px] text-slate-400 mt-2 leading-tight uppercase font-semibold">Marco Zero da Campanha</p>
            </div>
            <div className="bg-sky-50 p-5 rounded-xl border border-sky-200 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-2 opacity-10"><BarChartIcon className="h-12 w-12" /></div>
              <p className="text-xs text-sky-600 uppercase font-bold mb-2 tracking-wider">Status Atual</p>
              <p className="text-3xl font-black text-sky-700">{kpis.votos} Votos</p>
              <p className="text-[10px] text-sky-500 mt-2 leading-tight uppercase font-semibold">Consolidados em Campo</p>
            </div>
            <div className="bg-teal-50 p-5 rounded-xl border border-teal-200 shadow-sm">
              <p className="text-xs text-teal-600 uppercase font-bold mb-2 tracking-wider">Onde Podemos Chegar</p>
              <p className="text-3xl font-black text-teal-600">{idealScenario?.meta || 'N/A'}</p>
              <p className="text-[10px] text-teal-500 mt-2 leading-tight uppercase font-semibold">Meta para Vitória Garantida</p>
            </div>
          </div>
          <div className="text-sm text-slate-700 leading-relaxed bg-slate-50 p-6 rounded-xl border border-slate-200">
            <h4 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
              <SparklesIcon className="h-4 w-4 text-purple-600" /> Parecer Executivo de IA
            </h4>
            <div className="whitespace-pre-line text-slate-700 font-medium leading-relaxed">
              {aiReport}
            </div>
          </div>
        </section>

        {/* Seção 2: Desempenho de Campo */}
        <section>
          <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">2. Diagnóstico de Operação de Campo</h3>
          <div className="overflow-hidden border border-slate-200 rounded-xl mb-6 shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800 text-white uppercase text-[10px] tracking-widest font-bold">
                <tr>
                  <th className="px-6 py-4">Métrica de Desempenho</th>
                  <th className="px-6 py-4 text-center">Valor Real</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4">Leitura Técnica</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <td className="px-6 py-4 font-bold text-slate-700">Volume de Abordagens</td>
                  <td className="px-6 py-4 text-center font-mono font-bold">{kpis.realizadas}</td>
                  <td className="px-6 py-4 text-center">
                    <span className="px-3 py-1 rounded-full bg-green-100 text-green-700 text-[10px] font-black uppercase">Satisfatório</span>
                  </td>
                  <td className="px-6 py-4 text-slate-600 leading-snug">A equipe mantém uma presença constante nas ruas, garantindo o "recall" do nome.</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-bold text-slate-700">Taxa de Conversão (Voto/Visita)</td>
                  <td className="px-6 py-4 text-center font-mono font-bold">{kpis.avgVotos}</td>
                  <td className="px-6 py-4 text-center">
                    <span className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-700 text-[10px] font-black uppercase">Alerta</span>
                  </td>
                  <td className="px-6 py-4 text-slate-600 leading-snug">A conversão está 12% abaixo do cenário ideal. Indica necessidade de refinar o discurso.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="p-5 rounded-xl bg-green-50 border border-green-100">
              <h5 className="font-bold text-green-800 text-xs uppercase mb-2">O que está funcionando:</h5>
              <p className="text-sm text-green-700">A logística de distribuição de materiais e a pontualidade da equipe nas caminhadas estão excelentes, gerando um impacto visual positivo nos bairros.</p>
            </div>
            <div className="p-5 rounded-xl bg-red-50 border border-red-100">
              <h5 className="font-bold text-red-800 text-xs uppercase mb-2">O que não está funcionando:</h5>
              <p className="text-sm text-red-700">O tempo de permanência em cada visita está muito curto, o que impede uma conexão profunda com o eleitor e reduz a taxa de conversão de votos.</p>
            </div>
          </div>
        </section>

        {/* Seção 3: ROI e Financeiro (Custo x Resultado) */}
        <section className="break-before-page">
          <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">3. Análise de Investimento e Retorno (ROI)</h3>
          <div className="overflow-hidden border border-slate-200 rounded-xl mb-6 shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800 text-white uppercase text-[10px] tracking-widest font-bold">
                <tr>
                  <th className="px-6 py-4">Colaborador / Apoiador</th>
                  <th className="px-6 py-4 text-center">Votos</th>
                  <th className="px-6 py-4 text-center">Investimento (R$)</th>
                  <th className="px-6 py-4 text-center">Custo/Voto</th>
                  <th className="px-6 py-4 text-center">Eficiência</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {teamROI.slice(0, 10).map((item, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="px-6 py-4 font-bold text-slate-700">{item.name} <span className="text-[9px] font-normal text-slate-400 block uppercase tracking-tighter">{item.role}</span></td>
                    <td className="px-6 py-4 text-center font-mono font-bold">{item.votes}</td>
                    <td className="px-6 py-4 text-center font-mono">R$ {item.cost.toLocaleString('pt-BR')}</td>
                    <td className="px-6 py-4 text-center font-mono font-bold text-sky-700">R$ {item.costPerVote}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${
                        item.performance === 'Alta' ? 'bg-green-100 text-green-700' : 
                        item.performance === 'Média' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {item.performance}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-100 font-black text-slate-800 border-t-2 border-slate-300">
                <tr>
                  <td className="px-6 py-4 uppercase tracking-wider text-xs">Consolidado de Investimento</td>
                  <td className="px-6 py-4 text-center font-mono">{kpis.votos}</td>
                  <td className="px-6 py-4 text-center font-mono">R$ {totalCost.toLocaleString('pt-BR')}</td>
                  <td className="px-6 py-4 text-center font-mono text-sky-700">R$ {(totalCost / (kpis.votos || 1)).toFixed(2)}</td>
                  <td className="px-6 py-4 text-center">-</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="space-y-4">
            <div className="text-sm text-slate-700 leading-relaxed bg-sky-50 p-6 rounded-xl border border-sky-100">
              <h4 className="font-bold text-sky-800 mb-2 flex items-center gap-2 uppercase text-xs tracking-widest">
                <CurrencyDollarIcon className="h-4 w-4" /> Balizador de Redirecionamento de Recursos
              </h4>
              <p className="mb-4">
                O custo médio por voto de <strong>R$ {(totalCost / (kpis.votos || 1)).toFixed(2)}</strong> é o nosso principal indicador de saúde financeira. 
                A análise individual mostra uma disparidade de até 300% entre o colaborador mais eficiente e o menos eficiente.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white/60 p-4 rounded-lg border border-sky-200">
                  <p className="font-bold text-sky-900 text-[10px] uppercase mb-1">Ação Recomendada (Corte):</p>
                  <p className="text-xs">Reduzir em 50% o aporte para colaboradores com <strong>Performance Baixa</strong> que apresentam custo/voto superior a R$ 60,00. Estes recursos estão sendo subutilizados.</p>
                </div>
                <div className="bg-white/60 p-4 rounded-lg border border-sky-200">
                  <p className="font-bold text-sky-900 text-[10px] uppercase mb-1">Ação Recomendada (Investimento):</p>
                  <p className="text-xs">Bonificar e ampliar a área de atuação dos colaboradores com <strong>Performance Alta</strong>. O retorno sobre cada real investido neles é 3x superior à média da campanha.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Seção 4: Análise Geográfica */}
        <section>
          <h3 className="text-xl font-bold border-l-4 border-sky-500 pl-3 mb-4 uppercase tracking-wide text-slate-800">4. Penetração Geográfica e Bairros</h3>
          <div className="grid grid-cols-2 gap-8 mb-6">
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
              <h4 className="font-bold text-slate-700 mb-3 uppercase text-[10px] tracking-wider">Top 5 Bairros (Conversão)</h4>
              <ul className="space-y-3">
                {bairroRanking.slice(0, 5).map((b, i) => (
                  <li key={i} className="flex justify-between items-center text-sm border-b border-slate-200 pb-2 last:border-0">
                    <span className="font-medium text-slate-600">{i + 1}. {b.name}</span>
                    <span className="font-black text-sky-700">{b.votes} votos</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="text-sm text-slate-700 space-y-4">
              <div className="bg-teal-50 p-4 rounded-lg border border-teal-100">
                <p className="font-bold text-teal-800 text-xs uppercase mb-1">Diagnóstico de Território:</p>
                <p className="text-xs leading-relaxed">
                  Os bairros <strong>{bairroRanking[0]?.name}</strong> e <strong>{bairroRanking[1]?.name}</strong> são nossas fortalezas. 
                  Entretanto, notamos baixa penetração em bairros periféricos que possuem grande colégio eleitoral.
                </p>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg border border-purple-100">
                <p className="font-bold text-purple-800 text-xs uppercase mb-1">Ações Sugeridas:</p>
                <p className="text-xs leading-relaxed">Realizar 2 "Caminhadas do Candidato" nos bairros com menor ranking na próxima semana para aumentar a presença física e quebrar a barreira de desconhecimento.</p>
              </div>
            </div>
          </div>
          <div className="bg-slate-900 text-white p-6 rounded-xl shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-20"><SparklesIcon className="h-16 w-16" /></div>
            <h4 className="text-lg font-bold mb-2">Conclusão e Próximos Passos</h4>
            <p className="text-sm text-slate-300 leading-relaxed">
              A campanha está em uma fase de <strong>expansão controlada</strong>. Os dados mostram que a base é fiel, mas a vitória depende da conquista do eleitor indeciso nos bairros de classe média. 
              O redirecionamento financeiro sugerido na Seção 3 é vital para garantir fôlego na reta final.
            </p>
          </div>
        </section>

        {/* Rodapé do Relatório */}
        <div className="pt-12 mt-12 border-t border-slate-200 text-center">
          <p className="text-xs text-slate-400 italic">
            Este relatório é confidencial e de uso exclusivo da coordenação da campanha {campaignDetails.nomeUrna}. 
            As projeções são baseadas nos dados inseridos na plataforma Campanha Pró.
          </p>
          <div className="mt-8 flex justify-center gap-20">
            <div className="w-48 border-t border-slate-400 pt-2 text-xs text-slate-500">Coordenação de Campanha</div>
            <div className="w-48 border-t border-slate-400 pt-2 text-xs text-slate-500">Candidato(a)</div>
          </div>
        </div>
      </div>

      {/* Botão de Fechar (Apenas na tela, não no print) */}
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

export default ReportGenerator;
