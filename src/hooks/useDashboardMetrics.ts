import * as React from 'react';
import { calculateScenarioMetrics, getTodayString } from '../utils/helpers';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useVisits } from '../contexts/VisitsContext';
import { useCalculator } from '../contexts/CalculatorContext';

import { usePesquisas } from './usePesquisas';
import { getLeaderConversionStats, LeaderStat } from '../services/engagementService';

interface UseDashboardMetricsProps {
  municipioFilter: string;
  bairroFilter: string;
  apoiadorFilter: string;
  leaderFilter: string;
}

export const useDashboardMetrics = ({
  municipioFilter,
  bairroFilter,
  apoiadorFilter,
  leaderFilter: adminLeaderFilter, // Renomeado para evitar conflito
}: UseDashboardMetricsProps) => {
  const { user } = useAuth();
  const { teamMembers, locations } = useTeam();
  const { visits, engagementActions, isLoading: visitsLoading } = useVisits();
  const { scenarios, idealScenarioId } = useCalculator();
  const { pesquisas, isLoading: pesquisasLoading } = usePesquisas();
  const [leaderRanking, setLeaderRanking] = React.useState<LeaderStat[]>([]);
  const [engagementLoading, setEngagementLoading] = React.useState(true);

  const idealScenario = React.useMemo(() => scenarios.find(s => s.id === idealScenarioId) || null, [scenarios, idealScenarioId]);

  const isLoading = visitsLoading || pesquisasLoading || engagementLoading;

  React.useEffect(() => {
    if (!user?.campaignId) return;
    const fetchEngagement = async () => {
      console.log("[DashboardMetrics] Buscando métricas de engajamento para:", user.campaignId);
      const stats = await getLeaderConversionStats(user.campaignId);
      console.log("[DashboardMetrics] Stats de Líderes:", stats.length);
      setLeaderRanking(stats);
      setEngagementLoading(false);
    };
    fetchEngagement();
  }, [user?.campaignId]);

  React.useEffect(() => {
    if (pesquisas.length > 0) {
        console.log("[DashboardMetrics] Pesquisas carregadas:", pesquisas.length);
    }
    if (engagementActions.length > 0) {
        console.log("[DashboardMetrics] Ações de Engajamento carregadas:", engagementActions.length);
    }
  }, [pesquisas, engagementActions]);

  const { visibleVisits, visibleEngagements, allApoiadores, allMunicipios, allBairros, allLeaders } = React.useMemo(() => {
    let filteredVisits = visits;
    let filteredEngagements = engagementActions;
    
    // Lista de líderes do cadastro de equipe
    const leadersFromMembers = teamMembers.filter(m => m.role === 'Líder').map(m => m.name);
    // Lista de líderes encontrados nas visitas
    const leadersFromVisits = visits.map(v => v.lider).filter(Boolean) as string[];
    // Unir e ordenar
    let leadersInScope = [...new Set([...leadersFromMembers, ...leadersFromVisits])].sort();
    
    // Lista de apoiadores do cadastro de equipe
    const supportersFromMembers = teamMembers.filter(m => m.role === 'Apoiador' || m.role === 'Colaborador').map(m => m.name);
    const supportersFromVisits = visits.map(v => v.apoiador).filter(Boolean) as string[];


    // Municípios e Bairros vêm de locations E de visitas cadastradas (fallback)
    const municipiosFromLocations = locations.map(l => l.municipality);
    const municipiosFromVisits = visits.map(v => (v as any).municipio).filter(Boolean) as string[];
    const allMunicipiosCombined = [...new Set([...municipiosFromLocations, ...municipiosFromVisits])];

    const bairrosFromLocations = locations
      .filter(l => municipioFilter ? l.municipality === municipioFilter : true)
      .map(l => l.name);
    const bairrosFromVisits = visits
      .filter(v => municipioFilter ? (v as any).municipio === municipioFilter : true)
      .map(v => v.bairro)
      .filter(Boolean) as string[];
    let neighborhoodsInScope = [...new Set([...bairrosFromLocations, ...bairrosFromVisits])];

    // Lógica Estrita de Cascata para Apoiadores
    let supportersInScope = [...new Set([...supportersFromMembers, ...supportersFromVisits])].sort();

    if (municipioFilter || bairroFilter) {
      const visitsInLocal = visits.filter(v => 
        (municipioFilter ? v.municipio === municipioFilter : true) &&
        (bairroFilter ? v.bairro === bairroFilter : true)
      );
      const supportersInLocal = [...new Set(visitsInLocal.map(v => v.apoiador).filter(Boolean) as string[])];
      
      // Se houver membros da equipe vinculados a esses locais (via team_members.bairro/municipio se existisse), poderíamos cruzar aqui.
      // Por enquanto, filtramos apoiadores que REALIZARAM visitas nesses locais.
      supportersInScope = supportersInScope.filter(s => supportersInLocal.includes(s));
      
      // Se não houver visitas mas houver membros da equipe, não filtramos para não esvaziar a lista precocemente
      if (supportersInLocal.length === 0) {
          supportersInScope = [...new Set([...supportersFromMembers, ...supportersFromVisits])].sort();
      }
    }
    
    if (user?.type === 'Líder') {
      const myTeamSupporterNames = teamMembers
        .filter(m => m.assignedLeaderId === user.id)
        .map(m => m.name);
      filteredVisits = visits.filter(v => myTeamSupporterNames.includes(v.apoiador) || v.lider === user.name);
      filteredEngagements = engagementActions.filter(ea => myTeamSupporterNames.includes(ea.apoiador));
      
      // Filtra os apoiadores do escopo para mostrar apenas os do meu time
      supportersInScope = supportersInScope.filter(s => myTeamSupporterNames.includes(s));
      leadersInScope = [user.name];
    }

    if (user?.type === 'Admin' && adminLeaderFilter) {
      filteredVisits = filteredVisits.filter(v => v.lider === adminLeaderFilter);
       const leadersSupporters = [...new Set(filteredVisits.map(v => v.apoiador))];
      filteredEngagements = engagementActions.filter(ea => leadersSupporters.includes(ea.apoiador));
      supportersInScope = supportersInScope.filter(s => leadersSupporters.includes(s));
    }
    
    return {
      visibleVisits: filteredVisits,
      visibleEngagements: filteredEngagements,
      allApoiadores: supportersInScope,
      allMunicipios: allMunicipiosCombined.sort(),
      allBairros: neighborhoodsInScope.sort(),
      allLeaders: leadersInScope,
    };
  }, [user, visits, engagementActions, teamMembers, locations, adminLeaderFilter, municipioFilter, bairroFilter]);


  const completedVisits = React.useMemo(() => visibleVisits.filter(v => v.realizada === 'sim'), [visibleVisits]);

  const kpis = React.useMemo(() => {
    const realizadas = completedVisits.length;
    const votos = completedVisits.reduce((sum, v) => sum + v.votos, 0);
    const avgVotos = realizadas > 0 ? parseFloat((votos / realizadas).toFixed(2)) : 0;
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const activeSupporters = new Set(
        completedVisits.filter(v => new Date(v.data) >= sevenDaysAgo).map(v => v.apoiador)
    ).size;
    
    const totalAbordagens = visibleEngagements.filter(a => a.tipo === 'Abordagem Rápida').length;
    const totalMateriais = visibleEngagements.reduce((sum, a) => sum + (a.materialDistribuido || 0), 0);

    return { total: visibleVisits.length, realizadas, pendentes: visibleVisits.length - realizadas, votos, avgVotos, apoiadoresAtivos: activeSupporters, totalAbordagens, totalMateriais };
  }, [visibleVisits, completedVisits, visibleEngagements]);

  const dailyGoal = React.useMemo(() => {
    if (!idealScenario) return { meta: 0, realizadasHoje: 0, color: 'text-slate-400', status: 'N/A' };
    const todayStr = getTodayString();
    const eleicao = new Date(idealScenario.eleicao);
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    const diffTime = eleicao.getTime() - hoje.getTime();
    const daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const metrics = calculateScenarioMetrics(idealScenario, daysRemaining);
    const meta = metrics.famPerDay;
    const realizadasHoje = completedVisits.filter(v => v.data === todayStr).length;
    let color = 'text-red-400';
    let status = 'Abaixo';
    if (realizadasHoje >= meta) {
        color = 'text-[#1abc9c]';
        status = 'Meta Batida!';
    } else if (realizadasHoje >= meta * 0.7) {
        color = 'text-yellow-400';
        status = 'Quase lá';
    }
    return { meta, realizadasHoje, color, status };
  }, [idealScenario, completedVisits]);

  const aniversariantes = React.useMemo(() => {
    const today = new Date();
    const todayMonth = today.getMonth() + 1;
    const todayDay = today.getDate();
    return visibleVisits.filter(v => {
        if (!v.nasc) return false;
        const [, month, day] = v.nasc.split('-').map(Number);
        return month === todayMonth && day === todayDay;
    });
  }, [visibleVisits]);

  const visitasDeHoje = React.useMemo(() => {
      const todayStr = getTodayString();
      return visibleVisits.filter(v => v.data === todayStr && v.realizada === 'nao');
  }, [visibleVisits]);
  
  const filteredVisitsForChart = React.useMemo(() => {
    return visibleVisits.filter(v => 
      (municipioFilter ? v.municipio === municipioFilter : true) &&
      (bairroFilter ? v.bairro === bairroFilter : true) &&
      (apoiadorFilter ? v.apoiador === apoiadorFilter : true)
    );
  }, [visibleVisits, municipioFilter, bairroFilter, apoiadorFilter]);

  const createRanking = (key: 'bairro' | 'apoiador') => {
    const rankingData: { [name: string]: { visits: number; votes: number } } = {};
    completedVisits.forEach(v => {
      const name = v[key];
      if (!name) return;
      if (!rankingData[name]) rankingData[name] = { visits: 0, votes: 0 };
      rankingData[name].visits += 1;
      rankingData[name].votes += v.votos;
    });
    return Object.entries(rankingData)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.votes - a.votes);
  };
  
  const bairroRanking = React.useMemo(() => createRanking('bairro'), [completedVisits]);
  const apoiadorRanking = React.useMemo(() => createRanking('apoiador'), [completedVisits]);

  const currentScenarioStatus = React.useMemo(() => {
    if (completedVisits.length === 0) return { name: 'N/A', color: 'text-slate-400', avg: 0 };
    const totalVotes = completedVisits.reduce((sum, v) => sum + v.votos, 0);
    const avg = totalVotes / completedVisits.length;
    if (avg >= 7) return { name: 'Ideal (≥7)', color: 'text-[#4ac7f0]', avg };
    if (avg >= 5) return { name: 'Realista (5-6)', color: 'text-[#1abc9c]', avg };
    if (avg >= 3.5) return { name: 'Realista B (3.5-4)', color: 'text-yellow-400', avg };
    return { name: 'Conservador (<3.5)', color: 'text-orange-400', avg };
  }, [completedVisits]);

  return {
    kpis, dailyGoal, aniversariantes, visitasDeHoje,
    filteredVisits: filteredVisitsForChart,
    filteredEngagements: visibleEngagements,
    allMunicipios, allBairros, allApoiadores, allLeaders,
    bairroRanking, apoiadorRanking, leaderRanking, currentScenarioStatus, idealScenario, pesquisas,
    isLoading
  };
};