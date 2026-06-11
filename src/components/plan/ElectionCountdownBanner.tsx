/**
 * Banner de contagem regressiva eleitoral — só pro PLANO GRÁTIS.
 *
 * Tom escalonado conforme a eleição se aproxima:
 *   > 90 dias   → não aparece (cedo demais, vira ruído)
 *   60–90 dias  → 🟦 azul, suave: "Você está usando o essencial. Plano Pro tem IA."
 *   30–60 dias  → 🟨 amarelo, atenção: "Concorrentes pagos rodam IA todo dia."
 *   15–30 dias  → 🟧 laranja, urgência: "Você vai chegar no Dia D com leitor de BU?"
 *   < 15 dias   → 🟥 vermelho pulsante, Opção C: confronto direto
 *
 * Dispensável por sessão (sessionStorage).
 */
import * as React from 'react';
import { ArrowRight, X, AlertTriangle, Sparkles, Zap, Skull } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePlanStatus, isFree, daysToElection } from '../../hooks/usePlanStatus';
import { useAuth } from '../../contexts/AuthContext';

const DISMISS_KEY = 'electionBannerDismissed';

interface Tier {
  cls: string;            // classes Tailwind p/ fundo + borda + texto
  icon: React.ReactNode;
  title: (days: number) => string;
  subtitle: string;
  cta: string;
  pulse?: boolean;
}

const TIERS: Tier[] = [
  { // 60-90 dias — info
    cls: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-200',
    icon: <Sparkles className="w-5 h-5 text-indigo-300 shrink-0" />,
    title: (d) => `Faltam ${d} dias para a eleição`,
    subtitle: 'No Plano Pro você tem IA estrategista, dossiê de adversários e disparo ilimitado.',
    cta: 'Ver Plano Pro',
  },
  { // 30-60 dias — atenção
    cls: 'bg-amber-500/10 border-amber-500/30 text-amber-100',
    icon: <Zap className="w-5 h-5 text-amber-300 shrink-0" />,
    title: (d) => `Faltam ${d} dias — campanha esquenta`,
    subtitle: 'Candidatos no Plano Pro já classificam milhares de eleitores com IA. Você ainda no manual?',
    cta: 'Equiparar com o Plano Pro',
  },
  { // 15-30 dias — urgência
    cls: 'bg-orange-500/15 border-orange-500/40 text-orange-100',
    icon: <AlertTriangle className="w-5 h-5 text-orange-300 shrink-0" />,
    title: (d) => `⚠️ ${d} dias para a eleição`,
    subtitle: 'Você vai chegar no Dia D sem leitor de BU? Sem dossiê do opositor? Sem disparo ilimitado?',
    cta: 'Ativar Plano Pro agora',
    pulse: true,
  },
  { // < 15 dias — Opção C: confronto direto + medo de perder
    cls: 'bg-rose-500/15 border-rose-500/50 text-rose-100',
    icon: <Skull className="w-5 h-5 text-rose-300 shrink-0" />,
    title: (d) => d <= 0 ? 'É HOJE. Última chance.' : `🔴 FALTAM ${d} DIAS`,
    subtitle: 'Seu opositor PODE estar usando IA, dossiê e Dia D agora mesmo. Você não vai descobrir só na apuração.',
    cta: 'NÃO PERDER POR FALTA DE FERRAMENTA',
    pulse: true,
  },
];

function tierFor(days: number): Tier | null {
  if (days < 0) return null;       // eleição já passou — não mostra
  if (days > 90) return null;      // cedo demais
  if (days >= 60) return TIERS[0];
  if (days >= 30) return TIERS[1];
  if (days >= 15) return TIERS[2];
  return TIERS[3];
}

const ElectionCountdownBanner: React.FC = () => {
  const { status } = usePlanStatus();
  const { user } = useAuth();
  const [dismissed, setDismissed] = React.useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  // Não mostra: pagantes, sem campanha, dispensado, fora da janela.
  if (!status || !isFree(status) || dismissed) return null;
  const days = daysToElection(status);
  if (days === null) return null;
  let tier = tierFor(days);
  if (!tier) return null;

  // Adaptação especial para candidato/coordenador/líder DE PARTIDO usando a
  // plataforma em modo cortesia. O texto evita "vire pago" e foca em mostrar
  // que o ESSENCIAL é cortesia do partido, mas o Pro libera IA/dossiê/Dia D.
  const isFromParty = user?.type === 'Candidato de Partido';
  if (isFromParty) {
    tier = {
      ...tier,
      subtitle: tier === TIERS[3]
        ? '🎁 O essencial é cortesia do seu partido. Mas IA, dossiê e Dia D só no Pro — e seu opositor pode estar usando.'
        : '🎁 Você tem o essencial de cortesia via partido. Quer IA, dossiê e Dia D? Plano Pro.',
      cta: 'Ver Plano Pro',
    };
  }

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* */ }
    setDismissed(true);
  };

  return (
    <div className={`relative border-b ${tier.cls} ${tier.pulse ? 'animate-pulse' : ''}`} style={{ animationDuration: '3s' }}>
      <div className="max-w-7xl mx-auto px-4 py-2.5 sm:py-3 flex items-center gap-3">
        {tier.icon}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight">{tier.title(days)}</p>
          <p className="text-[11px] sm:text-xs opacity-80 mt-0.5">{tier.subtitle}</p>
        </div>
        <Link to="/assinar"
          className="hidden sm:inline-flex items-center gap-1.5 text-xs font-bold bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5 whitespace-nowrap shrink-0">
          {tier.cta} <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <button onClick={dismiss} className="text-current opacity-60 hover:opacity-100 shrink-0" aria-label="Dispensar">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default ElectionCountdownBanner;
