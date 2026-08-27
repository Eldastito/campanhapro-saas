/**
 * Pulso Digital §53-§59 do PRD Social Intelligence.
 *
 * Feed de signals produzidos pelo pipeline (PRs 9-22): consome
 * GET /api/v1/social/signals + assina o canal Broadcast
 * `campaign:<campaignId>:social_signals` para atualizações realtime.
 *
 * REGRA §42 aplicada na UI: hypotheses aparecem em bloco separado do
 * `summary` factual, com label "Hipóteses (não afirmação)". Nunca fundir.
 *
 * REGRA §45 aplicada: quando o feed vem vazio, mostramos "coletando dados"
 * — jamais inventamos sinal. Loading state distinto de "sem dados".
 */
import * as React from 'react';
import { authedFetch } from '../lib/authedFetch';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import Card from '../components/ui/Card';
import PulsoSignalCard from '../components/social/PulsoSignalCard';
import PulsoSignalDetailsModal from '../components/social/PulsoSignalDetailsModal';
import PulsoSummaryHeader from '../components/social/PulsoSummaryHeader';
import PulsoNotifierAdminCard from '../components/social/PulsoNotifierAdminCard';
import { PULSO_PRESETS, findMatchingPreset, FilterPreset } from '../components/social/pulsoPresets';
import {
  StoredSocialSignal,
  BroadcastSocialSignal,
  SocialSignalSeverity,
  SocialSignalSource,
  SocialProvider,
  SocialTopic,
  SEVERITY_ORDER,
  SEVERITY_LABELS,
  SOURCE_LABELS,
  PROVIDER_LABELS,
  TOPIC_LABELS,
  SOCIAL_TOPICS,
  SOCIAL_PROVIDERS,
  broadcastToStored,
} from '../components/social/pulsoTypes';

const SEVERITIES: SocialSignalSeverity[] = ['info', 'attention', 'risk', 'crisis'];
const SOURCES: SocialSignalSource[] = ['trend', 'anomaly', 'cross_network_trend', 'cross_network_anomaly'];

interface FiltersState {
  minSeverity: SocialSignalSeverity | '';
  source: SocialSignalSource | '';
  topic: SocialTopic | '';
  provider: SocialProvider | '';
  search: string;
  /** ISO string ou vazio — passa como ?since= pro server. */
  since: string;
}

const INITIAL_FILTERS: FiltersState = {
  minSeverity: '',
  source: '',
  topic: '',
  provider: '',
  search: '',
  since: '',
};

function buildQuery(f: FiltersState): string {
  const params = new URLSearchParams();
  if (f.minSeverity) params.set('minSeverity', f.minSeverity);
  if (f.source) params.set('source', f.source);
  if (f.topic) params.set('topic', f.topic);
  if (f.provider) params.set('provider', f.provider);
  const trimmedSearch = f.search.trim();
  if (trimmedSearch) params.set('search', trimmedSearch);
  if (f.since) params.set('since', f.since);
  params.set('limit', '100');
  return params.toString();
}

/** Dedup + sort estável — mesma regra do bus: severity DESC → confidence DESC → emittedAt DESC. */
function mergeAndSort(existing: StoredSocialSignal[], incoming: StoredSocialSignal[]): StoredSocialSignal[] {
  const map = new Map<string, StoredSocialSignal>();
  for (const s of existing) map.set(s.dedupKey, s);
  for (const s of incoming) {
    const cur = map.get(s.dedupKey);
    // Broadcast overrides stored quando dedupKey igual (updated=recente)
    if (!cur || SEVERITY_ORDER[s.severity] > SEVERITY_ORDER[cur.severity]) {
      map.set(s.dedupKey, s);
    } else if (SEVERITY_ORDER[s.severity] === SEVERITY_ORDER[cur.severity]
      && new Date(s.emittedAt) >= new Date(cur.emittedAt)) {
      map.set(s.dedupKey, s);
    }
  }
  return [...map.values()].sort((a, b) => {
    const sev = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (sev !== 0) return sev;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return new Date(b.emittedAt).getTime() - new Date(a.emittedAt).getTime();
  });
}

