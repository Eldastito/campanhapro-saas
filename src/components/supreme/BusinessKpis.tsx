import React, { useMemo, useState } from 'react';
import {
  Calculator, TrendingUp, TrendingDown, AlertTriangle, Clock,
  Target, Settings2, ChevronDown, Repeat, Coins,
} from 'lucide-react';

/**
 * KPIs de saúde do negócio (SaaS) para o Supreme Admin.
 * Combina os dados REAIS de `financial` (MRR, clientes pagantes, custos fixos,
 * margem) com premissas do dono (marketing, churn, custo/hora) salvas em
 * localStorage — e calcula CAC, LTV, LTV/CAC, ROI, Ponto de equilíbrio e o
 * Custo do seu tempo. Destaque central: CAC vs LTV (está ganhando ou perdendo?).
 */

interface Props {
  financial: any | null;
}

const LS_KEY = 'supreme_kpi_assumptions_v1';
const DEFAULTS = {
  marketingMensal: 0,     // R$ gastos em marketing/vendas por mês
  novosClientesMes: 1,    // novos clientes adquiridos por mês
  churnPctMes: 5,         // % de cancelamento mensal → vida média = 100/churn
  custoHora: 150,         // R$ por hora do seu tempo
  horasMes: 160,          // horas/mês dedicadas ao negócio
  pctTempoVendas: 50,     // % do seu tempo gasto em aquisição (vendas/mkt)
};

