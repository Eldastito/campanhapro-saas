import * as React from 'react';
import { TeamStats } from '../../hooks/useTeamsData';
import { ArrowUpIcon, ArrowDownIcon } from '../icons';

interface TeamsPerformanceTableProps {
    teams: TeamStats[];
}

type SortConfig = {
    key: keyof TeamStats;
    direction: 'ascending' | 'descending';
} | null;

const TeamsPerformanceTable = ({ teams }: TeamsPerformanceTableProps) => {
    const [sortConfig, setSortConfig] = React.useState<SortConfig>({ key: 'totalVotes', direction: 'descending' });

    const sortedTeams = React.useMemo(() => {
        let sortableItems = [...teams];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                if (a[sortConfig.key] < b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (a[sortConfig.key] > b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [teams, sortConfig]);

    const requestSort = (key: keyof TeamStats) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const SortableHeader = ({ sortKey, children }: { sortKey: keyof TeamStats; children?: React.ReactNode }) => {
        const isSorted = sortConfig?.key === sortKey;
        const icon = isSorted ? (sortConfig?.direction === 'ascending' ? <ArrowUpIcon className="h-4 w-4" /> : <ArrowDownIcon className="h-4 w-4" />) : null;
        return (
            <th className="px-4 py-3 cursor-pointer" onClick={() => requestSort(sortKey)}>
                <div className="flex items-center gap-1">
                    {children} {icon}
                </div>
            </th>
        );
    };

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-slate-300">
                <thead className="text-xs text-slate-400 uppercase bg-slate-700">
                    <tr>
                        <SortableHeader sortKey="leader">Líder</SortableHeader>
                        <SortableHeader sortKey="supporterCount">Apoiadores</SortableHeader>
                        <SortableHeader sortKey="completedVisits">Visitas Realizadas</SortableHeader>
                        <SortableHeader sortKey="completionRate">Taxa de Conclusão</SortableHeader>
                        <SortableHeader sortKey="totalVotes">Total de Votos</SortableHeader>
                        <SortableHeader sortKey="avgVotesPerVisit">Média Votos/Visita</SortableHeader>
                        <SortableHeader sortKey="engagementCount">Ações de Engajamento</SortableHeader>
                    </tr>
                </thead>
                <tbody>
                    {sortedTeams.map(team => (
                        <tr key={team.leader} className="bg-slate-800 border-b border-slate-700 hover:bg-slate-700/50">
                            <td className="px-4 py-3 font-medium">{team.leader}</td>
                            <td className="px-4 py-3 text-center">{team.supporterCount}</td>
                            <td className="px-4 py-3 text-center">{team.completedVisits}</td>
                            <td className="px-4 py-3 text-center">{team.completionRate.toFixed(1)}%</td>
                            <td className="px-4 py-3 text-center font-bold text-[#4ac7f0]">{team.totalVotes}</td>
                            <td className="px-4 py-3 text-center">{team.avgVotesPerVisit.toFixed(2)}</td>
                            <td className="px-4 py-3 text-center">{team.engagementCount}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default TeamsPerformanceTable;