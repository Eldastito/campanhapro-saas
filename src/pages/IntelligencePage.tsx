import * as React from 'react';
import Tabs from '../components/Tabs';
import IntelligenceOverview from '../components/intelligence/IntelligenceOverview';
import IntelligenceFactors from '../components/intelligence/IntelligenceFactors';
import IntelligenceScenarios from '../components/intelligence/IntelligenceScenarios';
import IntelligenceReports from '../components/intelligence/IntelligenceReports';
import ExaForgePanel from '../components/intelligence/ExaForgePanel';
import CompetitiveIntelPanel from '../components/intelligence/CompetitiveIntelPanel';
import PlaybookPanel from '../components/intelligence/PlaybookPanel';
import TseLookupCard from '../components/intelligence/TseLookupCard';

const SUBTABS = ['Visão Geral', 'Concorrência', 'Argumentário', 'Fatores', 'Projeções', 'Relatórios', 'Base de Conhecimento'];

const IntelligencePage: React.FC = () => {
  const [syncKey, setSyncKey] = React.useState(0);

  const handleSyncComplete = () => setSyncKey(k => k + 1);

  return (
    <div className="space-y-4">
      <Tabs tabs={SUBTABS} mode="state">
        <IntelligenceOverview onSyncComplete={handleSyncComplete} />
        <div className="space-y-4">
          <TseLookupCard />
          <CompetitiveIntelPanel />
        </div>
        <PlaybookPanel />
        <IntelligenceFactors key={syncKey} />
        <IntelligenceScenarios key={syncKey} />
        <IntelligenceReports key={syncKey} />
        <ExaForgePanel />
      </Tabs>
    </div>
  );
};

export default IntelligencePage;
