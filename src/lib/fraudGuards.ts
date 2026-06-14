/**
 * Filtros antifraude multi-camada (#121).
 *
 * Filosofia: a IA é cara. Rejeitamos lixo estrutural com algoritmos
 * gratuitos ANTES de qualquer chamada de modelo. A IA fica como
 * última camada — só pros casos que sobraram em "pending_review".
 *
 * Camadas:
 *   1. Estrutural (regex/dígito) — μs, zero custo
 *   2. Cross-check banco (uniqueness, volume) — ~10ms, zero custo
 *   3. ViaCEP (cache + API gratuita) — ~100ms, zero custo
 *   4. IA — só pra revisão de pendentes (não roda aqui)
 *
 * LGPD: NÃO validamos Nome nem Título de Eleitor (decisão de produto).
 * CPF não é coletado (não existe no schema).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { lookupCep, normalizeCep } from './cepLookup';

export type ValidationSeverity = 'block' | 'review' | 'pass';

export interface ValidationReason {
  layer: 'structural' | 'crosscheck' | 'external';
  code: string;
  message: string;
  severity: 'block' | 'review';
}

export interface ContactValidationInput {
  campaignId: string;
  phone?: string | null;
  email?: string | null;
  birthDate?: string | null; // YYYY-MM-DD
  zipCode?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  createdByUserId?: string | null;
}

export interface ContactValidationResult {
  severity: ValidationSeverity;
  reasons: ValidationReason[];
  /** Sugestões de campo corrigido (ex: cidade do CEP). */
  enrichments?: { city?: string; uf?: string; bairro?: string };
}

// ============================================================
// CAMADA 1 — Validações estruturais (regex/algoritmos)
// ============================================================

/** DDDs válidos no Brasil (Anatel). 11-99 com vários buracos. */
const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Normaliza telefone BR pra 11 dígitos (DDD + 9 + 8 dígitos).
 * Retorna null se não bate.
 */
export function normalizePhoneBR(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = String(input).replace(/\D+/g, '');
  // Remove DDI 55 se veio
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('55')) d = d.slice(2);
  return d.length === 11 || d.length === 10 ? d : null;
}

function structuralPhone(phone: string): ValidationReason | null {
  const d = normalizePhoneBR(phone);
  if (!d) return { layer: 'structural', code: 'PHONE_FORMAT', message: 'Telefone fora do formato BR (DDD + número).', severity: 'block' };
  const ddd = Number(d.slice(0, 2));
  if (!VALID_DDDS.has(ddd)) return { layer: 'structural', code: 'PHONE_DDD', message: `DDD ${ddd} não existe na Anatel.`, severity: 'block' };
  // Celular tem 9 dígitos e o 1º é 9. Fixo tem 8 dígitos e 1º != 9.
  if (d.length === 11 && d[2] !== '9') return { layer: 'structural', code: 'PHONE_MOBILE', message: 'Celular precisa começar com 9 depois do DDD.', severity: 'block' };
  // Padrões claramente fake: todos dígitos iguais, sequenciais
  const after = d.slice(2);
  if (/^(\d)\1+$/.test(after)) return { layer: 'structural', code: 'PHONE_FAKE', message: 'Padrão de dígitos repetidos.', severity: 'block' };
  return null;
}

function structuralEmail(email: string): ValidationReason | null {
  // Regex RFC simplificada que pega 99% dos bobos sem ser frouxa demais
  const ok = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim());
  if (!ok) return { layer: 'structural', code: 'EMAIL_FORMAT', message: 'Email com formato inválido.', severity: 'block' };
  return null;
}

