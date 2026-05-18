import * as React from 'react';
import { Sparkles, Check, X, Loader2, AlertTriangle, TrendingUp } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { authedFetch } from '../../lib/authedFetch';
import { useAuth } from '../../contexts/AuthContext';

type Bucket = 'recursos' | 'financeiro' | 'material' | 'pessoal' | 'redes_sociais' | 'outros' | 'reserva';
type AllocStatus = 'proposed' | 'approved' | 'active' | 'rejected' | 'superseded';

interface BucketSummary {
  bucket: Bucket;
  spentCents: number;
  allocatedCents: number;
}

interface BudgetSummary {
  totalBudgetCents: number;
  totalSpentCents: number;
  totalAllocatedCents: number;
  remainingCents: number;
  unallocatedCents: number;
  electionDate: string | null;
  daysUntilElection: number | null;
  buckets: BucketSummary[];
}

interface Allocation {
  id: string;
  bucket: Bucket;
  allocatedCents: number;
  rationale: string | null;
  status: AllocStatus;
  createdByAgentId: string | null;
  approvedAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const BUCKET_LABEL: Record<Bucket, string> = {
  recursos: 'Recursos',
  financeiro: 'Financeiro',
  material: 'Material',
  pessoal: 'Pessoal',
  redes_sociais: 'Redes Sociais',
  outros: 'Outros',
  reserva: 'Reserva',
};

const BUCKET_COLOR: Record<Bucket, string> = {
  recursos: 'bg-cyan-500',
  financeiro: 'bg-indigo-500',
  material: 'bg-amber-500',
  pessoal: 'bg-emerald-500',
  redes_sociais: 'bg-fuchsia-500',
  outros: 'bg-slate-500',
  reserva: 'bg-rose-500',
};

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const BudgetCEOPanel: React.FC = () => {
  const { user } = useAuth();
  const [summary, setSummary] = React.useState<BudgetSummary | null>(null);
  const [proposed, setProposed] = React.useState<Allocation[]>([]);
  const [active, setActive] = React.useState<Allocation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [actingId, setActingId] = React.useState<string | null>(null);
  const [ceoSummary, setCeoSummary] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!user?.campaignId) return;
    setLoading(true);
    try {
      const [sRes, pRes, aRes] = await Promise.all([
        authedFetch(`/api/v1/budget/summary?campaignId=${user.campaignId}`),
        authedFetch(`/api/v1/budget/allocations?campaignId=${user.campaignId}&status=proposed`),
        authedFetch(`/api/v1/budget/allocations?campaignId=${user.campaignId}&status=approved`),
      ]);
      const [sJ, pJ, aJ] = await Promise.all([sRes.json(), pRes.json(), aRes.json()]);
      setSummary(sJ);
      setProposed(pJ.allocations ?? []);
      setActive(aJ.allocations ?? []);
      // Inherit CEO's most recent summary if any proposals carry one
      const latest = (pJ.allocations ?? [])[0];
      const inheritedSummary = latest?.metadata?.summary as string | undefined;
      if (inheritedSummary) setCeoSummary(inheritedSummary);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user?.campaignId]);

  React.useEffect(() => { load(); }, [load]);

  const generatePlan = async () => {
    if (!user?.campaignId || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await authedFetch('/api/v1/budget/ceo-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: user.campaignId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao gerar plano');
      setCeoSummary(json.summary ?? null);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const approve = async (id: string) => {
    setActingId(id);
    try {
      await authedFetch(`/api/v1/budget/allocations/${id}/approve`, { method: 'PATCH' });
      await load();
    } finally {
      setActingId(null);
    }
  };

  const reject = async (id: string) => {
    setActingId(id);
    try {
      await authedFetch(`/api/v1/budget/allocations/${id}/reject`, { method: 'PATCH' });
      await load();
    } finally {
      setActingId(null);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-slate-500 animate-spin" /></div>;
  }

  if (!summary || !Array.isArray(summary.buckets) || summary.totalBudgetCents <= 0) {
    return (
      <Card>
        <div className="text-center py-10 space-y-2">
          <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
          <p className="text-slate-300 font-medium">Orçamento da campanha não definido</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Configure o orçamento total da campanha em <strong>Configurações → Dados da Campanha → Orçamento</strong>.
            O CEO precisa desse valor para propor alocações.
          </p>
        </div>
      </Card>
    );
  }

  const burnPct = summary.totalBudgetCents > 0
    ? (summary.totalSpentCents / summary.totalBudgetCents) * 100
    : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-5 h-5 text-fuchsia-400" />
              <h3 className="text-lg font-semibold text-slate-200">CEO de Campanha</h3>
            </div>
            <p className="text-xs text-slate-500 max-w-xl">
              O CEO analisa orçamento, despesas e dias para a eleição, e propõe a melhor
              alocação entre recursos, pessoal, material, financeiro e redes sociais.
              Toda proposta requer aprovação humana antes de virar diretriz oficial.
            </p>
          </div>
          <Button
            variant="primary"
            className="bg-gradient-to-r from-fuchsia-600 to-violet-600 border-none whitespace-nowrap"
            onClick={generatePlan}
            disabled={generating}
          >
            {generating
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analisando...</>
              : <><Sparkles className="w-4 h-4 mr-2" />Gerar Plano do CEO</>
            }
          </Button>
        </div>

        {/* Top stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
            <p className="text-xs text-slate-500">Orçamento total</p>
            <p className="text-base font-bold text-slate-200 mt-0.5">{brl(summary.totalBudgetCents)}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
            <p className="text-xs text-slate-500">Gasto</p>
            <p className="text-base font-bold text-amber-400 mt-0.5">{brl(summary.totalSpentCents)}</p>
            <p className="text-xs text-slate-500">{burnPct.toFixed(1)}% do total</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
            <p className="text-xs text-slate-500">Restante</p>
            <p className="text-base font-bold text-emerald-400 mt-0.5">{brl(summary.remainingCents)}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
            <p className="text-xs text-slate-500">Eleição</p>
            <p className="text-base font-bold text-slate-200 mt-0.5">
              {summary.daysUntilElection != null ? `${summary.daysUntilElection} dias` : '—'}
            </p>
            {summary.electionDate && <p className="text-xs text-slate-500">{summary.electionDate}</p>}
          </div>
        </div>

        {/* Stacked bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Distribuição (gasto + alocado)</span>
            <span>{brl(summary.totalSpentCents + summary.totalAllocatedCents)} / {brl(summary.totalBudgetCents)}</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden flex bg-slate-700/60">
            {summary.buckets.map(b => {
              const total = b.spentCents + b.allocatedCents;
              const pct = summary.totalBudgetCents > 0 ? (total / summary.totalBudgetCents) * 100 : 0;
              if (pct <= 0) return null;
              return (
                <div
                  key={b.bucket}
                  className={BUCKET_COLOR[b.bucket]}
                  style={{ width: `${pct}%` }}
                  title={`${BUCKET_LABEL[b.bucket]}: ${brl(total)} (${pct.toFixed(1)}%)`}
                />
              );
            })}
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-2 mt-3">{error}</p>
        )}
      </Card>

      {/* CEO Summary */}
      {ceoSummary && (
        <Card>
          <div className="flex items-start gap-3">
            <TrendingUp className="w-4 h-4 text-fuchsia-400 flex-shrink-0 mt-1" />
            <div>
              <p className="text-xs font-semibold text-fuchsia-400 uppercase tracking-wide mb-1">Resumo Executivo</p>
              <p className="text-sm text-slate-300">{ceoSummary}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Proposed allocations awaiting approval */}
      {proposed.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-300">Aguardando Aprovação ({proposed.length})</h3>
            <p className="text-xs text-amber-400">Nenhum recurso é alocado até você aprovar.</p>
          </div>
          <div className="space-y-2">
            {proposed.map(a => (
              <div key={a.id} className="flex items-start gap-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
                <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${BUCKET_COLOR[a.bucket]}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200">{BUCKET_LABEL[a.bucket]}</span>
                    <span className="text-sm font-bold text-slate-100">{brl(a.allocatedCents)}</span>
                    <span className="text-xs text-slate-500">· CEO</span>
                  </div>
                  {a.rationale && <p className="text-xs text-slate-400 mt-1">{a.rationale}</p>}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => approve(a.id)}
                    disabled={actingId === a.id}
                    title="Aprovar"
                    className="p-1.5 rounded text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40"
                  >
                    {actingId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => reject(a.id)}
                    disabled={actingId === a.id}
                    title="Rejeitar"
                    className="p-1.5 rounded text-red-400 hover:bg-red-500/20 disabled:opacity-40"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Active allocations + per-bucket usage */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3">Alocação Ativa por Bucket</h3>
        <div className="space-y-3">
          {summary.buckets.map(b => {
            const totalBucket = b.spentCents + b.allocatedCents;
            const pct = totalBucket > 0 && summary.totalBudgetCents > 0
              ? (totalBucket / summary.totalBudgetCents) * 100 : 0;
            const overSpent = b.allocatedCents > 0 && b.spentCents > b.allocatedCents;
            return (
              <div key={b.bucket}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${BUCKET_COLOR[b.bucket]}`} />
                    <span className="text-sm text-slate-200">{BUCKET_LABEL[b.bucket]}</span>
                    {overSpent && <span className="text-xs text-red-400">⚠ acima da alocação</span>}
                  </div>
                  <div className="text-xs text-slate-400">
                    <span className="text-amber-400">{brl(b.spentCents)} gasto</span>
                    {' · '}
                    <span className="text-emerald-400">{brl(b.allocatedCents)} alocado</span>
                    {' · '}
                    <span>{pct.toFixed(1)}%</span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden flex">
                  <div className={`${BUCKET_COLOR[b.bucket]} opacity-80`} style={{ width: `${Math.min(100, summary.totalBudgetCents > 0 ? (b.spentCents / summary.totalBudgetCents) * 100 : 0)}%` }} />
                  <div className={`${BUCKET_COLOR[b.bucket]} opacity-30`} style={{ width: `${Math.min(100, summary.totalBudgetCents > 0 ? (b.allocatedCents / summary.totalBudgetCents) * 100 : 0)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        {active.length === 0 && (
          <p className="text-xs text-slate-500 mt-3 italic">
            Nenhuma alocação aprovada. Gere o plano do CEO e aprove para registrar diretrizes.
          </p>
        )}
      </Card>
    </div>
  );
};

export default BudgetCEOPanel;
