import * as React from 'react';
import { Navigate } from 'react-router-dom';
import { authedFetch } from '../lib/authedFetch';
import { useAuth } from '../contexts/AuthContext';
import { useProfilePermissions } from '../contexts/PermissionsContext';
import { supabase } from '../lib/supabaseClient';
import { Sparkles, Check, Loader2, RefreshCw, LogOut } from 'lucide-react';
import Button from '../components/ui/Button';
import CheckoutDialog from '../components/billing/CheckoutDialog';
import { LOGO_MONO_BASE64 } from '../constants';

/**
 * Onboarding pago — "pagar antes de acessar". Mostra os planos comerciais e
 * abre o checkout (Asaas). O acesso ao /app só libera quando o pagamento é
 * confirmado (webhook seta campaign_configs.status='active'). Esta página
 * é o destino do gate enquanto a campanha está 'pending_payment'.
 */

const FEATURE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard', crm: 'CRM', help: 'Ajuda', visits: 'Visitas', team: 'Equipes',
  engagement: 'Engajamento', resources: 'Recursos', goals: 'Metas', routines: 'Rotinas',
  ai_agents: 'Agentes IA', forms: 'Formulários', analytics: 'Analytics', financial: 'Financeiro',
  content_studio: 'Estúdio', rag: 'Base IA (RAG)', meetings: 'Reuniões', tools: 'Ferramentas',
  training: 'Treinamento', whatsapp_omnichannel: 'WhatsApp', election_day: 'Dia das Eleições',
  intelligence: 'Inteligência', scenarios: 'Cenários', budget_ceo: 'Orçamento CEO',
  paperclip: 'Agentes-Tarefas', compliance: 'Conformidade',
};
const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });

const SubscribePage: React.FC = () => {
  const { user } = useAuth();
  const { config } = useProfilePermissions();
  const [plans, setPlans] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<any | null>(null);
  const [pix, setPix] = React.useState<{ qr?: string; copyPaste?: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    authedFetch('/api/v1/billing/plans')
      .then(r => r.json())
      .then(j => {
        const list = (Array.isArray(j) ? j : j.plans || []).filter((p: any) => p.id !== 'free' && p.active !== false);
        list.sort((a: any, b: any) => (a.monthlyCents || 0) - (b.monthlyCents || 0));
        setPlans(list);
      })
      .catch(() => setError('Não foi possível carregar os planos.'))
      .finally(() => setLoading(false));
  }, []);

  if (!user) return <Navigate to="/login" replace />;
  if (!user.campaignId) return <Navigate to="/welcome" replace />;
  // Já pago → entra no app
  if (config && config.status && config.status !== 'pending_payment') {
    return <Navigate to="/app" replace />;
  }

  const doCheckout = async (params: any) => {
    setError(null);
    const res = await authedFetch('/api/v1/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: selected.id, ...params }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error || 'Falha no checkout'); throw new Error(json.error); }
    if (json.pixQrCode || json.pixCopyPaste) {
      setPix({ qr: json.pixQrCode, copyPaste: json.pixCopyPaste });
      setSelected(null);
      return;
    }
    if (json.checkoutUrl) { window.location.href = json.checkoutUrl; return; }
    // Sem link nem PIX: NÃO redireciona (evitaria loop /app→/assinar).
    // A cobrança foi criada no Asaas; mostra orientação e o botão de já paguei.
    setSelected(null);
    setError('A cobrança foi criada, mas o link de pagamento ainda não ficou pronto. Aguarde alguns segundos e clique em "Assinar" de novo, ou pague pela cobrança em aberto no Asaas. O acesso libera automaticamente após a confirmação.');
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <img src={LOGO_MONO_BASE64} alt="CampanhaPro" className="h-9 w-9" />
            <div>
              <h1 className="text-xl font-black">Escolha seu plano</h1>
              <p className="text-xs text-slate-400">Ative sua campanha para acessar a plataforma.</p>
            </div>
          </div>
          <button onClick={() => supabase.auth.signOut().then(() => { window.location.href = '/login'; })} className="text-xs text-slate-400 hover:text-white flex items-center gap-1">
            <LogOut className="w-4 h-4" /> Sair
          </button>
        </div>

        {error && <p className="text-sm bg-red-500/10 text-red-400 rounded-lg p-3 mb-4">{error}</p>}

        {pix ? (
          <div className="max-w-md mx-auto bg-slate-800 rounded-2xl p-6 text-center space-y-4">
            <Sparkles className="w-10 h-10 text-emerald-400 mx-auto" />
            <h2 className="text-lg font-bold">Pague com PIX para ativar</h2>
            {pix.qr && <img src={pix.qr.startsWith('data:') ? pix.qr : `data:image/png;base64,${pix.qr}`} alt="PIX QR" className="w-56 h-56 mx-auto bg-white p-2 rounded-lg" />}
            {pix.copyPaste && (
              <div>
                <p className="text-[11px] text-slate-400 mb-1">PIX copia e cola:</p>
                <textarea readOnly value={pix.copyPaste} className="w-full bg-slate-900 border border-white/10 rounded p-2 text-[10px] font-mono" rows={3} onClick={(e) => (e.target as HTMLTextAreaElement).select()} />
              </div>
            )}
            <p className="text-xs text-slate-400">Após o pagamento, o acesso libera automaticamente.</p>
            <Button onClick={() => { window.location.href = '/app'; }} className="w-full"><RefreshCw className="w-4 h-4 mr-2" /> Já paguei — entrar</Button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-20 text-slate-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {plans.map((p, i) => (
              <div key={p.id} className={`bg-slate-800 rounded-2xl p-6 border ${i === 1 ? 'border-indigo-500' : 'border-white/5'} flex flex-col`}>
                {i === 1 && <span className="text-[9px] font-black uppercase bg-indigo-500 text-white px-2 py-0.5 rounded-full self-start mb-2">Mais popular</span>}
                <h3 className="text-lg font-black">{p.name}</h3>
                <p className="text-3xl font-black text-indigo-400 mt-1">{brl(p.monthlyCents)}<span className="text-xs text-slate-500 font-medium">/mês</span></p>
                <div className="flex flex-wrap gap-1 mt-4 flex-1">
                  {(p.features || []).slice(0, 14).map((f: string) => (
                    <span key={f} className="text-[10px] flex items-center gap-1 text-slate-300"><Check className="w-3 h-3 text-emerald-400" />{FEATURE_LABELS[f] || f}</span>
                  ))}
                </div>
                <Button onClick={() => setSelected(p)} className="w-full mt-5">Assinar {p.name}</Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <CheckoutDialog
        open={!!selected}
        planName={selected?.name || ''}
        monthlyCents={selected?.monthlyCents || 0}
        onClose={() => setSelected(null)}
        onSubmit={doCheckout}
      />
    </div>
  );
};

export default SubscribePage;