function structuralBirthDate(birthDate: string): ValidationReason | null {
  // Espera YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return { layer: 'structural', code: 'BIRTH_FORMAT', message: 'Data de nascimento fora do formato (AAAA-MM-DD).', severity: 'block' };
  }
  const d = new Date(birthDate + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return { layer: 'structural', code: 'BIRTH_INVALID', message: 'Data de nascimento inválida.', severity: 'block' };
  const now = new Date();
  if (d > now) return { layer: 'structural', code: 'BIRTH_FUTURE', message: 'Data de nascimento no futuro.', severity: 'block' };
  const yearsOld = (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (yearsOld > 120) return { layer: 'structural', code: 'BIRTH_TOO_OLD', message: 'Idade > 120 anos.', severity: 'block' };
  // Eleitor: mínimo 16 anos. Soft (vira review, não block — pode ser ajudante de campanha não-eleitor).
  if (yearsOld < 16) return { layer: 'structural', code: 'BIRTH_UNDER_16', message: 'Menor de 16 (não pode votar).', severity: 'review' };
  return null;
}

function structuralZipCode(zip: string): ValidationReason | null {
  const ok = normalizeCep(zip);
  if (!ok) return { layer: 'structural', code: 'CEP_FORMAT', message: 'CEP com formato inválido (precisa 8 dígitos).', severity: 'block' };
  return null;
}

// ============================================================
// CAMADA 2 — Cross-check banco
// ============================================================

async function crosscheckPhoneUnique(
  supabase: SupabaseClient, campaignId: string, phone: string,
): Promise<ValidationReason | null> {
  const d = normalizePhoneBR(phone);
  if (!d) return null;
  const { data } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('campaignId', campaignId)
    .eq('phone', d)
    .limit(1);
  if (data) {
    // count via head=true não devolve data; precisamos checar via outra forma
  }
  // 2ª tentativa — pega o primeiro
  const r2 = await supabase
    .from('contacts')
    .select('id')
    .eq('campaignId', campaignId)
    .eq('phone', d)
    .limit(1)
    .maybeSingle();
  if (r2?.data) return { layer: 'crosscheck', code: 'PHONE_DUPLICATE', message: 'Telefone já cadastrado nesta campanha.', severity: 'block' };
  return null;
}

async function crosscheckVolumeByUser(
  supabase: SupabaseClient, campaignId: string, userId: string,
): Promise<ValidationReason | null> {
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const { count } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('campaignId', campaignId)
    .eq('createdByUserId', userId)
    .gte('createdAt', since);
  if ((count || 0) >= 10) {
    return { layer: 'crosscheck', code: 'VOLUME_SUSPICIOUS', message: `Mesmo cadastrador inseriu ${count} contatos nos últimos 5 minutos.`, severity: 'review' };
  }
  return null;
}

async function crosscheckBairroExists(
  supabase: SupabaseClient, campaignId: string, neighborhood: string,
): Promise<ValidationReason | null> {
  // Bairro é considerado válido se já existe em outro contact OU em locations OU em visits.
  const b = neighborhood.trim();
  if (b.length < 2) return { layer: 'crosscheck', code: 'BAIRRO_TOO_SHORT', message: 'Bairro muito curto.', severity: 'review' };
  const [c1, c2] = await Promise.all([
    supabase.from('contacts').select('id').eq('campaignId', campaignId).eq('neighborhood', b).limit(1).maybeSingle(),
    supabase.from('locations').select('id').eq('campaignId', campaignId).ilike('name', b).limit(1).maybeSingle(),
  ]);
  if (c1?.data || c2?.data) return null;
  // Primeira ocorrência: não é fraude (poderia ser bairro novo), mas marca pra review
  // só se acompanhado de outro sinal — por isso devolve null aqui e fica de fora do
  // gatilho de severidade.
  return null;
}

// ============================================================
// CAMADA 3 — ViaCEP cross-ref
// ============================================================

async function externalCepLookup(
  supabase: SupabaseClient, zipCode: string, city: string | null,
): Promise<ValidationReason | null> {
  const info = await lookupCep(supabase, zipCode);
  if (!info) return null; // ViaCEP falhou — não bloqueia (tolerante)
  if (info.notFound) return { layer: 'external', code: 'CEP_NOT_FOUND', message: 'CEP não existe na base ViaCEP.', severity: 'block' };
  // Confere cidade (case + acento friendly)
  if (city && info.cidade) {
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    if (norm(city) !== norm(info.cidade)) {
      return { layer: 'external', code: 'CEP_CITY_MISMATCH', message: `CEP é de ${info.cidade}/${info.uf}, contato informa ${city}.`, severity: 'review' };
    }
  }
  return null;
}

// ============================================================
// Função principal
// ============================================================

/** Junta o resultado das camadas. Block > Review > Pass. */
function combine(reasons: ValidationReason[]): ValidationSeverity {
  if (reasons.some(r => r.severity === 'block')) return 'block';
  if (reasons.some(r => r.severity === 'review')) return 'review';
  return 'pass';
}

/**
 * Roda as 3 camadas determinísticas. NÃO chama IA — ela é a camada 4,
 * acionada manualmente por admin via UI ou pelo orquestrador quando
 * necessário. Esta função é segura pra rodar inline no INSERT.
 */
export async function validateContact(
  supabase: SupabaseClient,
  input: ContactValidationInput,
): Promise<ContactValidationResult> {
  const reasons: ValidationReason[] = [];

  // Camada 1 — estrutural
  if (input.phone) {
    const r = structuralPhone(input.phone);
    if (r) reasons.push(r);
  }
  if (input.email) {
    const r = structuralEmail(input.email);
    if (r) reasons.push(r);
  }
  if (input.birthDate) {
    const r = structuralBirthDate(input.birthDate);
    if (r) reasons.push(r);
  }
  if (input.zipCode) {
    const r = structuralZipCode(input.zipCode);
    if (r) reasons.push(r);
  }

  // Se já tem block estrutural, não vale gastar I/O no resto
  if (reasons.some(r => r.severity === 'block')) {
    return { severity: 'block', reasons };
  }

  // Camada 2 — banco
  const cross: (ValidationReason | null)[] = await Promise.all([
    input.phone ? crosscheckPhoneUnique(supabase, input.campaignId, input.phone) : Promise.resolve(null),
    input.createdByUserId ? crosscheckVolumeByUser(supabase, input.campaignId, input.createdByUserId) : Promise.resolve(null),
    input.neighborhood ? crosscheckBairroExists(supabase, input.campaignId, input.neighborhood) : Promise.resolve(null),
  ]);
  for (const r of cross) if (r) reasons.push(r);

  if (reasons.some(r => r.severity === 'block')) {
    return { severity: 'block', reasons };
  }

  // Camada 3 — ViaCEP (só se passou tudo)
  let enrichments: ContactValidationResult['enrichments'] = undefined;
  if (input.zipCode) {
    const r = await externalCepLookup(supabase, input.zipCode, input.city || null);
    if (r) reasons.push(r);
    else {
      // ViaCEP devolveu info OK — sugere enrich
      const info = await lookupCep(supabase, input.zipCode);
      if (info && !info.notFound) {
        enrichments = { city: info.cidade || undefined, uf: info.uf || undefined, bairro: info.bairro || undefined };
      }
    }
  }

  return { severity: combine(reasons), reasons, enrichments };
}
