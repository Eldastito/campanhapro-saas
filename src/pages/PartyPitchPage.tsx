import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { LOGO_MONO_BASE64 } from '../constants';
import {
  Printer, Landmark, ShieldCheck, MapPinned, BarChart3, GitBranch,
  Camera, Lock, Trophy, Gauge, CheckCircle2, ArrowRight, ArrowLeft,
} from 'lucide-react';

/**
 * Proposta comercial imprimível do produto "CampanhaPro Partido — Centro de
 * Comando" (controle de repasses + comprovação por realidade operacional).
 * Rota pública /proposta/partido — abre em nova aba, imprime/salva em PDF e pode
 * ser enviada ao presidente do partido. Mesmo padrão de impressão da plataforma.
 */
const Sec: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <section className="report-section mb-7">
    <h3 className="text-lg font-black border-l-4 border-indigo-500 pl-3 mb-3 uppercase tracking-wide text-slate-800">{n}. {title}</h3>
    {children}
  </section>
);

const Bullet: React.FC<{ icon: any; title: string; children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <div className="flex items-start gap-3 mb-2.5">
    <div className="shrink-0 w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center">
      <Icon className="w-4 h-4 text-indigo-600" />
    </div>
    <p className="text-[13px] text-slate-700 leading-snug"><b className="text-slate-900">{title}.</b> {children}</p>
  </div>
);

