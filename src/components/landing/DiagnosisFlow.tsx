import * as React from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { ClipboardCheckIcon, LightBulbIcon, InfoIcon } from '../icons';

import { Link } from 'react-router-dom';

const diagnosisQuestions = [
  {
    id: 1,
    question: "Como é feito o controle das visitas e intenções de voto hoje?",
    problem: "Falta de centralização de dados de campo e eleitores.",
    options: [
      { text: "Papel, planilhas esparsas ou memória", score: 3 },
      { text: "Grupos de WhatsApp sem métricas", score: 2 },
      { text: "Sistema próprio ou CRM simples", score: 0 }
    ]
  },
  {
    id: 2,
    question: "Qual a frequência de análise do sentimento do eleitor nos bairros?",
    problem: "Baixa inteligência de dados geolocalizados.",
    options: [
      { text: "Raramente ou apenas por intuição", score: 2 },
      { text: "Uma vez por mês", score: 1 },
      { text: "Semanalmente ou em tempo real", score: 0 }
    ]
  },
  {
    id: 3,
    question: "Como você define a rota da equipe de campo diariamente?",
    problem: "Ineficiência na logística de campo.",
    options: [
      { text: "Cada líder decide por conta própria", score: 2 },
      { text: "Baseado em pedidos de apoiadores", score: 1 },
      { text: "Baseado em mapas de calor e dados de pesquisa", score: 0 }
    ]
  },
  {
    id: 4,
    question: "Como é feita a prestação de contas e controle financeiro?",
    problem: "Risco jurídico e falta de visibilidade financeira.",
    options: [
      { text: "Apenas no final da campanha pelo contador", score: 3 },
      { text: "Planilha compartilhada simples", score: 1 },
      { text: "Sistema integrado com lançamentos diários", score: 0 }
    ]
  },
  {
    id: 5,
    question: "Sua equipe de Social Media utiliza IA para analisar tendências e roteiros?",
    problem: "Subutilização de tecnologia para engajamento digital.",
    options: [
      { text: "Não, fazemos tudo manualmente", score: 2 },
      { text: "Sim, usamos ChatGPT básico", score: 1 },
      { text: "Sim, usamos Agentes de IA integrados aos dados da campanha", score: 0 }
    ]
  },
  {
    id: 6,
    question: "Você sabe exatamente quantos votos faltam para atingir o quociente eleitoral?",
    problem: "Falta de clareza sobre a meta de vitória.",
    options: [
      { text: "Tenho apenas uma estimativa vaga", score: 2 },
      { text: "Sim, baseado na última eleição", score: 1 },
      { text: "Sim, com cálculo dinâmico baseado no cenário atual", score: 0 }
    ]
  },
  {
    id: 7,
    question: "Como as informações de campo chegam ao candidato?",
    problem: "Ruído na comunicação estratégica.",
    options: [
      { text: "Conversas informais e reuniões longas", score: 2 },
      { text: "Relatórios semanais em PDF", score: 1 },
      { text: "Dashboard em tempo real no celular", score: 0 }
    ]
  }
];

