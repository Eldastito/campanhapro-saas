import { authedFetch } from '../lib/authedFetch';
import * as React from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Sparkles, Loader2, CheckCircle, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { LOGO_MONO_BASE64 } from '../constants';

/**
 * First-time tenant setup. Runs once after signup — collects the campaign
 * metadata then POSTs /api/v1/onboarding/bootstrap to create the campaign +
 * user row + free subscription. Idempotent on the server, so refresh-during-
 * submit is safe.
 */
const WelcomePage: React.FC = () => {
  const { user, isInitializing } = useAuth();
  const navigate = useNavigate();
  const [accountType, setAccountType] = React.useState<'campaign' | 'party'>('campaign');
  const [campaignName, setCampaignName] = React.useState('');
  const [candidateName, setCandidateName] = React.useState('');
  const [party, setParty] = React.useState('');
  const [partyName, setPartyName] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const isParty = accountType === 'party';

  // If still loading auth → spinner
  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    );
  }

  // If not logged in → kick to login
  if (!user) return <Navigate to="/login" replace />;

  // If already bootstrapped → straight to app (campanha OU presidente de partido).
  if (user.campaignId || user.type === 'Presidente de Partido') return <Navigate to="/app" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isParty ? !partyName.trim() : !campaignName.trim()) {
      setError(isParty ? 'Nome do partido é obrigatório' : 'Nome da campanha é obrigatório');
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão expirada');

      const body = isParty
        ? { accountType: 'party', partyName: partyName.trim() }
        : {
            accountType: 'campaign',
            campaignName: campaignName.trim(),
            candidateName: candidateName.trim() || undefined,
            party: party.trim() || undefined,
          };

      const res = await authedFetch('/api/v1/onboarding/bootstrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? (isParty ? 'Erro ao criar partido' : 'Erro ao criar campanha'));

      setDone(true);
      setTimeout(() => {
        // Partido entra direto no painel (cobrança é manual). Campanha vai pro
        // fluxo de plano/pagamento.
        window.location.href = isParty ? '/app' : '/assinar';
      }, 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="text-center">
          <CheckCircle className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-100 mb-2">{isParty ? 'Partido criado' : 'Campanha criada'}</h2>
          <p className="text-slate-400">Carregando seu painel...</p>
          <Loader2 className="w-5 h-5 animate-spin text-slate-500 mx-auto mt-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
      <div className="text-center mb-8">
        <img src={LOGO_MONO_BASE64} alt="CampanhaPro" className="h-12 w-12 mx-auto" />
      </div>

      <Card className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-indigo-400" />
          <h2 className="text-2xl font-bold text-slate-100">Bem-vindo ao CampanhaPro</h2>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Primeiro, que tipo de conta você quer criar?
        </p>

        {/* Seletor de tipo de conta: Campanha (candidato) vs Partido (presidente). */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <button
            type="button"
            onClick={() => { setAccountType('campaign'); setError(null); }}
            className={`text-left rounded-xl border p-3 transition-colors ${!isParty ? 'border-indigo-500/70 bg-indigo-500/10' : 'border-slate-700 bg-slate-800 hover:border-slate-600'}`}
          >
            <p className="text-sm font-semibold text-slate-200">Campanha</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Candidato/equipe gerindo uma campanha eleitoral.</p>
          </button>
          <button
            type="button"
            onClick={() => { setAccountType('party'); setError(null); }}
            className={`text-left rounded-xl border p-3 transition-colors ${isParty ? 'border-indigo-500/70 bg-indigo-500/10' : 'border-slate-700 bg-slate-800 hover:border-slate-600'}`}
          >
            <p className="text-sm font-semibold text-slate-200">Partido</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Presidente de partido gerindo vários candidatos e repasses.</p>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isParty ? (
            <Input
              label="Nome do partido *"
              id="partyName"
              type="text"
              value={partyName}
              onChange={e => setPartyName(e.target.value)}
              placeholder="Ex: Partido Exemplo — Diretório Municipal"
              required
              autoFocus
            />
          ) : (
            <>
              <Input
                label="Nome da campanha *"
                id="campaignName"
                type="text"
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                placeholder="Ex: Campanha João Silva 2026"
                required
                autoFocus
              />
              <Input
                label="Nome do candidato"
                id="candidateName"
                type="text"
                value={candidateName}
                onChange={e => setCandidateName(e.target.value)}
                placeholder="opcional"
              />
              <Input
                label="Partido"
                id="party"
                type="text"
                value={party}
                onChange={e => setParty(e.target.value)}
                placeholder="opcional"
              />
            </>
          )}

          {error && (
            <p className="text-sm bg-red-500/10 text-red-400 rounded-lg p-3">{error}</p>
          )}

          <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 text-xs text-slate-400">
            {isParty ? (
              <>
                <p className="font-medium text-slate-300 mb-1">Acesso ao módulo do partido</p>
                <p>Você entra direto no painel do Presidente para cadastrar candidatos, repasses e relatórios. A forma de cobrança é combinada à parte com nossa equipe.</p>
              </>
            ) : (
              <>
                <p className="font-medium text-slate-300 mb-1">Próximo passo: escolher seu plano</p>
                <p>Depois de criar a campanha, você escolhe entre <span className="text-slate-200">Essencial, Estratégico ou Total</span> e ativa o acesso pagando com PIX, cartão ou boleto.</p>
              </>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{isParty ? 'Criando partido...' : 'Criando campanha...'}</>
              : <>{isParty ? 'Criar partido e entrar' : 'Criar campanha e entrar'} <ArrowRight className="w-4 h-4 ml-1" /></>}
          </Button>
        </form>

        <p className="text-[10px] text-slate-500 text-center mt-4">
          Logado como {user.email}. <button className="underline hover:text-slate-300" onClick={() => supabase.auth.signOut().then(() => navigate('/login'))}>Sair</button>
        </p>
      </Card>
    </div>
  );
};

export default WelcomePage;
