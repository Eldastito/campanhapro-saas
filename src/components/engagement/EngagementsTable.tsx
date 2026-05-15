import { EngagementAction } from '../../types/engagement';

interface EngagementsTableProps {
    actions: EngagementAction[];
}

const EngagementsTable = ({ actions }: EngagementsTableProps) => {
    const sortedActions = [...actions].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

    const renderActionDetails = (action: EngagementAction) => {
        switch (action.tipo) {
            case 'Abordagem Rápida':
                return `Local: ${action.local || 'N/A'} | Sentimento: ${action.sentimento || 'N/A'}`;
            case 'Distribuição de Material':
                return `Local: ${action.local || 'N/A'} | Qtd: ${action.materialDistribuido || 0}`;
            case 'Evento':
                return `Nome: ${action.eventoNome || 'N/A'} | Pessoas: ${action.pessoasContatadas || 0}`;
            default:
                return '';
        }
    };
    
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-slate-300">
                <thead className="text-xs text-slate-400 uppercase bg-slate-700">
                    <tr>
                        <th className="px-4 py-3">Data</th>
                        <th className="px-4 py-3">Apoiador</th>
                        <th className="px-4 py-3">Tipo de Ação</th>
                        <th className="px-4 py-3">Detalhes</th>
                    </tr>
                </thead>
                <tbody>
                    {sortedActions.map(action => (
                        <tr key={action.id} className="bg-slate-800 border-b border-slate-700 hover:bg-slate-700/50">
                            <td className="px-4 py-3">{action.data}</td>
                            <td className="px-4 py-3 font-medium">{action.apoiador}</td>
                            <td className="px-4 py-3">
                                <span className="bg-sky-500/20 text-sky-300 text-xs font-semibold mr-2 px-2.5 py-0.5 rounded">
                                    {action.tipo}
                                </span>
                            </td>
                            <td className="px-4 py-3 text-slate-400 text-xs">{renderActionDetails(action)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {actions.length === 0 && <p className="text-center py-8 text-slate-400">Nenhuma ação de engajamento registrada ainda.</p>}
        </div>
    );
};

export default EngagementsTable;