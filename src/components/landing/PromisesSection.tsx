import * as React from 'react';
import { CheckCircleIcon, InfoIcon } from '../icons';

const featureChecklistData = [
    {
      title: "Calculadora Estratégica & Dashboard",
      status: "Cumprido!",
      description: "Nossa Calculadora define metas diárias precisas para sua vitória, enquanto o Dashboard oferece uma visão 360º da campanha, com KPIs, gráficos de progresso e rankings de desempenho em tempo real.",
      icon: 'check'
    },
    {
      title: "Gestão Centralizada de Visitas",
      status: "Cumprido!",
      description: "Transforme a gestão de campo com nosso CRM integrado. Centralize o cadastro de famílias, registre solicitações e monitore o histórico de interações para garantir que nenhuma informação ou oportunidade seja perdida.",
      icon: 'check'
    },
    {
      title: "Ferramentas de Colaboração (Plano Estratégico+)",
      status: "Cumprido!",
      description: "Capacite sua equipe para registrar cada ponto de contato. A aba 'Engajamento' captura dados valiosos de ações rápidas, como distribuição de materiais e abordagens informais, medindo o pulso da campanha nas ruas.",
      icon: 'check'
    },
    {
      title: "Insights com IA (Plano Estratégico+)",
      status: "Cumprido!",
      description: "Tenha um consultor político virtual à sua disposição. Nossa IA analisa seus dados de desempenho e gera recomendações estratégicas para otimizar rotas, focar nos apoiadores mais eficientes e maximizar o impacto de cada ação.",
      icon: 'check'
    },
    {
      title: "Exportação de Dados (Plano Estratégico+)",
      status: "Cumprido!",
      description: "Seus dados, seu controle. Exporte relatórios completos de visitas, cenários e engajamento para formatos CSV com um único clique, facilitando análises aprofundadas e a integração com outras ferramentas.",
      icon: 'check'
    },
    {
      title: "Painéis por Equipe (Plano Total)",
      status: "Cumprido!",
      description: "Lidere com base em dados. A aba 'Equipes' fornece um painel de Business Intelligence para a gestão de campo, com comparações de performance, métricas de eficiência e rankings para identificar e recompensar os melhores times.",
      icon: 'check'
    },
    {
      title: "Controle Financeiro Completo (Plano Total)",
      status: "Cumprido!",
      description: "Garanta a saúde financeira e a conformidade da sua campanha. Nosso módulo financeiro oferece um dashboard completo com controle de orçamento, registro de receitas, gestão de despesas com anexo de notas fiscais e relatórios para uma prestação de contas impecável.",
      icon: 'check'
    }
];

const PromisesSection: React.FC = () => {
    return (
        <section id="transparency" className="py-20 px-4 bg-slate-900">
            <div className="container mx-auto text-center">
                <h2 className="text-3xl font-bold mb-12">O Que Prometemos vs. O Que Entregamos</h2>
                <div className="max-w-4xl mx-auto space-y-6 text-left">
                    {featureChecklistData.map((item) => (
                        <div key={item.title} className="bg-slate-800 p-6 rounded-lg transition-transform duration-300 hover:-translate-y-1">
                            <div className="flex items-center gap-3">
                                {item.icon === 'check' ? 
                                    <CheckCircleIcon className="h-6 w-6 text-green-400 flex-shrink-0" /> : 
                                    <InfoIcon className="h-6 w-6 text-yellow-400 flex-shrink-0" />
                                }
                                <div>
                                    <h3 className="text-xl font-semibold text-slate-100">{item.title}</h3>
                                    <span className={`text-sm font-bold ${item.icon === 'check' ? 'text-green-400' : 'text-yellow-400'}`}>{item.status}</span>
                                </div>
                            </div>
                            <p className="text-slate-400 mt-3 pl-9">{item.description}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default PromisesSection;
