import * as React from 'react';
import { Loader2, Landmark, Save, Gift, BadgeCheck } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { authedFetch } from '../../lib/authedFetch';

/**
 * Painel do plano do app Partido (Supreme Control). Mostra/edita o preço base
 * (R$/mês) e lista os partidos com o status de cobrança, permitindo marcar um
 * partido como "Cortesia" (acesso mantido, sem cobrança — controle financeiro
 * interno, invisível pro usuário). Não bloqueia acesso (enforcement é futuro).
 */
interface PartyRow {
  partyId: string;
  name: string;
  presidentEmail: string | null;
  presidentName: string | null;
  billing: { status: string; amountCents: number; courtesy: boolean; note: string | null; provider: string } | null;
}

const PartyBillingPanel: React.FC = () => {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [acting, setActing] = React.useState<string | null>(null);
  const [priceReais, setPriceReais] = React.useState('');
  const [parties, setParties] = React.useState<PartyRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await authedFetch('/api/v1/supreme/party-billing');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setPriceReais(((data.price?.monthlyCents ?? 0) / 100).toString());
      setParties(data.parties ?? []);
    } catch (e: any) {
      setError(e.message || 'Falha ao carregar.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const savePrice = async () => {
    const cents = Math.round(parseFloat(priceReais.replace(',', '.')) * 100);
    if (!Number.isInteger(cents) || cents < 0) { setError('Valor inválido.'); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await authedFetch('/api/v1/supreme/party-billing/price', {
        method: 'PUT', body: JSON.stringify({ monthlyCents: cents }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e: any) {
      setError(e.message || 'Falha ao salvar preço.');
    } finally {
      setSaving(false);
    }
  };

  const toggleCourtesy = async (p: PartyRow) => {
    const makeCourtesy = !p.billing?.courtesy;
    let note: string | null = null;
    if (makeCourtesy) {
      note = window.prompt('Motivo da cortesia (controle interno, opcional):', p.billing?.note || '') || null;
    }
    setActing(p.partyId);
    setError(null);
    try {
      const r = await authedFetch(`/api/v1/supreme/party-billing/${p.partyId}/courtesy`, {
        method: 'POST', body: JSON.stringify({ courtesy: makeCourtesy, note }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e: any) {
      setError(e.message || 'Falha ao atualizar cortesia.');
    } finally {
      setActing(null);
    }
  };

  const statusBadge = (p: PartyRow) => {
    const b = p.billing;
    if (b?.courtesy) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300">Cortesia (gratuito)</span>;
    if (!b) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-400">Sem cobrança</span>;
    const map: Record<string, string> = {
      active: 'bg-emerald-500/15 text-emerald-300',
      pending_payment: 'bg-amber-500/15 text-amber-300',
      past_due: 'bg-red-500/15 text-red-300',
      canceled: 'bg-slate-500/15 text-slate-400',
    };
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${map[b.status] || 'bg-slate-500/15 text-slate-400'}`}>{b.status}</span>;
  };

  return (
    <Card className="bg-slate-900 border-white/5 p-6 space-y-4">
      <div className="flex items-center gap-3 border-b border-white/5 pb-4">
        <Landmark className="w-6 h-6 text-indigo-400" />
        <h3 className="font-bold text-white uppercase tracking-widest text-sm">Plano do App Partido</h3>
        <span className="text-[10px] text-slate-500">{parties.length} partido(s)</span>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed">
        Assinatura mensal recorrente do app Partido (produto próprio, separado dos planos de campanha). Marque um partido como <strong className="text-violet-300">Cortesia</strong> para manter o acesso sem cobrança — visível só aqui, para controle financeiro.
      </p>

      {/* Preço base */}
      <div className="flex items-end gap-3">
        <label className="text-xs text-slate-300">
          Preço mensal (R$)
          <input
            type="number" step="0.01" min="0"
            value={priceReais} onChange={(e) => setPriceReais(e.target.value)}
            className="mt-1 block w-40 bg-slate-950 border border-white/10 rounded-md py-2 px-3 text-sm text-white"
          />
        </label>
        <Button onClick={savePrice} disabled={saving} className="bg-indigo-600 hover:bg-indigo-500 flex items-center gap-2 h-9 text-xs">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar preço
        </Button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Lista de partidos */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</div>
      ) : parties.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhum partido cadastrado ainda.</p>
      ) : (
        <div className="space-y-2">
          {parties.map((p) => (
            <div key={p.partyId} className="flex items-center justify-between gap-3 p-3 bg-slate-950 rounded-lg border border-white/5">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">{p.name || '(sem nome)'}</p>
                <p className="text-[11px] text-slate-500 truncate">{p.presidentName || '—'} · {p.presidentEmail || 'sem e-mail'}</p>
                {p.billing?.courtesy && p.billing?.note && (
                  <p className="text-[10px] text-violet-300/70 mt-0.5">Nota: {p.billing.note}</p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {statusBadge(p)}
                <Button
                  onClick={() => toggleCourtesy(p)}
                  disabled={acting === p.partyId}
                  className={`h-8 text-[11px] flex items-center gap-1.5 ${p.billing?.courtesy ? 'bg-slate-700 hover:bg-slate-600' : 'bg-violet-600 hover:bg-violet-500'}`}
                >
                  {acting === p.partyId ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : p.billing?.courtesy ? <BadgeCheck className="w-3.5 h-3.5" /> : <Gift className="w-3.5 h-3.5" />}
                  {p.billing?.courtesy ? 'Remover cortesia' : 'Marcar cortesia'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export default PartyBillingPanel;
