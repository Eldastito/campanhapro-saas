import * as React from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { LineChart, Brain, CheckCircle, ArrowRight, Sparkles, ShieldAlert } from 'lucide-react';
import { moduleByKey } from '../lib/modules';
import { useAuth } from '../contexts/AuthContext';
import { authedFetch } from '../lib/authedFetch';
import CheckoutDialog from '../components/billing/CheckoutDialog';

// Página comercial avulsa do módulo (add-on). Pública: serve cross-sell de
// Cenários/Inteligência pra quem está em Essencial/Estratégico e não quer
// subir pro Total. Lê preço de /api/v1/modules/pricing (rota pública).

interface ProductCopy {
  pitch: string;
  bullets: string[];
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  requires: string;
}

const COPY: Record<string, ProductCopy> = {
  cenarios: {
    pitch: 'Simule a campanha antes do voto. Monte Carlo dos cenários, projeção de meta, plano B com gatilho automático.',
    bullets: [
      'Simulação Monte Carlo dos cenários eleitorais',
      'Projeção de meta com bandas de confiança',
      'Plano B com gatilho automático quando a curva desviar',
      'Dossiê de bairros e adversários para a Sala de Guerra',
      'Histórico de simulações para comparar estratégias',
    ],
    icon: LineChart,
    accent: 'from-cyan-400 to-blue-500',
    requires: 'Requer plano Essencial ou superior. Os cenários consomem dados de CRM e visitas.',
  },
  inteligencia: {
    pitch: 'Leitura tática do território em tempo real. Mapeamento de adversários, sentimento por bairro, playbook estratégico.',
    bullets: [
      'Mapa de sentimento por bairro com calor em tempo real',
      'Dossiê competitivo de adversários e aliados',
      'Playbook estratégico atualizado pelo Exa',
      'Consulta TSE integrada (histórico de candidaturas)',
      'Relatórios prontos para a próxima reunião de campanha',
    ],
    icon: Brain,
    accent: 'from-violet-400 to-fuchsia-500',
    requires: 'Requer plano Essencial ou superior. A leitura tática cruza dados de visitas e CRM.',
  },
  legal_shield: {
    pitch: 'Copiloto contábil + jurídico que blinda a campanha ANTES da prestação de contas. Audita arrecadação e gastos contra as regras do TSE, aponta o risco e monta a tese de defesa.',
    bullets: [
      'Auditoria de receitas e despesas contra as regras do TSE/SPCE',
      'Detecção de fonte vedada, doação acima do limite e gasto sem comprovação',
      'Parecer com score de risco (baixo → crítico) por transação',
      'Tese de defesa com precedente favorável da jurisprudência oficial',
      'Base de regras atualizável (Resoluções TSE/TRE, manuais SPCE)',
    ],
    icon: ShieldAlert,
    accent: 'from-indigo-400 to-blue-600',
    requires: 'Requer plano pago ativo. É um copiloto de apoio — não substitui o responsável técnico (contador/advogado).',
  },
};

const formatBRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ProductPage: React.FC = () => {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const module = moduleByKey(slug);
  const copy = COPY[slug];
  const [monthlyCents, setMonthlyCents] = React.useState<number | null>(null);
  const [loadingPrice, setLoadingPrice] = React.useState(true);
  const [checkoutOpen, setCheckoutOpen] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/v1/modules/pricing');
        const json = await res.json();
        if (alive && json[slug]?.monthlyCents != null) setMonthlyCents(json[slug].monthlyCents);
      } finally {
        if (alive) setLoadingPrice(false);
      }
    })();
    return () => { alive = false; };
  }, [slug]);

  if (!module || !copy || !module.sellable) {
    return <Navigate to="/casos-de-uso" replace />;
  }

  const Icon = copy.icon;

  // Logado: abre o CheckoutDialog. Senão, leva pra cadastro preservando o
  // intent — depois do registro a gente leva o usuário pra cá de volta.
  const onPrimaryCta = () => {
    if (user?.campaignId) setCheckoutOpen(true);
    else navigate(`/register?next=${encodeURIComponent(`/produtos/${slug}`)}`);
  };

  const handleCheckoutSubmit = async (params: {
    name: string; email: string; cpfCnpj?: string; phone?: string;
    method: 'pix' | 'credit_card' | 'debit_card' | 'boleto' | 'undefined';
  }) => {
    const res = await authedFetch(`/api/v1/billing/addons/${slug}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || json.error || 'Falha no checkout');
    if (json.checkoutUrl) window.location.href = json.checkoutUrl;
    else navigate('/app');
  };

  const ctaLabel = user?.campaignId ? `Contratar ${module.name}` : `Criar conta para contratar`;

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white py-16 px-6 font-sans">
      <div className="max-w-4xl mx-auto">
        <button onClick={() => navigate(-1)} className="text-sm text-slate-400 hover:text-slate-200 mb-8">← Voltar</button>

        <header className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 rounded-full text-emerald-400 text-xs font-bold uppercase tracking-widest mb-6">
            <Sparkles className="w-3 h-3" /> Add-on avulso
          </div>
          <div className={`inline-flex w-20 h-20 rounded-2xl bg-gradient-to-br ${copy.accent} items-center justify-center mb-6`}>
            <Icon className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-5xl font-black mb-4">{module.name}</h1>
          <p className="text-gray-300 max-w-2xl mx-auto text-lg">{copy.pitch}</p>
        </header>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">O que entra</h2>
            <ul className="space-y-3">
              {copy.bullets.map((b) => (
                <li key={b} className="flex items-start gap-3 text-slate-200">
                  <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span className="text-sm leading-relaxed">{b}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-gradient-to-br from-slate-900/80 to-slate-800/40 border border-slate-700 rounded-2xl p-8 flex flex-col">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">Investimento</h2>
            <div className="flex-grow">
              {loadingPrice ? (
                <div className="h-12 bg-slate-800 rounded animate-pulse mb-3" />
              ) : monthlyCents != null ? (
                <>
                  <p className="text-5xl font-black text-white mb-1">{formatBRL(monthlyCents)}</p>
                  <p className="text-sm text-slate-400">por mês, recorrente</p>
                </>
              ) : (
                <p className="text-slate-400">Fale com a gente pra cotação.</p>
              )}
              <p className="text-xs text-slate-500 mt-6 leading-relaxed">{copy.requires}</p>
              <p className="text-xs text-slate-500 mt-3 leading-relaxed">
                Já incluso no plano <strong className="text-slate-300">Total</strong> (R$ 20.000/mês) — se quiser todos os módulos, vale mais a pena.
              </p>
            </div>
            <button
              onClick={onPrimaryCta}
              className={`w-full mt-6 bg-gradient-to-r ${copy.accent} text-slate-900 font-bold py-3 rounded-xl hover:opacity-90 transition flex items-center justify-center gap-2`}
            >
              {ctaLabel} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 text-center">
          <p className="text-sm text-slate-400">
            Prefere todos os add-ons + a plataforma cheia? Veja o plano <strong className="text-white">Total</strong> em <a href="/#pricing" className="text-emerald-400 hover:text-emerald-300">/#pricing</a>.
          </p>
        </div>
      </div>

      {monthlyCents != null && (
        <CheckoutDialog
          open={checkoutOpen}
          planName={`Add-on ${module.name}`}
          monthlyCents={monthlyCents}
          onClose={() => setCheckoutOpen(false)}
          onSubmit={handleCheckoutSubmit}
        />
      )}
    </div>
  );
};

export default ProductPage;
