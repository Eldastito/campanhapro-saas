import * as React from 'react';
import { useDashboardMetrics } from '../hooks/useDashboardMetrics';
import DailyGoal from '../components/dashboard/DailyGoal';
import KpiGrid from '../components/dashboard/KpiGrid';
import ProgressChart from '../components/dashboard/ProgressChart';
import Rankings from '../components/dashboard/Rankings';
import IssueMap from '../components/dashboard/IssueMap';
import DigitalColinha from '../components/dashboard/DigitalColinha';
import CampaignAdvisor from '../components/dashboard/CampaignAdvisor';
import ReportModal from '../components/dashboard/ReportModal';
import ReportGenerator from '../components/dashboard/ReportGenerator';
import PesquisaChart from '../components/dashboard/PesquisaChart';
import FraudAlertPanel from '../components/dashboard/FraudAlertPanel';
import WarRoomFeed from '../components/dashboard/WarRoomFeed';
import SupporterProfileCard from '../components/dashboard/SupporterProfileCard';
import ConversionFunnel from '../components/dashboard/ConversionFunnel';
import TeamTasksWidget from '../components/dashboard/TeamTasksWidget';
import IntelligencePanel from '../components/dashboard/IntelligencePanel';
import Button from '../components/ui/Button';
import SyncButton from '../components/ui/SyncButton';
import { PrintIcon, SparklesIcon } from '../components/icons';
import { Share2 } from 'lucide-react';
import Card from '../components/ui/Card';
import { useAuth } from '../contexts/AuthContext';
import { askAdvisor } from '../services/agentsClientService';
import AgendaPanel from '../components/agenda/AgendaPanel';
import VoiceCommandButton from '../components/agenda/VoiceCommandButton';
import FieldFocusCard from '../components/dashboard/FieldFocusCard';
import PartyFieldQuickCard from '../components/party/PartyFieldQuickCard';
// ExternalMemoryRefreshCard movido para SettingsPage (#56 era admin 1x/dia, não decisão diária do coord)

