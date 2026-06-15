/**
 * Alerta de Inatividade (#139).
 *
 * Lista líderes/coordenadores parados há ≥ cutoffDays. Visual destaca quem
 * NUNCA registrou visita vs quem só "esfriou".
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Clock, UserX, RefreshCw, Phone } from 'lucide-react';
import Card from '../ui/Card';
import { supabase } from '../../lib/supabaseClient';

interface InactiveMember {
  name: string;
  role: string | null;
  lastVisit: string | null;
  daysInactive: number | null;
}

async function authFetch(url: string): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

const TeamInactivityAlert: React.FC = () => {
  const [cutoff, setCutoff] = useState<3 | 7 | 14 | 30>(7);
  const [inactive, setInactive] = useState<InactiveMember[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await authFetch(`/api/v1/field-ops/inactivity?days=${cutoff}`);
      setInactive(r.inactive || []);
    } catch (err) {
      console.error('[inactivity]', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [cutoff]);

  const nunca = inactive.filter(m => m.lastVisit == null);
  const frios = inactive.filter(m => m.lastVisit != null);

  return (
    <Card className={inactive.length === 0 ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-red-500'}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {inactive.length === 0 ? (
            <Clock className="w-5 h-5 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-red-400" />
          )}
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            {inactive.length === 0 ? 'Equipe Ativa' : `${inactive.length} membro(s) parado(s)`}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <select value={cutoff} onChange={(e) => setCutoff(Number(e.target.value) as any)}
                  className="bg-slate-800 border border-slate-700 rounded text-xs text-white px-2 py-1">
            <option value={3}>≥ 3 dias</option>
            <option value={7}>≥ 7 dias</option>
            <option value={14}>≥ 14 dias</option>
            <option value={30}>≥ 30 dias</option>
          </select>
          <button onClick={load} className="p-1.5 hover:bg-slate-800 rounded text-slate-400">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading && inactive.length === 0 ? (
        <p className="text-xs text-slate-500 italic py-3">Buscando...</p>
      ) : inactive.length === 0 ? (
        <p className="text-xs text-emerald-300 italic">
          ✅ Todos os líderes/coordenadores fizeram pelo menos 1 visita nos últimos {cutoff} dias.
        </p>
      ) : (
        <div className="space-y-3">
          {nunca.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-red-300 uppercase tracking-widest mb-2 flex items-center gap-1">
                <UserX className="w-3 h-3" /> Nunca registraram visita ({nunca.length})
              </p>
              <div className="space-y-1.5">
                {nunca.map(m => (
                  <div key={m.name} className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 flex items-center gap-2">
                    <span className="text-sm text-red-200 font-bold flex-1 truncate">{m.name}</span>
                    {m.role && <span className="text-[9px] text-red-300/70 uppercase">{m.role}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {frios.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-amber-300 uppercase tracking-widest mb-2 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Sem visita há {cutoff}+ dias ({frios.length})
              </p>
              <div className="space-y-1.5">
                {frios.map(m => (
                  <div key={m.name} className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 flex items-center gap-2">
                    <span className="text-sm text-amber-100 font-bold flex-1 truncate">{m.name}</span>
                    {m.role && <span className="text-[9px] text-amber-300/70 uppercase">{m.role}</span>}
                    <span className="text-xs text-amber-300 font-mono whitespace-nowrap">
                      {m.daysInactive}d sem visitar
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[10px] text-slate-500 italic mt-3">
            💡 Considere ligar ou enviar mensagem motivacional pra retomar atividade.
          </p>
        </div>
      )}
    </Card>
  );
};

export default TeamInactivityAlert;
