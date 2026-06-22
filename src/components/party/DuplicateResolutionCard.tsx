/**
 * Card de resolução de duplicatas do import IA (#137).
 *
 * A IA NÃO corta duplicatas sozinha — apenas detecta grupos e pergunta ao
 * presidente o que fazer com cada um. Três ações por grupo:
 *  - Unificar: soma valores, junta campos não-vazios em uma linha só.
 *  - Manter todos: todas as linhas viram cadastros separados.
 *  - Manter só um: usuário escolhe qual linha do grupo manter; demais somem.
 *
 * Depois que o usuário decide, a opção escolhida fica exibida no próprio
 * grupo (transparência: ele vê o que foi feito antes de continuar).
 */
import React from 'react';
import { AlertTriangle, Merge, Users, Check, X } from 'lucide-react';

export type DupReason = 'identical' | 'name_city_state_phone' | 'name_city' | 'phone_diff_name';

export interface DupRow {
  displayName: string;
  cargo: string;
  regiao: string;
  estado: string;
  phone: string;
  valor: string;
  data: string;
}
export interface DupGroup { reason: DupReason; indexes: number[] }
export type Decision = { action: 'unify' | 'keep_all' | 'keep_one'; keepIdx?: number; outcomeText?: string };

const brl = (v: string | number) => {
  const n = typeof v === 'number' ? v : parseFloat(v || '0');
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const REASON_LABELS: Record<DupReason, { title: string; tone: 'rose' | 'amber' | 'sky' | 'fuchsia'; hint: string }> = {
  identical: {
    title: 'Linha 100% idêntica',
    tone: 'rose',
    hint: 'Todos os campos batem — quase certo que é o mesmo registro duplicado.',
  },
  name_city_state_phone: {
    title: 'Mesmo nome, cidade, UF e telefone',
    tone: 'rose',
    hint: 'Mesma pessoa com altíssima confiança — é raro coincidir nesses 4 campos.',
  },
  name_city: {
    title: 'Mesmo nome e cidade',
    tone: 'amber',
    hint: 'Pode ser a mesma pessoa com lançamentos distintos OU homônimos da mesma cidade.',
  },
  phone_diff_name: {
    title: 'Mesmo telefone, nomes diferentes',
    tone: 'sky',
    hint: 'Pode ser apelido (Hulk vs Hulk da Selva) ou telefone compartilhado em família.',
  },
};

const TONE_CLS: Record<'rose' | 'amber' | 'sky' | 'fuchsia', { border: string; text: string; bg: string }> = {
  rose:    { border: 'border-rose-500/40',    text: 'text-rose-300',    bg: 'bg-rose-500/10' },
  amber:   { border: 'border-amber-500/40',   text: 'text-amber-300',   bg: 'bg-amber-500/10' },
  sky:     { border: 'border-sky-500/40',     text: 'text-sky-300',     bg: 'bg-sky-500/10' },
  fuchsia: { border: 'border-fuchsia-500/40', text: 'text-fuchsia-300', bg: 'bg-fuchsia-500/10' },
};

interface Props {
  groups: DupGroup[];
  decisions: Record<number, Decision>;
  rows: DupRow[];
  onDecide: (groupIdx: number, decision: Decision) => void;
  onContinue: () => void;
}

const DuplicateResolutionCard: React.FC<Props> = ({ groups, decisions, rows, onDecide, onContinue }) => {
  const [expandedKeep, setExpandedKeep] = React.useState<number | null>(null);
  const allDecided = groups.every((_, i) => !!decisions[i]);

  // Cargos divergentes dentro de um grupo? Por lei eleitoral, ninguém concorre
  // a 2 cargos — então "Unificar" não faz sentido (são pessoas diferentes).
  const cargosDivergent = (g: DupGroup): boolean => {
    const cargos = new Set(g.indexes.map((i) => rows[i].cargo).filter((c) => c));
    return cargos.size > 1;
  };

  const describeOutcome = (g: DupGroup, dec: Decision): string => {
    if (dec.action === 'keep_all') return `Mantido ${g.indexes.length} cadastros separados.`;
    if (dec.action === 'keep_one') {
      const keep = dec.keepIdx ?? g.indexes[0];
      const r = rows[keep];
      return `Mantido apenas: ${r.displayName}${r.regiao ? ` · ${r.regiao}` : ''}${r.valor ? ` · ${brl(r.valor)}` : ''}. Demais (${g.indexes.length - 1}) descartados.`;
    }
    const valores = g.indexes.map((i) => parseFloat(rows[i].valor || '0')).filter((v) => v > 0);
    const soma = valores.reduce((a, b) => a + b, 0);
    return `Unificado em 1 cadastro. Valores ${valores.map((v) => brl(v)).join(' + ')} = ${brl(soma)}.`;
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-slate-900 border border-amber-500/30 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-white/10">
          <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-white">A IA encontrou {groups.length} grupo{groups.length > 1 ? 's' : ''} de duplicatas</h4>
            <p className="text-xs text-slate-400 mt-0.5">Eu não corto nada sozinha — você decide o que fazer com cada grupo abaixo.</p>
          </div>
        </div>

        {/* Lista de grupos */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {groups.map((g, gi) => {
            const meta = REASON_LABELS[g.reason];
            const tone = TONE_CLS[meta.tone];
            const dec = decisions[gi];
            return (
              <div key={gi} className={`rounded-xl border ${tone.border} ${tone.bg} p-3`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] uppercase tracking-wider font-bold ${tone.text}`}>{meta.title}</span>
                  <span className="text-[10px] text-slate-500">· {g.indexes.length} linhas</span>
                </div>
                <p className="text-[11px] text-slate-400 mb-2">{meta.hint}</p>

                {/* Linhas do grupo */}
                <div className="space-y-1.5">
                  {g.indexes.map((rowIdx) => {
                    const r = rows[rowIdx];
                    const isKeepCandidate = expandedKeep === gi;
                    const isSelected = dec?.action === 'keep_one' && dec.keepIdx === rowIdx;
                    return (
                      <div key={rowIdx}
                        className={`bg-slate-950 border rounded-lg px-2.5 py-1.5 text-xs flex items-center gap-2 ${isSelected ? 'border-emerald-500' : 'border-white/10'}`}>
                        <span className="text-slate-500 font-mono text-[10px]">#{rowIdx + 1}</span>
                        <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                          <span className="text-white font-bold col-span-2">{r.displayName}</span>
                          {(r.regiao || r.estado) && <span className="text-slate-400">{[r.regiao, r.estado].filter(Boolean).join('/')}</span>}
                          {r.cargo && <span className="text-slate-400">{r.cargo}</span>}
                          {r.phone && <span className="text-slate-400">📱 {r.phone}</span>}
                          {r.valor && <span className="text-emerald-300 font-bold">{brl(r.valor)}</span>}
                          {r.data && <span className="text-slate-400">📅 {r.data}</span>}
                        </div>
                        {isKeepCandidate && !dec && (
                          <button onClick={() => { onDecide(gi, { action: 'keep_one', keepIdx: rowIdx }); setExpandedKeep(null); }}
                            className="text-[10px] bg-emerald-600 hover:bg-emerald-500 rounded px-2 py-1 font-bold text-white">Manter esta</button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Outcome ou ações */}
                {dec ? (
                  <div className="mt-3 flex items-start gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-xs text-emerald-200 font-bold leading-tight">{describeOutcome(g, dec)}</p>
                      <button onClick={() => { setExpandedKeep(null); onDecide(gi, undefined as any); }}
                        className="text-[10px] text-slate-400 hover:text-white underline mt-1">Mudar decisão</button>
                    </div>
                  </div>
                ) : expandedKeep === gi ? (
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-amber-300">
                    <span>👆 Toque em "Manter esta" na linha que você quer preservar.</span>
                    <button onClick={() => setExpandedKeep(null)} className="text-slate-400 hover:text-white underline">Cancelar</button>
                  </div>
                ) : (
                  <>
                    {cargosDivergent(g) && (
                      <p className="text-[10px] text-rose-300 mt-2">⚠️ Cargos divergem — por lei eleitoral, são pessoas diferentes. Unificar fica indisponível.</p>
                    )}
                    <div className="mt-3 grid grid-cols-3 gap-1.5">
                      <button onClick={() => onDecide(gi, { action: 'unify' })} disabled={cargosDivergent(g)}
                        title={cargosDivergent(g) ? 'Cargos divergem — não é a mesma pessoa' : ''}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg px-2 py-2 text-[11px] font-bold text-white flex items-center justify-center gap-1">
                        <Merge className="w-3.5 h-3.5" /> Unificar
                      </button>
                      <button onClick={() => onDecide(gi, { action: 'keep_all' })}
                        className="bg-slate-700 hover:bg-slate-600 rounded-lg px-2 py-2 text-[11px] font-bold text-white flex items-center justify-center gap-1">
                        <Users className="w-3.5 h-3.5" /> Manter todos
                      </button>
                      <button onClick={() => setExpandedKeep(gi)}
                        className="bg-rose-600/80 hover:bg-rose-600 rounded-lg px-2 py-2 text-[11px] font-bold text-white flex items-center justify-center gap-1">
                        <X className="w-3.5 h-3.5" /> Manter só 1
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 flex items-center gap-3">
          <p className="text-[11px] text-slate-400 flex-1">
            {allDecided ? '✅ Todos os grupos resolvidos.' : `Decida ${groups.length - Object.keys(decisions).length} grupo(s) restante(s) para continuar.`}
          </p>
          <button onClick={onContinue} disabled={!allDecided}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl px-5 py-2.5 font-bold text-white text-sm">
            Continuar para preview
          </button>
        </div>
      </div>
    </div>
  );
};

export default DuplicateResolutionCard;
