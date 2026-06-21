import React, { useEffect, useState, useMemo, useCallback } from 'react';
import Card from '../ui/Card';
import { authedFetch } from '../../lib/authedFetch';

/**
 * Aba "Partidos" do Supreme Admin — visão financeira interna (só você vê).
 *
 * Fonte de verdade do preço do Plano Partido: module_prices('partido') — vem em
 * `planMonthlyCents`. A receita mensal estimada = partidos ATIVOS que NÃO são
 * cortesia × preço. "Cortesia" mantém o acesso sem cobrança (ex.: validação do
 * app) e é marcada só aqui, invisível pro presidente.
 *
 * IMPORTANTE: "Repasses a candidatos" (recebido/alocado) são transferências
 * INTERNAS do partido pros candidatos — NÃO são a cobrança do plano. Ficam numa
 * coluna separada e claramente rotulada pra não confundir com faturamento.
 */
interface Party {
  id: string;
  name: string;
  status: string | null;
  billingNote: string | null;
  createdAt: string;
  presidentName: string | null;
  presidentEmail: string | null;
  candidatesCount: number;
  valorRecebido: number;
  valorAlocado: number;
  courtesy: boolean;
  billingStatus: string | null;
  courtesyNote: string | null;
}

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PartiesTab: React.FC = () => {
  const [parties, setParties] = useState<Party[]>([]);
  const [planMonthlyCents, setPlanMonthlyCents] = useState(300000);
  const [loading, setLoading] = useState(true);
  const [priceReais, setPriceReais] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/api/v1/supreme/parties');
      if (r.ok) {
        const j = await r.json();
        setParties(j.parties || []);
        setPlanMonthlyCents(j.planMonthlyCents ?? 300000);
        setPriceReais(((j.planMonthlyCents ?? 300000) / 100).toString());
      }
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const savePrice = async () => {
    const cents = Math.round(parseFloat(priceReais.replace(',', '.')) * 100);
    if (!Number.isInteger(cents) || cents < 0) return;
    setSavingPrice(true);
    try {
      await authedFetch('/api/v1/supreme/party-billing/price', {
        method: 'PUT', body: JSON.stringify({ monthlyCents: cents }),
      });
      await load();
    } finally { setSavingPrice(false); }
  };

  const toggleCourtesy = async (p: Party) => {
    const makeCourtesy = !p.courtesy;
    let note: string | null = null;
    if (makeCourtesy) note = window.prompt('Motivo da cortesia (controle interno, opcional):', p.courtesyNote || '') || null;
    setActing(p.id);
    try {
      await authedFetch(`/api/v1/supreme/party-billing/${p.id}/courtesy`, {
        method: 'POST', body: JSON.stringify({ courtesy: makeCourtesy, note }),
      });
      await load();
    } finally { setActing(null); }
  };

  // Receita = partidos ativos que NÃO são cortesia × preço do plano. Cortesia = R$0.
  const totals = useMemo(() => {
    const ativos = parties.filter((p) => p.status === 'active');
    const pagantes = ativos.filter((p) => !p.courtesy);
    return {
      receitaMensal: (pagantes.length * planMonthlyCents) / 100,
      partidosAtivos: ativos.length,
      cortesias: ativos.filter((p) => p.courtesy).length,
      candidatos: ativos.reduce((s, p) => s + p.candidatesCount, 0),
    };
  }, [parties, planMonthlyCents]);

  return (
    <div className="space-y-4">
      {/* Preço do Plano Partido (fonte de verdade) */}
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Preço do Plano Partido (R$/mês)</p>
          <div className="flex items-center gap-2 mt-1">
            <input type="number" step="0.01" min="0" value={priceReais}
              onChange={(e) => setPriceReais(e.target.value)}
              className="w-40 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
            <button onClick={savePrice} disabled={savingPrice}
              className="text-xs px-3 py-2 rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 font-bold">
              {savingPrice ? 'Salvando…' : 'Salvar preço'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Fonte de verdade do faturamento do app Partido.</p>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Receita mensal estimada</p>
          <p className="text-3xl font-black text-emerald-300 mt-1">{fmtBRL(totals.receitaMensal)}</p>
          <p className="text-[11px] text-slate-500 mt-1">Partidos pagantes × {fmtBRL(planMonthlyCents / 100)}. Cortesias não contam.</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Partidos ativos</p>
          <p className="text-3xl font-black text-white mt-1">{totals.partidosAtivos}</p>
          <p className="text-[11px] text-slate-500 mt-1">{parties.length} no total · {totals.cortesias} cortesia(s)</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Candidatos vinculados</p>
          <p className="text-3xl font-black text-white mt-1">{totals.candidatos}</p>
          <p className="text-[11px] text-slate-500 mt-1">Somados entre partidos ativos</p>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <h3 className="font-bold text-white">Carteira de Partidos</h3>
          <button onClick={load} className="text-xs text-slate-400 hover:text-white">↻ Atualizar</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/40">
                <th className="text-left px-4 py-2">Partido / Presidente</th>
                <th className="text-left px-4 py-2">Plano Partido</th>
                <th className="text-right px-4 py-2">Cands</th>
                <th className="text-right px-4 py-2">Repasses a candidatos (interno)</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Cortesia</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="text-center text-slate-500 py-6 text-xs">Carregando…</td></tr>
              )}
              {!loading && parties.length === 0 && (
                <tr><td colSpan={6} className="text-center text-slate-500 py-6 text-xs">Nenhum partido cadastrado ainda.</td></tr>
              )}
              {parties.map((p) => (
                <tr key={p.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-white">{p.name}</p>
                    <p className="text-[11px] text-slate-400">{p.presidentName || '—'}{p.presidentEmail ? ` · ${p.presidentEmail}` : ''}</p>
                    <p className="text-[10px] text-slate-600">criado {new Date(p.createdAt).toLocaleDateString('pt-BR')}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    {p.courtesy ? (
                      <span className="text-violet-300 font-semibold">Cortesia · {fmtBRL(0)}</span>
                    ) : (
                      <span className="text-slate-200 font-semibold">{fmtBRL(planMonthlyCents / 100)}/mês</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-300">{p.candidatesCount}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-slate-400">{fmtBRL(p.valorRecebido)}</span>
                    <span className="block text-[10px] text-slate-600">alocado {fmtBRL(p.valorAlocado)}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${p.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-400'}`}>{p.status || '—'}</span>
                    {p.courtesy && p.courtesyNote && <span className="block text-[10px] text-violet-300/70 mt-1">{p.courtesyNote}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => toggleCourtesy(p)} disabled={acting === p.id}
                      className={`text-[11px] px-2.5 py-1 rounded-lg font-bold ${p.courtesy ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-violet-600/20 text-violet-300 hover:bg-violet-600/30'}`}>
                      {acting === p.id ? '…' : p.courtesy ? 'Remover cortesia' : 'Marcar cortesia'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-600 px-4 py-2 border-t border-white/5">
          Preço do Plano Partido vem de <code>module_prices</code>. "Repasses a candidatos" são transferências internas do partido (não é cobrança do plano). Cortesia mantém o acesso sem cobrança — invisível pro presidente.
        </p>
      </Card>
    </div>
  );
};

export default PartiesTab;
