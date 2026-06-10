import * as React from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, MapPin } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

/**
 * TELÃO público do PARTIDO (link tokenizado, sem login). Para o presidente
 * projetar em reunião: mapa ao vivo dos comitês (cor = saúde do candidato),
 * check-ins e o placar 🟢🟡🔴 do partido. Reusa o Leaflet global (window.L),
 * mesmo padrão do Mapa da Campanha. NÃO expõe valores em R$.
 */
const LEVEL_COLOR: Record<string, string> = { green: '#10b981', yellow: '#f59e0b', red: '#f43f5e' };
const esc = (s: any) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c));
const SAFETY_POLL_MS = 120_000; // rede de segurança caso um broadcast se perca

interface TelaoPoint { displayName: string; local: string | null; approx?: boolean; lat: number | null; lng: number | null; hasPhoto: boolean; level: string; checkins: number; }
interface TelaoData { partyName: string; channel?: string; points: TelaoPoint[]; checkinPoints: { lat: number; lng: number }[]; stats: { candidates: number; committees: number; checkins: number; green: number; yellow: number; red: number }; }

const PartyTelaoPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = React.useState<TelaoData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const lgRef = React.useRef<{ comites?: any; checkins?: any }>({});

  const load = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/public/party/telao/${token}`);
      if (!r.ok) { setError('Telão não encontrado ou link inválido.'); return; }
      setData(await r.json()); setError(null);
    } catch { setError('Falha ao carregar.'); }
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

  // Init do mapa (1x)
  React.useEffect(() => {
    const L = (window as any).L;
    if (!L || !mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, { zoomControl: true, attributionControl: false }).setView([-22.9068, -43.1729], 8);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
    lgRef.current.checkins = L.layerGroup().addTo(map);
    lgRef.current.comites = L.layerGroup().addTo(map);
    mapRef.current = map;
  });

  // Desenho dos marcadores quando os dados mudam
  React.useEffect(() => {
    const L = (window as any).L; const map = mapRef.current;
    if (!L || !map || !data) return;
    const pts: [number, number][] = [];

    lgRef.current.checkins?.clearLayers();
    data.checkinPoints.forEach((p) => {
      if (typeof p.lat !== 'number') return;
      L.circleMarker([p.lat, p.lng], { radius: 4, fillColor: '#38bdf8', color: '#0ea5e9', weight: 1, fillOpacity: 0.5 }).addTo(lgRef.current.checkins);
      pts.push([p.lat, p.lng]);
    });

    lgRef.current.comites?.clearLayers();
    data.points.forEach((p) => {
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
      const color = LEVEL_COLOR[p.level] || '#94a3b8';
      const mk = L.circleMarker([p.lat, p.lng], { radius: 11, fillColor: color, color: '#fff', weight: 2, fillOpacity: 0.9 });
      mk.bindPopup(`<div style="min-width:170px"><b>${esc(p.displayName)}</b>${p.local ? `<br/><span style="opacity:.7">${esc(p.local)}${p.approx ? ' (aprox.)' : ''}</span>` : ''}<br/><span style="color:${color}">●</span> ${p.checkins} check-in(s)${p.hasPhoto ? ' · 📸' : ''}</div>`);
      mk.addTo(lgRef.current.comites); pts.push([p.lat, p.lng]);
    });

    if (pts.length) { try { map.fitBounds(pts, { padding: [60, 60], maxZoom: 12 }); } catch { /* */ } }
    setTimeout(() => { try { map.invalidateSize(); } catch { /* */ } }, 150);
  }, [data]);

  if (loading) return <div className="h-screen w-screen bg-[#0a0a0b] flex items-center justify-center"><Loader2 className="w-10 h-10 text-indigo-500 animate-spin" /></div>;
  if (error) return <div className="h-screen w-screen bg-[#0a0a0b] text-slate-300 flex items-center justify-center text-center p-8"><div><MapPin className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>{error}</p></div></div>;

  const s = data!.stats;
  return (
    <div className="h-screen w-screen bg-[#0a0a0b] text-white relative overflow-hidden">
      <div ref={mapDivRef} className="absolute inset-0 z-0" />

      {/* Cabeçalho flutuante */}
      <div className="absolute top-0 left-0 right-0 z-[500] pointer-events-none p-4 sm:p-6 bg-gradient-to-b from-black/70 to-transparent">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{data!.partyName}</h1>
        <p className="text-xs text-slate-400">Telão ao vivo · estrutura de campo · atualiza em tempo real</p>
      </div>

      {/* Placar 🟢🟡🔴 + totais */}
      <div className="absolute bottom-0 left-0 right-0 z-[500] p-4 sm:p-6 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex flex-wrap gap-2 sm:gap-3">
          <Card v={s.candidates} l="Candidatos" c="text-white" />
          <Card v={s.committees} l="Comitês no mapa" c="text-indigo-300" />
          <Card v={s.checkins} l="Check-ins" c="text-sky-300" />
          <Card v={s.green} l="🟢 Em dia" c="text-emerald-300" />
          <Card v={s.yellow} l="🟡 Atenção" c="text-amber-300" />
          <Card v={s.red} l="🔴 Risco" c="text-rose-300" />
        </div>
      </div>
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