const PulsoDigitalPage: React.FC = () => {
  const { user } = useAuth();
  const campaignId = user?.campaignId;

  const [filters, setFilters] = React.useState<FiltersState>(INITIAL_FILTERS);
  const [signals, setSignals] = React.useState<StoredSocialSignal[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [liveCount, setLiveCount] = React.useState(0);
  const [selectedSignal, setSelectedSignal] = React.useState<StoredSocialSignal | null>(null);

  const fetchSignals = React.useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    try {
      const q = buildQuery(filters);
      const res = await authedFetch(`/api/v1/social/signals?${q}`);
      if (!res.ok) {
        const t = await res.text();
        setError(`Erro ${res.status}: ${t.slice(0, 200)}`);
        setSignals([]);
        return;
      }
      const body = await res.json() as { signals?: StoredSocialSignal[] };
      const list = body.signals ?? [];
      setSignals(mergeAndSort([], list));
      setLiveCount(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSignals([]);
    } finally {
      setLoading(false);
    }
  }, [campaignId, filters]);

  // Download CSV: usa authedFetch (Authorization header) + blob → link
  // temporário. Não abre em nova tab pra evitar tela em branco no browser.
  const [exporting, setExporting] = React.useState(false);
  const exportCsv = React.useCallback(async () => {
    if (!campaignId) return;
    setExporting(true);
    setError(null);
    try {
      const q = buildQuery(filters);
      const res = await authedFetch(`/api/v1/social/signals?${q}&format=csv`);
      if (!res.ok) {
        const t = await res.text();
        setError(`Erro ${res.status}: ${t.slice(0, 200)}`);
        return;
      }
      const blob = await res.blob();
      const dispo = res.headers.get('Content-Disposition') ?? '';
      const match = dispo.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : 'signals.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }, [campaignId, filters]);

  React.useEffect(() => {
    void fetchSignals();
  }, [fetchSignals]);

  // Broadcast realtime — CLAUDE.md: Broadcast, não postgres_changes.
  React.useEffect(() => {
    if (!campaignId) return;
    const topic = `campaign:${campaignId}:social_signals`;
    const ch = supabase
      .channel(topic)
      .on('broadcast', { event: 'new' }, (payload: { payload?: { signals?: BroadcastSocialSignal[] } }) => {
        const incoming = payload.payload?.signals ?? [];
        if (!incoming.length) return;
        const converted = incoming.map(bs => broadcastToStored(bs, campaignId));
        setSignals(prev => mergeAndSort(prev, converted));
        setLiveCount(c => c + incoming.length);
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [campaignId]);

  const setFilter = <K extends keyof FiltersState>(key: K, value: FiltersState[K]) => {
    setFilters(f => ({ ...f, [key]: value }));
  };

  const clearFilters = () => setFilters(INITIAL_FILTERS);

  const hasFilters = Object.values(filters).some(v => v !== '');

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-slate-100">Pulso Digital</h2>
            <p className="text-xs text-slate-400 mt-1">
              Sinais consolidados das redes sociais monitoradas.{' '}
              <span className="text-slate-500">
                Sentimento é estimativa (§42), nunca verdade. Hipóteses são possibilidades a explorar — nunca afirmação.
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {liveCount > 0 && (
              <span
                className="px-2 py-1 rounded-md text-[11px] bg-emerald-500/15 text-emerald-300 border border-emerald-600/60"
                title="Signals novos recebidos via realtime desde a última atualização"
              >
                +{liveCount} ao vivo
              </span>
            )}
            <button
              type="button"
              onClick={() => void exportCsv()}
              disabled={exporting || loading}
              title="Baixar CSV com os filtros atuais"
              className="px-3 py-1.5 rounded-md text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700"
            >
              {exporting ? 'Exportando…' : 'Exportar CSV'}
            </button>
            <button
              type="button"
              onClick={() => void fetchSignals()}
              disabled={loading}
              className="px-3 py-1.5 rounded-md text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700"
            >
              {loading ? 'Atualizando…' : 'Atualizar'}
            </button>
          </div>
        </div>

        {/* Presets — reduzem cliques em selects pra visões comuns */}
        <PresetsRow
          filters={filters}
          onApply={(p) => {
            const derived = p.computeFilters(new Date());
            setFilters(f => ({
              ...f,
              minSeverity: derived.minSeverity,
              since: derived.since,
              // source/topic/provider preservados; presets são só severity + tempo
            }));
          }}
        />

        {/* Filters */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <FilterSelect
            label="Severidade mín."
            value={filters.minSeverity}
            onChange={v => setFilter('minSeverity', v as SocialSignalSeverity | '')}
            options={SEVERITIES.map(s => ({ value: s, label: SEVERITY_LABELS[s] }))}
          />
          <FilterSelect
            label="Origem"
            value={filters.source}
            onChange={v => setFilter('source', v as SocialSignalSource | '')}
            options={SOURCES.map(s => ({ value: s, label: SOURCE_LABELS[s] }))}
          />
          <FilterSelect
            label="Tema"
            value={filters.topic}
            onChange={v => setFilter('topic', v as SocialTopic | '')}
            options={SOCIAL_TOPICS.map(t => ({ value: t, label: TOPIC_LABELS[t] }))}
          />
          <FilterSelect
            label="Rede"
            value={filters.provider}
            onChange={v => setFilter('provider', v as SocialProvider | '')}
            options={SOCIAL_PROVIDERS.map(p => ({ value: p, label: PROVIDER_LABELS[p] }))}
          />
        </div>
        {/* Text search — filtro por substring no summary */}
        <div className="mt-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Buscar no summary</span>
            <input
              type="search"
              value={filters.search}
              onChange={e => setFilter('search', e.target.value)}
              placeholder="ex.: protesto, hospital, escola…"
              maxLength={200}
              className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />
          </label>
        </div>
        {hasFilters && (
          <div className="mt-3">
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-sky-400 hover:text-sky-300 underline"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </Card>

      {error && (
        <Card>
          <p className="text-sm text-red-300">{error}</p>
        </Card>
      )}

      {loading && signals.length === 0 && (
        <Card>
          <p className="text-sm text-slate-400">Carregando sinais…</p>
        </Card>
      )}

      {!loading && signals.length === 0 && !error && (
        <Card>
          <p className="text-sm text-slate-300 font-medium">Sem sinais no momento.</p>
          <p className="text-xs text-slate-500 mt-1">
            Isso pode significar: dados insuficientes (§45 — o pipeline não inventa
            baseline), filtros muito restritivos, ou o scheduler ainda não rodou pra
            esta campanha.
          </p>
        </Card>
      )}

      {signals.length > 0 && <PulsoSummaryHeader signals={signals} />}

      <div className="grid grid-cols-1 gap-3">
        {signals.map(s => (
          <PulsoSignalCard
            key={s.dedupKey}
            signal={s}
            onClick={setSelectedSignal}
          />
        ))}
      </div>

      <PulsoSignalDetailsModal
        signal={selectedSignal}
        onClose={() => setSelectedSignal(null)}
      />

      {/* Config de notifiers — auto-esconde se não for Admin/Coordenador */}
      <PulsoNotifierAdminCard />
    </div>
  );
};

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}

interface PresetsRowProps {
  filters: FiltersState;
  onApply: (preset: FilterPreset) => void;
}

const PresetsRow: React.FC<PresetsRowProps> = ({ filters, onApply }) => {
  // Fixamos "now" no mount pra que a comparação com preset.since fique
  // estável enquanto o usuário interage (senão o botão pisca "ativo"/
  // "inativo" a cada segundo por drift no now).
  const nowRef = React.useRef<Date>(new Date());
  const active = React.useMemo(
    () => findMatchingPreset({ minSeverity: filters.minSeverity, since: filters.since }, nowRef.current, 5 * 60_000),
    [filters.minSeverity, filters.since],
  );
  return (
    <div className="mt-4 flex flex-wrap gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold self-center mr-1">
        Presets
      </span>
      {PULSO_PRESETS.map(p => {
        const isActive = active?.id === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onApply(p)}
            title={p.scope}
            className={
              isActive
                ? 'px-2 py-1 rounded-md text-[11px] bg-sky-500/20 text-sky-200 border border-sky-500'
                : 'px-2 py-1 rounded-md text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
            }
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
};

const FilterSelect: React.FC<FilterSelectProps> = ({ label, value, onChange, options }) => (
  <label className="block">
    <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">{label}</span>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
    >
      <option value="">Todos</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  </label>
);

export default PulsoDigitalPage;
