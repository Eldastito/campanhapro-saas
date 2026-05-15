import * as React from 'react';
import { ShieldCheck } from 'lucide-react';
import Tabs from '../components/Tabs';
import ErrorBoundary from '../components/dev/ErrorBoundary';

const ComplianceOverview = React.lazy(() => import('../components/compliance/ComplianceOverview'));
const AuditLogTable = React.lazy(() => import('../components/compliance/AuditLogTable'));
const WebhookHealth = React.lazy(() => import('../components/compliance/WebhookHealth'));

const SUBTABS = ['Visão Geral', 'Auditoria', 'Webhooks'];

const Loading: React.FC = () => (
  <div className="py-8 text-center text-slate-500 text-sm">Carregando...</div>
);

const CompliancePage: React.FC = () => (
  <div className="space-y-6">
    <div className="flex items-center gap-2">
      <ShieldCheck className="w-6 h-6 text-indigo-400" />
      <h2 className="text-2xl font-bold text-slate-200">Conformidade & Observabilidade</h2>
    </div>

    <Tabs tabs={SUBTABS} mode="state">
      <ErrorBoundary label="Visão Geral">
        <React.Suspense fallback={<Loading />}>
          <ComplianceOverview />
        </React.Suspense>
      </ErrorBoundary>
      <ErrorBoundary label="Auditoria">
        <React.Suspense fallback={<Loading />}>
          <AuditLogTable />
        </React.Suspense>
      </ErrorBoundary>
      <ErrorBoundary label="Webhooks">
        <React.Suspense fallback={<Loading />}>
          <WebhookHealth />
        </React.Suspense>
      </ErrorBoundary>
    </Tabs>
  </div>
);

export default CompliancePage;
