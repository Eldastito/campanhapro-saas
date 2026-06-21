import * as React from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { CheckCircleIcon } from '../icons';

interface PricingSectionProps {
    onGoToRegister: () => void;
    setToastMessage: (message: string) => void;
}

// Valores e features sincronizados com o catálogo real em `plans` (Supabase).
// Já tropeçamos exibindo R$149/R$399/R$999 enquanto o banco cobra 10/15/20 mil.
const plans = [
    {
      name: 'Gratuito',
      price: 0,
      features: [
        'Dashboard e CRM',
        'Gestão de visitas e equipe',
        'Formulários e materiais',
        'Para conhecer a plataforma',
      ],
      popular: false,
      variant: 'secondary' as const,
      ctaLabel: 'Começar grátis',
    },
    {
      name: 'Essencial',
      price: 10000,
      features: [
        'Tudo do Gratuito',
        'Agentes de IA (100 chamadas/mês)',
        'WhatsApp Omnichannel',
        'Metas, rotinas e engajamento',
        'Até 1.000 disparos/mês',
      ],
      popular: false,
      variant: 'secondary' as const,
      ctaLabel: 'Assinar Essencial',
    },
    {
      name: 'Estratégico',
      price: 15000,
      features: [
        'Tudo do Essencial',
        'Analytics e Financeiro',
        'Content Studio com RAG',
        'Reuniões, Call Center e Treinamento',
        'Até 10.000 disparos/mês',
      ],
      popular: true,
      variant: 'primary' as const,
      ctaLabel: 'Assinar Estratégico',
    },
    {
      name: 'Total',
      price: 20000,
      features: [
        'Tudo do Estratégico',
        'Cenários e Inteligência',
        'Dia da Eleição e Compliance',
        'Orçamento CEO e Paperclip',
        'IA e disparos ilimitados',
      ],
      popular: false,
      variant: 'secondary' as const,
      ctaLabel: 'Assinar Total',
    },
];

const formatPrice = (cents: number) => {
  if (cents === 0) return 'R$ 0';
  return `R$ ${cents.toLocaleString('pt-BR')}`;
};

const PricingSection: React.FC<PricingSectionProps> = ({ onGoToRegister, setToastMessage }) => {
    const handleSubscribeClick = (planName: string) => {
        setToastMessage(`Ótima escolha! Para assinar o plano ${planName}, primeiro crie sua conta.`);
        setTimeout(() => {
            onGoToRegister();
        }, 1000);
    };

    return (
        <section id="pricing" className="py-20 px-4 bg-slate-800">
            <h2 className="text-3xl font-bold text-center mb-4">Planos Sob Medida para sua Vitória</h2>
            <p className="text-center text-slate-400 mb-12 max-w-2xl mx-auto">
                Comece grátis para conhecer a plataforma. Quando a campanha exigir, evolua para o plano que entrega o arsenal completo.
            </p>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
                {plans.map(plan => (
                    <div key={plan.name}>
                        <Card className={`border bg-slate-900 ${plan.popular ? 'border-2 border-[#4ac7f0]' : 'border-slate-700'} relative transition-all duration-300 hover:transform hover:-translate-y-2 hover:shadow-lg hover:shadow-cyan-500/20 flex flex-col h-full`}>
                            {plan.popular && <span className="absolute top-0 -translate-y-1/2 left-1/2 -translate-x-1/2 bg-[#4ac7f0] text-slate-900 text-xs font-bold px-3 py-1 rounded-full uppercase">Mais Popular</span>}
                            <div className="flex-grow">
                                <h3 className={`text-2xl font-bold text-center ${plan.popular ? 'text-transparent bg-clip-text bg-gradient-to-r from-[#4ac7f0] to-[#1abc9c]' : ''}`}>{plan.name}</h3>
                                <p className="text-center text-4xl font-extrabold my-4">{formatPrice(plan.price)}<span className="text-lg font-normal text-slate-400">/mês</span></p>
                                <ul className="space-y-3 my-6 text-slate-300">
                                    {plan.features.map(feature => (
                                        <li key={feature} className="flex items-start gap-3"><CheckCircleIcon className="h-5 w-5 text-green-400 flex-shrink-0 mt-1" aria-hidden="true" /> <span>{feature}</span></li>
                                    ))}
                                </ul>
                            </div>
                            <Button variant={plan.variant} className="w-full mt-4" onClick={() => handleSubscribeClick(plan.name)}>{plan.ctaLabel}</Button>
                        </Card>
                    </div>
                ))}
            </div>
        </section>
    );
};

export default PricingSection;
