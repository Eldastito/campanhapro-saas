/**
 * Shell do candidato (e coordenador/líder) de partido — Opção B.
 *
 * O usuário tem DUAS áreas:
 *  1. Tela enxuta de prestação de contas ao partido (PartyCandidatePage) — DEFAULT.
 *  2. Plataforma CampanhaPro completa, em modo cortesia (CampaignWebApp).
 *
 * A escolha persiste em sessionStorage (volta pra prestação ao re-logar).
 * A barreira já foi quebrada (eles estão logados) — aqui oferecemos a degustação.
 */
import * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import PartyCandidatePage from './PartyCandidatePage';
import CampaignWebApp from '../CampaignWebApp';
// CampaignWebApp já tem seu próprio DataProvider — não duplicar (causa double-subscribe
// em postgres_changes do Supabase Realtime e quebra o app inteiro).

const STORAGE_KEY = 'partyView';
type View = 'party' | 'platform';

export function setPartyView(v: View) {
  try { sessionStorage.setItem(STORAGE_KEY, v); } catch { /* */ }
  window.dispatchEvent(new CustomEvent('party-view-change', { detail: v }));
}

const PartyCandidateShell: React.FC = () => {
  const [view, setView] = React.useState<View>(() => {
    try { return (sessionStorage.getItem(STORAGE_KEY) as View) || 'party'; } catch { return 'party'; }
  });

  React.useEffect(() => {
    const onChange = (e: Event) => setView((e as CustomEvent).detail);
    window.addEventListener('party-view-change', onChange);
    return () => window.removeEventListener('party-view-change', onChange);
  }, []);

  if (view === 'platform') {
    return (
      <>
        {/* Botão flutuante de voltar pra prestação de contas (obrigação primária) */}
        <button
          onClick={() => setPartyView('party')}
          className="fixed top-3 left-3 z-[200] bg-amber-500/90 hover:bg-amber-500 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-lg flex items-center gap-1.5"
          title="Voltar à prestação de contas do partido"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Comprovação
        </button>
        <CampaignWebApp />
      </>
    );
  }
  return <PartyCandidatePage />;
};

export default PartyCandidateShell;