const DashboardPage = () => {
  const { user, userType } = useAuth();
  const [leaderFilter, setLeaderFilter] = React.useState('');
  const [municipioFilter, setMunicipioFilter] = React.useState('');
  const [bairroFilter, setBairroFilter] = React.useState('');
  const [apoiadorFilter, setApoiadorFilter] = React.useState('');
  const [isAdvisorOpen, setIsAdvisorOpen] = React.useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = React.useState(false);
  const [selectedReport, setSelectedReport] = React.useState<string | null>(null);

  const [advisorTips, setAdvisorTips] = React.useState<any[]>([]);
  const [isAdvisorLoading, setIsAdvisorLoading] = React.useState(false);

  const {
    kpis,
    dailyGoal,
    allLeaders,
    allMunicipios,
    allBairros,
    allApoiadores,
    bairroRanking,
    apoiadorRanking,
    leaderRanking,
    currentScenarioStatus,
    idealScenario,
    filteredVisits,
    filteredEngagements,
    pesquisas,
    isLoading
  } = useDashboardMetrics({ municipioFilter, bairroFilter, apoiadorFilter, leaderFilter });

  const handleOpenAdvisor = async () => {
      setIsAdvisorOpen(true);
      setIsAdvisorLoading(true);
      try {
         const prompt = `
           KPIs Atuais:
           - Visitas Realizadas: ${kpis.realizadas} / Pendentes: ${kpis.pendentes}
           - Votos Mapeados: ${kpis.votos}
           - Apoiadores Ativos (7d): ${kpis.apoiadoresAtivos}
           - Abordagens Rápidas: ${kpis.totalAbordagens}
           - Materiais Distribuídos: ${kpis.totalMateriais}
           
           Top Bairros com interações (Atenção):
           ${bairroRanking.slice(0,3).map(b => `- ${b.name}: ${b.visits} visitas, ${b.votes} votos intenção`).join('\n')}

           Status do Cenário Ideal:
           ${currentScenarioStatus?.name || 'N/A'}
         `;
         const tips = await askAdvisor(prompt, user?.campaignId || 'default', String(user?.uid || 'unknown'));
         setAdvisorTips(tips);
      } catch (e) {
         console.error(e);
         setAdvisorTips([{ title: "Erro na IA", message: "Consultor de IA indisponível. Verifique a configuração da chave de IA no ambiente.", type: "error" }]);
      } finally {
         setIsAdvisorLoading(false);
      }
  };

  return (
    <div className="space-y-6">
      {selectedReport && (
        <ReportGenerator 
          reportType={selectedReport} 
          onClose={() => setSelectedReport(null)} 
        />
      )}
      <div className="flex flex-wrap justify-between items-center gap-4 no-print">
        <h2 className="text-2xl font-bold text-slate-200">Dashboard de Campanha</h2>
        <div className="flex gap-2">
            <Button variant="primary" onClick={handleOpenAdvisor} className="bg-gradient-to-r from-[#4ac7f0] to-[#1abc9c] border-none shadow-lg shadow-sky-500/20">
                <SparklesIcon className="mr-2" /> Consultor de IA
            </Button>
            <Button variant="secondary" onClick={() => setIsReportModalOpen(true)}><PrintIcon className="mr-2" /> Relatórios (Export C-Level)</Button>
        </div>
      </div>
      
      <SyncButton />

      <div className="print-page-title hidden print:block">Relatório de Desempenho - {new Date().toLocaleDateString('pt-BR')}</div>

      {idealScenario && <DailyGoal dailyGoal={dailyGoal} />}

      {/* Ferramentas leves de campo do Coord/Líder de Partido (#83) — autoesconde se não for membro */}
      <PartyFieldQuickCard />

      <AgendaPanel voiceSlot={<VoiceCommandButton campaignId={user?.campaignId} />} />

      <IntelligencePanel />

      <div className="print-stack space-y-6">
        <KpiGrid kpis={kpis} currentScenarioStatus={currentScenarioStatus} isLoading={isLoading} />

        <div className="space-y-6">
            <ProgressChart 
                filteredVisits={filteredVisits}
                municipioFilter={municipioFilter}
                setMunicipioFilter={(val) => {
                    setMunicipioFilter(val);
                    setBairroFilter('');
                    setApoiadorFilter('');
                }}
                allMunicipios={allMunicipios}
                bairroFilter={bairroFilter}
                setBairroFilter={(val) => {
                    setBairroFilter(val);
                    setApoiadorFilter('');
                }}
                allBairros={allBairros}
                apoiadorFilter={apoiadorFilter}
                setApoiadorFilter={setApoiadorFilter}
                allApoiadores={allApoiadores}
            />

            {apoiadorFilter && (
                <div className="mb-6">
                    <SupporterProfileCard supporterName={apoiadorFilter} />
                </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                <FraudAlertPanel />
                <IssueMap visits={filteredVisits} engagements={filteredEngagements} />
                <WarRoomFeed />
                <ConversionFunnel />
                <div className="md:col-span-2 xl:col-span-4">
                    <Rankings bairroRanking={bairroRanking} apoiadorRanking={apoiadorRanking} leaderRanking={leaderRanking} />
                </div>
                <TeamTasksWidget />
                <PesquisaChart data={pesquisas} />
                <DigitalColinha />
            </div>

            {userType === 'Admin' && allLeaders.length > 0 && (
                <Card className="no-print p-4">
                    <div className="flex flex-col md:flex-row md:items-center gap-4">
                        <label htmlFor="leader-filter" className="text-sm font-medium text-slate-300">Filtrar por Equipe (Líder):</label>
                        <select id="leader-filter" value={leaderFilter} onChange={e => setLeaderFilter(e.target.value)} className="bg-slate-700 border border-slate-600 rounded-md py-1 px-3 text-sm focus:ring-2 focus:ring-sky-500">
                            <option value="">Todas as Equipes</option>
                            {allLeaders.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                    </div>
                </Card>
            )}
        </div>
      </div>

      <CampaignAdvisor 
        isOpen={isAdvisorOpen} 
        onClose={() => setIsAdvisorOpen(false)} 
        title="Consultor Estratégico de Campanha"
        isLoading={isAdvisorLoading}
        tips={advisorTips}
      />

      {/* Foco de Campo IA (#116) — recomenda onde ir, onde evitar, qual pauta */}
      <FieldFocusCard />

      {/* Social Media Insights - Fase 4 */}
      <Card className="no-print p-6 border-t-4 border-t-pink-500">
          <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-gradient-to-r from-pink-500 to-purple-500 rounded-lg">
                  <Share2 className="w-6 h-6 text-white" />
              </div>
              <div>
                  <h3 className="text-xl font-bold text-slate-100">Desempenho em Mídias Sociais</h3>
                  <p className="text-sm text-slate-400">Integração Omni-channel (Instagram, Facebook & WhatsApp)</p>
              </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                  <h4 className="text-sm font-semibold text-slate-400 uppercase">Alcance (Sete dias)</h4>
                  <p className="text-3xl font-black text-white mt-2">--</p>
                  <p className="text-xs text-slate-500 mt-1">Conecte sua conta Meta para ver dados reais</p>
              </div>
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                  <h4 className="text-sm font-semibold text-slate-400 uppercase">Engajamento / Sentimento</h4>
                  <p className="text-3xl font-black text-white mt-2">--%</p>
                  <p className="text-xs text-slate-500 mt-1">Status: Aguardando integração</p>
              </div>
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                  <h4 className="text-sm font-semibold text-slate-400 uppercase">Conversão Link na Bio</h4>
                  <p className="text-3xl font-black text-white mt-2">--</p>
                  <p className="text-xs text-sky-400 mt-1">Status: Aguardando integração</p>
              </div>
          </div>
      </Card>

      <ReportModal 
        isOpen={isReportModalOpen} 
        onClose={() => setIsReportModalOpen(false)} 
        onGenerateReport={(id) => setSelectedReport(id)}
      />
    </div>
  );
};

export default DashboardPage;