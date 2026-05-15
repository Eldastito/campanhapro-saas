import * as React from 'react';
import Card from '../ui/Card';

interface PesquisaChartProps {
    // Para simplificar, vou assumir uma prop que recebe os dados.
    // Você vai plugar isso onde armazenar os dados de pesquisa.
    data: any[]; 
}

const SimplePieChart = ({ data }: { data: { label: string; value: number; color: string }[] }) => {
    const total = data.reduce((sum, d) => sum + d.value, 0);
    let cumulativeAngle = 0;

    if (total === 0) {
        return (
            <svg viewBox="0 0 100 100" className="w-48 h-48">
                <circle cx="50" cy="50" r="40" fill="transparent" stroke="#334155" strokeWidth="2" />
            </svg>
        );
    }

    return (
        <svg viewBox="0 0 100 100" className="w-48 h-48">
            {data.map((d, i) => {
                const angle = (d.value / total) * 360;
                const radians = (cumulativeAngle * Math.PI) / 180;
                const x = 50 + 40 * Math.cos(radians);
                const y = 50 + 40 * Math.sin(radians);
                const largeArc = angle > 180 ? 1 : 0;
                const path = `M 50 50 L ${x} ${y} A 40 40 0 ${largeArc} 1 ${50 + 40 * Math.cos(((cumulativeAngle + angle) * Math.PI) / 180)} ${50 + 40 * Math.sin(((cumulativeAngle + angle) * Math.PI) / 180)} Z`;
                cumulativeAngle += angle;
                return <path key={i} d={path} fill={d.color} />;
            })}
        </svg>
    );
};

const PesquisaChart: React.FC<PesquisaChartProps> = ({ data }) => {
    // Exemplo de transformação de dados para o gráfico de intenção de voto
    const votingData = React.useMemo(() => {
        const counts = data.reduce((acc, curr) => {
            const vote = curr.intencaoVoto;
            acc[vote] = (acc[vote] || 0) + 1;
            return acc;
        }, {});
        
        return [
            { label: 'Candidato', value: counts['candidato'] || 0, color: '#4ac7f0' },
            { label: 'Outros', value: counts['outro'] || 0, color: '#f59e0b' },
            { label: 'Indeciso', value: counts['indeciso'] || 0, color: '#94a3b8' },
        ];
    }, [data]);

    return (
        <Card>
            <h3 className="font-bold text-lg text-slate-300 mb-4">Intenção de Voto</h3>
            <div className="flex flex-col items-center">
                <SimplePieChart data={votingData} />
                <div className="flex gap-4 mt-4 text-sm">
                    {votingData.map(d => (
                        <div key={d.label} className="flex items-center gap-1">
                            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }}></div>
                            <span className="text-slate-300">{d.label}: {d.value}</span>
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    );
};

export default PesquisaChart;
