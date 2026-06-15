/**
 * Backup automático noturno (#137).
 *
 * Mostra histórico dos últimos 30 dias de snapshots + botão "Gerar
 * snapshot agora" (manual). Snapshots são gerados automaticamente 03h BR.
 */
import React, { useEffect, useState } from 'react';
import { Database, RefreshCw, Calendar, HardDrive } from 'lucide-react';
import Card from '../ui/Card';
import { supabase } from '../../lib/supabaseClient';

interface Backup {
  id: string;
  snapshotDate: string;
  sizeBytes: number;
  counts: Record<string, number> | null;
  createdAt: string;
}

async function authFetch(url: string, init: RequestInit = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const r = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

const fmtBytes = (b: number) => {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
};

const AutoBackupCard: React.FC = () => {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await authFetch('/api/v1/control-panel/status');
      setBackups(r.backups || []);
    } catch (err) {
      console.error('[backup] load:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createNow = async () => {
    setCreating(true);
    try {
      const r = await authFetch('/api/v1/control-panel/backup-now', { method: 'POST', body: '{}' });
      alert(`✅ Snapshot criado!\n${fmtBytes(r.snapshot.sizeBytes)} · ${Object.values(r.snapshot.counts).filter((v: any) => v > 0).length} tabelas com dados`);
      load();
    } catch (err: any) {
      alert('Falha: ' + (err?.message || 'erro'));
    } finally {
      setCreating(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const hasToday = backups.some(b => b.snapshotDate === today);

  return (
    <Card className="border-l-4 border-l-blue-500">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-blue-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Backup Automático</h3>
        </div>
        <button onClick={load} className="p-1.5 hover:bg-slate-800 rounded text-slate-400">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <p className="text-xs text-slate-400 mb-3">
        Snapshots automáticos rodam todo dia às 03h (BR). Retém 30 dias. Pode gerar manualmente também.
      </p>

      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold mb-3 ${
        hasToday ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
      }`}>
        <Calendar className="w-3.5 h-3.5" />
        {hasToday ? '✓ Snapshot de hoje já criado' : '⚠️ Sem snapshot ainda hoje'}
      </div>

      <button
        onClick={createNow}
        disabled={creating}
        className="w-full flex items-center justify-center gap-2 py-2.5 mb-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all"
      >
        <Database className={`w-4 h-4 ${creating ? 'animate-spin' : ''}`} />
        {creating ? 'Gerando...' : 'Gerar snapshot agora'}
      </button>

      {backups.length === 0 && !loading ? (
        <p className="text-xs text-slate-500 italic text-center py-3">
          Nenhum snapshot ainda. O primeiro será gerado automaticamente em ~24h.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Histórico (últimos 30 dias)</p>
          {backups.slice(0, 30).map(b => {
            const total = b.counts ? Object.values(b.counts).reduce((a: number, v: any) => a + (v > 0 ? v : 0), 0) : 0;
            return (
              <div key={b.id} className="flex items-center gap-3 bg-slate-900/60 rounded-lg p-2 border border-slate-800">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-xs text-slate-200 flex-1">
                  {new Date(b.snapshotDate).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', weekday: 'short' })}
                </span>
                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                  <HardDrive className="w-3 h-3" /> {fmtBytes(b.sizeBytes)}
                </span>
                <span className="text-[10px] text-emerald-300 font-mono">{total} registros</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

export default AutoBackupCard;
