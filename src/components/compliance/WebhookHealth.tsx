import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import { Webhook, CheckCircle, XCircle, RefreshCw, Loader2 } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

interface WebhookEvent {
  id: string;
  source: string;
  event_type: string | null;
  signature_valid: boolean;
  received_at: string;
  processed_at: string | null;
  error: string | null;
}

export const WebhookHealth: React.FC = () => {
  const [events, setEvents] = React.useState<WebhookEvent[]>([]);
  const [loading, setLoading] = React.useState(true);

  const fetchEvents = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch('/api/v1/observability/webhooks');
      if (res.ok) {
        const json = await res.json();
        setEvents(json.events ?? []);
      }
    } catch {
      // empty state
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { fetchEvents(); }, [fetchEvents]);

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-slate-200 flex items-center gap-2">
          <Webhook className="w-4 h-4 text-indigo-400" />
          Histórico de Webhooks
        </h3>
        <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={fetchEvents} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">
          <Webhook className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhum webhook recebido ainda.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {events.map(e => (
            <div
              key={e.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
                e.signature_valid
                  ? 'border-slate-700 bg-slate-800/40'
                  : 'border-red-500/40 bg-red-500/10'
              }`}
            >
              {e.signature_valid
                ? <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                : <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
              <span className="text-xs font-medium text-slate-200 uppercase shrink-0">{e.source}</span>
              {e.event_type && <span className="text-xs text-slate-500 shrink-0">{e.event_type}</span>}
              {e.error && <span className="text-xs text-red-400 truncate">{e.error}</span>}
              <span className="text-[10px] text-slate-500 ml-auto shrink-0">
                {new Date(e.received_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export default WebhookHealth;