const brl = (v: number) =>
  'R$ ' + (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BusinessKpis: React.FC<Props> = ({ financial }) => {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState<typeof DEFAULTS>(() => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') }; }
    catch { return DEFAULTS; }
  });
  const save = (patch: Partial<typeof DEFAULTS>) => {
    setA((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const k = useMemo(() => {
    const mrr = (financial?.mrrCents ?? 0) / 100;
    const pagantes = financial?.subscriptions?.payingActive ?? 0;
    const custosFixos = (financial?.profitLoss?.custosFixosCents ?? 0) / 100;
    const custoIaVar = (financial?.profitLoss?.custoIaVariavelCents ?? 0) / 100;
    const margem = (financial?.profitLoss?.margemPct ?? 0) / 100;
    const arpu = pagantes > 0 ? mrr / pagantes : 0;          // receita média por cliente/mês

    const custoTempo = (a.custoHora || 0) * (a.horasMes || 0);            // custo do seu tempo/mês
    const tempoEmVendas = custoTempo * ((a.pctTempoVendas || 0) / 100);   // parcela alocada à aquisição
    const cacBase = (a.marketingMensal || 0) + tempoEmVendas;
    const cac = a.novosClientesMes > 0 ? cacBase / a.novosClientesMes : null;

    const vidaMeses = a.churnPctMes > 0 ? 100 / a.churnPctMes : 0;        // tempo médio de permanência
    const ltv = arpu * margem * vidaMeses;                               // valor do cliente na vida toda
    const ratio = cac && cac > 0 ? ltv / cac : null;                     // LTV/CAC
    const contrib = arpu * margem;                                       // margem de contribuição/cliente
    const payback = contrib > 0 && cac != null ? cac / contrib : null;   // meses p/ recuperar o CAC

    const custoTotal = custosFixos + custoTempo + (a.marketingMensal || 0) + custoIaVar;
    const lucro = mrr - custoTotal;                                      // lucro "verdadeiro" (inclui seu tempo)
    const roi = custoTotal > 0 ? (lucro / custoTotal) * 100 : null;

    const fixoRecorr = custosFixos + custoTempo + (a.marketingMensal || 0);
    const beClientes = contrib > 0 ? Math.ceil(fixoRecorr / contrib) : null;  // clientes p/ empatar
    const beReceita = margem > 0 ? fixoRecorr / margem : null;                // receita p/ empatar
    const faltamClientes = beClientes != null ? Math.max(0, beClientes - pagantes) : null;

    return { mrr, pagantes, custosFixos, margem, arpu, custoTempo, cac, ltv, ratio, payback, roi, custoTotal, lucro, beClientes, beReceita, faltamClientes, vidaMeses };
  }, [financial, a]);

  // Veredito CAC vs LTV
  let verdict: { tone: 'green' | 'amber' | 'red' | 'gray'; title: string; detail: string };
  if (k.cac == null || k.ratio == null) {
    verdict = { tone: 'gray', title: 'Defina as premissas', detail: 'Preencha "novos clientes/mês" e custos para calcular CAC e LTV.' };
  } else if (k.ratio < 1) {
    verdict = { tone: 'red', title: `Prejuízo: você perde ${brl(k.cac - k.ltv)} por cliente`, detail: `O CAC (${brl(k.cac)}) é MAIOR que o LTV (${brl(k.ltv)}). Cada cliente custa mais do que dá retorno — reduza o CAC ou aumente preço/retenção.` };
  } else if (k.ratio < 3) {
    verdict = { tone: 'amber', title: `Atenção: LTV/CAC = ${k.ratio.toFixed(1)}x`, detail: `Acima de 1 (lucra), mas o ideal de SaaS é ≥ 3x. Há margem apertada para crescer com folga.` };
  } else {
    verdict = { tone: 'green', title: `Saudável: LTV/CAC = ${k.ratio.toFixed(1)}x`, detail: `Cada R$ 1 investido em aquisição retorna ${brl(k.ratio).replace('R$ ', 'R$ ')} em valor. Dá para acelerar a aquisição.` };
  }
  const toneCls: Record<string, string> = {
    green: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
    red: 'bg-rose-500/10 border-rose-500/30 text-rose-300',
    gray: 'bg-slate-500/10 border-white/10 text-slate-300',
  };

  const cards = [
    { label: 'CAC', val: k.cac == null ? '—' : brl(k.cac), sub: 'custo p/ adquirir 1 cliente', color: 'text-rose-400', icon: TrendingDown },
    { label: 'LTV', val: brl(k.ltv), sub: `valor na vida (${k.vidaMeses ? k.vidaMeses.toFixed(0) : '—'} meses)`, color: 'text-emerald-400', icon: TrendingUp },
    { label: 'LTV / CAC', val: k.ratio == null ? '—' : `${k.ratio.toFixed(1)}x`, sub: 'ideal ≥ 3x', color: k.ratio == null ? 'text-slate-400' : k.ratio < 1 ? 'text-rose-400' : k.ratio < 3 ? 'text-amber-400' : 'text-emerald-400', icon: Repeat },
    { label: 'ROI mensal', val: k.roi == null ? '—' : `${k.roi.toFixed(0)}%`, sub: '(receita − custo) / custo', color: (k.roi ?? 0) >= 0 ? 'text-sky-400' : 'text-rose-400', icon: Coins },
    { label: 'Ponto de equilíbrio', val: k.beClientes == null ? '—' : `${k.beClientes} cli.`, sub: k.beReceita != null ? `${brl(k.beReceita)}/mês` : '', color: 'text-violet-400', icon: Target },
    { label: 'Payback do CAC', val: k.payback == null ? '—' : `${k.payback.toFixed(1)} m`, sub: 'meses p/ recuperar', color: 'text-teal-400', icon: Clock },
    { label: 'Custo do meu tempo', val: brl(k.custoTempo), sub: `${a.custoHora}/h × ${a.horasMes}h`, color: 'text-amber-400', icon: Clock },
    { label: 'Lucro real (c/ tempo)', val: brl(k.lucro), sub: 'MRR − custos − seu tempo', color: k.lucro >= 0 ? 'text-emerald-400' : 'text-rose-400', icon: Coins },
  ];

  const field = (label: string, key: keyof typeof DEFAULTS, suffix?: string, step = 1) => (
    <div>
      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number" min={0} step={step}
          value={(a as any)[key]}
          onChange={(e) => save({ [key]: Number(e.target.value) } as any)}
          className="w-full bg-slate-950 border border-white/10 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-indigo-500 font-mono"
        />
        {suffix && <span className="text-[10px] text-slate-500 shrink-0">{suffix}</span>}
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-lg font-black text-white uppercase flex items-center gap-2"><Calculator className="w-5 h-5 text-indigo-400" /> Saúde do Negócio (KPIs)</h3>
          <p className="text-xs text-slate-500 uppercase tracking-widest font-mono">CAC · LTV · ROI · Equilíbrio · Custo do seu tempo</p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-slate-800/60 border border-white/10 rounded-lg px-3 py-1.5">
          <Settings2 className="w-3.5 h-3.5" /> Premissas <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Veredito CAC vs LTV */}
      <div className={`rounded-xl border p-4 my-4 flex items-start gap-3 ${toneCls[verdict.tone]}`}>
        {verdict.tone === 'red' ? <AlertTriangle className="w-6 h-6 shrink-0" /> : verdict.tone === 'green' ? <TrendingUp className="w-6 h-6 shrink-0" /> : <Repeat className="w-6 h-6 shrink-0" />}
        <div>
          <p className="font-black text-sm">{verdict.title}</p>
          <p className="text-xs opacity-80 mt-0.5">{verdict.detail}</p>
        </div>
      </div>

      {/* Painel de premissas (colapsável) */}
      {open && (
        <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 mb-4">
          <p className="text-[10px] text-slate-500 mb-3">Ajuste com seus números reais. Salvo automaticamente neste navegador. MRR, clientes pagantes, custos fixos e margem vêm dos dados reais da plataforma.</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {field('Marketing/vendas', 'marketingMensal', 'R$/mês', 50)}
            {field('Novos clientes', 'novosClientesMes', '/mês')}
            {field('Churn mensal', 'churnPctMes', '%')}
            {field('Seu custo/hora', 'custoHora', 'R$', 10)}
            {field('Horas/mês', 'horasMes', 'h')}
            {field('% tempo em vendas', 'pctTempoVendas', '%', 5)}
          </div>
        </div>
      )}

      {/* Cards de KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div key={i} className="bg-slate-900/50 border border-white/5 rounded-xl p-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10"><c.icon className={`w-7 h-7 ${c.color}`} /></div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{c.label}</p>
            <p className={`text-2xl font-black mt-1.5 font-mono tracking-tighter ${c.color}`}>{c.val}</p>
            {c.sub && <p className="text-[10px] text-slate-600 mt-0.5">{c.sub}</p>}
          </div>
        ))}
      </div>

      {k.beClientes != null && (
        <p className="text-[11px] text-slate-500 mt-3">
          Você tem <strong className="text-slate-300">{k.pagantes}</strong> cliente(s) pagante(s).
          {k.faltamClientes && k.faltamClientes > 0
            ? <> Faltam <strong className="text-violet-400">{k.faltamClientes}</strong> para atingir o ponto de equilíbrio.</>
            : <> Você já passou do ponto de equilíbrio. 🎉</>}
        </p>
      )}
    </div>
  );
};

export default BusinessKpis;
