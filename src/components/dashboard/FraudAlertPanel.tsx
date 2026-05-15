import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { ShieldAlert, CheckCircle, Clock } from 'lucide-react';
import Card from '../ui/Card';

interface FraudLog {
  id: string;
  entityType: string;
  riskLevel: string;
  reason: string;
  detectedBy: string;
  isResolved: boolean;
  createdAt: string;
}

const FraudAlertPanel: React.FC = () => {
  const { user, userType } = useAuth();
  const [logs, setLogs] = useState<FraudLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Somente Admins e Leaders devem ver este painel
  const canView = userType === 'Admin' || userType === 'Líder';

  useEffect(() => {
    if (!canView || !user?.campaignId) {
        setLoading(false);
        return;
    }

    fetchLogs();

    const subscription = supabase
      .channel(`fraud-alerts-${user.campaignId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'fraud_audit_logs',
        filter: `campaignId=eq.${user.campaignId}` 
      }, (payload: { new: FraudLog }) => {
        setLogs(prev => [payload.new, ...prev]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [user?.campaignId, userType]);

  const fetchLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('fraud_audit_logs')
        .select('*')
        .eq('campaignId', user?.campaignId)
        .order('createdAt', { ascending: false })
        .limit(5);

      if (error) throw error;
      setLogs(data || []);
    } catch (err) {
      console.error("Erro ao buscar logs de fraude:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!canView) return null;

  return (
    <Card className="border-l-4 border-l-red-500 bg-red-500/5 animate-pulse-subtle">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-red-500" />
          <h3 className="text-sm font-bold text-red-400 uppercase tracking-widest">Alertas do Auditor de Integridade</h3>
        </div>
        {logs.length > 0 && (
          <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            {logs.filter(l => !l.isResolved).length} PENDENTES
          </span>
        )}
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-xs text-slate-500 italic py-4">Escaneando integridade dos dados...</p>
        ) : logs.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400 py-2">
            <CheckCircle className="w-4 h-4" />
            Nenhuma irregularidade detectada nos últimos cadastros.
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="bg-slate-900/60 rounded-xl p-3 border border-red-500/10 hover:border-red-500/30 transition-all">
              <div className="flex justify-between items-start mb-1">
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${
                  log.riskLevel === 'CRÍTICO' ? 'bg-red-600 text-white' : 
                  log.riskLevel === 'Alto' ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-300'
                }`}>
                  Risco {log.riskLevel}
                </span>
                <span className="text-[9px] text-slate-500 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" /> {new Date(log.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-xs text-slate-200 font-medium mb-1">
                {log.entityType === 'voter' ? 'Eleitor Suspeito' : 'Reporte Inconsistente'}: {log.reason}
              </p>
              <p className="text-[9px] text-slate-500 italic">Identificado por: {log.detectedBy}</p>
            </div>
          ))
        )}
      </div>
    </Card>
  );
};

export default FraudAlertPanel;
