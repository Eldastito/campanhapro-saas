/**
 * Sync leve de perfil PÚBLICO no Kwai (#123).
 *
 * Kwai NÃO tem API pública pra ler perfis. A oficial "Kwai for Business" é
 * só pra anunciantes comprarem mídia, não pra ler.
 *
 * Estratégia: fetch direto da página pública do perfil + regex em metadados
 * (og:title, og:description, structured-data JSON-LD embed). Bem mais leve
 * que headless-browser, mas frágil: se o Kwai mudar o HTML, quebra. Quando
 * quebrar, o socialRouter retorna o erro pro frontend e o agente IA é avisado
 * via fallback no #50 (web_search).
 *
 * Aceita tanto handle (@username) quanto URL completa.
 */

const KWAI_TIMEOUT_MS = 8000;
const KWAI_UA = 'Mozilla/5.0 (compatible; CampanhaProBot/1.0; +https://campanhapro.com)';

export interface KwaiSnapshot {
  handle: string | null;
  profileUrl: string;
  displayName: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  videosCount: number | null;
  raw: Record<string, any>;
  fetchedAt: string;
}

function normalizeHandle(input: string): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  // Aceita URL completa, retorna handle
  const urlMatch = trimmed.match(/kwai\.com\/(?:@|user\/)([\w._-]+)/i);
  if (urlMatch) return urlMatch[1].replace(/^@/, '');
  // Aceita @user ou user
  return trimmed.replace(/^@/, '').replace(/[^\w._-]/g, '') || null;
}

/** Tenta parse de números brasileiros: "1,2 mi" → 1_200_000, "12,5K" → 12500 */
function parseSocialCount(s: string | null | undefined): number | null {
  if (!s) return null;
  const clean = String(s).trim().toLowerCase().replace(/\./g, '').replace(',', '.');
  const m = clean.match(/^([\d.]+)\s*(k|mil|m|mi|milh|milhão|milhões|bi|b)?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'k' || unit === 'mil') return Math.round(n * 1_000);
  if (unit === 'm' || unit === 'mi' || unit.startsWith('milh')) return Math.round(n * 1_000_000);
  if (unit === 'bi' || unit === 'b') return Math.round(n * 1_000_000_000);
  return Math.round(n);
}

export async function fetchKwaiPublicProfile(rawInput: string): Promise<KwaiSnapshot> {
  const handle = normalizeHandle(rawInput);
  if (!handle) throw new Error('handle_invalido');

  const profileUrl = `https://www.kwai.com/@${handle}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), KWAI_TIMEOUT_MS);

  let html = '';
  try {
    const r = await fetch(profileUrl, {
      headers: {
        'User-Agent': KWAI_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`kwai_http_${r.status}`);
    html = await r.text();
  } finally {
    clearTimeout(t);
  }

  // Tenta extrair de meta tags (og:title, og:description) — caminho mais estável
  const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1] || null;
  const ogDesc = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1] || null;

  // JSON-LD embed (quando disponível)
  let jsonLdData: any = null;
  const jsonLd = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLd) {
    try { jsonLdData = JSON.parse(jsonLd[1]); } catch { /* ignora */ }
  }

  // Heurísticas no texto: "1,2K seguidores" / "12.345 fãs" / etc
  const followersMatch = html.match(/([\d.,]+\s*(?:K|M|mi|mil|milhões?|bi)?)\s*(?:seguidor(?:es)?|fãs|fãs|followers)/i);
  const followingMatch = html.match(/([\d.,]+\s*(?:K|M|mi|mil|milhões?|bi)?)\s*(?:seguindo|following)/i);
  const videosMatch = html.match(/([\d.,]+\s*(?:K|M|mi|mil)?)\s*(?:v[ií]deos?|posts?)/i);

  const displayName = ogTitle?.replace(/\s*[•·|]\s*Kwai\s*$/i, '').trim() || null;

  return {
    handle,
    profileUrl,
    displayName,
    bio: ogDesc,
    followers: parseSocialCount(followersMatch?.[1]),
    following: parseSocialCount(followingMatch?.[1]),
    videosCount: parseSocialCount(videosMatch?.[1]),
    raw: { ogTitle, ogDesc, jsonLd: jsonLdData },
    fetchedAt: new Date().toISOString(),
  };
}
