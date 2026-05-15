interface KpiGridProps {
  kpis: {
    total: number;
    realizadas: number;
    pendentes: number;
    votos: number;
    avgVotos: number;
    apoiadoresAtivos: number;
    totalAbordagens: number;
    totalMateriais: number;
  };
  currentScenarioStatus: {
    name: string;
    color: string;
    avg: number;
  };
  isLoading?: boolean;
}

const KpiCard = ({ title, value, description, valueClassName = '', isLoading = false }: { title: string; value: string | number; description?: string, valueClassName?: string, isLoading?: boolean }) => (
  <div className="bg-slate-700 p-4 rounded-lg relative overflow-hidden">
    <p className="text-sm text-slate-400">{title}</p>
    {isLoading ? (
        <div className="h-9 bg-slate-600 rounded mt-1 w-1/2 animate-pulse"></div>
    ) : (
        <p className={`text-3xl font-bold mt-1 ${valueClassName}`}>{value}</p>
    )}
    {description && (
        isLoading ? (
            <div className="h-4 bg-slate-600 rounded mt-1 w-3/4 animate-pulse"></div>
        ) : (
            <p className="text-xs text-slate-500 mt-1">{description}</p>
        )
    )}
  </div>
);

const KpiGrid = ({ kpis, currentScenarioStatus, isLoading = false }: KpiGridProps) => (
  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 print-break-inside-avoid">
    <KpiCard title="Visitas Realizadas" value={kpis.realizadas} description={`de ${kpis.total} totais`} valueClassName={kpis.total === 0 ? "text-slate-500" : "text-[#4ac7f0]"} isLoading={isLoading} />
    <KpiCard title="Estimativa de Votos" value={kpis.votos} valueClassName={kpis.total === 0 ? "text-slate-500" : "text-[#1abc9c]"} isLoading={isLoading} />
    <KpiCard title="Média de Votos" value={kpis.avgVotos} description="por visita" isLoading={isLoading} />
    <KpiCard title="Apoiadores Ativos" value={kpis.apoiadoresAtivos} description="últimos 7 dias" isLoading={isLoading} />
    <KpiCard title="Total Abordagens" value={kpis.totalAbordagens} description="engajamento rápido" isLoading={isLoading} />
    <KpiCard title="Materiais Entregues" value={kpis.totalMateriais} description="panfletos, etc." isLoading={isLoading} />
    <KpiCard title="Visitas Pendentes" value={kpis.pendentes} valueClassName={kpis.total === 0 ? "text-slate-500" : "text-yellow-400"} isLoading={isLoading} />
    <KpiCard title="Cenário Atual" value={kpis.total === 0 && !isLoading ? 'Sem Dados' : currentScenarioStatus.name} valueClassName={`text-lg ${kpis.total === 0 ? "text-slate-500" : currentScenarioStatus.color}`} description={`Média: ${currentScenarioStatus.avg.toFixed(2)} votos`} isLoading={isLoading} />
  </div>
);

export default KpiGrid;