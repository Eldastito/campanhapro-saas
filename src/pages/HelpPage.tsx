import * as React from 'react';
import AccordionItem from '../components/ui/AccordionItem';
import {
    BarChartIcon, CalculatorIcon, ClipboardListIcon, SparklesIcon,
    UsersGroupIcon, CurrencyDollarIcon, AcademicCapIcon, CogIcon,
    ToolsIcon, MapPinIcon,
} from '../components/icons';
import { MessageCircle, Headset, Building2, KeyRound, Phone, Sparkles, Users } from 'lucide-react';

const HelpTopic = ({icon, title, children}: {icon: React.ReactNode, title: string, children?: React.ReactNode}) => (
    <div className="flex items-start gap-4">
        <div className="flex-shrink-0 mt-1 text-sky-400">{icon}</div>
        <div>
            <h4 className="font-bold text-slate-200">{title}</h4>
            <div className="text-sm text-slate-300 prose prose-invert max-w-none prose-ul:my-2 prose-li:my-1">
                {children}
            </div>
        </div>
    </div>
);

const HelpPage = () => {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-slate-200">Central de Ajuda</h2>
      <p className="text-slate-400">
        Tire suas dúvidas sobre como usar cada parte do sistema. Clique em um tópico abaixo para ver a explicação.
      </p>

      <div className="space-y-4">
        
        <AccordionItem title="Dashboard: O Painel da Campanha" initialOpen>
            <div className="space-y-4 text-slate-300">
                <p className="italic">Pense no <strong>Dashboard</strong> como o painel do carro da sua campanha. Ele mostra de forma rápida se você está no caminho certo para a vitória.</p>
                <HelpTopic icon={<BarChartIcon className="w-5 h-5"/>} title="Meta Diária">
                    Mostra quantas visitas sua equipe precisa fazer <strong>hoje</strong> para bater a meta definida na Calculadora. Fique de olho nesse número!
                </HelpTopic>
                <HelpTopic icon={<BarChartIcon className="w-5 h-5"/>} title="Quadrados Resumo (KPIs)">
                    São os números mais importantes, como o total de visitas feitas, o total de votos que você já conseguiu e a média de votos por visita.
                </HelpTopic>
                 <HelpTopic icon={<BarChartIcon className="w-5 h-5"/>} title="Gráfico de Progresso e Rankings">
                    O gráfico mostra a evolução das suas visitas e votos ao longo do tempo. Os rankings mostram os 5 bairros e os 5 apoiadores que estão trazendo mais votos. É ótimo para saber onde focar seus esforços!
                </HelpTopic>
                <HelpTopic icon={<SparklesIcon className="w-5 h-5"/>} title="Gerar Insights com IA (Plano Estratégico+)">
                    Este botão é como ter um especialista do seu lado. Ele olha todos os seus números e te dá dicas valiosas do que fazer para melhorar sua campanha.
                </HelpTopic>
            </div>
        </AccordionItem>
        
        <AccordionItem title="Calculadora: O Cérebro da Campanha">
            <div className="space-y-4 text-slate-300">
                <p className="italic">A <strong>Calculadora</strong> é onde tudo começa. É aqui que você define seu objetivo e o sistema te diz o que precisa ser feito, dia após dia, para chegar lá.</p>
                <HelpTopic icon={<CalculatorIcon className="w-5 h-5"/>} title="Parâmetros Principais">
                   <ul>
                        <li><strong>Meta de Votos:</strong> O número total de votos que você quer alcançar na eleição.</li>
                        <li><strong>Dias de Visita/Semana:</strong> Quantos dias, de segunda a domingo, sua equipe vai para a rua?</li>
                        <li><strong>Capacidade de Visitas/Dia:</strong> Em um dia bom, quantas casas sua equipe consegue visitar?</li>
                        <li><strong>Votos/Família (Base):</strong> Na sua opinião, quantos votos em média você consegue em cada casa que visita? Seja realista!</li>
                        <li><strong>Buffer %:</strong> É uma "gordurinha" de segurança para compensar possíveis desistências.</li>
                    </ul>
                </HelpTopic>
                 <HelpTopic icon={<CalculatorIcon className="w-5 h-5"/>} title="Cenário Ideal">
                    Depois de preencher tudo, salve o cenário! Você pode criar vários (um otimista, um pessimista) e depois escolher o melhor como seu <strong>"Cenário Ideal"</strong>. É este cenário que define a Meta Diária no Dashboard.
                </HelpTopic>
            </div>
        </AccordionItem>

        <AccordionItem title="Visitas: Seu Caderno de Campo Digital">
            <div className="space-y-4 text-slate-300">
                <p className="italic">A aba <strong>Visitas</strong> é onde você anota todas as informações sobre as famílias visitadas. Chega de papel e planilha perdida!</p>
                <HelpTopic icon={<ClipboardListIcon className="w-5 h-5"/>} title="Gerenciamento Rápido">
                    <ul>
                        <li><strong>Marcar como Realizada:</strong> A visita aconteceu? É só ligar a chavinha na coluna "Realizada".</li>
                        <li><strong>Editar Votos Rápido:</strong> A família prometeu mais votos? Clique no número na coluna "Votos" e digite o novo valor.</li>
                        <li><strong>Ver Detalhes:</strong> Clique na setinha para baixo no final da linha para ver todas as informações daquela visita.</li>
                    </ul>
                </HelpTopic>
            </div>
        </AccordionItem>

        <AccordionItem title="Engajamento: As Conversas Rápidas">
             <div className="space-y-4 text-slate-300">
                <p className="italic">Nem toda conversa vira uma visita completa. A aba <strong>Engajamento</strong> serve para registrar as interações mais rápidas do dia a dia.</p>
                <HelpTopic icon={<SparklesIcon className="w-5 h-5"/>} title="Tipos de Ação">
                     <ul>
                        <li><strong>Abordagem Rápida:</strong> Anote aqui aquela conversa na fila da padaria ou no ponto de ônibus.</li>
                        <li><strong>Distribuição de Material:</strong> Registre onde e quantos panfletos ou santinhos foram entregues.</li>
                        <li><strong>Evento:</strong> A equipe foi a uma festa de bairro? Anote o nome do evento e quantas pessoas foram contatadas.</li>
                    </ul>
                </HelpTopic>
            </div>
        </AccordionItem>

        <AccordionItem title="Recursos: Cadastrando sua Equipe e Localidades">
            <div className="space-y-4 text-slate-300">
                <p className="italic">Esta é a área de cadastros essenciais. Manter os <strong>Recursos</strong> atualizados é a base para todo o resto funcionar bem.</p>
                <HelpTopic icon={<UsersGroupIcon className="w-5 h-5"/>} title="Gestão de Equipe">
                   <p>Aqui você cadastra todas as pessoas que trabalham na sua campanha.</p>
                   <ul>
                        <li><strong>Adicionar Membro:</strong> Cadastre seus Líderes, Apoiadores e Colaboradores.</li>
                        <li><strong>Login da Equipe:</strong> O <strong>email e a senha</strong> que você define aqui são os dados que o membro da sua equipe usará para entrar no sistema e ver as próprias tarefas.</li>
                   </ul>
                </HelpTopic>
                <HelpTopic icon={<MapPinIcon className="w-5 h-5"/>} title="Gestão de Localidades">
                    <p>Cadastre aqui todos os bairros, distritos ou zonas onde sua campanha irá atuar.</p>
                     <ul>
                        <li>As localidades que você adicionar aqui aparecerão automaticamente no formulário de cadastro de Visitas.</li>
                        <li>Use o botão <strong>"Carregar Principais Bairros (Rio de Janeiro)"</strong> como um atalho para popular rapidamente a lista se sua campanha for no RJ.</li>
                   </ul>
                </HelpTopic>
            </div>
        </AccordionItem>

        <AccordionItem title="Equipes: Análise de Desempenho (Plano Total)">
            <div className="space-y-4 text-slate-300">
                <p className="italic">Exclusiva para o <strong>Plano Campanha Total</strong>, a aba <strong>Equipes</strong> é o seu centro de comando para analisar e comparar a performance dos seus times de campo.</p>
                <HelpTopic icon={<UsersGroupIcon className="w-5 h-5"/>} title="Tabela Comparativa">
                    Veja todas as suas equipes, lado a lado, com dados sobre número de apoiadores, total de visitas, votos totais e média de votos. Clique no título de qualquer coluna (ex: "Total de Votos") para ordenar e identificar os melhores resultados.
                </HelpTopic>
            </div>
        </AccordionItem>

        <AccordionItem title="Financeiro: O Controle Total do Dinheiro (Plano Total)">
            <div className="space-y-4 text-slate-300">
                <p className="italic">A aba <strong>Financeiro</strong> é o centro de controle do dinheiro da sua campanha. Mantenha tudo organizado para uma gestão eficiente e uma prestação de contas tranquila.</p>
                <HelpTopic icon={<CurrencyDollarIcon className="w-5 h-5"/>} title="Funcionalidades">
                     <ul>
                        <li><strong>Visão Geral:</strong> Um dashboard que mostra o resumo financeiro: orçamento, arrecadado, gasto e saldo.</li>
                        <li><strong>Receitas e Despesas:</strong> Registre toda entrada e saída de dinheiro. Você pode anexar uma foto da nota fiscal ou recibo em cada despesa!</li>
                    </ul>
                </HelpTopic>
            </div>
        </AccordionItem>

        <AccordionItem title="📥 Caixa de Entrada Omnichannel (WhatsApp)">
            <div className="space-y-4 text-slate-300">
                <p className="italic">A <strong>Caixa de Entrada</strong> reúne todas as conversas de WhatsApp num quadro Kanban. Cada conversa é um card que você arrasta entre as colunas conforme o estágio do atendimento.</p>
                <HelpTopic icon={<MessageCircle className="w-5 h-5"/>} title="Pipeline do Atendimento">
                    <ul>
                        <li><strong>Novo Lead:</strong> eleitor escreveu pela primeira vez.</li>
                        <li><strong>🤖 IA Atendendo:</strong> o bot está respondendo automaticamente (só Plano Total).</li>
                        <li><strong>⏳ Fila Humana:</strong> a IA entendeu que precisa de gente (assunto sensível, pedido de "PESSOA", etc).</li>
                        <li><strong>🧑 Com Operador:</strong> alguém assumiu — a IA pausa automaticamente.</li>
                        <li><strong>Fechado:</strong> atendimento encerrado.</li>
                    </ul>
                </HelpTopic>
                <HelpTopic icon={<Sparkles className="w-5 h-5"/>} title="Atualização em tempo real">
                    Mensagens entram e a IA responde sem você precisar dar refresh. Quando um eleitor escreve, a coluna do Kanban se atualiza sozinha.
                </HelpTopic>
                <HelpTopic icon={<Users className="w-5 h-5"/>} title="Equipe de Atendimento">
                    Botão no topo abre o painel onde você cria <strong>Líderes do Call Center</strong> (que depois cadastram os operadores) e gerencia as <strong>Áreas de Atendimento</strong> (menu no mesmo número).
                </HelpTopic>
            </div>
        </AccordionItem>

        <AccordionItem title="📞 Call Center (Receptivo + Telemarketing Ativo)">
            <div className="space-y-4 text-slate-300">
                <p className="italic">Um <strong>módulo completo de central</strong> que opera sobre o WhatsApp. Inclui receptivo com transição invisível da IA pro humano e telemarketing ativo a partir de listas do CRM.</p>
                <HelpTopic icon={<Headset className="w-5 h-5"/>} title="Receptivo + Transição Invisível">
                    Quando a IA escala uma conversa pro humano, ela <strong>deixa um resumo pronto</strong> pro operador (assunto, tom, o que já foi falado). O eleitor não precisa repetir a história quando o humano assume.
                </HelpTopic>
                <HelpTopic icon={<MapPinIcon className="w-5 h-5"/>} title="Áreas de Atendimento (menu no mesmo número)">
                    Cadastre áreas (ex.: Financeiro, Suporte, Jurídico) e o eleitor recebe um <strong>menu numérico</strong> ao escrever. A conversa é roteada pra área certa e a IA responde com a <strong>persona daquela área</strong>.
                </HelpTopic>
                <HelpTopic icon={<Phone className="w-5 h-5"/>} title="Telemarketing Ativo (lista do CRM → operador)">
                    Líder cria uma campanha ativa com nome + script. O sistema semeia a lista com seus contatos do CRM. O operador clica em <strong>"Próximo contato"</strong>, recebe nome + telefone + script, fala via wa.me e registra o resultado (Interessado / Recusou / Agendar retorno / etc).
                </HelpTopic>
                <HelpTopic icon={<BarChartIcon className="w-5 h-5"/>} title="Relatórios (botão na Caixa de Entrada)">
                    Coordenador/Candidato veem: conversas por estágio (receptivo), progresso das campanhas ativas, ranking de produtividade por operador (trabalhados + interessados) e mix de resultados.
                </HelpTopic>
            </div>
        </AccordionItem>

        <AccordionItem title="🏛️ Plano Partido (Presidente + Candidatos)">
            <div className="space-y-4 text-slate-300">
                <p className="italic">Para <strong>presidentes de partido</strong> que coordenam vários candidatos. O presidente vê o agregado; cada candidato só vê o próprio painel (isolamento RLS).</p>
                <HelpTopic icon={<Building2 className="w-5 h-5"/>} title="Cadeia de Convites">
                    Presidente → convida Candidatos → convidam Coordenadores → convidam Líderes → convidam Apoiadores. Cada nível tem link próprio com o nome do superior travado (não dá pra impersonar).
                </HelpTopic>
                <HelpTopic icon={<MapPinIcon className="w-5 h-5"/>} title="Comitês & Check-in geolocalizado">
                    Cada candidato cadastra seu comitê com endereço + GPS + até 4 fotos (fachada/interior/placa/equipe). Coordenadores fazem check-in geolocalizado em eventos.
                </HelpTopic>
                <HelpTopic icon={<CurrencyDollarIcon className="w-5 h-5"/>} title="Repasses + Válvula">
                    Presidente registra repasses (valor/data/destino) e tem uma <strong>válvula</strong> pra aprovar/segurar/cortar baseado no score do candidato (verde/amarelo/vermelho calculado por sinais: cadastro, comitê, atividade, equipe, contas).
                </HelpTopic>
                <HelpTopic icon={<BarChartIcon className="w-5 h-5"/>} title="Telão público">
                    Link tokenizado (não-listado) que mostra um <strong>mapa ao vivo fullscreen</strong> com pino dos comitês e heat do estado — para projetar em eventos do partido.
                </HelpTopic>
            </div>
        </AccordionItem>

        <AccordionItem title="🔐 Gerar Acesso para Membros Órfãos">
            <div className="space-y-4 text-slate-300">
                <p className="italic">Quando você cadastra um membro da equipe mas ele ainda não tem login, ele aparece como <strong>órfão</strong> na tabela da Equipe (botão âmbar em destaque).</p>
                <HelpTopic icon={<KeyRound className="w-5 h-5"/>} title="Como funciona">
                    <ul>
                        <li>No card do membro, clique no botão <strong>"🔐 Gerar acesso"</strong>.</li>
                        <li>O sistema cria um <strong>link de convite</strong> (válido por 7 dias) e o exibe num modal pra você copiar.</li>
                        <li>Mande pelo WhatsApp/email do membro. Ele abre, se cadastra, e cai direto no app já dentro da equipe com a função correta.</li>
                        <li>O membro existente fica <strong>amarrado automaticamente</strong> — sem cadastro duplicado.</li>
                    </ul>
                </HelpTopic>
            </div>
        </AccordionItem>

        <AccordionItem title="Treinamento: O Manual da Equipe">
             <div className="space-y-4 text-slate-300">
                <p className="italic">Aqui fica o "manual de instruções" para sua equipe de campo. É um guia rápido para todo mundo falar a mesma língua e fazer o trabalho da melhor forma.</p>
                <HelpTopic icon={<AcademicCapIcon className="w-5 h-5"/>} title="Conteúdo">
                    Inclui scripts de abordagem, guias de como "ler" o eleitor e boas práticas para o trabalho de rua, <strong>treinamento de operador de Call Center</strong> e <strong>treinamento de Fiscal Dia D</strong>.
                </HelpTopic>
            </div>
        </AccordionItem>

        <AccordionItem title="Ferramentas e Configurações">
            <div className="space-y-4 text-slate-300">
                <p className="italic">Áreas administrativas para personalizar a plataforma e gerenciar seus dados.</p>
                <HelpTopic icon={<ToolsIcon className="w-5 h-5"/>} title="Ferramentas">
                    <ul>
                        <li><strong>Personalização Visual:</strong> Faça o upload dos logos da sua campanha para o cabeçalho e relatórios.</li>
                        <li><strong>Backup e Restauração:</strong> Salve uma cópia de segurança de todos os seus dados.</li>
                        <li><strong>Exportar para CSV:</strong> Baixe listas em um formato que abre em programas de planilha, como o Excel.</li>
                    </ul>
                </HelpTopic>
                 <HelpTopic icon={<CogIcon className="w-5 h-5"/>} title="Configurações">
                    Preencha informações como CNPJ da campanha, nome completo do candidato, e o orçamento total, que será usado como base no dashboard financeiro.
                </HelpTopic>
            </div>
        </AccordionItem>

      </div>
    </div>
  );
};

export default HelpPage;