import * as React from 'react';
import { Visit } from '../types/visits';
import { EngagementAction } from '../types/engagement';
import { TeamMember } from '../types/teams';


export interface TeamStats {
    leader: string;
    supporterCount: number;
    totalVisits: number;
    completedVisits: number;
    completionRate: number;
    totalVotes: number;
    avgVotesPerVisit: number;
    engagementCount: number;
}

export const useTeamsData = (visits: Visit[], engagementActions: EngagementAction[], teamMembers: TeamMember[]): { teamStats: TeamStats[] } => {
    const teamStats = React.useMemo(() => {
        const leadersFromMembers = teamMembers.filter(m => m.role === 'Líder').map(m => m.name);
        const leadersFromVisits = visits.map(v => v.lider).filter(Boolean) as string[];
        const leaders = [...new Set([...leadersFromMembers, ...leadersFromVisits])].sort();
        
        const stats: TeamStats[] = leaders.map(leader => {
            const teamVisits = visits.filter(v => v.lider === leader);
            const teamSupporters = [...new Set(teamVisits.map(v => v.apoiador))];

            const completedVisits = teamVisits.filter(v => v.realizada === 'sim');
            const totalVotes = completedVisits.reduce((sum, v) => sum + v.votos, 0);
            
            const teamEngagementActions = engagementActions.filter(action => teamSupporters.includes(action.apoiador));

            const totalVisits = teamVisits.length;
            const completionRate = totalVisits > 0 ? (completedVisits.length / totalVisits) * 100 : 0;
            const avgVotesPerVisit = completedVisits.length > 0 ? totalVotes / completedVisits.length : 0;

            return {
                leader,
                supporterCount: teamSupporters.length,
                totalVisits,
                completedVisits: completedVisits.length,
                completionRate,
                totalVotes,
                avgVotesPerVisit,
                engagementCount: teamEngagementActions.length,
            };
        });

        return stats;
    }, [visits, engagementActions, teamMembers]);

    return { teamStats };
};
