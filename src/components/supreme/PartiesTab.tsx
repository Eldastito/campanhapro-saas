import React, { useEffect, useState, useMemo } from 'react';
import Card from '../ui/Card';
import { authedFetch } from '../../lib/authedFetch';

/**
 * Aba "Partidos" do Supreme Admin — visão financeira interna.
 *
 * Mostra cada partido contratado (Plano Partido R$ 2.500/mês, pago FORA do
 * Asaas neste momento) com: plano, billingNote editável, nº de candidatos,
 * total recebido e alocado. O cabeçalho soma a receita mensal estimada
 * somando o valor extraído da billingNote (ex.: "R$ 2.500/mês" → 2500).
 *
 * Visível APENAS para Supreme Admin (proteção já existe no router).
 */
interface Party {
  id: string;
  name: string;
  plan: string | null;
  status: string | null;
  billingNote: string | null;
  candidatesCount: number;
  valorRecebido: number;
  valorAlocado: number;
  createdAt: string;
}

// Extrai "R$ 2500" / "R$ 2.500" / "R$ 2.500,00" da billingNote. Best-effort —
// se o admin escrever sem padrão, devolve 0 e nem entra na soma de receita.
function parseMensalidade(note: string | null): number {
  if (!note) return 0;
  const m = note.match(/R\$\s*([\d.]+(?:,\d{2})?)/);
  if (!m) return 0;
  const raw = m[1].replace(/\./g, '').replace(',', '.');
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PartiesTab: React.FC = () => {
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/api/v1/supreme/parties');
      if (r.ok) {
        const j = await r.json();
        setParties(j.parties || []);
      }
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const startEdit = (p: Party) => { setEditingId(p.id); setEditValue(p.billingNote || ''); };
  const cancelEdit = () => { setEditingId(null); setEditValue(''); };
  const saveEdit = async (id: string) => {
    setSaving(true);
    try {
      const r = await authedFetch(`/api/v1/supreme/parties/${id}`, {
        method: 'PATCH', body: JSON.stringify({ billingNote: editValue }),
      });
      if (r.ok) { await load(); cancelEdit(); }
    } finally { setSaving(false); }
  };

  // Totais para o cabeçalho — só conta partido ativo. Se houver "[DEMO]" no
  // nome, marca como demo (não tira da soma — quem decide é você ao apagar).
  const totals = useMemo(() => {
    const ativos = parties.filter((p) => p.status === 'active');
    const receitaMensal = ativos.reduce((s, p) => s + parseMensalidade(p.billingNote), 0);
    const candidatos = ativos.reduce((s, p) => s + p.candidatesCount, 0);
    return { receitaMensal, partidosAtivos: ativos.length, candidatos };
  }, [parties]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Receita mensal estimada</p>
          <p className="text-3xl font-black text-emerald-300 mt-1">{fmtBRL(totals.receitaMensal)}</p>
          <p className="text-[11px] text-slate-500 mt-1">Extraída da billingNote (R$ ...) de partidos ativos. Apenas você vê.</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Partidos ativos</p>
          <p className="text-3xl font-black text-white mt-1">{totals.partidosAtivos}</p>
          <p className="text-[11px] text-slate-500 mt-1">{parties.length} no total ({parties.filter((p) => p.name.includes('[DEMO]')).length} DEMO)</p>
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
                <th className="text-left px-4 py-2">Partido</th>
                <th className="text-left px-4 py-2">Plano</th>
                <th className="text-left px-4 py-2">Cobrança (billingNote)</th>
                <th className="text-right px-4 py-2">Cands</th>
                <th className="text-right px-4 py-2">Recebido</th>
                <th className="text-right px-4 py-2">Alocado</th>
                <th className="text-left px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="text-center text-slate-500 py-6 text-xs">Carregando…</td></tr>
              )}
              {!loading && parties.length === 0 && (
                <tr><td colSpan={7} className="text-center text-slate-500 py-6 text-xs">Nenhum partido contratado ainda.</td></tr>
              )}
              {parties.map((p) => (
                <tr key={p.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-white">{p.name}</p>
                    <p className="text-[10px] text-slate-500">criado {new Date(p.createdAt).toLocaleDateString('pt-BR')}</p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-300">{p.plan || '—'}</td>
                  <td className="px-4 py-2.5">
                    {editingId === p.id ? (
                      <div className="flex gap-1">
                        <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
                          placeholder='Ex.: "Plano Partido — R$ 2.500/mês"'
                          className="flex-1 bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-white text-xs" />
                        <button onClick={() => saveEdit(p.id)} disabled={saving}
                          className="text-xs px-2 py-1 rounded-lg bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30">✓</button>
                        <button onClick={cancelEdit}
                          className="text-xs px-2 py-1 rounded-lg bg-white/5 text-slate-400 hover:bg-white/10">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(p)} className="text-left text-slate-300 hover:text-white text-xs">
                        {p.billingNote || <span className="italic text-slate-500">— clique para definir</span>}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-300">{p.candidatesCount}</td>
                  <td className="px-4 py-2.5 text-right text-slate-300">{fmtBRL(p.valorRecebido)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-300">{fmtBRL(p.valorAlocado)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${p.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-400'}`}>{p.status || '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-600 px-4 py-2 border-t border-white/5">
          Cobrança do Plano Partido acontece HOJE FORA do Asaas (manual). Esta tela é só para sua visão financeira interna — nenhum candidato/presidente vê valor.
        </p>
      </Card>
    </div>
  );
};

export default PartiesTab;
