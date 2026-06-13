/**
 * Áreas de Atendimento (Call Center F3).
 *
 * "Menu no mesmo número": quando a campanha define áreas (ex.: Financeiro,
 * Suporte, Jurídico), o eleitor que escreve no WhatsApp recebe um menu e
 * escolhe a área pelo número. A conversa é então roteada (channel_conversations
 * .areaId) e a IA passa a responder com a PERSONA daquela área.
 *
 * Áreas são opcionais: sem áreas ativas, o atendimento segue como receptivo
 * único (comportamento de F2, sem menu).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ServiceArea {
  id: string;
  name: string;
  description: string | null;
  persona: string | null;
  assignedUserId: string | null;
  position: number;
}

/** Áreas ativas da campanha, na ordem do menu. */
export async function loadActiveAreas(
  supabase: SupabaseClient, campaignId: string,
): Promise<ServiceArea[]> {
  const { data } = await supabase
    .from('service_areas')
    .select('id, name, description, persona, "assignedUserId", position')
    .eq('campaignId', campaignId)
    .eq('active', true)
    .order('position', { ascending: true })
    .order('createdAt', { ascending: true });
  return (data as ServiceArea[]) || [];
}

const MENU_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

/** Texto do menu enviado ao eleitor (tom de WhatsApp). */
export function buildAreaMenu(areas: ServiceArea[]): string {
  const lines = areas.map((a, i) =>
    `${MENU_EMOJI[i] ?? `${i + 1}.`} ${a.name}${a.description ? ` — ${a.description}` : ''}`,
  );
  return [
    'Para te direcionar para a equipe certa, responda com o *número* da opção:',
    '',
    ...lines,
  ].join('\n');
}

/**
 * Casa a resposta do eleitor com uma área: por número ("1", "2", inclusive
 * "1️⃣") ou pelo nome da área. Retorna null se nada bate (→ reapresenta o menu).
 */
export function matchAreaChoice(text: string, areas: ServiceArea[]): ServiceArea | null {
  const t = (text || '').trim().toLowerCase();
  if (!t || areas.length === 0) return null;

  // 1) por número (extrai dígitos, cobre "1", "opção 2", "2️⃣")
  const digits = t.replace(/[^\d]/g, '');
  if (/^\d+$/.test(digits)) {
    const n = parseInt(digits, 10);
    if (n >= 1 && n <= areas.length) return areas[n - 1];
  }
  // 2) por nome (igualdade exata)
  const exact = areas.find((a) => a.name.trim().toLowerCase() === t);
  if (exact) return exact;
  // 3) por nome (substring, mín. 3 chars pra evitar falso-positivo)
  if (t.length >= 3) {
    const contains = areas.find((a) => {
      const n = a.name.trim().toLowerCase();
      return t.includes(n) || n.includes(t);
    });
    if (contains) return contains;
  }
  return null;
}