const PartyPitchPage: React.FC = () => {
  const navigate = useNavigate();
  // Volta pra de onde veio; se aberta direto (sem histórico), cai no Hub.
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/app/hub'));
  // Preço/condição vêm por parâmetro de URL para a proposta ser reaproveitável
  // por cliente (ex.: /proposta/partido?preco=2.500&periodo=mês&cond=Candidatos%20ilimitados).
  // Sem parâmetro, mostra "Sob proposta" — nada de preço chumbado.
  const q = new URLSearchParams(window.location.search);
  const preco = q.get('preco');
  const periodo = q.get('periodo') || 'mês';
  const cond = q.get('cond') || (preco ? 'Candidatos ilimitados · tudo incluso' : 'Conforme o tamanho do partido');
  return (
    <div id="party-pitch" className="min-h-screen bg-slate-100 text-slate-900 print:bg-white">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #party-pitch, #party-pitch * { visibility: visible !important; }
          #party-pitch { position: absolute !important; inset: 0 !important; background: #fff !important; }
          .no-print { display: none !important; }
          .report-section { break-inside: avoid; page-break-inside: avoid; }
          .page-break { break-before: page; page-break-before: always; }
          .print-footer { position: fixed; bottom: 0; left: 0; right: 0; display: block !important; }
          @page { size: A4; margin: 14mm 14mm 18mm 14mm; }
        }
      `}</style>

      {/* Toolbar (não imprime) */}
      <div className="no-print sticky top-0 z-10 bg-slate-900 text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="flex items-center gap-1 text-sm text-slate-300 hover:text-white">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          <span className="text-sm text-slate-500 hidden sm:inline">·</span>
          <span className="text-sm text-slate-300 hidden sm:inline">Proposta comercial · CampanhaPro Partido</span>
        </div>
        <button onClick={() => window.print()} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md px-4 py-2 text-sm flex items-center gap-2">
          <Printer className="w-4 h-4" /> Imprimir / Salvar PDF
        </button>
      </div>

      <div className="max-w-[820px] mx-auto bg-white shadow-xl print:shadow-none my-6 print:my-0 p-10 print:p-0">

        {/* Rodapé de impressão */}
        <div className="print-footer hidden text-[9px] text-slate-500 border-t border-slate-300 pt-1 px-2">
          CampanhaPro Partido · Centro de Comando · campanhapro2.tesseractauto.com.br · Proposta comercial — transparência e prestação de contas
        </div>

        {/* CAPA / HERO */}
        <div className="text-center border-b-2 border-slate-200 pb-7 mb-8">
          <img src={LOGO_MONO_BASE64} alt="CampanhaPro" className="h-16 w-16 object-contain mx-auto mb-3" referrerPolicy="no-referrer" />
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-indigo-600 flex items-center justify-center gap-1.5"><Landmark className="w-3.5 h-3.5" /> CampanhaPro Partido — Centro de Comando</p>
          <h1 className="text-3xl font-black tracking-tight mt-2 text-slate-900">O partido tem o dinheiro.<br />Agora tem o <span className="text-indigo-600">controle</span>.</h1>
          <p className="text-sm text-slate-500 mt-3 max-w-xl mx-auto">Controle de repasses + comprovação em tempo real de onde cada real está virando comitê, equipe e voto.</p>
        </div>

        {/* 1. O PROBLEMA */}
        <Sec n={1} title="O problema de quem financia campanha">
          <p className="text-[13px] text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-4">
            Você repassa recursos para dezenas de candidatos e precisa <b>garantir que cada real vira comitê, equipe e voto</b> — não desvio.
            Hoje isso é caderno, planilha de Excel e confiança cega. Sem visão do que acontece no campo, é impossível saber quem está
            trabalhando e quem está só recebendo.
          </p>
        </Sec>

        {/* 2. A SOLUÇÃO */}
        <Sec n={2} title="A solução">
          <p className="text-[13px] text-slate-700 leading-relaxed mb-3">
            Um painel onde você <b>lança quem recebeu quanto</b> e <b>acompanha, ao vivo, onde o dinheiro está sendo aplicado</b> —
            com mapa, fotos geolocalizadas e um <b>score de eficiência</b> por candidato. Tudo isolado: nenhum candidato vê o do outro.
          </p>
          <div className="grid grid-cols-3 gap-3 mt-2">
            {[
              { icon: GitBranch, t: 'Estrutura que se monta sozinha', d: 'cada nível convida o próximo' },
              { icon: MapPinned, t: 'Mapa do partido ao vivo', d: 'projetável no telão do diretório' },
              { icon: Gauge, t: 'Score por candidato', d: 'recebeu × entregou' },
            ].map((c, i) => (
              <div key={i} className="border border-slate-200 rounded-xl p-3 text-center">
                <c.icon className="w-5 h-5 text-indigo-600 mx-auto mb-1.5" />
                <p className="text-[12px] font-bold text-slate-800 leading-tight">{c.t}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{c.d}</p>
              </div>
            ))}
          </div>
        </Sec>

        {/* 3. COMO FUNCIONA */}
        <Sec n={3} title="Como funciona — em 3 passos">
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-indigo-600 text-white font-black flex items-center justify-center text-sm">1</div>
              <p className="text-[13px] text-slate-700"><b>Cadastre seu time em cadeia.</b> Importe sua planilha; cada candidato se cadastra e <b>gera um link</b> para o coordenador, que gera para os líderes. O nome de quem convidou já vem travado no formulário — a hierarquia inteira se monta e fica registrada, sem fraude de identidade.</p>
            </div>
            <div className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-indigo-600 text-white font-black flex items-center justify-center text-sm">2</div>
              <p className="text-[13px] text-slate-700"><b>Eles comprovam, você acompanha.</b> Cada equipe registra visitas, reuniões e check-ins no comitê — com <b>GPS e foto</b>. As metas do candidato vão sendo marcadas como cumpridas à medida que a estrutura aparece. Tudo no <b>mapa em tempo real</b>.</p>
            </div>
            <div className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-indigo-600 text-white font-black flex items-center justify-center text-sm">3</div>
              <p className="text-[13px] text-slate-700"><b>Você decide com dados.</b> Um painel mostra os candidatos lado a lado: <b>quanto recebeu × quanto entregou × score 🟢🟡🔴</b>. Libere o próximo repasse, segure, ou corte quem não produz.</p>
            </div>
          </div>
        </Sec>

        {/* quebra de página */}
        <div className="page-break" />

        {/* 4. O QUE VOCÊ GANHA */}
        <Sec n={4} title="O que você ganha">
          <div className="grid grid-cols-2 gap-x-6">
            <div>
              <Bullet icon={MapPinned} title="Telão ao vivo no diretório">Um link abre o mapa do partido em tela cheia, atualizando em tempo real — com mapa de calor do estado.</Bullet>
              <Bullet icon={Camera} title="Comprovação geolocalizada">Comitês, equipes e atividades com GPS e foto — difícil de falsificar.</Bullet>
              <Bullet icon={Trophy} title="Ranking de eficiência">Saiba quem rende mais por real investido e realoque a verba.</Bullet>
            </div>
            <div>
              <Bullet icon={ShieldCheck} title="Válvula de repasse">Libere dinheiro só para quem entrega — aprovar, segurar ou cortar.</Bullet>
              <Bullet icon={Lock} title="Isolamento total">Nenhum candidato vê o do outro; cada equipe enxerga só o seu.</Bullet>
              <Bullet icon={BarChart3} title="Metas financeiras acompanhadas">Veja as metas do candidato sendo cumpridas conforme o time se cadastra e produz.</Bullet>
            </div>
          </div>
        </Sec>

        {/* 5. POR QUE FUNCIONA */}
        <Sec n={5} title="Por que funciona — mesmo sem nota fiscal">
          <p className="text-[13px] text-slate-700 leading-relaxed bg-indigo-50 border border-indigo-200 rounded-xl p-4">
            <b>Dinheiro bem usado deixa rastro.</b> Um comitê fantasma não sustenta semanas de presença geolocalizada e equipe ativa;
            um coordenador que não existe não tem como aparecer no sistema. A plataforma <b>torna a fraude cara e visível</b> — e te dá o
            poder de cortar. Não é vigilância: é <b>transparência e prestação de contas</b> do uso de recursos legítimos.
          </p>
        </Sec>

        {/* 6. INVESTIMENTO */}
        <Sec n={6} title="Investimento">
          <div className="rounded-2xl border-2 border-indigo-400 bg-indigo-50 p-6 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">Plano Partido</p>
            <p className="text-4xl font-black text-slate-900 mt-1">{preco ? <>R$ {preco}<span className="text-lg font-bold text-slate-500"> /{periodo}</span></> : <span className="text-2xl">Sob proposta</span>}</p>
            <p className="text-[12px] text-slate-600 mt-1">{cond}</p>
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 mt-3 text-[12px] text-slate-700">
              <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Implementação inclusa</span>
              <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Suporte incluso</span>
              <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Telão ao vivo</span>
            </div>
          </div>
          <p className="text-[12px] text-slate-600 mt-3 flex items-start gap-1.5">
            <ArrowRight className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            Adicione candidatos conforme o plano, e cada candidato pode evoluir para o <b>CampanhaPro completo</b> (CRM + IA + Inteligência) quando precisar de mais.
          </p>
          <p className="text-[10px] text-slate-400 mt-2">Valores e condições sob proposta, conforme o tamanho e a necessidade do partido.</p>
        </Sec>

        {/* CTA */}
        <div className="report-section mt-8 rounded-2xl bg-slate-900 text-white p-6 text-center">
          <p className="text-lg font-black">Transparência e prestação de contas. Do seu jeito, no seu comando.</p>
          <p className="text-sm text-slate-300 mt-1 flex items-center justify-center gap-2">Vamos configurar o seu partido <ArrowRight className="w-4 h-4" /> contato@campanhapro</p>
        </div>

        <p className="text-center text-[10px] text-slate-400 pt-6">CampanhaPro Partido · Centro de Comando · {new Date().getFullYear()} · Proposta comercial</p>
      </div>
    </div>
  );
};

export default PartyPitchPage;
