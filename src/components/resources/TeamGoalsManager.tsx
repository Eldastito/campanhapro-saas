import * as React from 'react';
import { authedFetch } from '../../lib/authedFetch';
import { Target, Plus, Loader2, X, Trash2, AlertCircle, MapPin, User } from 'lucide-react';
import Card from '../ui/Card';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Metas por membro × bairro (#53).
 *
 * Define alvo de visitas/contatos/apoiadores por membro num bairro específico
 * (ou geral). Progresso é COMPUTADO em runtime no backend cruzando com
 * visits/contacts/engagement_actions — não duplica dado e não fica desalinhado.
 *
 * Só Admin/Coordenador podem criar/editar; o resto da equipe pode VER o que
 * é dele (RLS faz o filtro no banco).
 */
interface Member { id: string; name: string; role: string }
interface Progress { visitDone: number; contactDone: number; supporterDone: number }
interface Goal {
  id: string; campaignId: string; memberId: string | null; bairro: string | null;
  visitTarget: number; contactTarget: number; supporterTarget: number;
  deadline: string | null; notes: string | null; createdAt: string;
  memberName: string | null; memberRole: string | null;
  progress: Progress;
}

const pct = (done: number, target: number) => (target <= 0 ? 0 : Math.min(100, Math.round((done / target) * 100)));
const barCls = (p: number) => p >= 100 ? 'bg-emerald-500' : p >= 60 ? 'bg-sky-500' : p >= 30 ? 'bg-amber-500' : 'bg-rose-500';

const TeamGoalsManager: React.FC = () => {
  const { userType } = useAuth();
  const canEdit = userType === 'Admin' || userType === 'Coordenador';

  const [goals, setGoals] = React.useState<Goal[]>([]);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<Partial<Goal> | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await authedFetch('/api/v1/team/goals');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Falha ao carregar metas');
      setGoals(j.goals || []);
      setMembers(j.members || []);
    } catch (e: any) { setErr(e?.message || 'Erro'); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    setSaving(true); setErr(null);
    try {
      const r = await authedFetch('/api/v1/team/goals', { method: 'POST', body: JSON.stringify(editing) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Falha ao salvar');
      setEditing(null);
      await load();
    } catch (e: any) { setErr(e?.message || 'Erro ao salvar'); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('Remover essa meta?')) return;
    try {
      const r = await authedFetch(`/api/v1/team/goals/${id}`, { method: 'DELETE' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Falha'); }
      await load();
    } catch (e: any) { setErr(e?.message || 'Erro ao remover'); }
  };

  if (loading) return <div className="flex items-center gap-2 text-slate-400 p-6"><Loader2 className="w-4 h-4 animate-spin" /> Carregando metas…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Target className="w-5 h-5 text-emerald-400" /> Metas da equipe por zona
          </h3>
          <p className="text-xs text-slate-400">Defina alvos por membro × bairro. O progresso é calculado pelas visitas, contatos e engajamentos reais.</p>
        </div>
        {canEdit && (
          <button onClick={() => setEditing({ memberId: null, bairro: '', visitTarget: 0, contactTarget: 0, supporterTarget: 0 })}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold px-3 py-2 rounded-xl flex items-center gap-2">
            <Plus className="w-4 h-4" /> Nova meta
          </button>
        )}
      </div>

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-2.5 text-xs text-rose-300 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{err}</span>
        </div>
      )}

      {goals.length === 0 && !editing && (
        <div className="text-center py-12 border border-dashed border-white/10 rounded-3xl">
          <Target className="w-10 h-10 text-slate-600 mx-auto mb-2" />
          <p className="text-slate-400">Nenhuma meta cadastrada.</p>
          {canEdit && <p className="text-xs text-slate-500 mt-1">Clique em <b>Nova meta</b> pra começar.</p>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {goals.map((g) => (
          <Card key={g.id} className="p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="min-w-0">
                <p className="font-bold text-white truncate flex items-center gap-1.5">
                  {g.memberName ? <><User className="w-3.5 h-3.5 text-emerald-400" /> {g.memberName}</> : <>👥 Equipe inteira</>}
                </p>
                <p className="text-[11px] text-slate-400 flex items-center gap-2 flex-wrap mt-0.5">
                  {g.memberRole && <span className="bg-slate-700/60 px-1.5 py-0.5 rounded">{g.memberRole}</span>}
                  {g.bairro ? <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {g.bairro}</span> : <span className="text-slate-500">Sem restrição de bairro</span>}
                  {g.deadline && <span>📅 até {new Date(g.deadline + 'T00:00').toLocaleDateString('pt-BR')}</span>}
                </p>
              </div>
              {canEdit && (
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setEditing(g)} className="text-xs text-sky-400 hover:text-sky-300 px-2 py-1">Editar</button>
                  <button onClick={() => remove(g.id)} title="Remover" className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>

            <ProgressRow label="Visitas" done={g.progress.visitDone} target={g.visitTarget} />
            <ProgressRow label="Contatos" done={g.progress.contactDone} target={g.contactTarget} />
            <ProgressRow label="Apoiadores" done={g.progress.supporterDone} target={g.supporterTarget} />

            {g.notes && <p className="text-[11px] text-slate-500 mt-2 pt-2 border-t border-white/5 italic">"{g.notes}"</p>}
          </Card>
        ))}
      </div>

      {/* Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 w-full max-w-md space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-bold text-white flex items-center gap-2"><Target className="w-5 h-5 text-emerald-400" /> {editing.id ? 'Editar meta' : 'Nova meta'}</h4>
              <button onClick={() => setEditing(null)} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">Membro</label>
              <select value={editing.memberId || ''} onChange={(e) => setEditing({ ...editing, memberId: e.target.value || null })}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white mt-1">
                <option value="">— Equipe inteira (qualquer membro) —</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
              </select>
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">Bairro <span className="text-slate-500">(opcional)</span></label>
              <input value={editing.bairro || ''} onChange={(e) => setEditing({ ...editing, bairro: e.target.value })} placeholder="Ex: Centro"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white mt-1" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <NumField label="Visitas" value={editing.visitTarget || 0} onChange={(v) => setEditing({ ...editing, visitTarget: v })} />
              <NumField label="Contatos" value={editing.contactTarget || 0} onChange={(v) => setEditing({ ...editing, contactTarget: v })} />
              <NumField label="Apoiadores" value={editing.supporterTarget || 0} onChange={(v) => setEditing({ ...editing, supporterTarget: v })} />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">Prazo <span className="text-slate-500">(opcional)</span></label>
              <input type="date" value={editing.deadline || ''} onChange={(e) => setEditing({ ...editing, deadline: e.target.value })}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white mt-1" />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">Observação <span className="text-slate-500">(opcional)</span></label>
              <textarea value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value.slice(0, 300) })} rows={2}
                placeholder="Foco em zona X, abordagem Y…"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white mt-1" />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="px-3 py-2 text-sm text-slate-400 hover:text-white">Cancelar</button>
              <button onClick={save} disabled={saving}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ProgressRow: React.FC<{ label: string; done: number; target: number }> = ({ label, done, target }) => {
  if (target <= 0) return null;
  const p = pct(done, target);
  return (
    <div className="mb-1.5">
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300 font-bold">{done}/{target} <span className="text-slate-500">({p}%)</span></span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barCls(p)}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
};

const NumField: React.FC<{ label: string; value: number; onChange: (v: number) => void }> = ({ label, value, onChange }) => (
  <div>
    <label className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">{label}</label>
    <input type="number" min={0} value={value} onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
      className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-2 text-sm text-white mt-1" />
  </div>
);

export default TeamGoalsManager;
