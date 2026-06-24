/**
 * Convite de equipe em cadeia (#149).
 *
 * Cada nível convida o nível abaixo (candidato→coordenador→líder→equipe) com
 * nome + telefone já preenchidos; o convidado só cria email+senha. O link vai
 * por WhatsApp ou cópia. Sem limite de pessoas.
 *
 * Reutilizável: a tela do candidato e a do membro (coordenador/líder) usam o
 * mesmo card — o backend deriva o papel do convite pelo tipo de quem convida.
 */
import * as React from 'react';
import { Users, Loader2, Send, Copy, Check, Clock, CheckCircle2 } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

interface MemberInvite {
  token: string;
  displayName: string;
  phone: string | null;
  role: string;
  status: 'pending' | 'active';
  createdAt: string;
}

const ROLE_LABEL: Record<string, string> = {
  'Coordenador': 'Coordenador', 'Líder': 'Líder', 'Lider': 'Líder', 'Apoiador': 'Apoio',
};

const inviteUrl = (token: string) => `${window.location.origin}/cadastro/equipe/${token}`;

const MemberInviteCard: React.FC = () => {
  const [invites, setInvites] = React.useState<MemberInvite[]>([]);
  const [canInvite, setCanInvite] = React.useState(false);
  const [nextRole, setNextRole] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [nome, setNome] = React.useState('');
  const [tel, setTel] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await authedFetch('/api/v1/party/member-invites');
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setInvites(j.invites || []);
        setCanInvite(!!j.canInvite);
        setNextRole(j.nextRole || null);
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const nextLabel = nextRole ? (ROLE_LABEL[nextRole] || nextRole) : 'membro';

  // Abre o WhatsApp já com a mensagem + link; usa o telefone se houver.
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
    navigator.clipboard?.writeText(inviteUrl(token)).then(() => {
      setCopied(token); setTimeout(() => setCopied(null), 1500);
    }, () => {});
  };

  const gerar = async () => {
    if (!nome.trim()) { setErr('Informe o nome.'); return; }
    setErr(null); setBusy(true);
    try {
      const r = await authedFetch('/api/v1/party/member-invites', {
        method: 'POST', body: JSON.stringify({ displayName: nome.trim(), phone: tel.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.invite) {
        setNome(''); setTel('');
        setInvites((prev) => [j.invite, ...prev]);
        openWhatsApp(j.invite); // abre o WhatsApp já com o convite
      } else {
        setErr(j.detail || j.error || 'Não consegui gerar o convite.');
      }
    } catch { setErr('Falha de rede ao gerar o convite.'); }
    finally { setBusy(false); }
  };

  if (loading) return null;
  if (!canInvite) return null; // perfil sem nível abaixo pra convidar

  return (
    <div className="bg-[#1c2128] border border-white/5 rounded-3xl p-5 mb-6">
      <p className="font-bold flex items-center gap-2 mb-1"><Users className="w-5 h-5 text-emerald-300" /> Minha equipe</p>
      <p className="text-xs text-slate-400 mb-4">Convide seu <b>{nextLabel}</b> por WhatsApp ou link. O nome já vai reservado — a pessoa só cria e-mail e senha. Pode convidar quantos quiser.</p>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2 mb-2">
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={`Nome do ${nextLabel}`}
          className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
        <input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="WhatsApp" inputMode="tel"
          className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
      </div>
      {err && <p className="text-xs text-rose-400 mb-2">{err}</p>}
      <button onClick={gerar} disabled={busy || !nome.trim()}
        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2 text-sm">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Gerar convite e abrir WhatsApp
      </button>

      {invites.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Convidados</p>
          {invites.map((inv) => (
            <div key={inv.token} className="flex items-center gap-2 bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{inv.displayName} <span className="text-[10px] text-slate-500">· {ROLE_LABEL[inv.role] || inv.role}</span></p>
                <p className={`text-[10px] flex items-center gap-1 ${inv.status === 'active' ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {inv.status === 'active' ? <><CheckCircle2 className="w-3 h-3" /> cadastrado</> : <><Clock className="w-3 h-3" /> aguardando cadastro</>}
                </p>
              </div>
              {inv.status === 'pending' && (
                <>
                  <button onClick={() => openWhatsApp(inv)} title="Reenviar no WhatsApp" className="p-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30"><Send className="w-3.5 h-3.5" /></button>
                  <button onClick={() => copyLink(inv.token)} title="Copiar link" className="p-1.5 rounded-lg bg-white/5 text-slate-300 hover:bg-white/10">
                    {copied === inv.token ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MemberInviteCard;
