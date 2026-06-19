/**
 * Modal de upgrade — Opção C (confronto + medo de perder + Dia D).
 *
 * Aparece quando o usuário tenta usar uma ação travada (IA, Dia D, etc.) ou
 * estoura uma cota (WhatsApp/dia). Texto muda conforme a feature.
 *
 * Tom: campanha não se ganha com o básico. Faltam X dias. Seu opositor já pode
 * estar usando. Não chegue no Dia D sem o Plano Pro.
 */
import * as React from 'react';
import DOMPurify from 'dompurify';
import { Sparkles, X, ArrowRight, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';

interface CtaCopy { title: string; bullets: string[]; cta: string; }

const COPY: Record<string, CtaCopy> = {
  ai_calls: {
    title: '🤖 IA estrategista está no Plano Pro',
    bullets: [
      'Classifica seus eleitores em apoiador / indeciso / opositor em minutos',
      'Gera dossiês completos de adversários a partir de fontes públicas',
      'Sugere estratégia personalizada com base na sua base real',
      '**Seu opositor já pode estar usando.** Você não vai querer descobrir no dia.',
    ],
    cta: 'Ativar IA agora',
  },
  ai_trial: {
    title: '🎯 Você usou toda a cota do seu trial',
    bullets: [
      'Foi um aperitivo — no Plano Pro a IA é ilimitada',
      'Continue classificando eleitores sem limite',
      'Faça dossiês de todos os opositores',
      '**O trial acaba — a campanha não.** Não pare agora.',
    ],
    cta: 'Continuar com o Plano Pro',
  },
  whatsapp_blast: {
    title: '📱 Você atingiu o limite diário de WhatsApp',
    bullets: [
      'O Plano Grátis libera 100 disparos por dia (para você testar)',
      'No Plano Pro o disparo é ilimitado e segmentado',
      'Sua base de eleitores está aí — pronta pra ser ativada',
      '**Mensagem certa, no momento certo, ganha eleição.**',
    ],
    cta: 'Desbloquear disparo ilimitado',
  },
  election_day: {
    title: '🗳️ Leitor de BU é exclusivo do Plano Pro',
    bullets: [
      'Leitura do QR Code do Boletim de Urna no padrão TRE/TSE 2026',
      'Você sabe o resultado da seção antes do TSE divulgar',
      'Seus fiscais já chegam treinados no Dia D',
      '**Faltam poucos dias. Não chegue no Dia D sem isso.**',
    ],
    cta: 'Garantir Dia D agora',
  },
  forms: {
    title: '📝 Você atingiu o limite de formulários',
    bullets: [
      'No Plano Grátis: 5 formulários ativos (suficiente pra testar)',
      'No Plano Pro: ilimitados + Form Builder + landing pages públicas',
      'Cada formulário a mais é uma fonte de lead a mais',
    ],
    cta: 'Desbloquear formulários',
  },
  team_members: {
    title: '👥 Você atingiu o limite de membros da equipe',
    bullets: [
      'No Plano Grátis: 10 membros por perfil (já bom pra começar)',
      'No Plano Pro: equipe ilimitada + metas + gamificação',
      'Quanto mais gente em campo, mais voto na rua',
    ],
    cta: 'Ampliar equipe',
  },
  default: {
    title: '⚡ Esta ação faz parte do Plano Pro',
    bullets: [
      'A IA estrategista, o disparo ilimitado e o Dia D estão no Plano Pro',
      'Eleição não se ganha com o básico',
      'Seu opositor pode já estar usando',
      '**Faltam dias. Não chegue na reta final sem isso.**',
    ],
    cta: 'Ver Plano Pro',
  },
};

interface Props {
  open: boolean;
  onClose: () => void;
  feature?: string;            // 'ai_calls' | 'whatsapp_blast' | 'election_day' | ...
  customMessage?: string;       // sobrescreve o título se o backend enviou um
  daysToElection?: number;      // se conhecido, reforça urgência
  showRefusalCta?: boolean;     // mostra o botão "Não, vou arriscar" (Opção C)
}

const UpgradeModal: React.FC<Props> = ({
  open, onClose, feature = 'default', customMessage, daysToElection, showRefusalCta = true,
}) => {
  if (!open) return null;
  const copy = COPY[feature] || COPY.default;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={onClose}>
      <div className="bg-gradient-to-br from-slate-900 to-[#0a0a0b] border border-indigo-500/30 rounded-3xl max-w-lg w-full p-6 sm:p-8 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>

        {daysToElection !== undefined && daysToElection > 0 && (
          <div className="inline-flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-bold px-3 py-1.5 rounded-full mb-4">
            <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
            Faltam {daysToElection} dias para a eleição
          </div>
        )}

        <div className="flex items-start gap-3 mb-4">
          <div className="bg-indigo-500/15 border border-indigo-500/30 rounded-2xl p-3 shrink-0">
            <Sparkles className="w-6 h-6 text-indigo-300" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xl sm:text-2xl font-black text-white leading-tight">{customMessage || copy.title}</h3>
            <p className="text-xs text-slate-400 mt-1">Você está no Plano Grátis</p>
          </div>
        </div>

        <ul className="space-y-2 mb-6">
          {copy.bullets.map((b, i) => (
            <li key={i} className="text-sm text-slate-300 flex gap-2"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(`<span class="text-indigo-400 shrink-0">✓</span> <span>${b.replace(/\*\*(.+?)\*\*/g, '<b class="text-rose-300">$1</b>')}</span>`) }} />
          ))}
        </ul>

        <div className="space-y-2">
          <Link to="/assinar" onClick={onClose}
            className="w-full bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 rounded-xl px-4 py-3 font-bold flex items-center justify-center gap-2 text-white shadow-lg shadow-indigo-600/30">
            <Sparkles className="w-4 h-4" /> {copy.cta} <ArrowRight className="w-4 h-4" />
          </Link>
          {showRefusalCta && (
            <button onClick={onClose}
              className="w-full bg-transparent border border-white/10 hover:bg-white/5 rounded-xl px-4 py-2.5 font-bold text-slate-400 text-sm">
              Não, vou arriscar sem isso
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpgradeModal;

/** Indicador de "travado" reutilizável: cadeado + tooltip. */
export const LockBadge: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 ${className}`}>
    <Lock className="w-2.5 h-2.5" /> PRO
  </span>
);
