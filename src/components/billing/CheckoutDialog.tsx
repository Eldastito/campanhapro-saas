import * as React from 'react';
import { X, Loader2, CreditCard, QrCode, Receipt } from 'lucide-react';
import Button from '../ui/Button';

interface Props {
  open: boolean;
  planName: string;
  monthlyCents: number;
  onClose: () => void;
  onSubmit: (params: {
    name: string;
    email: string;
    cpfCnpj?: string;
    phone?: string;
    method: 'pix' | 'credit_card' | 'debit_card' | 'boleto' | 'undefined';
  }) => Promise<void>;
}

const METHODS: Array<{
  id: 'pix' | 'credit_card' | 'debit_card' | 'boleto' | 'undefined';
  label: string;
  icon: React.ReactNode;
  hint: string;
}> = [
  { id: 'pix', label: 'PIX', icon: <QrCode className="w-4 h-4" />, hint: 'Aprovação imediata · taxa menor' },
  { id: 'credit_card', label: 'Cartão de crédito', icon: <CreditCard className="w-4 h-4" />, hint: 'Recorrente · pode parcelar' },
  { id: 'boleto', label: 'Boleto', icon: <Receipt className="w-4 h-4" />, hint: 'Compensação em até 3 dias úteis' },
  { id: 'undefined', label: 'Escolher no checkout', icon: <CreditCard className="w-4 h-4" />, hint: 'Cliente decide na próxima tela' },
];

const formatBRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const CheckoutDialog: React.FC<Props> = ({ open, planName, monthlyCents, onClose, onSubmit }) => {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [cpfCnpj, setCpfCnpj] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [method, setMethod] = React.useState<'pix' | 'credit_card' | 'debit_card' | 'boleto' | 'undefined'>('pix');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError('Nome e email são obrigatórios');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        email: email.trim(),
        cpfCnpj: cpfCnpj.trim() || undefined,
        phone: phone.trim() || undefined,
        method,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-100">Assinar {planName}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{formatBRL(monthlyCents)} / mês · pagamento via Asaas</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Nome completo *</label>
            <input
              className="w-full text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">Email *</label>
            <input
              type="email"
              className="w-full text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">CPF/CNPJ</label>
              <input
                className="w-full text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                value={cpfCnpj}
                onChange={e => setCpfCnpj(e.target.value)}
                placeholder="opcional"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Telefone</label>
              <input
                className="w-full text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="opcional"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">Forma de pagamento</label>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map(m => (
                <label
                  key={m.id}
                  className={`cursor-pointer border rounded-lg px-3 py-2 transition-colors ${
                    method === m.id
                      ? 'border-indigo-500/60 bg-indigo-500/10'
                      : 'border-slate-700 hover:border-slate-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="method"
                    value={m.id}
                    checked={method === m.id}
                    onChange={() => setMethod(m.id)}
                    className="sr-only"
                  />
                  <div className="flex items-center gap-1.5 text-sm font-medium text-slate-200">
                    {m.icon} {m.label}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">{m.hint}</p>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">{error}</p>
          )}

          <p className="text-[10px] text-slate-500">
            Pagamento processado pela Asaas. Você será redirecionado para a tela de pagamento segura.
          </p>

          <Button
            variant="primary"
            type="submit"
            className="w-full"
            disabled={submitting}
          >
            {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processando...</> : 'Prosseguir'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default CheckoutDialog;
