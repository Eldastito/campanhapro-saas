/**
 * Convite + gestão de equipe em cadeia (#149/#150).
 *
 * Cada nível convida o nível abaixo (candidato→coordenador→líder→equipe) com
 * nome + telefone + bairro de atuação. O convidado só cria email+senha
 * (link/WhatsApp). Sem limite de pessoas.
 *
 * Reutilizável: a tela do candidato e a do membro usam o mesmo card — o backend
 * deriva o papel do convite pelo tipo de quem convida.
 */
import * as React from 'react';
import { Users, Loader2, Send, Copy, Check, Clock, CheckCircle2, Pencil, X, Trash2 } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

interface MemberInvite {
  token: string;
  displayName: string;
  phone: string | null;
  role: string;
  status: 'pending' | 'active';
  bairro: string | null;
  createdAt: string;
}

const ROLE_LABEL: Record<string, string> = {
  'Coordenador': 'Coordenador', 'Líder': 'Líder', 'Lider': 'Líder', 'Apoiador': 'Apoio',
};

const inviteUrl = (token: string) => `${window.location.origin}/cadastro/equipe/${token}`;

const MemberInviteCard: React.FC = () => {
  const [invites, setInvites] = React.useState<MemberInvite[]>([]);
  const [canInvite, setCanInvite] = React.useState(false);
  const [allowedRoles, setAllowedRoles] = React.useState<string[]>([]);
  const [selectedRole, setSelectedRole] = React.useState<string>('');
  const [loading, setLoading] = React.useState(true);
  const [novo, setNovo] = React.useState({ nome: '', tel: '', bairro: '' });
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [editTok, setEditTok] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState({ bairro: '' });
  const [savingEdit, setSavingEdit] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const r = await authedFetch('/api/v1/party/member-invites');
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setInvites(j.invites || []);
        setCanInvite(!!j.canInvite);
        const roles: string[] = j.allowedRoles || [];
        setAllowedRoles(roles);
        setSelectedRole((cur) => (cur && roles.includes(cur)) ? cur : (roles[0] || ''));
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const nextLabel = selectedRole ? (ROLE_LABEL[selectedRole] || selectedRole) : 'membro';

  const excluir = async (token: string) => {
    if (!window.confirm('Excluir este registro de equipe? Se a pessoa já se cadastrou, a conta dela continua — só o vínculo aqui é removido.')) return;
    const r = await authedFetch(`/api/v1/party/member-invites/${token}`, { method: 'DELETE' });
    if (r.ok) setInvites((prev) => prev.filter((i) => i.token !== token));
  };

  const openWhatsApp = (inv: MemberInvite) => {
    const phone = (inv.phone || '').replace(/\D/g, '');
    const label = ROLE_LABEL[inv.role] || inv.role;
    const msg = `Olá, ${inv.displayName}! Faça seu cadastro como ${label} por este link (seu nome já está reservado, é só criar a senha): ${inviteUrl(inv.token)}`;
    const wa = phone
      ? `https://wa.me/${phone.length <= 11 ? '55' + phone : phone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(wa, '_blank');
  };

  const copyLink = (token: string) => {
    navigator.clipboard?.writeText(inviteUrl(token)).then(() => { setCopied(token); setTimeout(() => setCopied(null), 1500); }, () => {});
  };

  const gerar = async () => {
    if (!novo.nome.trim()) { setErr('Informe o nome.'); return; }
    setErr(null); setBusy(true);
    try {
      const r = await authedFetch('/api/v1/party/member-invites', {
        method: 'POST',
        body: JSON.stringify({ displayName: novo.nome.trim(), phone: novo.tel.trim(), bairro: novo.bairro.trim(), role: selectedRole }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.invite) {
        setNovo({ nome: '', tel: '', bairro: '' });
        setInvites((prev) => [j.invite, ...prev]);
        openWhatsApp(j.invite);
      } else setErr(j.detail || j.error || 'Não consegui gerar o convite.');
    } catch { setErr('Falha de rede ao gerar o convite.'); }
    finally { setBusy(false); }
  };

  const startEdit = (inv: MemberInvite) => {
    setEditTok(inv.token);
    setEditForm({ bairro: inv.bairro || '' });
  };
  const saveEdit = async (token: string) => {
    setSavingEdit(true);
    try {
      const r = await authedFetch(`/api/v1/party/member-invites/${token}`, {
        method: 'PATCH',
        body: JSON.stringify({ bairro: editForm.bairro.trim() }),
      });
      if (r.ok) { setEditTok(null); await load(); }
    } finally { setSavingEdit(false); }
  };

  if (loading) return null;
  if (!canInvite) return null;

  return (
    <div className="bg-[#1c2128] border border-white/5 rounded-3xl p-5 mb-6">
      <p className="font-bold flex items-center gap-2 mb-1"><Users className="w-5 h-5 text-emerald-300" /> Minha equipe</p>
      <p className="text-xs text-slate-400 mb-3">Cadastre seu <b>{nextLabel}</b> (nome, WhatsApp, bairro de atuação). O convite vai por WhatsApp/link — a pessoa só cria e-mail e senha. Sem limite.</p>

      {/* Seletor de papel quando há mais de uma opção (ex.: candidato → Coordenador ou Líder) */}
      {allowedRoles.length > 1 && (
        <div className="flex gap-1.5 mb-2">
          {allowedRoles.map((rl) => (
            <button key={rl} onClick={() => setSelectedRole(rl)}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${selectedRole === rl ? 'bg-emerald-600 text-white' : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800'}`}>
              {ROLE_LABEL[rl] || rl}
            </button>
          ))}
        </div>
      )}

      {/* Cadastro do membro */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder={`Nome do ${nextLabel} *`} className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
        <input value={novo.tel} onChange={(e) => setNovo({ ...novo, tel: e.target.value })} placeholder="WhatsApp" inputMode="tel" className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
        <input value={novo.bairro} onChange={(e) => setNovo({ ...novo, bairro: e.target.value })} placeholder="Bairro de atuação" className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
      </div>
      {err && <p className="text-xs text-rose-400 mb-2">{err}</p>}
      <button onClick={gerar} disabled={busy || !novo.nome.trim()} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2 text-sm">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Cadastrar e enviar convite no WhatsApp
      </button>

      {invites.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Equipe cadastrada</p>
          {invites.map((inv) => (
            <div key={inv.token} className="bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{inv.displayName} <span className="text-[10px] text-slate-500">· {ROLE_LABEL[inv.role] || inv.role}</span></p>
                  {inv.bairro && <p className="text-[10px] text-slate-400">📍 {inv.bairro}</p>}
                  <p className={`text-[10px] flex items-center gap-1 ${inv.status === 'active' ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {inv.status === 'active' ? <><CheckCircle2 className="w-3 h-3" /> cadastrado</> : <><Clock className="w-3 h-3" /> aguardando cadastro</>}
                  </p>
                </div>
                <button onClick={() => startEdit(inv)} title="Editar" className="p-1.5 rounded-lg bg-white/5 text-slate-300 hover:bg-white/10"><Pencil className="w-3.5 h-3.5" /></button>
                {inv.status === 'pending' && <>
                  <button onClick={() => openWhatsApp(inv)} title="Reenviar no WhatsApp" className="p-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30"><Send className="w-3.5 h-3.5" /></button>
                  <button onClick={() => copyLink(inv.token)} title="Copiar link" className="p-1.5 rounded-lg bg-white/5 text-slate-300 hover:bg-white/10">{copied === inv.token ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}</button>
                </>}
                <button onClick={() => excluir(inv.token)} title="Excluir registro" className="p-1.5 rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              {editTok === inv.token && (
                <div className="mt-2 pt-2 border-t border-white/5 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-1.5 items-center">
                  <input value={editForm.bairro} onChange={(e) => setEditForm({ ...editForm, bairro: e.target.value })} placeholder="Bairro" className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />
                  <button onClick={() => saveEdit(inv.token)} disabled={savingEdit} className="bg-emerald-600 hover:bg-emerald-500 rounded-lg px-2 py-1.5 text-xs font-bold">{savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Salvar'}</button>
                  <button onClick={() => setEditTok(null)} className="p-1.5 text-slate-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MemberInviteCard;
