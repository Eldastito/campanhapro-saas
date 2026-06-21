import * as React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { authedFetch } from '../../lib/authedFetch';
import { riskBadge } from './risk';

const KINDS: Array<{ value: string; label: string }> = [
  { value: 'donation', label: 'Doação' },
  { value: 'expense', label: 'Despesa' },
  { value: 'transaction', label: 'Transação' },
  { value: 'contract', label: 'Contrato' },
  { value: 'accounts_rendering', label: 'Prestação de contas' },
  { value: 'free_query', label: 'Consulta livre' },
];

const ReviewForm: React.FC<{ onCreated?: () => void }> = ({ onCreated }) => {
  const [kind, setKind] = React.useState('donation');
  const [description, setDescription] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<any | null>(null);

  const submit = async () => {
    if (!description.trim()) { setError('Descreva o que analisar.'); return; }
    setRunning(true); setError(null); setResult(null);
    try {
      const r = await authedFetch('/api/v1/legal-shield/review', {
        method: 'POST',
        body: JSON.stringify({ kind, description }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.detail || json.error || 'Falha na análise');
      setResult(json);
      onCreated?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const b = result ? riskBadge(result.riskHint) : null;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Tipo de análise</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
          >
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Descrição</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Ex.: Recebemos doação de R$ 5.000 de pessoa física que é sócia de empresa com contrato com a prefeitura. Pode?"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <Button onClick={submit} disabled={running}>
          {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Analisando…</> : <><Sparkles className="w-4 h-4" /> Rodar análise</>}
        </Button>
        <p className="text-[11px] text-slate-500">
          A análise roda o Auditor Contábil e o Assessor Jurídico sobre a base de regras do TSE. Consome orçamento de IA.
        </p>
      </Card>

      {result && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-200">Resultado</h4>
            {b && <span className={`px-2 py-1 rounded-full text-xs border ${b.cls}`}>Risco {b.label}</span>}
          </div>
          <div>
            <p className="text-xs font-semibold text-teal-300 mb-1">Achados Contábeis</p>
            <p className="text-sm text-slate-300 whitespace-pre-wrap">{result.accounting?.text}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-indigo-300 mb-1">Parecer Jurídico</p>
            <p className="text-sm text-slate-300 whitespace-pre-wrap">{result.legal?.text}</p>
          </div>
          <p className="text-[11px] text-slate-500 italic border-t border-slate-800 pt-2">{result.disclaimer}</p>
        </Card>
      )}
    </div>
  );
};

export default ReviewForm;
