import * as React from 'react';
import { ShieldCheck, Send, Check, X, Clock, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { RJ_MUNICIPALITIES } from '../../data/rj-locations';

/**
 * Autorização de fiscais de zona. O Líder solicita à COORDENAÇÃO da campanha
 * (Admin/Coordenador), que é quem providencia os crachás de fiscal com o
 * partido/Justiça Eleitoral. Admin/Coordenador aprova ou nega aqui.
 */
const STATUS = {
  pendente: { label: 'Pendente', cls: 'bg-amber-500/15 text-amber-400', icon: Clock },
  aprovado: { label: 'Aprovado', cls: 'bg-emerald-500/15 text-emerald-400', icon: Check },
  negado: { label: 'Negado', cls: 'bg-rose-500/15 text-rose-400', icon: X },
} as const;

const FiscalRequestsPanel: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.type === 'Admin' || user?.type === 'Coordenador';
  const [reqs, setReqs] = React.useState<any[]>([]);
  const [form, setForm] = React.useState({ municipio: '', zona: '', quantidade: 1, justificativa: '' });
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(() => {
    if (!user?.campaignId) return;
    let q = supabase.from('fiscal_requests').select('*').eq('campaignId', user.campaignId).order('createdAt', { ascending: false });
    if (!isAdmin) q = q.eq('requesterId', String(user.uid));
    q.then(({ data }) => setReqs(data ?? []), () => {});
  }, [user?.campaignId, user?.uid, isAdmin]);

  React.useEffect(() => {
    load();
    if (!user?.campaignId) return;
    const ch = supabase.channel(`fiscalreq-${user.campaignId}-${user.uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fiscal_requests', filter: `campaignId=eq.${user.campaignId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, user?.campaignId, user?.uid]);

  const submit = async () => {
    if (!form.municipio) { alert('Selecione o município.'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('fiscal_requests').insert({
        campaignId: user!.campaignId,
        requesterId: user!.uid ? String(user!.uid) : null,
        requesterName: user!.name,
        municipio: form.municipio,
        zona: form.zona.trim() || null,
        quantidade: Number(form.quantidade) || 1,
        justificativa: form.justificativa.trim() || null,
      });
      if (error) throw error;
      setForm({ municipio: '', zona: '', quantidade: 1, justificativa: '' });
    } catch (e: any) { alert(e?.message || 'Falha ao enviar a solicitação.'); }
    finally { setSaving(false); }
  };

  const review = async (id: string, status: 'aprovado' | 'negado') => {
    const note = status === 'negado' ? (prompt('Motivo (opcional):') || null) : null;
    await supabase.from('fiscal_requests').update({
      status, reviewedBy: user?.uid ? String(user.uid) : null, reviewedAt: new Date().toISOString(), reviewNote: note,
    }).eq('id', id);
  };

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <h2 className="text-lg font-bold mb-1 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-indigo-400" /> Autorização de Fiscais de Zona</h2>
      <p className="text-[11px] text-slate-500 mb-4">
        {isAdmin
          ? 'Aprove os pedidos dos líderes. Cabe à coordenação providenciar os crachás de fiscal junto ao partido / Justiça Eleitoral.'
          : 'Solicite à coordenação da campanha a autorização para credenciar fiscais (crachás) nas zonas onde sua equipe atua.'}
      </p>

      {/* Form do líder */}
      {!isAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 mb-4 bg-slate-900/50 p-3 rounded-lg">
          <select value={form.municipio} onChange={(e) => setForm({ ...form, municipio: e.target.value })}
            className="md:col-span-4 bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-sm">
            <option value="">Município…</option>
            {RJ_MUNICIPALITIES.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
          <input value={form.zona} onChange={(e) => setForm({ ...form, zona: e.target.value })} placeholder="Zona(s)"
            className="md:col-span-2 bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-sm" />
          <input type="number" min={1} value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: Number(e.target.value) })} placeholder="Qtd"
            className="md:col-span-2 bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-sm" />
          <input value={form.justificativa} onChange={(e) => setForm({ ...form, justificativa: e.target.value })} placeholder="Justificativa (opcional)"
            className="md:col-span-3 bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-sm" />
          <button onClick={submit} disabled={saving} className="md:col-span-1 bg-indigo-600 hover:bg-indigo-500 rounded-md flex items-center justify-center">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      )}

      {reqs.length === 0 ? (
        <p className="text-slate-400 text-sm">{isAdmin ? 'Nenhuma solicitação de fiscal.' : 'Você ainda não fez solicitações.'}</p>
      ) : (
        <div className="space-y-2">
          {reqs.map((r) => {
            const st = STATUS[r.status as keyof typeof STATUS] || STATUS.pendente;
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/50 rounded-lg p-3">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">{r.municipio}{r.zona ? ` · Zona ${r.zona}` : ''} · {r.quantidade} fiscal(is)</p>
                  <p className="text-[11px] text-slate-400">{isAdmin ? `Solicitado por ${r.requesterName || '—'}` : ''}{r.justificativa ? ` · ${r.justificativa}` : ''}{r.reviewNote ? ` · obs: ${r.reviewNote}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full flex items-center gap-1 ${st.cls}`}><st.icon className="w-3 h-3" /> {st.label}</span>
                  {isAdmin && r.status === 'pendente' && (
                    <>
                      <button onClick={() => review(r.id, 'aprovado')} title="Aprovar" className="text-emerald-400 hover:text-emerald-300"><Check className="w-4 h-4" /></button>
                      <button onClick={() => review(r.id, 'negado')} title="Negar" className="text-rose-400 hover:text-rose-300"><X className="w-4 h-4" /></button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FiscalRequestsPanel;