const DiagnosisFlow: React.FC = () => {
  const [isIntroModalOpen, setIsIntroModalOpen] = React.useState(false);
  const [isQuestionnaireOpen, setIsQuestionnaireOpen] = React.useState(false);
  const [isReportOpen, setIsReportOpen] = React.useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<{ [key: number]: string }>({});
  const [reportData, setReportData] = React.useState<{ score: number; title: string; message: string; problems: string[] } | null>(null);

  const handleStartDiagnosis = () => {
    setIsIntroModalOpen(false);
    setIsQuestionnaireOpen(true);
    setCurrentQuestionIndex(0);
    setAnswers({});
  }

  const handleAnswerSelect = (questionId: number, optionText: string) => {
    setAnswers(prev => ({...prev, [questionId]: optionText}));
  }
  
  const handleNextQuestion = () => {
    if (currentQuestionIndex < diagnosisQuestions.length - 1) {
        setCurrentQuestionIndex(prev => prev + 1);
    }
  }

  const handlePrevQuestion = () => {
    if (currentQuestionIndex > 0) {
        setCurrentQuestionIndex(prev => prev - 1);
    }
  }

  const handleShowReport = () => {
      let score = 0;
      const problems: string[] = [];
      diagnosisQuestions.forEach(q => {
          const selectedOptionText = answers[q.id];
          const selectedOption = q.options.find(opt => opt.text === selectedOptionText);
          if (selectedOption && selectedOption.score > 0) {
              score += selectedOption.score;
              problems.push(q.problem);
          }
      });
      
      let title = '';
      let message = '';
      if (score <= 2) {
          title = "Parabéns! Sua Campanha Parece Organizada";
          message = "Seu nível de organização está acima da média. O Campanha Pró pode te ajudar a otimizar ainda mais seus resultados e escalar suas operações com segurança.";
      } else if (score <= 6) {
          title = "Atenção: Pontos de Melhoria Identificados";
          message = "Sua campanha possui alguns pontos de desorganização que podem estar custando votos e eficiência. Estruturar seus processos pode trazer um grande impacto.";
      } else {
          title = "Alerta: Risco Alto de Desorganização";
          message = "Sua campanha corre um sério risco de perder informações valiosas e desperdiçar esforços. A falta de processos claros é um dos maiores motivos de fracasso eleitoral.";
      }

      setReportData({ score, title, message, problems });
      setIsQuestionnaireOpen(false);
      setIsReportOpen(true);
  }
  
  const closeAllModals = () => {
      setIsIntroModalOpen(false);
      setIsQuestionnaireOpen(false);
      setIsReportOpen(false);
  }

  const progress = React.useMemo(() => {
    return ((currentQuestionIndex + 1) / diagnosisQuestions.length) * 100;
  }, [currentQuestionIndex]);
    return (
        <>
            <section className="py-20 px-4 bg-slate-900">
                <div className="container mx-auto">
                    <Card className="bg-gradient-to-r from-sky-900/50 to-cyan-900/50 p-8 text-center ring-2 ring-sky-500/50">
                        <div className="flex justify-center mb-4">
                            <ClipboardCheckIcon className="h-12 w-12 text-sky-300" />
                        </div>
                        <h2 className="text-3xl font-bold text-slate-100">Trace seu Caminho para a Vitória com Inteligência Estratégica</h2>
                        <p className="mt-4 text-lg text-slate-300 max-w-2xl mx-auto">
                            Vencer eleições exige mais do que intuição. Utilize nosso Diagnóstico de Vitória para entender como nossa Inteligência Eleitoral, impulsionada por Agentes de IA, pode transformar sua campanha e aumentar suas chances.
                        </p>
                        <div className="mt-8 flex justify-center">
                            <Button onClick={() => setIsIntroModalOpen(true)} className="text-base px-8 py-3">Iniciar Diagnóstico de Vitória</Button>
                        </div>
                    </Card>
                </div>
            </section>
             
            {/* Modals for Diagnosis Flow */}
            <Modal isOpen={isIntroModalOpen} onClose={closeAllModals} title="Diagnóstico de Vitória da Campanha">
                <div className="text-center">
                    <div className="flex justify-center mb-4">
                        <LightBulbIcon className="h-12 w-12 text-yellow-300" />
                    </div>
                    <p className="text-slate-300 mb-6">
                        Responda 7 perguntas rápidas e receba um diagnóstico instantâneo sobre os principais pontos de atenção da sua campanha, incluindo a gestão financeira. É grátis e leva menos de 2 minutos.
                    </p>
                    <div className="flex justify-center gap-4">
                        <Button variant="secondary" onClick={closeAllModals}>Agora não</Button>
                        <Button onClick={handleStartDiagnosis}>Começar Diagnóstico</Button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isQuestionnaireOpen} onClose={closeAllModals} title="Diagnóstico de Vitória">
                <div>
                    <div className="w-full bg-slate-700 rounded-full h-2.5 mb-4">
                        <div className="bg-gradient-to-r from-[#4ac7f0] to-[#1abc9c] h-2.5 rounded-full" style={{ width: `${progress}%`, transition: 'width 0.3s ease-in-out' }}></div>
                    </div>
                    <p className="text-sm text-slate-400 mb-4 text-center">Pergunta {currentQuestionIndex + 1} de {diagnosisQuestions.length}</p>
                    
                    <h3 className="text-lg font-semibold text-slate-100 mb-6 text-center">{diagnosisQuestions[currentQuestionIndex].question}</h3>

                    <div className="space-y-3">
                        {diagnosisQuestions[currentQuestionIndex].options.map(option => (
                            <button 
                                key={option.text}
                                onClick={() => handleAnswerSelect(diagnosisQuestions[currentQuestionIndex].id, option.text)}
                                className={`w-full text-left p-4 rounded-lg border-2 transition-all ${answers[diagnosisQuestions[currentQuestionIndex].id] === option.text ? 'bg-sky-500/20 border-sky-500' : 'bg-slate-700 border-slate-600 hover:bg-slate-600/50'}`}
                            >
                                {option.text}
                            </button>
                        ))}
                    </div>

                    <div className="flex justify-between mt-8">
                        <Button variant="secondary" onClick={handlePrevQuestion} disabled={currentQuestionIndex === 0}>Anterior</Button>
                        {currentQuestionIndex < diagnosisQuestions.length - 1 ? (
                            <Button onClick={handleNextQuestion} disabled={!answers[diagnosisQuestions[currentQuestionIndex].id]}>Próxima</Button>
                        ) : (
                            <Button onClick={handleShowReport} disabled={!answers[diagnosisQuestions[currentQuestionIndex].id]}>Ver meu Diagnóstico</Button>
                        )}
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isReportOpen} onClose={closeAllModals} title="Seu Diagnóstico de Vitória">
                {reportData && (
                    <div className="text-center">
                        <p className="text-sm font-bold uppercase text-slate-400">Pontuação de Risco</p>
                        <p className="text-6xl font-extrabold my-2 text-transparent bg-clip-text bg-gradient-to-r from-[#4ac7f0] to-[#1abc9c]">{reportData.score}</p>
                        <h3 className="text-xl font-bold text-slate-100">{reportData.title}</h3>
                        <p className="text-slate-300 mt-2 mb-6">{reportData.message}</p>
                        
                        {reportData.problems.length > 0 && (
                            <div className="text-left bg-slate-900/50 p-4 rounded-lg mb-6">
                                <h4 className="font-semibold text-slate-200 mb-3">Pontos de Atenção Identificados:</h4>
                                <ul className="space-y-2 text-sm">
                                    {reportData.problems.map(problem => (
                                        <li key={problem} className="flex items-start gap-2">
                                                <InfoIcon className="h-4 w-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                                                <span>{problem}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="bg-slate-700/50 p-4 rounded-lg">
                            <p className="font-semibold text-slate-100">Com o Campanha Pró, você transforma dados em estratégia com nossos Agentes de IA e ferramentas de pesquisa.</p>
                            <div className="flex flex-col sm:flex-row justify-center gap-4 mt-4">
                                <Button variant="secondary" onClick={() => { closeAllModals(); document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }); }}>Ver Funcionalidades</Button>
                                <Link to="/register">
                                    <Button onClick={() => closeAllModals()}>Criar Conta e Resolver</Button>
                                </Link>
                            </div>
                        </div>
                    </div>
                )}
            </Modal>
        </>
    );
};

export default DiagnosisFlow;
