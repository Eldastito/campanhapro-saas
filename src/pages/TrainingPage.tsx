import * as React from 'react';
import { CheckCircleIcon, InfoIcon, LightBulbIcon } from '../components/icons';
import AccordionItem from '../components/ui/AccordionItem';

const TrainingTipCard = ({ title, children, variant }: { title: string; children?: React.ReactNode; variant: 'positive' | 'negative' | 'neutral' }) => {
    const variants = {
        positive: { bg: 'bg-green-500/10', text: 'text-green-400', icon: <CheckCircleIcon className="w-5 h-5" /> },
        negative: { bg: 'bg-red-500/10', text: 'text-red-400', icon: <InfoIcon className="w-5 h-5" /> },
        neutral: { bg: 'bg-sky-500/10', text: 'text-sky-400', icon: <LightBulbIcon className="w-5 h-5" /> },
    }
    const config = variants[variant];

    return (
        <div className={`${config.bg} p-4 rounded-lg`}>
            <h4 className={`font-semibold ${config.text} flex items-center gap-2 mb-2`}>{config.icon} {title}</h4>
            <div className="text-sm text-slate-300 prose prose-invert max-w-none prose-ul:my-2 prose-li:my-1">
                {children}
            </div>
        </div>
    )
};


const TrainingPage = () => {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-slate-200">Central de Treinamento de Campo</h2>
      <p className="text-slate-400">Capacite a equipe para abordagens mais eficazes e humanas. Use este material como guia para padronizar e qualificar o trabalho de rua.</p>
      
      <div className="space-y-4">
        <AccordionItem title="Scripts de Abordagem: O Que Falar?" initialOpen>
            <div className="space-y-4 text-slate-300">
                <p>Use estes roteiros como ponto de partida. O mais importante é ser natural e genuíno.</p>
                <div>
                    <h4 className="font-semibold text-[#4ac7f0]">1. Abordagem Direta (Ideal para apoiadores mais confiantes)</h4>
                    <p className="mt-1 pl-4 border-l-2 border-slate-600 italic">"Olá, bom dia! Meu nome é [Seu Nome], sou apoiador(a) do(a) candidato(a) [Nome do Candidato(a)]. Você já conhece as propostas dele(a) para a nossa cidade? Posso deixar um material com você?"</p>
                </div>
                 <div>
                    <h4 className="font-semibold text-[#4ac7f0]">2. Abordagem Comunitária (Excelente para iniciar conversas)</h4>
                    <p className="mt-1 pl-4 border-l-2 border-slate-600 italic">"Olá, tudo bem? Estamos conversando com os moradores do [Nome do Bairro] para ouvir sobre as necessidades daqui. Na sua opinião, qual é o maior desafio que o bairro enfrenta hoje? [Ouvir a resposta]. Entendo. O(A) [Nome do Candidato(a)] tem uma proposta interessante sobre isso..."</p>
                </div>
                 <div>
                    <h4 className="font-semibold text-[#4ac7f0]">3. Abordagem Rápida (Para panfletagem)</h4>
                    <p className="mt-1 pl-4 border-l-2 border-slate-600 italic">"Bom dia! Sou [Seu Nome], apoiador(a) do(a) [Nome do Candidato(a)]. Aceita um material para conhecer o trabalho dele(a)? É sem compromisso!"</p>
                </div>
            </div>
        </AccordionItem>
        <AccordionItem title="Guia de Percepção: Como 'Ler' o Eleitor">
             <div className="space-y-4 text-slate-300">
                <p>Observe a linguagem corporal para entender o nível de abertura da pessoa. Isso ajuda a não ser invasivo e a otimizar o tempo.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <TrainingTipCard title="Sinais de Abertura (Luz Verde)" variant="positive">
                         <ul className="list-disc list-inside">
                            <li>Contato visual direto e amigável.</li>
                            <li>Sorriso, mesmo que discreto.</li>
                            <li>Postura relaxada, corpo virado para você.</li>
                            <li>Acena com a cabeça enquanto você fala.</li>
                            <li>Faz perguntas sobre o candidato ou as propostas.</li>
                        </ul>
                    </TrainingTipCard>
                    <TrainingTipCard title="Sinais de Fechamento (Luz Vermelha)" variant="negative">
                         <ul className="list-disc list-inside">
                            <li>Evita contato visual, olha para os lados.</li>
                            <li>Braços cruzados firmemente.</li>
                            <li>Respostas curtas e monossilábicas ("sim", "não").</li>
                            <li>Dá um passo para trás, criando distância.</li>
                            <li>Verifica o relógio ou o celular.</li>
                        </ul>
                    </TrainingTipCard>
                </div>
                 <p className="mt-4 text-sm italic"><strong>Dica de ouro:</strong> Se perceber "Luz Vermelha", não insista. Agradeça o tempo da pessoa, entregue o material (se ela aceitar) e siga em frente. Uma retirada educada é melhor que uma interação forçada.</p>
            </div>
        </AccordionItem>
        <AccordionItem title="Lidando com Objeções Comuns">
            <div className="space-y-4 text-slate-300">
                <p>É normal encontrar resistência. O segredo é estar preparado e manter a calma. O objetivo não é vencer uma discussão, mas sim deixar uma impressão positiva.</p>
                <div className="pl-4 border-l-2 border-slate-600 space-y-3">
                    <p><strong>Objeção:</strong> <i>"Não me interesso por política / São todos iguais."</i><br/>
                    <strong>Resposta Sugerida:</strong> "Eu entendo perfeitamente o seu cansaço. É por isso mesmo que o(a) [Candidato(a)] está tentando fazer algo diferente, focando em [Proposta Chave 1] e [Proposta Chave 2]. Agradeço seu tempo!"</p>
                    
                    <p><strong>Objeção:</strong> <i>"Já tenho meu candidato."</i><br/>
                    <strong>Resposta Sugerida:</strong> "Que ótimo que você já se decidiu, isso é muito importante! Se não for incômodo, posso deixar nosso material mesmo assim? Quem sabe você não encontra algo interessante. Muito obrigado!"</p>
                     
                    <p><strong>Objeção:</strong> <i>"Não voto em [Partido do Candidato]."</i><br/>
                    <strong>Resposta Sugerida:</strong> "Respeito sua posição. A ideia do(a) [Candidato(a)] é trabalhar por todos no bairro, independente de partido. As propostas dele(a) para a segurança/saúde aqui na região são bem concretas. Agradeço sua atenção!"</p>
                </div>
            </div>
        </AccordionItem>
        <AccordionItem title="A Importância do Registro de Dados">
            <div className="space-y-4 text-slate-300">
                <p>Cada visita e cada conversa rápida que você registra no sistema é como uma peça de um quebra-cabeça. Sozinha, pode não parecer muito, mas juntas, elas mostram a imagem completa da campanha.</p>
                <TrainingTipCard title="Por que registrar TUDO?" variant="neutral">
                    <ul>
                        <li><strong>Você Alimenta a Estratégia:</strong> Seus registros no sistema alimentam o Dashboard do coordenador, mostrando quais bairros estão respondendo melhor.</li>
                        <li><strong>Você Ajuda a IA:</strong> Nos planos mais avançados, a Inteligência Artificial usa seus dados para dar dicas cada vez mais precisas para a campanha.</li>
                        <li><strong>Você Otimiza o Trabalho:</strong> Ao anotar quem já foi visitado, evitamos que duas equipes visitem a mesma casa, economizando tempo.</li>
                        <li><strong>Você Cria Laços:</strong> Registrar o aniversário de alguém ou um pedido específico mostra que a campanha se importa. É assim que se conquista a confiança.</li>
                    </ul>
                </TrainingTipCard>
            </div>
        </AccordionItem>
        <AccordionItem title="Guia de Boas Práticas de Campo">
            <div className="space-y-4 text-slate-300">
                <TrainingTipCard title="O que FAZER" variant="positive">
                    <ul className="list-disc list-inside">
                        <li><strong>Trabalhe em duplas:</strong> É mais seguro e um pode ajudar o outro a quebrar o gelo.</li>
                        <li><strong>Seja um bom ouvinte:</strong> Às vezes, ouvir a queixa de um morador vale mais do que qualquer discurso.</li>
                        <li><strong>Seja educado sempre:</strong> Um "bom dia" e um sorriso abrem portas. Agradeça sempre o tempo da pessoa.</li>
                        <li><strong>Conheça o básico:</strong> Saiba de cor 2 ou 3 propostas principais do candidato para a região que está visitando.</li>
                         <li><strong>Vista-se de forma apropriada:</strong> Use roupas neutras e confortáveis. A identificação da campanha é importante, mas sem exageros.</li>
                        <li><strong>Mantenha-se positivo:</strong> Sua energia é contagiante. Mostre confiança no projeto.</li>
                    </ul>
                </TrainingTipCard>
                <TrainingTipCard title="O que NÃO FAZER" variant="negative">
                    <ul className="list-disc list-inside">
                        <li><strong>Nunca discuta:</strong> O objetivo é apresentar, não converter à força. Se encontrar um opositor, agradeça e se retire educadamente.</li>
                        <li><strong>Não prometa o que não pode cumprir:</strong> Não faça promessas pessoais em nome do candidato. Foque nas propostas oficiais.</li>
                        <li><strong>Não entre em residências:</strong> Mantenha a conversa na porta ou no portão, por segurança e respeito.</li>
                        <li><strong>Não fale mal de outros candidatos:</strong> Foque em apresentar as qualidades e propostas do seu. A crítica negativa raramente funciona.</li>
                        <li><strong>Não force a entrega de material:</strong> Se a pessoa recusar, agradeça e siga em frente.</li>
                    </ul>
                </TrainingTipCard>
            </div>
        </AccordionItem>
      </div>
    </div>
  );
};

export default TrainingPage;