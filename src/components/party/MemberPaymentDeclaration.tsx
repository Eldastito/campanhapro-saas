/**
 * Declaração de recebimento do membro (#150).
 *
 * O membro (Coordenador/Líder/Apoiador) vê quanto quem o convidou DECLAROU
 * pagar a ele e declara, do lado dele, quanto REALMENTE recebeu + a data.
 * Os dois lados ficam registrados pra conferência (candidato declara o que
 * paga; membro declara o que recebe).
 */
import * as React from 'react';
import { Wallet, Loader2, CheckCircle2 } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

const brl = (n: number | null) => (n && n > 0 ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');

const MemberPaymentDeclaration: React.FC = () => {
  const [loading, setLoading] = React.useState(true);
  const [payment, setPayment] = React.useState<any>(null);
  const [valor, setValor] = React.useState('');
  const [data, setData] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [ok, setOk] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const r = await authedFetch('/api/v1/party/member/payment');
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.payment) {
        setPayment(j.payment);
        if (j.payment.valorRecebido) setValor(String(j.payment.valorRecebido));
        if (j.payment.dataRecebido) setData(j.payment.dataRecebido);
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const salvar = async () => {
    setSaving(true); setOk(false);
    try {
      const r = await authedFetch('/api/v1/party/member/payment', {
        method: 'PATCH', body: JSON.stringify({ valorRecebido: valor, dataRecebido: data }),
      });
      if (r.ok) { setOk(true); await load(); setTimeout(() => setOk(false), 2000); }
    } finally { setSaving(false); }
  };

  if (loading || !payment) return null; // só aparece se o membro tem vínculo

  return (
    <div className="bg-[#1c2128] border border-white/5 rounded-3xl p-5 mb-6">
      <p className="font-bold flex items-center gap-2 mb-1"><Wallet className="w-5 h-5 text-amber-300" /> Meu pagamento</p>
      <p className="text-xs text-slate-400 mb-3">
        Quem te cadastrou declarou pagar <b className="text-white">{brl(payment.valorPago)}</b>
        {payment.dataPago ? ` em ${new Date(payment.dataPago + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}.
        Confirme abaixo quanto você <b>realmente recebeu</b> e quando.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_auto] gap-2">
        <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Valor recebido (R$)" inputMode="decimal" className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
        <input value={data} onChange={(e) => setData(e.target.value)} type="date" className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
        <button onClick={salvar} disabled={saving} className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-xl px-4 py-2 font-bold flex items-center justify-center gap-2 text-sm">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : ok ? <CheckCircle2 className="w-4 h-4" /> : null} {ok ? 'Salvo' : 'Confirmar'}
        </button>
      </div>
    </div>
  );
};

export default MemberPaymentDeclaration;
