import * as React from 'react';
import { TargetIcon, BarChartIcon, UsersGroupIcon, FinancialIcon } from '../icons';

const coreFeaturesData = [
    {
        icon: <TargetIcon aria-hidden="true" />,
        title: "Calculadora Estratégica",
        description: "Defina sua meta de votos e descubra exatamente quantas famílias você precisa visitar por dia e por semana para alcançá-la.",
    },
    {
        icon: <BarChartIcon aria-hidden="true" />,
        title: "Dashboard em Tempo Real",
        description: "Acompanhe o progresso da sua campanha com gráficos intuitivos. Veja votos por bairro, ranking de apoiadores e o desempenho diário.",
    },
    {
        icon: <UsersGroupIcon aria-hidden="true" />,
        title: "Gestão Centralizada",
        description: "Gerencie todas as visitas, colete informações valiosas sobre as famílias e nunca mais perca um contato ou um compromisso.",
    },
    {
        icon: <FinancialIcon aria-hidden="true" />,
        title: "Controle Financeiro Total",
        description: "Gerencie o orçamento, registre doações e despesas, e anexe notas fiscais. Tenha uma visão clara da saúde financeira da sua campanha.",
    },
];

const CoreFeatures: React.FC = () => {
    return (
        <section id="features" className="py-20 px-4 bg-slate-800">
            <div className="container mx-auto text-center">
                <h2 className="text-3xl font-bold mb-12">O Fim da Desorganização na sua Campanha</h2>
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-6xl mx-auto">
                    {coreFeaturesData.map((feature) => (
                        <div key={feature.title} className="flex flex-col items-center p-6 rounded-xl transition-all duration-300 hover:bg-slate-900/50 hover:scale-105">
                            <div className="bg-slate-900 p-4 rounded-full mb-4">
                                {feature.icon}
                            </div>
                            <h3 className="text-xl font-semibold mb-2 text-slate-100">{feature.title}</h3>
                            <p className="text-slate-400">{feature.description}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default CoreFeatures;
