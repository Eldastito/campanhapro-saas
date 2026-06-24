import * as React from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, MapPin } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { supabase } from '../lib/supabaseClient';

/**
 * TELÃO público do PARTIDO (link tokenizado, sem login). Para o presidente
 * projetar em reunião: mapa ao vivo dos comitês (cor = saúde do candidato),
 * check-ins e o placar 🟢🟡🔴 do partido. NÃO expõe valores em R$.
 *
 * Mapa: MapLibre GL (WebGL, vetorial) com CLUSTERING — resolve a sobreposição
 * de dezenas de pinos na mesma região (ex.: zona metropolitana do RJ). O cluster
 * herda a cor da PIOR saúde que contém (tem algum 🔴 → vermelho; senão 🟡; senão
 * 🟢), então a leitura de saúde continua mesmo agrupado. Zoom in expande.
 */
const LEVEL_COLOR: Record<string, string> = { green: '#10b981', yellow: '#f59e0b', red: '#f43f5e' };
const esc = (s: any) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c] || c));
const SAFETY_POLL_MS = 120_000; // rede de segurança caso um broadcast se perca
// Base RASTER do Carto (as MESMAS tiles que o telão Leaflet usava e que já
// funcionavam nesta rede) — evita depender do style.json vetorial, que pode
// falhar silenciosamente em alguns ambientes. glyphs do Carto p/ o nº do cluster.
const BASE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf',
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0a0a0b' } },
    { id: 'carto', type: 'raster', source: 'carto' },
  ],
};

interface TelaoPoint { displayName: string; local: string | null; approx?: boolean; noCommittee?: boolean; lat: number | null; lng: number | null; hasPhoto: boolean; photoUrl?: string | null; level: string; checkins: number; }
interface TelaoData { partyName: string; channel?: string; points: TelaoPoint[]; checkinPoints: { lat: number; lng: number }[]; stats: { candidates: number; committees: number; checkins: number; green: number; yellow: number; red: number }; }

const PartyTelaoPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = React.useState<TelaoData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [lightbox, setLightbox] = React.useState<string | null>(null);
  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const readyRef = React.useRef(false);
  const dataRef = React.useRef<TelaoData | null>(null);
  // Telão fica numa TV/projetor: uma falha de refresh NÃO pode trocar o mapa já
  // carregado por uma tela de erro. Só erra full-screen na 1ª carga.
  const hasDataRef = React.useRef(false);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/public/party/telao/${token}`);
      if (!r.ok) { if (!hasDataRef.current) setError('Telão não encontrado ou link inválido.'); return; }
      setData(await r.json()); hasDataRef.current = true; setError(null);
    } catch { if (!hasDataRef.current) setError('Falha ao carregar.'); }
    finally { setLoading(false); }
  }, [token]);

  React.useEffect(() => { load(); const t = setInterval(load, SAFETY_POLL_MS); return () => clearInterval(t); }, [load]);

  // Tempo real: assina o canal Broadcast do partido. O backend dá um "ping" quando
  // há comitê/check-in/repasse novo → re-buscamos na hora (sem expor tabela a RLS).
  React.useEffect(() => {
    const topic = data?.channel;
    if (!topic) return;
    const ch = supabase.channel(topic).on('broadcast', { event: 'update' }, () => { load(); }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [data?.channel, load]);

  // Atualiza as fontes do mapa + enquadra. Chamado no load do mapa e a cada `data`.
  const draw = React.useCallback(() => {
    const map = mapRef.current;
    const d = dataRef.current;
    if (!map || !readyRef.current || !d) return;

    const candFeatures = d.points
      .filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number')
      .map((p) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lng as number, p.lat as number] },
        properties: {
          displayName: p.displayName,
          sub: p.noCommittee
            ? `${p.local ? p.local + ' · ' : ''}sem comitê · local aproximado`
            : (p.local ? `${p.local}${p.approx ? ' (aprox.)' : ''}` : ''),
          level: p.level || 'red',
          checkins: p.checkins || 0,
          hasPhoto: !!p.hasPhoto,
          photoUrl: p.photoUrl || '',
          noCommittee: !!p.noCommittee,
        },
      }));
    const checkinFeatures = d.checkinPoints
      .filter((p) => typeof p.lat === 'number')
      .map((p) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] }, properties: {} }));

    (map.getSource('cands') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: candFeatures });
    (map.getSource('checkins') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: checkinFeatures });

    // Enquadra em todos os pontos válidos.
    const all = [...candFeatures, ...checkinFeatures].map((f) => f.geometry.coordinates as [number, number]);
    if (all.length === 1) {
      map.easeTo({ center: all[0], zoom: 13, duration: 600 });
    } else if (all.length > 1) {
      const b = new maplibregl.LngLatBounds(all[0], all[0]);
      all.forEach((c) => b.extend(c));
      try { map.fitBounds(b, { padding: 80, maxZoom: 13, duration: 600 }); } catch { /* */ }
    }
  }, []);

  // Init do mapa (1x).
  React.useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: BASE_STYLE,
      center: [-43.1729, -22.9068],
      zoom: 7,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    // Se algo falhar (tiles/glyphs/estilo), loga no console — diagnóstico.
    map.on('error', (e: any) => console.error('[telao maplibre]', e?.error?.message || e?.error || e));

    map.on('load', () => {
      // Candidatos — fonte clusterizada. clusterProperties agrega a saúde p/ o
      // cluster herdar a cor da PIOR situação que contém.
      map.addSource('cands', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterRadius: 48,
        clusterMaxZoom: 13,
        clusterProperties: {
          red: ['+', ['case', ['==', ['get', 'level'], 'red'], 1, 0]],
          yellow: ['+', ['case', ['==', ['get', 'level'], 'yellow'], 1, 0]],
        },
      });
      map.addSource('checkins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      // Check-ins — bolinhas azuis pequenas (camada de fundo).
      map.addLayer({
        id: 'checkin-pts', type: 'circle', source: 'checkins',
        paint: { 'circle-radius': 4, 'circle-color': '#38bdf8', 'circle-opacity': 0.5, 'circle-stroke-color': '#0ea5e9', 'circle-stroke-width': 1 },
      });

      // Clusters — cor pela pior saúde (algum vermelho → vermelho; senão amarelo; senão verde).
      const clusterColor = ['case', ['>', ['get', 'red'], 0], LEVEL_COLOR.red, ['>', ['get', 'yellow'], 0], LEVEL_COLOR.yellow, LEVEL_COLOR.green] as any;
      map.addLayer({
        id: 'clusters', type: 'circle', source: 'cands', filter: ['has', 'point_count'],
        paint: {
          'circle-color': clusterColor,
          'circle-opacity': 0.85,
          'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
          'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 30],
        },
      });
      map.addLayer({
        id: 'cluster-count', type: 'symbol', source: 'cands', filter: ['has', 'point_count'],
        layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['Open Sans Bold'], 'text-size': 13 },
        paint: { 'text-color': '#fff' },
      });

      // Candidatos individuais — cor pela saúde; sem comitê = mais transparente.
      map.addLayer({
        id: 'cand-pts', type: 'circle', source: 'cands', filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['match', ['get', 'level'], 'green', LEVEL_COLOR.green, 'yellow', LEVEL_COLOR.yellow, 'red', LEVEL_COLOR.red, '#94a3b8'],
          'circle-radius': ['case', ['get', 'noCommittee'], 7, 9],
          'circle-opacity': ['case', ['get', 'noCommittee'], 0.4, 0.95],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': ['case', ['get', 'noCommittee'], 1, 2],
        },
      });

      // Popup do candidato.
      const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 12, maxWidth: '260px' });
      map.on('click', 'cand-pts', (e) => {
        const f = e.features?.[0]; if (!f) return;
        const p = f.properties as any;
        const color = LEVEL_COLOR[p.level] || '#94a3b8';
        const coords = (f.geometry as any).coordinates.slice();
        const url = p.photoUrl && p.photoUrl !== 'null' ? String(p.photoUrl) : '';
        const photoHtml = url
          ? `<img src="${esc(url)}" class="telao-photo" alt="comitê" style="margin-top:8px;width:100%;height:96px;object-fit:cover;border-radius:8px;cursor:zoom-in" />`
          : '';
        const html = `<div style="min-width:180px;font-family:system-ui"><b>${esc(p.displayName)}</b>${p.sub ? `<br/><span style="opacity:.7">${esc(p.sub)}</span>` : ''}<br/><span style="color:${color}">●</span> ${p.checkins} check-in(s)${photoHtml}</div>`;
        popup.setLngLat(coords).setHTML(html).addTo(map);
        // Clique na foto → abre o lightbox (expande). setLightbox é estável.
        const img = popup.getElement()?.querySelector('.telao-photo') as HTMLImageElement | null;
        if (img && url) img.onclick = () => setLightbox(url);
      });

      // Clique no cluster → expande (zoom).
      map.on('click', 'clusters', async (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
        if (!f) return;
        const clusterId = (f.properties as any).cluster_id;
        const src = map.getSource('cands') as maplibregl.GeoJSONSource;
        try {
          const zoom = await src.getClusterExpansionZoom(clusterId);
          map.easeTo({ center: (f.geometry as any).coordinates, zoom: zoom + 0.5, duration: 500 });
        } catch { /* */ }
      });

      // Cursor pointer nas camadas clicáveis.
      for (const layer of ['cand-pts', 'clusters']) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      }

      readyRef.current = true;
      draw();
    });

    return () => { map.remove(); mapRef.current = null; readyRef.current = false; };
  }, [draw]);

  // Redesenha quando os dados mudam.
  React.useEffect(() => { dataRef.current = data; draw(); }, [data, draw]);

  // IMPORTANTE: o container do mapa é renderizado SEMPRE (mesmo em loading/erro),
  // senão o useEffect de init roda antes do <div> existir e o mapa nunca é criado
  // (mapa preto). Spinner e erro viram overlays por cima.
  const s = data?.stats;
  return (
    <div className="h-screen w-screen bg-[#0a0a0b] text-white relative overflow-hidden">
      <div ref={mapDivRef} className="absolute inset-0 z-0" />

      {loading && (
        <div className="absolute inset-0 z-[600] bg-[#0a0a0b]/80 flex items-center justify-center"><Loader2 className="w-10 h-10 text-indigo-500 animate-spin" /></div>
      )}
      {error && !data && (
        <div className="absolute inset-0 z-[600] bg-[#0a0a0b] text-slate-300 flex items-center justify-center text-center p-8"><div><MapPin className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>{error}</p></div></div>
      )}

      {/* Cabeçalho flutuante */}
      {data && <div className="absolute top-0 left-0 right-0 z-[500] pointer-events-none p-4 sm:p-6 bg-gradient-to-b from-black/70 to-transparent">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{data.partyName}</h1>
        <p className="text-xs text-slate-400">Telão ao vivo · estrutura de campo · atualiza em tempo real</p>
        <p className="text-[10px] text-slate-500 mt-0.5">● comitê com local · ◌ sem comitê (aprox. pela cidade) · agrupados por região (clique pra abrir) · cor = saúde</p>
      </div>}

      {/* Placar 🟢🟡🔴 + totais */}
      {data && s && <div className="absolute bottom-0 left-0 right-0 z-[500] p-4 sm:p-6 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex flex-wrap gap-2 sm:gap-3">
          <Card v={s.candidates} l="Candidatos" c="text-white" />
          <Card v={s.committees} l="Comitês no mapa" c="text-indigo-300" />
          <Card v={s.checkins} l="Check-ins" c="text-sky-300" />
          <Card v={s.green} l="🟢 Em dia" c="text-emerald-300" />
          <Card v={s.yellow} l="🟡 Atenção" c="text-amber-300" />
          <Card v={s.red} l="🔴 Risco" c="text-rose-300" />
        </div>
      </div>}

      {/* Lightbox — foto do comitê expandida */}
      {lightbox && (
        <div className="fixed inset-0 z-[1000] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="comitê" className="max-h-[90vh] max-w-[90vw] rounded-2xl shadow-2xl object-contain" />
        </div>
      )}
    </div>
  );
};

const Card: React.FC<{ v: number; l: string; c: string }> = ({ v, l, c }) => (
  <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl px-4 py-2 text-center min-w-[88px]">
    <p className={`text-2xl sm:text-3xl font-black leading-none ${c}`}>{v}</p>
    <p className="text-[10px] sm:text-[11px] text-slate-400 mt-1 whitespace-nowrap">{l}</p>
  </div>
);

export default PartyTelaoPage;
