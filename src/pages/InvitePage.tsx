import * as React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { CheckCircle, Loader2, AlertTriangle, ShieldCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { LOGO_MONO_BASE64 } from '../constants';

interface InviteView {
  campaignName: string | null;
  role: string;
  invitedByName: string;
  expiresAt: string;
  status: string;
}

const InvitePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const { user, isInitializing } = useAuth();
  const navigate = useNavigate();

  const [invite, setInvite] = React.useState<InviteView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [accepting, setAccepting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    if (!token) { setError('Token ausente.'); setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`/api/v1/team/invites/token/${token}`);
        if (res.status === 404) { setError('Convite não encontrado.'); return; }
        if (res.status === 410) {
          const j = await res.json();
          setError(j.error === 'invite_expired' ? 'Convite expirado.' : `Convite ${j.error?.replace('invite_', '')}.`);
          return;
        }
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Erro ao verificar convite');
        setInvite(json.invite);
      } catch (err: any) {
        setError(err.message);
      } finally { setLoading(false); }
    })();
  }, [token]);

  const accept = async () => {
    if (!token) return;
    setAccepting(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/v1/team/invites/token/${token}/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
        },
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.error === 'email_mismatch') {
          throw new Error('Este convite foi enviado para outro email. Faça login com o email convidado.');
        }
        if (json.error === 'already_in_another_campaign') {
          throw new Error('Você já participa de outra campanha. Saia dela primeiro para aceitar este convite.');
        }
        if (json.error === 'invite_already_consumed') {
          throw new Error('Este convite já foi aceito.');
        }
        throw new Error(json.error ?? 'Erro ao aceitar convite');
      }
      setDone(true);
      setTimeout(() => { window.location.href = '/app'; }, 1500);
    } catch (err: any) {
      setError(err.message);
    } finally { setAccepting(false); }
  };

  if (loading || isInitializing) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <CheckCircle className="w-16 h-16 text-emerald-400 mb-4" />
        <h2 className="text-2xl font-bold text-slate-100 mb-2">Bem-vindo à equipe</h2>
        <p className="text-slate-400">Carregando seu painel...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
      <div className="text-center mb-8">
        <Link to="/"><img src={LOGO_MONO_BASE64} alt="CampanhaPro" className="h-12 w-12 mx-auto" /></Link>
      </div>

      <Card className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="w-5 h-5 text-indigo-400" />
          <h2 className="text-xl font-bold text-slate-100">Convite para campanha</h2>
        </div>

        {error ? (
          <div className="flex items-start gap-2 text-sm bg-red-500/10 text-red-300 border border-red-500/30 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : invite ? (
          <>
            <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4 space-y-2">
              <div>
                <p className="text-xs text-slate-500">Campanha</p>
                <p className="text-base font-semibold text-slate-100">{invite.campaignName ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Função</p>
                <p className="text-base font-medium text-slate-200">{invite.role}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Convidado por</p>
                <p className="text-sm text-slate-300">{invite.invitedByName}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">
                  Expira em {new Date(invite.expiresAt).toLocaleString('pt-BR')}
                </p>
              </div>
            </div>

            {!user ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-slate-400">
                  Faça login ou crie uma conta com o email para o qual o convite foi enviado.
                </p>
                <Button variant="primary" className="w-full" onClick={() => navigate(`/login?redirect=/invite/${token}`)}>
                  Entrar ou criar conta <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <p className="text-xs text-slate-500">
                  Logado como <span className="text-slate-300">{user.email}</span>
                </p>
                <Button variant="primary" className="w-full" onClick={accept} disabled={accepting}>
                  {accepting
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Aceitando...</>
                    : 'Aceitar convite e entrar na equipe'}
                </Button>
              </div>
            )}
          </>
        ) : null}
      </Card>
    </div>
  );
};

export default InvitePage;
