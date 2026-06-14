/**
 * Lookup de CEP via ViaCEP (gratuito, sem auth, ~60 req/min).
 * Cache em `cep_cache` pra zerar custo de rede em CEPs repetidos.
 *
 * Filosofia: NUNCA bloqueia o fluxo principal. Se ViaCEP cair ou der
 * timeout, devolve null e o validador faz fallback (não bloqueia o save).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CepInfo {
  cep: string;        // só dígitos
  cidade: string | null;
  uf: string | null;
  bairro: string | null;
  logradouro: string | null;
  fromCache: boolean;
  notFound: boolean;
}

const VIACEP_TIMEOUT_MS = 3500;

/** Normaliza pra 8 dígitos. Retorna null se não bate o formato. */
export function normalizeCep(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = String(input).replace(/\D+/g, '');
  return /^\d{8}$/.test(digits) ? digits : null;
}

export async function lookupCep(
  supabase: SupabaseClient,
  rawCep: string,
): Promise<CepInfo | null> {
  const cep = normalizeCep(rawCep);
  if (!cep) return null;

  // 1) Cache
  try {
    const { data: cached } = await supabase
      .from('cep_cache')
      .select('cep, logradouro, bairro, cidade, uf, "notFound"')
      .eq('cep', cep)
      .maybeSingle();
    if (cached) {
      return {
        cep,
        cidade: (cached as any).cidade,
        uf: (cached as any).uf,
        bairro: (cached as any).bairro,
        logradouro: (cached as any).logradouro,
        fromCache: true,
        notFound: !!(cached as any).notFound,
      };
    }
  } catch { /* segue */ }

  // 2) ViaCEP
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), VIACEP_TIMEOUT_MS);
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const notFound = !!j?.erro;
    const info: CepInfo = {
      cep,
      cidade: notFound ? null : String(j.localidade || '').trim() || null,
      uf: notFound ? null : String(j.uf || '').trim().toUpperCase() || null,
      bairro: notFound ? null : String(j.bairro || '').trim() || null,
      logradouro: notFound ? null : String(j.logradouro || '').trim() || null,
      fromCache: false,
      notFound,
    };
    // Salva cache (fire-and-forget, não bloqueia)
    void supabase.from('cep_cache').upsert({
      cep,
      logradouro: info.logradouro,
      bairro: info.bairro,
      cidade: info.cidade,
      uf: info.uf,
      notFound: info.notFound,
    }, { onConflict: 'cep' });
    return info;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
