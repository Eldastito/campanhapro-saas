import { useState } from 'react';
import { usePermissions } from '../hooks/usePermissions';
import { UsersGroupIcon } from '../components/icons';
import { useVisits } from '../contexts/VisitsContext';
import { useTeam } from '../contexts/TeamContext';
import { useTeamsData } from '../hooks/useTeamsData';
import TeamsPerformanceTable from '../components/teams/TeamsPerformanceTable';
import FiscalRequestsPanel from '../components/team/FiscalRequestsPanel';
import TeamInactivityAlert from '../components/teams/TeamInactivityAlert';
import TeamROIPanel from '../components/resources/TeamROIPanel';
import TeamGamificationPanel from '../components/resources/TeamGamificationPanel';
import Card from '../components/ui/Card';
import { Calendar } from 'lucide-react';

type Period = 30 | 60 | 90 | 180;

const TeamsPage = () => {
  const permissions = usePermissions();
  const { visits, engagementActions } = useVisits();
  const { teamMembers } = useTeam();
  const { teamStats } = useTeamsData(visits, engagementActions, teamMembers);
  const [period, setPeriod] = useState<Period>(30);

  if (!permissions.canUseTeamPanels) {
    return (
      <div className="space-y-6">
        <FiscalRequestsPanel />
        <div className="flex flex-col items-center justify-center text-center h-64">
          <UsersGroupIcon className="h-16 w-16 text-slate-500" />
          <h2 className="mt-4 text-2xl font-bold text-slate-300">Painel de Equipes</h2>
          <p className="mt-2 max-w-md text-slate-400">
            Este recurso está disponível apenas no plano <strong>Campanha Total</strong>.
            Ele permite que você filtre o dashboard por líder de equipe, acompanhando a performance
            de cada grupo separadamente.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FiscalRequestsPanel />

      {/* Header + filtro central de período */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-200">Painel de Desempenho por Equipe</h2>
          <p className="text-slate-400 text-sm mt-1">
            ROI, conquistas, alertas de inatividade e tabela detalhada. Filtre o período pra recortar a análise.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <label className="text-xs text-slate-400 font-bold uppercase tracking-widest">Período:</label>
          <select
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value) as Period)}
            className="bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 py-1"
          >
            <option value={30}>Últimos 30 dias</option>
            <option value={60}>Últimos 60 dias</option>
            <option value={90}>Últimos 90 dias</option>
            <option value={180}>Últimos 6 meses</option>
          </select>
        </div>
      </div>

      {/* Alerta de inatividade no topo (vermelho/amarelo se tiver, verde se não) */}
      <TeamInactivityAlert />

      {/* ROI por membro (com período centralizado) */}
      <TeamROIPanel daysProp={period} />

      {/* Conquistas (XP, badges) */}
      <TeamGamificationPanel daysProp={period} />

      {/* Tabela detalhada existente */}
      <Card>
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3">📊 Tabela de Desempenho</h3>
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
