import * as React from 'react';
import Tabs from '../components/Tabs';
import IntelligenceOverview from '../components/intelligence/IntelligenceOverview';
import IntelligenceFactors from '../components/intelligence/IntelligenceFactors';
import IntelligenceScenarios from '../components/intelligence/IntelligenceScenarios';
import IntelligenceReports from '../components/intelligence/IntelligenceReports';

const SUBTABS = ['Visão Geral', 'Fatores', 'Cenários', 'Relatórios'];

const IntelligencePage: React.FC = () => {
  const [syncKey, setSyncKey] = React.useState(0);

  // Increment to signal child components that a new sync happened
  const handleSyncComplete = () => setSyncKey(k => k + 1);

  return (
    <div className="space-y-4">
      <Tabs tabs={SUBTABS} mode="state">
        <IntelligenceOverview onSyncComplete={handleSyncComplete} />
        <IntelligenceFactors key={syncKey} />
        <IntelligenceScenarios key={syncKey} />
        <IntelligenceReports key={syncKey} />
      </Tabs>
    </div>
  );
};

export default IntelligencePage;
