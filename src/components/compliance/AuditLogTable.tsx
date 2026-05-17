import * as React from 'react';
import { ScrollText, Filter, Loader2, RefreshCw } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

interface AuditEntry {
  id: string;
  action: string;
  actorId: string | null;
  actorType: 'user' | 'system' | 'webhook' | 'agent';
  resourceType: string | null;
  resourceId: string | null;
  severity: 'info' | 'warn' | 'error' | 'critical';
  metadata: Record<string, unknown>;
  traceId: string | null;
  createdAt: string;
}

const severityColor: Record<AuditEntry['severity'], string> = {
  info: 'text-slate-400 bg-slate-500/20',
  warn: 'text-amber-300 bg-amber-500/20',
  error: 'text-red-300 bg-red-500/20',
  critical: 'text-red-200 bg-red-600/30 border border-red-500/40',
};

const actorTypeColor: Record<AuditEntry['actorType'], string> = {
  user: 'text-sky-300',
  system: 'text-slate-400',
  webhook: 'text-purple-300',
  agent: 'text-indigo-300',
};

export const AuditLogTable: React.FC = () => {
  const [entries, setEntries] = React.useState<AuditEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [severity, setSeverity] = React.useState<string>('');
  const [action, setAction] = React.useState<string>('');
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const fetchEntries = React.useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (severity) qs.set('severity', severity);
      if (action) qs.set('action', action);
      qs.set('limit', '100');
      const res = await fetch(`/api/v1/observability/audit?${qs}`);
      if (res.ok) {
        const json = await res.json();
        setEntries(json.entries ?? []);
      }
    } catch {
      // empty state
    } finally {
      setLoading(false);
    }
  }, [severity, action]);

  React.useEffect(() => { fetchEntries(); }, [fetchEntries]);

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-slate-200 flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-indigo-400" />
          Auditoria
        </h3>
        <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={fetchEntries} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Filter className="w-3.5 h-3.5 text-slate-500" />
        <select
          className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-300"
          value={severity}
          onChange={e => setSeverity(e.target.value)}
        >
          <option value="">Todas as severidades</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
          <option value="critical">Critical</option>
        </select>
        <input
          className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-300 placeholder-slate-500 w-48"
          value={action}
          onChange={e => setAction(e.target.value)}
          placeholder="Filtro por ação (ex: dossier.)"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-8 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">
          <ScrollText className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhum evento de auditoria registrado.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {entries.map(e => {
            const isExpanded = expanded === e.id;
            const hasMetadata = e.metadata && Object.keys(e.metadata).length > 0;
            return (
              <div key={e.id} className="border border-slate-700 rounded-lg overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-700/40 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : e.id)}
                >
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${severityColor[e.severity]}`}>
                    {e.severity.toUpperCase()}
                  </span>
                  <span className="text-xs font-mono text-slate-200 min-w-[200px] truncate">{e.action}</span>
                  <span className={`text-[10px] ${actorTypeColor[e.actorType]} shrink-0`}>
                    {e.actorType}
                  </span>
                  {e.resourceType && (
                    <span className="text-[10px] text-slate-500 truncate">
                      {e.resourceType}{e.resourceId ? `:${e.resourceId.slice(0, 8)}` : ''}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-500 ml-auto shrink-0">
                    {new Date(e.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </button>
                {isExpanded && hasMetadata && (
                  <pre className="text-[11px] text-slate-300 bg-slate-800 p-2 m-2 rounded whitespace-pre-wrap max-h-40 overflow-auto">
                    {JSON.stringify(e.metadata, null, 2)}
                    {e.traceId && `\n\ntrace_id: ${e.traceId}`}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

export default AuditLogTable;
