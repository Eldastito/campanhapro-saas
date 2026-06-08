import { supabase } from './supabaseClient';

/**
 * Geocodificação com cache em banco (geo_cache). Primeiro consulta o cache;
 * em miss, chama o Nominatim (OpenStreetMap) com throttle (~1.1s, política de
 * uso) e persiste o resultado — então fica instantâneo nas próximas vezes.
 * Retorna null quando não encontra (e cacheia o null pra não repetir).
 */
export interface LatLng { lat: number; lng: number; }

const inflight = new Map<string, Promise<LatLng | null>>();
let lastCall = 0;

export async function geocode(rawQuery: string): Promise<LatLng | null> {
  const key = rawQuery.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key) return null;
  if (inflight.has(key)) return inflight.get(key)!;

  const task = (async (): Promise<LatLng | null> => {
    // 1. Cache
    try {
      const { data } = await supabase.from('geo_cache').select('lat,lng').eq('query', key).maybeSingle();
      if (data) return (data.lat != null && data.lng != null) ? { lat: data.lat, lng: data.lng } : null;
    } catch { /* segue p/ rede */ }

    // 2. Nominatim (throttle p/ respeitar a política de 1 req/s)
    const wait = Math.max(0, 1100 - (Date.now() - lastCall));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(rawQuery)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const arr = await res.json();
      if (Array.isArray(arr) && arr[0]?.lat) {
        const coord = { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) };
        supabase.from('geo_cache').upsert({ query: key, lat: coord.lat, lng: coord.lng }).then(() => {}, () => {});
        return coord;
      }
      // miss → cacheia null p/ não reconsultar
      supabase.from('geo_cache').upsert({ query: key, lat: null, lng: null }).then(() => {}, () => {});
    } catch { /* offline / erro de rede */ }
    return null;
  })();

  inflight.set(key, task);
  return task;
}

/** Geocodifica vários alvos em sequência (respeita o throttle interno). */
export async function geocodeMany(queries: string[]): Promise<Record<string, LatLng>> {
  const out: Record<string, LatLng> = {};
  for (const q of queries) {
    const r = await geocode(q);
    if (r) out[q] = r;
  }
  return out;
}
