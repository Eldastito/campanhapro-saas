import React from 'react';
import { Database, Cpu, Megaphone, CheckCircle2, ChevronRight, MessageSquare, MapPin, Zap } from 'lucide-react';

const VisualFlowComponent: React.FC = () => {
  const steps = [
    {
      icon: <Database className="w-6 h-6 text-blue-400" />,
      title: "Coleta de Dados",
      desc: "Informações vindas das ruas, redes sociais e WhatsApp.",
      tags: ["CRM", "App Externa"]
    },
    {
      icon: <Cpu className="w-6 h-6 text-purple-400" />,
      title: "Inteligência IA",
      desc: "Nossas IAs analisam sentimentos, dores e oportunidades.",
      tags: ["Gemini Pro", "War Room"]
    },
    {
      icon: <Megaphone className="w-6 h-6 text-emerald-400" />,
      title: "Ação Coordenada",
      desc: "Criação de conteúdo, visitas e mensagens personalizadas.",
      tags: ["Criativo", "Campo"]
    },
    {
      icon: <CheckCircle2 className="w-6 h-6 text-yellow-400" />,
      title: "Voto Garantido",
      desc: "Conversão do eleitor através de relacionamento real.",
      tags: ["Resultados", "ROI"]
    }
  ];

  return (
    <div className="py-12">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-2">
        {steps.map((step, index) => (
          <React.Fragment key={index}>
            <div className="flex-1 w-full group">
              <div className="bg-[#161b22] p-6 rounded-3xl border border-white/5 hover:border-blue-500/30 transition-all hover:scale-[1.02] relative overflow-hidden">
                <div className="bg-white/5 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-blue-500/10 transition-colors">
                  {step.icon}
                </div>
                <h4 className="font-bold mb-1 text-sm">{step.title}</h4>
                <p className="text-[11px] text-gray-500 leading-relaxed mb-4">{step.desc}</p>
                <div className="flex flex-wrap gap-2">
                  {step.tags.map(tag => (
                    <span key={tag} className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/5">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="absolute -right-2 -bottom-2 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                  {step.icon}
                </div>
              </div>
            </div>
            {index < steps.length - 1 && (
              <div className="hidden md:block">
                <ChevronRight className="w-5 h-5 text-gray-700" />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
      
      {/* Exemplo de Fluxo Real */}
      <div className="mt-12 bg-blue-600/5 border border-blue-500/20 rounded-3xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <Zap className="w-16 h-16 text-blue-400" />
        </div>
        <h5 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-4">Na prática (Exemplo):</h5>
        <div className="flex flex-col md:flex-row gap-6 text-sm italic text-gray-400 leading-relaxed">
          <div className="flex-1 flex gap-3">
            <MapPin className="w-5 h-5 text-red-400 shrink-0" />
            <p>"Muitas reclamações de buracos no bairro Setor Leste."</p>
          </div>
          <div className="hidden md:block text-blue-500">→</div>
          <div className="flex-1 flex gap-3">
            <Cpu className="w-5 h-5 text-purple-400 shrink-0" />
            <p>IA sugere pauta de infraestrutura e cria roteiro de vídeo.</p>
          </div>
          <div className="hidden md:block text-blue-500">→</div>
          <div className="flex-1 flex gap-3">
            <MessageSquare className="w-5 h-5 text-emerald-400 shrink-0" />
            <p>Apoiadores do bairro recebem o vídeo do candidato.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VisualFlowComponent;
