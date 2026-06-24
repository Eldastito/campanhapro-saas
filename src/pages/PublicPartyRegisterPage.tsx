import * as React from 'react';
import { useParams } from 'react-router-dom';
import { Landmark, Lock, Loader2, CheckCircle2, ShieldCheck, Eye, EyeOff, Mail, Phone } from 'lucide-react';
import { SmokeyBackground } from '../components/ui/SmokeyBackground';

/**
 * Cadastro do candidato via link de convite do partido (público).
 * O nome do candidato vem do convite e fica TRAVADO — garante o vínculo e a
 * hierarquia. O convidado só define e-mail e senha.
 */
interface Invite { partyName: string; candidate: { displayName: string; cargo?: string; regiao?: string; phone?: string | null; email?: string | null }; alreadyRegistered: boolean; }

const INPUT_CLS = 'w-full rounded-xl border border-white/15 bg-white/5 py-3 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30';

const PublicPartyRegisterPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [invite, setInvite] = React.useState<Invite | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ email: '', password: '', phone: '' });
  const [showPassword, setShowPassword] = React.useState(false);
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
        if (j.candidate?.email) setForm((f) => ({ ...f, email: j.candidate.email }));
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

  if (loading) return (
    <main className="relative min-h-screen w-full overflow-hidden bg-slate-950">
      <SmokeyBackground color="#4f46e5" backdropBlurAmount="sm" className="absolute inset-0" />
      <div className="relative z-10 flex min-h-screen items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-400 animate-spin" /></div>
    </main>
  );

  if (err && !invite) {
    return (
      <main className="relative min-h-screen w-full overflow-hidden bg-slate-950">
        <SmokeyBackground color="#4f46e5" backdropBlurAmount="sm" className="absolute inset-0" />
        <div className="relative z-10 flex min-h-screen text-white items-center justify-center p-6"><p className="text-rose-400 font-bold">Convite inválido ou expirado.</p></div>
      </main>
    );
  }

  if (done || invite?.alreadyRegistered) {
    return (
      <main className="relative min-h-screen w-full overflow-hidden bg-slate-950">
        <SmokeyBackground color="#4f46e5" backdropBlurAmount="sm" className="absolute inset-0" />
        <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-white/15 bg-white/5 p-8 shadow-2xl backdrop-blur-xl text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <h1 className="text-2xl font-black text-white">Cadastro concluído!</h1>
            <p className="text-sm text-slate-300 mt-1 mb-5">Sua conta está pronta. Faça login para acessar.</p>
            <a href="/login" className="inline-block bg-indigo-600 hover:bg-indigo-500 rounded-xl px-6 py-3 font-bold text-white transition-all">Ir para o login</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-slate-950">
      <SmokeyBackground color="#4f46e5" backdropBlurAmount="sm" className="absolute inset-0" />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-5 rounded-2xl border border-white/15 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
          <div className="text-center">
            <Landmark className="w-10 h-10 text-indigo-400 mx-auto mb-2" />
            <p className="text-[11px] uppercase tracking-widest text-indigo-400 font-bold">{invite?.partyName}</p>
            <h1 className="text-2xl font-black text-white mt-1">Cadastro de candidato</h1>
          </div>

          {/* Nome travado (vínculo garantido pelo convite) */}
          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 flex items-center gap-2">
            <Lock className="w-4 h-4 text-slate-400 shrink-0" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Você está sendo cadastrado como</p>
              <p className="font-bold text-white">{invite?.candidate.displayName}</p>
              <p className="text-xs text-slate-400">{[invite?.candidate.cargo, invite?.candidate.regiao].filter(Boolean).join(' · ')}</p>
            </div>
          </div>

          {err && <p className="rounded-lg bg-red-500/15 p-3 text-center text-sm text-red-300">{err}</p>}

          <div className="space-y-3">
            {/* E-mail */}
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-[18px] h-[18px]" />
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" placeholder="Seu e-mail"
                className={`${INPUT_CLS} pl-10 pr-4`} autoComplete="email" />
            </div>

            {/* Senha com mostrar/ocultar */}
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-[18px] h-[18px]" />
              <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                type={showPassword ? 'text' : 'password'} placeholder="Crie uma senha (mín. 6)"
                className={`${INPUT_CLS} pl-10 pr-11`} autoComplete="new-password" />
              <button type="button" onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-white"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {/* WhatsApp */}
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-[18px] h-[18px]" />
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="WhatsApp (opcional)"
                className={`${INPUT_CLS} pl-10 pr-4`} />
            </div>
          </div>

          <button onClick={submit} disabled={busy}
            className="group w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white transition-all hover:bg-indigo-500 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Concluir cadastro
          </button>
          <p className="text-[11px] text-slate-500 text-center flex items-center justify-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Seus dados ficam isolados — somente você e o presidente do partido têm acesso.</p>
        </div>
      </div>
    </main>
  );
};

export default PublicPartyRegisterPage;
