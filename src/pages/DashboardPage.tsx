import * as React from 'react';
import { useDashboardMetrics } from '../hooks/useDashboardMetrics';
import DailyGoal from '../components/dashboard/DailyGoal';
import KpiGrid from '../components/dashboard/KpiGrid';
import ProgressChart from '../components/dashboard/ProgressChart';
import Rankings from '../components/dashboard/Rankings';
import IssueMap from '../components/dashboard/IssueMap';
import DigitalColinha from '../components/dashboard/DigitalColinha';
import ReportModal from '../components/dashboard/ReportModal';
import ReportGenerator from '../components/dashboard/ReportGenerator';
import PesquisaChart from '../components/dashboard/PesquisaChart';
import FraudAlertPanel from '../components/dashboard/FraudAlertPanel';
import SupporterProfileCard from '../components/dashboard/SupporterProfileCard';
import ConversionFunnel from '../components/dashboard/ConversionFunnel';
import TeamTasksWidget from '../components/dashboard/TeamTasksWidget';
// CampaignAdvisor + IntelligencePanel + WarRoomFeed removidos do Dashboard —
// duplicavam o Estrategista/War Room em "Agentes IA" e os Fatores em "Inteligência".
import Button from '../components/ui/Button';
import SyncButton from '../components/ui/SyncButton';
import { PrintIcon } from '../components/icons';
import Card from '../components/ui/Card';
import { useAuth } from '../contexts/AuthContext';
import AgendaPanel from '../components/agenda/AgendaPanel';
import VoiceCommandButton from '../components/agenda/VoiceCommandButton';
import FieldFocusCard from '../components/dashboard/FieldFocusCard';
import PartyFieldQuickCard from '../components/party/PartyFieldQuickCard';
import PulsoStatsTile from '../components/dashboard/PulsoStatsTile';
// ExternalMemoryRefreshCard movido para SettingsPage (#56 era admin 1x/dia, não decisão diária do coord)

const DashboardPage = () => {
  const { user, userType } = useAuth();
  const [leaderFilter, setLeaderFilter] = React.useState('');
  const [municipioFilter, setMunicipioFilter] = React.useState('');
  const [bairroFilter, setBairroFilter] = React.useState('');
  const [apoiadorFilter, setApoiadorFilter] = React.useState('');
  const [isReportModalOpen, setIsReportModalOpen] = React.useState(false);
  const [selectedReport, setSelectedReport] = React.useState<string | null>(null);

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
            <Button variant="secondary" onClick={() => setIsReportModalOpen(true)}><PrintIcon className="mr-2" /> Relatórios (Export C-Level)</Button>
        </div>
      </div>
      
      <SyncButton />

      <div className="print-page-title hidden print:block">Relatório de Desempenho - {new Date().toLocaleDateString('pt-BR')}</div>

      {idealScenario && <DailyGoal dailyGoal={dailyGoal} />}

      {/* Ferramentas leves de campo do Coord/Líder de Partido (#83) — autoesconde se não for membro */}
      <PartyFieldQuickCard />

      <AgendaPanel voiceSlot={<VoiceCommandButton campaignId={user?.campaignId} />} />

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
                <PulsoStatsTile />
                <FraudAlertPanel />
                <IssueMap visits={filteredVisits} engagements={filteredEngagements} />
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

      {/* Foco de Campo IA (#116) — recomenda onde ir, onde evitar, qual pauta */}
      <FieldFocusCard />

      <ReportModal
        isOpen={isReportModalOpen} 
        onClose={() => setIsReportModalOpen(false)} 
        onGenerateReport={(id) => setSelectedReport(id)}
      />
    </div>
  );
};

export default DashboardPage;