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
        <AccordionItem title="📞 Treinamento do Operador de Call Center">
            <div className="space-y-4 text-slate-300">
                <p>Quem opera o atendimento humano (Receptivo) ou faz Telemarketing Ativo. Recursos práticos pra trabalhar bem.</p>

                <TrainingTipCard title="Receptivo — assumindo uma conversa da IA" variant="positive">
                    <p>Quando um eleitor cai na <strong>"⏳ Fila Humana"</strong>, antes de assumir:</p>
                    <ul className="list-disc list-inside">
                        <li>Clique na conversa pra ver o histórico completo.</li>
                        <li>Leia o <strong>resumo da IA</strong> que aparece no topo (Transição Invisível) — diz o que o eleitor já contou, qual é o assunto e o tom.</li>
                        <li>Clique em <strong>"Assumir"</strong>. A IA pausa automaticamente. Você fala como humano.</li>
                        <li>Se não for da sua área, clique em <strong>"Devolver"</strong> → volta pra fila.</li>
                        <li>Resolvido? <strong>"Encerrar"</strong> fecha a conversa.</li>
                    </ul>
                </TrainingTipCard>

                <TrainingTipCard title="Telemarketing Ativo — trabalhando uma lista" variant="neutral">
                    <p>O Líder do Call Center cria uma campanha com nome + script. Pra você operar:</p>
                    <ul className="list-disc list-inside">
                        <li>Abra a aba <strong>📞 Ativo</strong> na sua estação. Escolha a campanha.</li>
                        <li>Clique em <strong>"Próximo contato"</strong>. O sistema te dá nome + telefone + script.</li>
                        <li>Botão <strong>"Abrir no WhatsApp"</strong> abre o chat no wa.me pra você falar com o eleitor.</li>
                        <li>Ao fim da conversa: selecione a <strong>disposição</strong> (Interessado / Vai votar / Indeciso / Recusou / Agendar retorno / Número errado), opcionalmente escreva notas.</li>
                        <li>Botões finais: <strong>Concluir</strong> (encerra), <strong>Sem resposta</strong> (não atendeu), ou <strong>Retorno</strong> (devolve pra fila pra alguém ligar depois).</li>
                        <li>Ao salvar resultado, o sistema já te dá o próximo contato automático.</li>
                    </ul>
                </TrainingTipCard>

                <TrainingTipCard title="Áreas de Atendimento — atenção" variant="neutral">
                    <p>Se sua campanha tem áreas configuradas (ex.: Financeiro / Suporte), o eleitor escolheu uma área pelo menu numérico. Cada conversa mostra um <strong>badge 🧭 com o nome da área</strong> nos cards do Kanban — só assuma conversas da SUA área.</p>
                </TrainingTipCard>

                <TrainingTipCard title="O que NÃO fazer" variant="negative">
                    <ul className="list-disc list-inside">
                        <li><strong>Não se passe por candidato ou pela IA.</strong> Você é operador humano da equipe.</li>
                        <li><strong>Não prometa cargo, dinheiro ou favor.</strong> Vedado pela lei eleitoral.</li>
                        <li><strong>Não force conversa em quem pediu "SAIR".</strong> Respeite o opt-out (LGPD).</li>
                        <li>Se o assunto exigir, agradeça e <strong>devolva pra fila</strong> ou peça pra alguém especializado pegar.</li>
                    </ul>
                </TrainingTipCard>
            </div>
        </AccordionItem>

        <AccordionItem title="🗳️ Treinamento do Fiscal Dia D (Leitor de BU)">
            <div className="space-y-4 text-slate-300">
                <p>Fiscais que acompanham a apuração no dia da eleição usando o <strong>Leitor de QR Code do Boletim de Urna</strong> (padrão TRE/TSE 2026).</p>

                <TrainingTipCard title="O que é o Leitor BU" variant="positive">
                    <p>Depois que a urna fecha, a mesa imprime o BU (Boletim de Urna). Ele tem QR Codes que carregam os votos por candidato daquela seção. Você aponta a câmera do celular, o app decodifica, valida e <strong>soma à apuração paralela da sua campanha</strong> — antes de sair pelo TSE.</p>
                </TrainingTipCard>

                <TrainingTipCard title="Passo a passo no dia" variant="neutral">
                    <ul className="list-disc list-inside">
                        <li>Abra a aba <strong>Dia D</strong> no seu app antes de entrar na seção.</li>
                        <li>Aponte a câmera pros QR Codes do BU. Pode ter mais de um — leia todos até completar.</li>
                        <li>Confira que zona + seção batem com o que está no BU físico.</li>
                        <li>Confirme. O sistema soma à apuração da campanha em tempo real.</li>
                        <li>Se a câmera falhar, há uma opção pra digitar manualmente os totais como fallback.</li>
                    </ul>
                </TrainingTipCard>

                <TrainingTipCard title="Cuidados — o que NÃO fazer" variant="negative">
                    <ul className="list-disc list-inside">
                        <li><strong>Não compartilhe o BU em redes sociais</strong> antes do TSE divulgar. Pode atrapalhar a apuração oficial.</li>
                        <li>Não confie em BU que esteja rasurado, parcial ou de seção que você não fiscalizou pessoalmente.</li>
                        <li>Se houver divergência entre o QR Code e os totais impressos, <strong>registre uma observação</strong> e avise o coordenador.</li>
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