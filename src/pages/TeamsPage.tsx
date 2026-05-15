import { usePermissions } from '../hooks/usePermissions';
import { UsersGroupIcon } from '../components/icons';
import { useVisits } from '../contexts/VisitsContext';
import { useTeam } from '../contexts/TeamContext';
import { useTeamsData } from '../hooks/useTeamsData';
import TeamsPerformanceTable from '../components/teams/TeamsPerformanceTable';
import Card from '../components/ui/Card';

const TeamsPage = () => {
  const permissions = usePermissions();
  const { visits, engagementActions } = useVisits();
  const { teamMembers } = useTeam();
  const { teamStats } = useTeamsData(visits, engagementActions, teamMembers);

  if (!permissions.canUseTeamPanels) {
    return (
      <div className="flex flex-col items-center justify-center text-center h-64">
        <UsersGroupIcon className="h-16 w-16 text-slate-500" />
        <h2 className="mt-4 text-2xl font-bold text-slate-300">Painel de Equipes</h2>
        <p className="mt-2 max-w-md text-slate-400">
          Este recurso está disponível apenas no plano <strong>Campanha Total</strong>.
          Ele permite que você filtre o dashboard por líder de equipe, acompanhando a performance
          de cada grupo separadamente.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-slate-200">Painel de Desempenho por Equipe</h2>
      <p className="text-slate-400">
        Analise e compare o desempenho de suas equipes de campo. Clique nos cabeçalhos da tabela para ordenar os resultados e identificar os líderes mais eficientes.
      </p>
      <Card>
        {teamStats.length > 0 ? (
          <TeamsPerformanceTable teams={teamStats} />
        ) : (
          <div className="text-center py-10">
            <p className="text-slate-400">Nenhum líder de equipe encontrado nas visitas cadastradas.</p>
            <p className="text-sm text-slate-500 mt-2">Para usar este painel, preencha o campo "Líder de Equipe" ao registrar uma visita.</p>
          </div>
        )}
      </Card>
    </div>
  );
};

export default TeamsPage;