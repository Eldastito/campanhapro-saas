import { supabase } from '../lib/supabaseClient';

export type VoterStage = 
  | 'capturado' 
  | 'validado' 
  | 'interessado' 
  | 'apoiador_confirmado' 
  | 'multiplicador' 
  | 'descadastrado' 
  | 'risco_rejeicao';

interface VoterJourneyData {
  contact: any;
  interactions: any[];
  visits: any[];
  pesquisas: any[];
}

/**
 * Calcula o estágio atual do eleitor baseado em regras auditáveis.
 */
export function calculateVoterStage(data: VoterJourneyData): VoterStage {
  const { contact, interactions, visits, pesquisas } = data;

  // 1. Regras de saída/rejeição (Prioridade máxima)
  if (contact.classification === 'Rejeição' || pesquisas.some(p => p.intencaoVoto === 'outro')) {
    return 'risco_rejeicao';
  }

  // 2. Regra de multiplicador (Trouxe novos contatos - simulado por tag ou contagem)
  const isMultiplier = contact.classification === 'Multiplicador' || (contact.tags && contact.tags.includes('Multiplicador'));
  if (isMultiplier) return 'multiplicador';

  // 3. Regra de apoiador confirmado
  const isSupporter = contact.classification === 'Apoiador' || pesquisas.some(p => p.intencaoVoto === 'candidato') || visits.some(v => v.votos > 0);
  if (isSupporter) return 'apoiador_confirmado';

  // 4. Regra de interessado (Interagiu 2+ vezes)
  if (interactions.length >= 2 || visits.length >= 1) {
    return 'interessado';
  }

  // 5. Regra de validado (Telefone e Bairro presentes)
  if (contact.phone && contact.neighborhood && contact.neighborhood !== 'Não Informado') {
    return 'validado';
  }

  // 6. Estágio inicial
  return 'capturado';
}

/**
 * Recomenda a Próxima Melhor Ação (NBA) baseada no estágio e dados.
 */
export function calculateNextBestAction(stage: VoterStage, _trustScore: number) {
  switch (stage) {
    case 'capturado':
      return {
        action: 'Validar Cadastro',
        reason: 'Eleitor recém capturado. Necessário confirmar bairro e telefone para segmentação.'
      };
    case 'validado':
      return {
        action: 'Enviar Convite de Boas-vindas',
        reason: 'Cadastro completo. Iniciar relacionamento via WhatsApp com pauta de interesse.'
      };
    case 'interessado':
      return {
        action: 'Convidar para Reunião/Evento',
        reason: 'Eleitor engajado. Momento de estreitar laços físicos ou em live.'
      };
    case 'apoiador_confirmado':
      return {
        action: 'Desafio de Multiplicação',
        reason: 'Apoio garantido. Pedir indicação de 3 amigos ou familiares.'
      };
    case 'multiplicador':
      return {
        action: 'Manutenção de Liderança',
        reason: 'Liderança ativa. Enviar material exclusivo e agradecer mobilização.'
      };
    case 'risco_rejeicao':
      return {
        action: 'Monitoramento Passivo',
        reason: 'Eleitor com tendência de rejeição. Evitar contato direto invasivo.'
      };
    default:
      return {
        action: 'Escuta Ativa',
        reason: 'Manter fluxo de comunicação para entender necessidades.'
      };
  }
}

// --- JOURNEY SYNC ---
export const updateVoterJourney = async (contactId: string, campaignId: string) => {
    try {
        const { data: contact } = await supabase.from('contacts').select('*').eq('id', contactId).single();
        if (!contact) return;
        
        const { data: interactions } = await supabase.from('contact_interactions').select('*').eq('contactId', contactId);
        const { data: visits } = await supabase.from('visits').select('*').eq('voterId', contactId);
        const { data: pesquisas } = await supabase.from('pesquisas').select('*').eq('campaignId', campaignId); // Melhorar filtro no futuro
        
        const currentStage = calculateVoterStage({ contact, interactions: interactions || [], visits: visits || [], pesquisas: pesquisas || [] });
        const nba = calculateNextBestAction(currentStage, 0);
        
        const { data: existingJourney } = await supabase.from('voter_journey').select('currentStage').eq('contactId', contactId).single();
        
        const journeyUpdate = {
            campaignId,
            contactId,
            currentStage,
            nextBestAction: nba.action,
            nextActionReason: nba.reason,
            updatedAt: new Date().toISOString()
        };

        if (existingJourney) {
            await supabase.from('voter_journey').update(journeyUpdate).eq('contactId', contactId);
        } else {
            await supabase.from('voter_journey').insert(journeyUpdate);
        }
        return currentStage;
    } catch (e) { console.error(e); }
};

/**
 * Sincroniza em massa contatos que não têm jornada iniciada.
 */
export async function syncVoterJourneys(campaignId: string) {
  try {
    // 1. Pegar todos os contatos que NÃO estão na voter_journey
    const { data: contactsWithoutJourney, error } = await supabase
      .from('contacts')
      .select('id')
      .eq('campaignId', campaignId);

    if (error || !contactsWithoutJourney) return;

    const { data: existingJourneys } = await supabase
      .from('voter_journey')
      .select('contactId')
      .eq('campaignId', campaignId);

    const existingIds = new Set(existingJourneys?.map(j => j.contactId) || []);
    const missingIds = contactsWithoutJourney.filter(c => !existingIds.has(c.id)).map(c => c.id);

    console.log(`[JOURNEY SYNC] Processando ${missingIds.length} contatos...`);

    for (const id of missingIds) {
      await updateVoterJourney(id, campaignId);
    }

    return missingIds.length;
  } catch (error) {
    console.error("Erro na sincronização em massa:", error);
    return 0;
  }
}
