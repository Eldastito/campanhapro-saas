import * as React from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { CheckCircleIcon } from '../icons';

interface PricingSectionProps {
    onGoToRegister: () => void;
    setToastMessage: (message: string) => void;
}

const plans = [
    {
      name: 'Essencial',
      price: 149,
      features: [
        '1 Usuário',
        'Calculadora e Dashboard',
        'Gestão de Visitas',
        'Relatórios em PDF',
        'Limite de 1.000 visitas',
      ],
      popular: false,
      variant: 'secondary' as const,
    },
    {
      name: 'Estratégico',
      price: 399,
      features: [
        'Até 5 Usuários',
        'Tudo do Plano Essencial',
        'Ferramentas de Colaboração',
        'Insights com IA',
        'Exportação de Dados',
        'Limite de 10.000 visitas',
      ],
      popular: true,
      variant: 'primary' as const,
    },
    {
      name: 'Campanha Total',
      price: 999,
      features: [
        'Usuários Ilimitados',
        'Tudo do Plano Estratégico',
        'Suporte Prioritário',
        'Painéis por Equipe',
        'Controle Financeiro Completo',
        'Visitas Ilimitadas',
      ],
      popular: false,
      variant: 'secondary' as const,
    },
];

const PricingSection: React.FC<PricingSectionProps> = ({ onGoToRegister, setToastMessage }) => {
    const handleSubscribeClick = (planName: string) => {
        setToastMessage(`Ótima escolha! Para assinar o plano ${planName}, primeiro crie sua conta.`);
        setTimeout(() => {
            onGoToRegister();
        }, 1000);
    };

    return (
        <section id="pricing" className="py-20 px-4 bg-slate-800">
            <h2 className="text-3xl font-bold text-center mb-12">Planos Sob Medida para sua Vitória</h2>
            <div className="grid lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
                {plans.map(plan => (
                    <div key={plan.name}>
                        <Card className={`border bg-slate-900 ${plan.popular ? 'border-2 border-[#4ac7f0]' : 'border-slate-700'} relative transition-all duration-300 hover:transform hover:-translate-y-2 hover:shadow-lg hover:shadow-cyan-500/20 flex flex-col`}>
                            {plan.popular && <span className="absolute top-0 -translate-y-1/2 left-1/2 -translate-x-1/2 bg-[#4ac7f0] text-slate-900 text-xs font-bold px-3 py-1 rounded-full uppercase">Mais Popular</span>}
                            <div className="flex-grow">
                                <h3 className={`text-2xl font-bold text-center ${plan.popular ? 'text-transparent bg-clip-text bg-gradient-to-r from-[#4ac7f0] to-[#1abc9c]' : ''}`}>{plan.name}</h3>
                                <p className="text-center text-4xl font-extrabold my-4">{`R$ ${plan.price}`}<span className="text-lg font-normal text-slate-400">/mês</span></p>
                                <ul className="space-y-3 my-6 text-slate-300">
                                    {plan.features.map(feature => (
                                        <li key={feature} className="flex items-start gap-3"><CheckCircleIcon className="h-5 w-5 text-green-400 flex-shrink-0 mt-1" aria-hidden="true" /> <span>{feature}</span></li>
                                    ))}
                                </ul>
                            </div>
                            <Button variant={plan.variant} className="w-full mt-4" onClick={() => handleSubscribeClick(plan.name)}>Assinar {plan.name}</Button>
                        </Card>
                    </div>
                ))}
            </div>
        </section>
    );
};

export default PricingSection;
