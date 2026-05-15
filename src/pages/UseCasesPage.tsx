import React, { useState } from 'react';
import {
  Zap, Shield, Target, TrendingUp,
  Sparkles, PlayCircle, BarChart3, X
} from 'lucide-react';
import VisualFlowComponent from '../components/ui/VisualFlowComponent';

const UseCasesPage: React.FC = () => {
  const [showVideoModal, setShowVideoModal] = useState(false);
  const cases = [
    {
      id: 'crisis',
      title: 'Gestão de Crise em 60 Segundos',
      problem: 'Uma fake news ou reclamação local começa a viralizar no bairro X.',
      solution: 'A IA de CRM detecta o pico de menções negativas, a Sala de Guerra alerta o estrategista, e o Creative Producer gera um vídeo de resposta focado no fato real.',
      result: 'Neutralização da crise antes que chegue à TV ou grandes portais.',
      icon: <Shield className="w-8 h-8 text-red-400" />,
      color: 'red'
    },
    {
      id: 'targeting',
      title: 'O Caçador de Indecisos',
      problem: 'Dificuldade em saber quem realmente converter na reta final.',
      solution: 'O CRM cruza dados de visitas e redes sociais para identificar quem está no "limiar da conversão" e sugere uma visita presencial ou mensagem direta personalizada.',
      result: 'Aumento de 15% na taxa de conversão de votos no mês final.',
      icon: <Target className="w-8 h-8 text-blue-400" />,
      color: 'blue'
    },
    {
      id: 'engagement',
      title: 'Militância Digital Ativa',
      problem: 'Baixa interação dos apoiadores cadastrados.',
      solution: 'A IA de engajamento cria réguas de relacionamento automáticas, enviando vídeos exclusivos e pedidos de ajuda baseados no interesse de cada apoiador.',
      result: 'Transformação de cadastros passivos em cabos eleitorais ativos.',
      icon: <TrendingUp className="w-8 h-8 text-emerald-400" />,
      color: 'emerald'
    }
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white py-16 px-6 font-sans">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 px-4 py-2 rounded-full text-blue-400 text-xs font-bold uppercase tracking-widest mb-6">
            <Sparkles className="w-3 h-3" /> Showroom de Inteligência
          </div>
          <h1 className="text-5xl font-black mb-6 leading-tight">
            Como a CampanhaPro <br/>
            <span className="bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">Ganha Eleições</span>
          </h1>
          <p className="text-gray-400 max-w-2xl mx-auto text-lg">
            Esqueça as ferramentas complexas. Veja como resolvemos os problemas que realmente decidem o voto.
          </p>
        </header>

        {/* Infográfico de Fluxo */}
        <section className="mb-24">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-2">O Ciclo da Vitória</h2>
            <p className="text-sm text-gray-500">Do dado de rua ao voto na urna, tudo orquestrado por IA.</p>
          </div>
          <VisualFlowComponent />
        </section>

        {/* Grade de Casos de Uso */}
        <div className="grid md:grid-cols-3 gap-8 mb-24">
          {cases.map((item) => (
            <div key={item.id} className="p-8 rounded-3xl bg-[#161b22] border border-white/5 hover:border-white/20 transition-all flex flex-col justify-between group">
              <div>
                <div className="mb-6 p-4 bg-white/5 rounded-2xl w-fit group-hover:scale-110 transition-transform">
                  {item.icon}
                </div>
                <h3 className="text-xl font-bold mb-4">{item.title}</h3>
                <div className="space-y-4 text-sm text-gray-400">
                  <p><strong className="text-gray-200">Problema:</strong> {item.problem}</p>
                  <p><strong className="text-gray-200">Solução:</strong> {item.solution}</p>
                </div>
              </div>
              <div className="mt-8 pt-6 border-t border-white/5">
                <p className={`text-sm font-bold text-${item.color}-400 flex items-center gap-2`}>
                  <TrendingUp className="w-4 h-4" /> {item.result}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Seção Dia da Eleição - Destaque */}
        <section className="bg-gradient-to-br from-[#161b22] to-[#0d1117] rounded-[40px] p-12 border border-white/10 relative overflow-hidden mb-24">
          <div className="relative z-10 grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-black mb-6">Operação Dia D: <br/>Blindagem de Resultado</h2>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="bg-emerald-500/10 p-3 rounded-xl h-fit">
                    <Shield className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="font-bold mb-1">Fiscalização Digital</h4>
                    <p className="text-sm text-gray-500">Leitura de QR Code via IA para apuração paralela instantânea.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="bg-blue-500/10 p-3 rounded-xl h-fit">
                    <Zap className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <h4 className="font-bold mb-1">Resposta à Boca de Urna</h4>
                    <p className="text-sm text-gray-500">Identificação de focos de adversários e redirecionamento de fiscais.</p>
                  </div>
                </div>
              </div>
              <button 
              onClick={() => setShowVideoModal(true)}
              className="mt-10 px-8 py-4 bg-emerald-600 hover:bg-emerald-500 rounded-2xl font-bold flex items-center gap-3 transition-all shadow-xl shadow-emerald-600/20 active:scale-95"
            >
              Ver Demonstração do Scanner <PlayCircle className="w-5 h-5" />
            </button>
          </div>
          <div className="relative">
            <div className="aspect-square bg-blue-600/20 rounded-full blur-[100px] absolute inset-0"></div>
            <div className="bg-black/40 rounded-3xl border border-white/10 p-8 relative z-10 backdrop-blur-sm group cursor-pointer" onClick={() => setShowVideoModal(true)}>
               <BarChart3 className="w-12 h-12 text-blue-400 mb-6 group-hover:scale-110 transition-transform" />
               <div className="space-y-4">
                  <div className="h-2 bg-white/5 rounded-full w-full"></div>
                  <div className="h-2 bg-emerald-500/40 rounded-full w-[80%]"></div>
                  <div className="h-2 bg-white/5 rounded-full w-[60%]"></div>
                  <p className="text-xs text-gray-500 mt-4">Apuração paralela em tempo real integrada ao mapa da cidade.</p>
               </div>
            </div>
          </div>
        </div>
      </section>

      {/* Modal de Vídeo/Demonstração */}
      {showVideoModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-10 bg-black/95 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-[#161b22] w-full max-w-5xl aspect-video rounded-[40px] border border-white/10 shadow-2xl relative overflow-hidden flex flex-col items-center justify-center">
            <button 
              onClick={() => setShowVideoModal(false)}
              className="absolute top-6 right-6 z-20 p-3 bg-black/40 hover:bg-white/10 rounded-full text-white transition-all"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Simulação de Vídeo de Alta Qualidade */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 to-emerald-900/20"></div>
            <div className="relative z-10 text-center space-y-6 p-12">
              <div className="w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-8 animate-pulse border border-emerald-500/30">
                <Shield className="w-12 h-12 text-emerald-400" />
              </div>
              <h2 className="text-4xl font-black mb-4">Iniciando Demonstração IA...</h2>
              <div className="max-w-md mx-auto space-y-3">
                <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 animate-[progress_3s_ease-in-out_infinite]"></div>
                </div>
                <div className="flex justify-between text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                  <span>Conectando ao TSE</span>
                  <span>Criptografia Ativa</span>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4 mt-12">
                {[1,2,3].map(i => (
                  <div key={i} className="bg-black/40 p-4 rounded-2xl border border-white/5 animate-in slide-in-from-bottom-4 duration-500 delay-[200ms]">
                    <div className="h-4 bg-white/5 rounded-full w-12 mb-3"></div>
                    <div className="h-2 bg-emerald-500/20 rounded-full w-full"></div>
                  </div>
                ))}
              </div>

              <p className="text-gray-400 text-sm mt-8">
                Esta é uma prévia da interface de <strong>Visão Computacional</strong>.<br/>
                O sistema real utiliza a câmera do celular para auditar BUs instantaneamente.
              </p>
            </div>

            {/* Efeito de Scan Visual */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500/30 blur-md animate-[scan_4s_linear_infinite]"></div>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.4)_100%)]"></div>
            </div>
          </div>
        </div>
      )}

        <footer className="text-center pb-20">
          <h3 className="text-2xl font-bold mb-6">Pronto para profissionalizar sua campanha?</h3>
          <button className="px-12 py-5 bg-white text-black rounded-3xl font-black text-lg hover:scale-105 transition-transform">
            Adquirir CampanhaPro Agora
          </button>
        </footer>
      </div>
    </div>
  );
};

export default UseCasesPage;
