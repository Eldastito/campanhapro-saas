import * as React from 'react';
import { LOGO_MONO_BASE64 } from '../constants';
import { Printer, Landmark } from 'lucide-react';

/**
 * Sumário Executivo imprimível do produto "CampanhaPro Partido — Centro de
 * Comando". Documento estratégico completo (problema → solução → arquitetura →
 * antifraude → modelo de negócio → oportunidade → roadmap). Rota pública
 * /sumario/partido. Mesmo padrão de impressão da plataforma.
 */
const Sec: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <section className="report-section mb-6">
    <h3 className="text-[15px] font-black border-l-4 border-indigo-500 pl-3 mb-2 uppercase tracking-wide text-slate-800">{n}. {title}</h3>
    {children}
  </section>
);
const P: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="text-[12.5px] text-slate-700 leading-relaxed mb-2">{children}</p>;
const LI: React.FC<{ children: React.ReactNode }> = ({ children }) => <li className="text-[12.5px] text-slate-700 leading-snug flex gap-1.5 mb-1"><span className="text-indigo-500">•</span><span>{children}</span></li>;

const PartyExecSummaryPage: React.FC = () => {
  return (
    <div id="party-exec" className="min-h-screen bg-slate-100 text-slate-900 print:bg-white">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #party-exec, #party-exec * { visibility: visible !important; }
          #party-exec { position: absolute !important; inset: 0 !important; background: #fff !important; }
          .no-print { display: none !important; }
          .report-section { break-inside: avoid; page-break-inside: avoid; }
          .page-break { break-before: page; page-break-before: always; }
          .print-footer { position: fixed; bottom: 0; left: 0; right: 0; display: block !important; }
          @page { size: A4; margin: 14mm 14mm 18mm 14mm; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 bg-slate-900 text-white px-6 py-3 flex items-center justify-between">
        <span className="text-sm text-slate-300">Sumário Executivo · CampanhaPro Partido</span>
        <button onClick={() => window.print()} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md px-4 py-2 text-sm flex items-center gap-2">
          <Printer className="w-4 h-4" /> Imprimir / Salvar PDF
        </button>
      </div>

      <div className="max-w-[820px] mx-auto bg-white shadow-xl print:shadow-none my-6 print:my-0 p-10 print:p-0">
        <div className="print-footer hidden text-[9px] text-slate-500 border-t border-slate-300 pt-1 px-2">
          CampanhaPro Partido · Sumário Executivo · campanhapro2.tesseractauto.com.br · Confidencial
        </div>

        {/* Cabeçalho */}
        <div className="flex items-center gap-4 border-b-2 border-slate-200 pb-5 mb-6">
          <img src={LOGO_MONO_BASE64} alt="CampanhaPro" className="h-14 w-14 object-contain" referrerPolicy="no-referrer" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-600 flex items-center gap-1.5"><Landmark className="w-3 h-3" /> CampanhaPro Partido — Centro de Comando</p>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Sumário Executivo</h1>
            <p className="text-[11px] text-slate-500">Controle de repasses + comprovação por realidade operacional · Documento estratégico</p>
          </div>
        </div>

        <Sec n={1} title="Visão geral">
          <P><b>CampanhaPro Partido</b> é um produto voltado ao <b>presidente/financiador de partido</b>, que repassa recursos a dezenas de candidatos e precisa garantir que o dinheiro vira estrutura de campanha — comitê, coordenadores e líderes — sem desvio. O produto <b>controla os repasses</b> e <b>comprova, em tempo real e por geolocalização, onde cada real está sendo aplicado</b>, com um score de eficiência por candidato. Roda dentro da plataforma CampanhaPro, com isolamento total entre candidatos, e serve de <b>porta de entrada</b> para a venda dos planos completos aos próprios candidatos.</P>
        </Sec>

        <Sec n={2} title="O problema">
          <ul>
            <LI>Repasses em espécie, <b>sem recibo</b>, anotados em caderno/planilha.</LI>
            <LI>Destino do dinheiro: aluguel de comitê, pagamento de coordenador e de líderes.</LI>
            <LI>O financiador precisa <b>garantir o uso correto</b> e poder <b>ver, aprovar e cortar</b>.</LI>
            <LI>Obstáculo: sem nota fiscal, é impossível auditar por documento.</LI>
          </ul>
        </Sec>

        <Sec n={3} title="A solução (a sacada)">
          <P>Não se audita dinheiro vivo pelo recibo — audita-se pela <b>realidade operacional</b>. Dinheiro bem aplicado <b>deixa rastro</b>: o coordenador pago existe e está ativo; os líderes pagos estão cadastrados e produzindo; o comitê tem presença geolocalizada recorrente. <b>Sem rastro = sinal de desvio.</b> O uso correto do dinheiro gera, ele mesmo, a prova — dentro do sistema.</P>
        </Sec>

        <Sec n={4} title="Como funciona">
          <ul>
            <LI><b>Cadeia de cadastro:</b> o presidente convida os candidatos; cada candidato convida seu coordenador; o coordenador convida seus líderes. O link já carrega e <b>trava o nome de quem convidou</b> — a hierarquia inteira se monta sozinha e fica registrada, à prova de troca de identidade.</LI>
            <LI><b>Comprovação geolocalizada:</b> comitê e atividades com <b>GPS + foto</b>; check-in recorrente prova a "vida" do comitê.</LI>
            <LI><b>Metas que acendem sozinhas:</b> conforme o time se cadastra e produz, as metas do candidato são marcadas como cumpridas.</LI>
            <LI><b>Score de eficiência (🟢🟡🔴):</b> recebeu × entregou, por candidato.</LI>
            <LI><b>Válvula do presidente:</b> aprovar o próximo repasse, segurar ou cortar quem não produz — com ranking de eficiência.</LI>
            <LI><b>Telão ao vivo:</b> link público que abre o mapa do partido em tela cheia no diretório, com mapa de calor do estado.</LI>
          </ul>
        </Sec>

        <Sec n={5} title="Arquitetura e isolamento">
          <P><b>Partido (presidente) → candidatos (ilimitados) → coordenadores → líderes.</b> Cada candidato é um espaço isolado: <b>o candidato A nunca vê o B</b>, e cada equipe só enxerga o próprio espaço. O presidente vê o <b>agregado</b> de todos (repasses, comprovações, scores, ranking) — em modo leitura + a válvula. O presidente pode <b>adicionar candidatos a qualquer momento</b>, sem limite.</P>
        </Sec>

        <Sec n={6} title="Motor antifraude (de onde vêm os dados)">
          <ul>
            <LI><b>Headcount real:</b> nº de coordenadores/líderes cadastrados e ativos sob o candidato (cada um se cadastrou via link único).</LI>
            <LI><b>Check-ins e atividades geolocalizados:</b> quantidade e recorrência.</LI>
            <LI><b>Razão R$ recebido ÷ entrega</b> e <b>tempo desde o repasse sem prova.</b></LI>
          </ul>
          <P>O score é <b>regra matemática ponderada</b> (consultas no banco, sem IA cara). A IA entra só num <b>resumo semanal em lote</b> e no digest do presidente — custo de centavos. Fotos comprimidas e com cota; sem vídeo pesado. <b>Custo por candidato baixo de propósito</b>, para a mensalidade fixa cobrir candidatos ilimitados.</P>
        </Sec>

        <div className="page-break" />

        <Sec n={7} title="Modelo de negócio">
          <P><b>Plano Partido: R$ 2.500/mês — candidatos ilimitados, implementação e suporte inclusos.</b> O valor cobre a estrutura/infra. O retorno real vem do <b>upsell</b>: cada candidato dentro da plataforma é um lead para os planos completos do CampanhaPro (R$ 10k / 15k / 20k <b>por mês, por candidato</b>). É um clássico <b>land-and-expand</b>: a porta entra barata, o caixa vem das evoluções.</P>
        </Sec>

        <Sec n={8} title="A oportunidade">
          <ul>
            <LI>1 presidente coloca <b>60–130 candidatos</b> dentro da plataforma de uma vez = <b>60–130 leads quentes</b>.</LI>
            <LI>Coordenadores e líderes também viram usuários → mais superfície de venda.</LI>
            <LI>O presidente vira <b>canal/revendedor</b>; o mesmo produto se vende a <b>vários partidos</b> (B2B2C).</LI>
            <LI>Conta de retorno: <b>3 candidatos</b> que evoluam para o plano de entrada = <b>R$ 30k/mês</b> = 12× a mensalidade do partido inteiro.</LI>
          </ul>
        </Sec>

        <Sec n={9} title="Roadmap">
          <ul>
            <LI><b>Fase 1 (núcleo):</b> hierarquia/isolamento, cadeia de cadastro com nome travado, repasses + import de planilha, comprovação geo (comitê + check-in), metas automáticas, painel/ranking/válvula do presidente, telão público ao vivo.</LI>
            <LI><b>Fase 2:</b> vídeos, plano declarado × entregue, alertas, digest por IA, gamificação, teaser de upgrade in-app.</LI>
            <LI><b>Fase 3:</b> multi-partido, painel de revenda e comissionamento do presidente como canal.</LI>
          </ul>
        </Sec>

        <Sec n={10} title="Conformidade e diferenciais">
          <P><b>Enquadramento:</b> transparência e prestação de contas operacional de recursos legítimos — nunca facilitação de caixa 2; cuidado no modo de registrar.</P>
          <P><b>Diferenciais:</b> comprovação por realidade (não por papel) · telão ao vivo no diretório · isolamento total entre candidatos · funil embutido de upsell · custo de operação enxuto que viabiliza candidatos ilimitados por preço fixo.</P>
        </Sec>

        <p className="text-center text-[10px] text-slate-400 pt-4 border-t border-slate-200">CampanhaPro Partido · Centro de Comando · {new Date().getFullYear()} · Documento confidencial</p>
      </div>
    </div>
  );
};

export default PartyExecSummaryPage;
