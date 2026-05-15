import * as React from 'react';
import Card from '../ui/Card';
import { Visit } from '../../types/visits';
import { EngagementAction } from '../../types/engagement';
import { MessageSquare, ThumbsUp, Minus } from 'lucide-react';

interface IssueMapProps {
    visits: Visit[];
    engagements: EngagementAction[];
}

const IssueMap = ({ visits, engagements }: IssueMapProps) => {
    const issuesByBairro = React.useMemo(() => {
        const map: Record<string, { positive: number; neutral: number; negative: number; topIssues: string[] }> = {};
        
        visits.forEach(v => {
            if (!map[v.bairro]) {
                map[v.bairro] = { positive: 0, neutral: 0, negative: 0, topIssues: [] };
            }
            if (v.solicit) {
                map[v.bairro].topIssues.push(v.solicit);
            }
            // Logic: if votes > 0, it's a positive signal
            if (v.votos > 0) map[v.bairro].positive++;
            else map[v.bairro].neutral++;
        });

        engagements.forEach(e => {
            const local = e.local || 'Geral';
            if (!map[local]) {
                map[local] = { positive: 0, neutral: 0, negative: 0, topIssues: [] };
            }
            if (e.sentimento === 'Positivo') map[local].positive++;
            else if (e.sentimento === 'Negativo') map[local].negative++;
            else map[local].neutral++;
        });

        return Object.entries(map)
            .map(([name, data]) => ({
                name,
                ...data,
                topIssues: [...new Set(data.topIssues)].slice(0, 3)
            }))
            .sort((a, b) => (b.positive + b.neutral + b.negative) - (a.positive + a.neutral + a.negative))
            .slice(0, 6);
    }, [visits, engagements]);

    return (
        <Card className="h-full">
            <h3 className="font-bold text-lg text-slate-300 mb-4 flex items-center gap-2">
                <MessageSquare className="text-sky-400" /> Mapa de Demandas e Sentimento
            </h3>
            <div className="space-y-4">
                {issuesByBairro.length > 0 ? (
                    issuesByBairro.map((b) => (
                        <div key={b.name} className="bg-slate-700/30 p-3 rounded-lg border border-slate-600/50">
                            <div className="flex justify-between items-start mb-2">
                                <h4 className="font-bold text-slate-200">{b.name}</h4>
                                <div className="flex gap-2">
                                    <span className="flex items-center gap-1 text-xs text-green-400">
                                        <ThumbsUp size={12} /> {b.positive}
                                    </span>
                                    <span className="flex items-center gap-1 text-xs text-slate-400">
                                        <Minus size={12} /> {b.neutral}
                                    </span>
                                </div>
                            </div>
                            {b.topIssues.length > 0 && (
                                <div className="space-y-1">
                                    <p className="text-[10px] uppercase text-slate-500 font-bold">Principais Demandas:</p>
                                    <ul className="text-xs text-slate-400 list-disc list-inside">
                                        {b.topIssues.map((issue, i) => (
                                            <li key={i} className="truncate">{issue}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ))
                ) : (
                    <p className="text-sm text-slate-500 italic text-center py-8">
                        Dados insuficientes para mapear demandas.
                    </p>
                )}
            </div>
        </Card>
    );
};

export default IssueMap;
