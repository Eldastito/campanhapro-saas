import React from 'react';
import { Check, X, Shield, Zap, TrendingUp } from 'lucide-react';

const PricingPage: React.FC = () => {
  const plans = [
    {
      name: 'Plano Limitado',
      price: 'R$ 10.000',
      description: 'Ideal para campanhas municipais de pequeno porte ou vereadores iniciantes.',
      features: [
        { name: 'Gestão de Visitas e Militância', available: true },
        { name: 'Dashboard de Intenção de Voto', available: true },
        { name: 'Até 100 usuários na equipe', available: true },
        { name: 'Até 500 chamadas de IA/mês', available: true },
        { name: 'Envio de Imagens e Documentos', available: false },
        { name: 'Geração de Vídeos por IA', available: false },
        { name: 'Apuração Paralela (QR Code)', available: false },
        { name: 'Relatórios Executivos em PDF', available: false },
      ],
      cta: 'Começar Agora',
      popular: false,
      tier: 'limitado'
    },
    {
      name: 'Plano Completo',
      price: 'R$ 20.000',
      description: 'A solução definitiva para campanhas majoritárias, estaduais ou de alta performance.',
      features: [
        { name: 'Gestão de Visitas e Militância', available: true },
        { name: 'Dashboard de Intenção de Voto', available: true },
        { name: 'Usuários Ilimitados', available: true },
        { name: 'IA Ilimitada (Estrategista/Growth)', available: true },
        { name: 'Envio de Imagens, Áudios e Vídeos', available: true },
        { name: 'Geração de Vídeos por IA (Google Flow)', available: true },
        { name: 'Apuração Paralela Real-time (QR Code)', available: true },
        { name: 'Relatórios Executivos em PDF/Excel/CSV', available: true },
      ],
      cta: 'Assinar Plano Full',
      popular: true,
      tier: 'completo'
    }
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white py-20 px-6 font-sans">
      <div className="max-w-7xl mx-auto text-center mb-16">
        <h1 className="text-5xl font-extrabold mb-6 bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          Planos de Prateleira CampanhaPro
        </h1>
        <p className="text-gray-400 text-xl max-w-2xl mx-auto">
          Escolha a potência da sua campanha. Tecnologia de ponta, do planejamento à apuração.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
        {plans.map((plan) => (
          <div 
            key={plan.name}
            className={`relative p-8 rounded-3xl border ${
              plan.popular 
                ? 'border-emerald-500/50 bg-gradient-to-b from-[#161b22] to-[#0d1117] shadow-[0_0_40px_rgba(16,185,129,0.1)]' 
                : 'border-white/10 bg-[#161b22]'
            } transition-all duration-300 hover:scale-[1.02]`}
          >
            {plan.popular && (
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-emerald-500 text-black text-xs font-bold px-4 py-1 rounded-full uppercase tracking-wider">
                Mais Recomendado
              </div>
            )}

            <div className="mb-8">
              <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-4xl font-black">{plan.price}</span>
                <span className="text-gray-400 text-sm">/ única ou campanha</span>
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">
                {plan.description}
              </p>
            </div>

            <div className="space-y-4 mb-10">
              {plan.features.map((feature) => (
                <div key={feature.name} className="flex items-center gap-3">
                  {feature.available ? (
                    <div className="bg-emerald-500/20 p-1 rounded-full">
                      <Check className="w-4 h-4 text-emerald-400" />
                    </div>
                  ) : (
                    <div className="bg-white/5 p-1 rounded-full">
                      <X className="w-4 h-4 text-gray-500" />
                    </div>
                  )}
                  <span className={`text-sm ${feature.available ? 'text-gray-200' : 'text-gray-500'}`}>
                    {feature.name}
                  </span>
                </div>
              ))}
            </div>

            <button className={`w-full py-4 rounded-xl font-bold transition-all ${
              plan.popular 
                ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg shadow-emerald-500/20' 
                : 'bg-white/5 hover:bg-white/10 text-white border border-white/10'
            }`}>
              {plan.cta}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-24 max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">Por que o CampanhaPro?</h2>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="p-6 rounded-2xl bg-white/5 border border-white/5 text-center">
            <Shield className="w-10 h-10 text-blue-400 mx-auto mb-4" />
            <h4 className="font-bold mb-2">Segurança de Dados</h4>
            <p className="text-sm text-gray-400">Criptografia de ponta a ponta e servidores LGPD compliance.</p>
          </div>
          <div className="p-6 rounded-2xl bg-white/5 border border-white/5 text-center">
            <Zap className="w-10 h-10 text-yellow-400 mx-auto mb-4" />
            <h4 className="font-bold mb-2">Apuração em Minutos</h4>
            <p className="text-sm text-gray-400">Leitura de QR Code do BU integrada para apuração paralela veloz.</p>
          </div>
          <div className="p-6 rounded-2xl bg-white/5 border border-white/5 text-center">
            <TrendingUp className="w-10 h-10 text-emerald-400 mx-auto mb-4" />
            <h4 className="font-bold mb-2">Foco em ROI</h4>
            <p className="text-sm text-gray-400">Saiba exatamente quanto custa cada voto por bairro e seção.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PricingPage;
