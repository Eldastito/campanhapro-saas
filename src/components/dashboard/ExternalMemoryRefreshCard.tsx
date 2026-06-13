import * as React from 'react';
import Card from '../ui/Card';
import { authedFetch } from '../../lib/authedFetch';
import { Globe, Loader2, RefreshCw, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';

/**
 * Atualiza a Memória Externa da IA (#56). Dispara web_search em 2 frentes
 * (cenário municipal + adversários) e o resultado vai pra RAG via #110.
 * Próxima chamada de qualquer agente já encontra esse sinal fresco.
 *
 * Throttle: 1x/dia por campanha (custo controlado).
 */
interface Briefing {
  label: string; ok: boolean; summary?: string; error?: string;
  citations?: { url: string; title: string }[];
  webSearches?: number;
}
interface RefreshResult {
  ok: boolean; refreshedAt: string; municipio: string | null; candidato: string;
  briefings: Briefing[];
  stats: { totalSources: number; totalSearches: number; briefingsOk: number };
}
interface Status { lastRefreshAt: string | null; nextAvailableAt: string | null; canRefresh: boolean }

const LABEL: Record<string, string> = {
  cenario_municipal: '🏛️ Cenário municipal',
  movimento_adversarios: '⚔️ Movimento dos adversários',
};

const ExternalMemoryRefreshCard: React.FC = () => {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [data, setData] = React.useState<RefreshResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const r = await authedFetch('/api/v1/rag/refresh-status');
        if (r.ok) setStatus(await r.json());
      } catch { /* */ }
    })();
  }, []);

  const run = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await authedFetch('/api/v1/rag/refresh-external', { method: 'POST' });
      const j = await r.json();
      if (r.status === 429) { setErr(j?.detail || 'Já atualizado hoje. Tente amanhã.'); return; }
      if (!r.ok) { setErr(j?.error || 'Falha ao atualizar memória externa.'); return; }
      setData(j);
      setStatus({ lastRefreshAt: j.refreshedAt, nextAvailableAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(), canRefresh: false });
    } catch (e: any) { setErr(e?.message || 'Erro.'); }
    finally { setLoading(false); }
  };

  const nextLabel = status?.nextAvailableAt
    ? new Date(status.nextAvailableAt).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
    : null;

  return (
    <Card className="no-print p-5 border-t-4 border-t-sky-500">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-r from-sky-500 to-cyan-500 rounded-lg">
            <Globe className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100">Memória externa da IA</h3>
            <p className="text-xs text-slate-400">Notícias do município + movimento dos adversários, com fonte.</p>
          </div>
        </div>
        <button onClick={run} disabled={loading || (status && !status.canRefresh) || false}
          className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold px-3 py-2 rounded-xl flex items-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {loading ? 'Buscando…' : 'Atualizar'}
        </button>
      </div>

      {status && status.lastRefreshAt && (
        <p className="text-[11px] text-slate-500 mb-2">
          Última atualização: {new Date(status.lastRefreshAt).toLocaleString('pt-BR')}.
          {!status.canRefresh && nextLabel && <> Próxima disponível em <b>{nextLabel}</b>.</>}
        </p>
      )}

      {err && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 text-xs text-amber-300 flex items-start gap-2 mb-3">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{err}</span>
        </div>
      )}

      {data && (
        <div className="space-y-3 mt-3">
          <p className="text-xs text-slate-400">
            ✅ <b className="text-emerald-300">{data.stats.briefingsOk}/2</b> briefings ok ·
            {' '}<b className="text-sky-300">{data.stats.totalSources}</b> fontes coletadas ·
            {' '}<b className="text-slate-300">{data.stats.totalSearches}</b> buscas web
            {data.municipio && <> · 📍 {data.municipio}</>}
          </p>

          {data.briefings.map((b, i) => (
            <div key={i} className={`border rounded-xl p-3 ${b.ok ? 'border-sky-500/30 bg-sky-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className="text-sm font-bold text-slate-200">{LABEL[b.label] || b.label}</p>
                {b.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
              </div>
              {b.ok && b.summary && <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line line-clamp-6">{b.summary}…</p>}
              {!b.ok && <p className="text-xs text-rose-300">{b.error}</p>}
              {b.ok && b.citations && b.citations.length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/5">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Fontes ({b.citations.length})</p>
                  <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                    {b.citations.slice(0, 8).map((c, j) => (
                      <li key={j} className="text-[11px]">
                        <a href={c.url} target="_blank" rel="noopener noreferrer"
                          className="text-sky-400 hover:text-sky-300 inline-flex items-center gap-1">
                          <ExternalLink className="w-2.5 h-2.5" />
                          {(c.title || c.url).slice(0, 70)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}

          <p className="text-[10px] text-slate-500 pt-1 border-t border-white/5">
            💾 Este conteúdo já foi salvo na memória da IA. Próxima pergunta no Consultor / Foco / Dossiê já vai usar esses sinais.
          </p>
        </div>
      )}
    </Card>
  );
};

export default ExternalMemoryRefreshCard;
