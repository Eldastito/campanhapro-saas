import * as React from 'react';
import { Download, FileText, RefreshCw } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';

interface ReportRow {
  label: string;
  value: string | number;
}

interface ReportSection {
  title: string;
  rows: ReportRow[];
}

function buildSections(factors: any, lastSync: any): ReportSection[] {
  if (!factors && !lastSync) return [];
  const sections: ReportSection[] = [];

  if (lastSync) {
    sections.push({
      title: 'Snapshot',
      rows: [
        { label: 'Última Sincronização', value: new Date(lastSync.lastSyncAt).toLocaleString('pt-BR') },
        { label: 'Visitas Processadas', value: lastSync.visitCount },
        { label: 'Pesquisas Processadas', value: lastSync.pesquisaCount },
      ],
    });
  }

  if (factors) {
    sections.push({
      title: 'Score',
      rows: [
        { label: 'Score Estratégico', value: factors.score },
        { label: 'Forças', value: factors.strengths.length },
        { label: 'Fraquezas', value: factors.weaknesses.length },
        { label: 'Oportunidades', value: factors.opportunities.length },
        { label: 'Riscos', value: factors.risks.length },
      ],
    });

    for (const [key, label] of [
      ['strengths', 'Forças'],
      ['weaknesses', 'Fraquezas'],
      ['opportunities', 'Oportunidades'],
      ['risks', 'Riscos'],
    ] as const) {
      if (factors[key]?.length) {
        sections.push({
          title: label,
          rows: (factors[key] as string[]).map((item: string, i: number) => ({
            label: `${i + 1}.`,
            value: item,
          })),
        });
      }
    }
  }

  return sections;
}

function exportCsv(sections: ReportSection[], campaignId: string) {
  const lines = ['Secao,Item,Valor'];
  for (const section of sections) {
    for (const row of section.rows) {
      const clean = (s: string | number) =>
        `"${String(s).replace(/"/g, '""')}"`;
      lines.push(`${clean(section.title)},${clean(row.label)},${clean(row.value)}`);
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `relatorio-inteligencia-${campaignId}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const IntelligenceReports: React.FC = () => {
  const { user } = useAuth();
  const [factors, setFactors] = React.useState<any>(null);
  const [lastSync, setLastSync] = React.useState<any>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user?.campaignId) return;
    fetch('/api/v1/intelligence/factors')
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (json) {
          setFactors(json.factors);
          setLastSync(json.lastSync);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [user?.campaignId]);

  const sections = buildSections(factors, lastSync);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16 text-slate-500">
        <RefreshCw className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-200">Relatórios de Inteligência</h3>
        {sections.length > 0 && (
          <Button
            variant="secondary"
            className="text-sm"
            onClick={() => exportCsv(sections, user?.campaignId ?? 'campaign')}
          >
            <Download className="w-4 h-4 mr-2" />
            Exportar CSV
          </Button>
        )}
      </div>

      {sections.length === 0 ? (
        <Card>
          <div className="text-center py-10 text-slate-500">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhum dado para exportar</p>
            <p className="text-sm mt-1">Sincronize os dados na aba Visão Geral para gerar relatórios.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {sections.map(section => (
            <Card key={section.title}>
              <h4 className="text-sm font-semibold text-slate-300 mb-3 pb-2 border-b border-slate-700">
                {section.title}
              </h4>
              <dl className="space-y-2">
                {section.rows.map((row, i) => (
                  <div key={i} className="flex justify-between text-sm gap-4">
                    <dt className="text-slate-400 shrink-0">{row.label}</dt>
                    <dd className="text-slate-200 text-right">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default IntelligenceReports;
