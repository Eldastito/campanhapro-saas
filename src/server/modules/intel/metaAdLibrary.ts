/**
 * Integração com a Biblioteca de Anúncios da Meta (Ad Library API).
 *
 * Endpoint público: GET https://graph.facebook.com/<v>/ads_archive
 * Para anúncios político/sociais no Brasil:
 *   ad_type=POLITICAL_AND_ISSUE_ADS, ad_reached_countries=["BR"]
 * Requer um access token (env META_ADLIBRARY_TOKEN). Pode ser o app token
 * "APP_ID|APP_SECRET" de um app no Meta for Developers, ou um user/system token.
 *
 * Dados retornados (anúncios políticos): página, criativos, período, faixa de
 * gasto e de impressões, moeda e link do snapshot. A Meta guarda por ~7 anos.
 */
const GRAPH = 'https://graph.facebook.com/v21.0/ads_archive';

export interface MetaAd {
  id: string;
  pageName: string | null;
  bodies: string;             // textos dos criativos (concatenados)
  startDate: string | null;
  stopDate: string | null;
  spend: string | null;       // faixa "R$ x–y"
  impressions: string | null; // faixa "x–y"
  platforms: string | null;
  snapshotUrl: string | null;
}

export interface AdLibraryResult {
  available: boolean;        // false quando falta token ou a API recusou
  reason?: string;
  total: number;
  ads: MetaAd[];
}

function fmtRange(r: any, prefix = ''): string | null {
  if (!r) return null;
  const lo = r.lower_bound, hi = r.upper_bound;
  if (lo == null && hi == null) return null;
  if (hi == null) return `${prefix}${lo}+`;
  return `${prefix}${lo}–${hi}`;
}

/** Busca anúncios político/sociais (BR) por termo (nome do adversário/página). */
export async function searchMetaAds(term: string, limit = 15): Promise<AdLibraryResult> {
  const token = process.env.META_ADLIBRARY_TOKEN;
  if (!token) return { available: false, reason: 'sem_token', total: 0, ads: [] };
  const q = (term || '').trim();
  if (!q) return { available: false, reason: 'sem_termo', total: 0, ads: [] };

  const fields = [
    'id', 'page_name', 'ad_creative_bodies', 'ad_creative_link_titles',
    'ad_delivery_start_time', 'ad_delivery_stop_time', 'spend', 'impressions',
    'currency', 'publisher_platforms', 'ad_snapshot_url',
  ].join(',');

  const url = `${GRAPH}?access_token=${encodeURIComponent(token)}`
    + `&search_terms=${encodeURIComponent(q)}`
    + `&ad_type=POLITICAL_AND_ISSUE_ADS`
    + `&ad_reached_countries=${encodeURIComponent('["BR"]')}`
    + `&ad_active_status=ALL`
    + `&fields=${fields}&limit=${Math.min(Math.max(limit, 1), 50)}`;

  try {
    const res = await fetch(url);
    const json: any = await res.json();
    if (json?.error) {
      return { available: false, reason: json.error.message || 'api_error', total: 0, ads: [] };
    }
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    const ads: MetaAd[] = data.map((a) => ({
      id: a.id,
      pageName: a.page_name ?? null,
      bodies: [...(a.ad_creative_bodies || []), ...(a.ad_creative_link_titles || [])].join(' | ').slice(0, 400),
      startDate: a.ad_delivery_start_time ? String(a.ad_delivery_start_time).slice(0, 10) : null,
      stopDate: a.ad_delivery_stop_time ? String(a.ad_delivery_stop_time).slice(0, 10) : null,
      spend: fmtRange(a.spend, (a.currency ? a.currency + ' ' : '')),
      impressions: fmtRange(a.impressions),
      platforms: Array.isArray(a.publisher_platforms) ? a.publisher_platforms.join(', ') : null,
      snapshotUrl: a.ad_snapshot_url ?? null,
    }));
    return { available: true, total: ads.length, ads };
  } catch (e: any) {
    return { available: false, reason: e?.message || 'fetch_failed', total: 0, ads: [] };
  }
}
