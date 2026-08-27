/**
 * PulsoNotifierAdminCard — bloco admin-only no Pulso Digital que mostra
 * o estado atual dos notifiers (Slack + email) e permite resetar o
 * dedup cache.
 *
 * Consome:
 *   GET    /api/v1/social/signals/notifier-status  (PR 39)
 *   DELETE /api/v1/social/signals/notifier-cache   (PR 40)
 *
 * VISIBILIDADE: só renderiza pra Admin ou Coordenador (mesmo gate do
 * endpoint). Fiscal/outros roles não veem — matcha o 403 do server.
 *
 * REGRA §35 preservada: endpoints já filtram por campaignId do req.user;
 * card não precisa passar nada explícito.
 */

import * as React from 'react';
import { authedFetch } from '../../lib/authedFetch';
import Card from '../ui/Card';
import { useAuth } from '../../contexts/AuthContext';

interface NotifierChannel {
  configured: boolean;
  minSeverity: string | null;
  cachedDedupKeys: number;
  cacheMaxPerCampaign: number;
  notifierVersion: string;
}

interface NotifierStatusResponse {
  slack: NotifierChannel;
  email: NotifierChannel & { recipientsCount: number };
}

interface ResetResponse {
  slack: { cleared: number };
  email: { cleared: number };
}

const ADMIN_ROLES = new Set(['Admin', 'Coordenador']);

const PulsoNotifierAdminCard: React.FC = () => {
  const { userType } = useAuth();
  const canSee = userType && ADMIN_ROLES.has(userType);

  const [status, setStatus] = React.useState<NotifierStatusResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastReset, setLastReset] = React.useState<ResetResponse | null>(null);

  const fetchStatus = React.useCallback(async () => {
    if (!canSee) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch('/api/v1/social/signals/notifier-status');
      if (!res.ok) {
        setError(`Erro ${res.status}`);
        setStatus(null);
        return;
      }
      const body = await res.json() as NotifierStatusResponse;
      setStatus(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [canSee]);

  React.useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const resetCache = React.useCallback(async () => {
    if (!canSee) return;
    // Confirmação — reset é destrutivo (força re-notify)
    if (!window.confirm(
      'Isso vai limpar o dedup cache dos notifiers. Sinais previamente enviados podem ser re-notificados na próxima janela do scheduler. Continuar?',
    )) return;
    setResetting(true);
    setError(null);
    try {
      const res = await authedFetch('/api/v1/social/signals/notifier-cache', { method: 'DELETE' });
      if (!res.ok) {
        setError(`Erro ${res.status}`);
        return;
      }
      const body = await res.json() as ResetResponse;
      setLastReset(body);
      // Recarrega status pra ver cachedDedupKeys=0
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  }, [canSee, fetchStatus]);

  if (!canSee) return null;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-slate-200">Configuração dos Notifiers</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Visível apenas para Admin/Coordenador. Endpoint /signals/notifier-status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchStatus()}
            disabled={loading}
            className="text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-50"
            title="Atualizar"
          >
            {loading ? '…' : '↻'}
          </button>
          <button
            type="button"
            onClick={() => void resetCache()}
            disabled={resetting || loading}
            className="px-2 py-1 rounded-md text-[11px] bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-50 text-amber-300 border border-amber-600/60"
            title="Limpa o dedup cache in-memory. Força re-notify no próximo tick."
          >
            {resetting ? 'Limpando…' : 'Limpar dedup cache'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-300">{error}</p>
      )}

      {lastReset && !error && (
        <p className="mt-3 text-xs text-emerald-300">
          Cache limpo — Slack: {lastReset.slack.cleared}, Email: {lastReset.email.cleared} dedupKeys removidos.
        </p>
      )}

      {status && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChannelBlock name="Slack" channel={status.slack} />
          <EmailChannelBlock channel={status.email} />
        </div>
      )}
    </Card>
  );
};

interface ChannelBlockProps {
  name: string;
  channel: NotifierChannel;
}

const ChannelBlock: React.FC<ChannelBlockProps> = ({ name, channel }) => {
  return (
    <div className="rounded-md border border-slate-700 bg-slate-800/40 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-200">{name}</span>
        <ConfiguredBadge configured={channel.configured} />
      </div>
      <dl className="mt-2 text-[11px] text-slate-400 space-y-0.5">
        <DlRow label="minSeverity" value={channel.minSeverity ?? '—'} />
        <DlRow label="Dedup keys cached" value={`${channel.cachedDedupKeys} / ${channel.cacheMaxPerCampaign}`} />
        <DlRow label="Version" value={channel.notifierVersion} />
      </dl>
    </div>
  );
};

const EmailChannelBlock: React.FC<{ channel: NotifierChannel & { recipientsCount: number } }> = ({ channel }) => {
  return (
    <div className="rounded-md border border-slate-700 bg-slate-800/40 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-200">Email</span>
        <ConfiguredBadge configured={channel.configured} />
      </div>
      <dl className="mt-2 text-[11px] text-slate-400 space-y-0.5">
        <DlRow label="Recipients" value={String(channel.recipientsCount)} />
        <DlRow label="minSeverity" value={channel.minSeverity ?? '—'} />
        <DlRow label="Dedup keys cached" value={`${channel.cachedDedupKeys} / ${channel.cacheMaxPerCampaign}`} />
        <DlRow label="Version" value={channel.notifierVersion} />
      </dl>
    </div>
  );
};

const ConfiguredBadge: React.FC<{ configured: boolean }> = ({ configured }) => (
  <span
    className={
      configured
        ? 'text-[10px] px-1.5 py-0.5 rounded border bg-emerald-500/15 text-emerald-300 border-emerald-600/60'
        : 'text-[10px] px-1.5 py-0.5 rounded border bg-slate-700/40 text-slate-400 border-slate-600'
    }
  >
    {configured ? 'configurado' : 'desligado'}
  </span>
);

const DlRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-2">
    <dt className="text-slate-500">{label}</dt>
    <dd className="text-slate-300 font-mono tabular-nums text-[10.5px]">{value}</dd>
  </div>
);

export default PulsoNotifierAdminCard;
