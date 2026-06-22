import * as React from 'react';
import { useParams } from 'react-router-dom';
import { Landmark, Lock, Loader2, CheckCircle2, ShieldCheck } from 'lucide-react';

/**
 * Cadastro do candidato via link de convite do partido (público).
 * O nome do candidato vem do convite e fica TRAVADO — garante o vínculo e a
 * hierarquia. O convidado só define e-mail e senha.
 */
interface Invite { partyName: string; candidate: { displayName: string; cargo?: string; regiao?: string; phone?: string | null }; alreadyRegistered: boolean; }

const PublicPartyRegisterPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [invite, setInvite] = React.useState<Invite | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ email: '', password: '', phone: '' });
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/public/party/invite/${token}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Convite inválido');
        setInvite(j);
        if (j.candidate?.phone) setForm((f) => ({ ...f, phone: j.candidate.phone }));
      } catch (e: any) { setErr(e.message); }
      finally { setLoading(false); }
    })();
  }, [token]);

  const submit = async () => {
    if (!form.email.trim() || form.password.length < 6) { setErr('Informe e-mail e senha (mín. 6).'); return; }
    setErr(null); setBusy(true);
    try {
      const r = await fetch(`/api/public/party/register/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.error || 'Falha no cadastro');
      setDone(true);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>;

  if (err && !invite) {
    return <div className="min-h-screen bg-[#0a0a0b] text-white flex items-center justify-center p-6"><div className="text-center"><p className="text-rose-400 font-bold">Convite inválido ou expirado.</p></div></div>;
  }

  if (done || invite?.alreadyRegistered) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900/60 border border-emerald-500/30 rounded-3xl p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
          <h1 className="text-2xl font-black">Cadastro concluído!</h1>
          <p className="text-sm text-slate-400 mt-1 mb-5">Sua conta está pronta. Faça login para acessar.</p>
          <a href="/login" className="inline-block bg-indigo-600 hover:bg-indigo-500 rounded-xl px-6 py-3 font-bold">Ir para o login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-slate-900/60 border border-white/10 rounded-3xl p-8">
        <div className="text-center mb-5">
          <Landmark className="w-10 h-10 text-indigo-400 mx-auto mb-2" />
          <p className="text-[11px] uppercase tracking-widest text-indigo-400 font-bold">{invite?.partyName}</p>
          <h1 className="text-2xl font-black mt-1">Cadastro de candidato</h1>
        </div>

        {/* Nome travado (vínculo garantido pelo convite) */}
        <div className="bg-slate-950 border border-white/10 rounded-xl px-4 py-3 mb-3 flex items-center gap-2">
          <Lock className="w-4 h-4 text-slate-500 shrink-0" />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Você está sendo cadastrado como</p>
            <p className="font-bold text-white">{invite?.candidate.displayName}</p>
            <p className="text-xs text-slate-400">{[invite?.candidate.cargo, invite?.candidate.regiao].filter(Boolean).join(' · ')}</p>
          </div>
        </div>

        <div className="space-y-2">
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" placeholder="Seu e-mail" className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-white" />
          <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} type="password" placeholder="Crie uma senha (mín. 6)" className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-white" />
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="WhatsApp (opcional)" className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-white" />
        </div>
        {err && <p className="text-sm text-rose-400 mt-2">{err}</p>}
        <button onClick={submit} disabled={busy} className="w-full mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-4 py-3 font-bold flex items-center justify-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Concluir cadastro
        </button>
        <p className="text-[11px] text-slate-500 mt-3 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Seus dados ficam isolados — somente você e o presidente do partido têm acesso.</p>
      </div>
    </div>
  );
};

export default PublicPartyRegisterPage;
