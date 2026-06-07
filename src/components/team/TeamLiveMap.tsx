import * as React from 'react';
import { MapPin, Users } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useTeam } from '../../contexts/TeamContext';

/**
 * Mapa ao vivo da equipe (Leaflet via CDN — window.L, já carregado no index.html).
 * Mostra a última posição compartilhada de cada membro (team_locations_live).
 * Líder vê só os próprios liderados (+ ele); Admin/Coordenador vê todos.
 * Cor por recência: verde <5min, âmbar <30min, cinza mais antigo.
 */
interface LiveLoc {
  userId: string; userName: string | null; lat: number; lng: number; recordedAt: string;
}

const TeamLiveMap: React.FC = () => {
  const { user } = useAuth();
  const { teamMembers } = useTeam();
  const [locs, setLocs] = React.useState<LiveLoc[]>([]);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const layerRef = React.useRef<any>(null);

  // Líder → só seus liderados (+ ele). Admin/Coordenador/Candidato → todos.
  const allowedIds = React.useMemo(() => {
    if (user?.type === 'Líder') {
      const ids = new Set<string>((teamMembers as any[]).map(m => m.userId).filter(Boolean));
      if (user.uid) ids.add(user.uid);
      return ids;
    }
    return null;
  }, [teamMembers, user?.type, user?.uid]);

  const fetchLocs = React.useCallback(async () => {
    if (!user?.campaignId) return;
    const { data } = await supabase.from('team_locations_live').select('userId, userName, lat, lng, recordedAt').eq('campaignId', user.campaignId);
    let rows = (data ?? []) as LiveLoc[];
    if (allowedIds) rows = rows.filter(r => allowedIds.has(r.userId));
    setLocs(rows);
  }, [user?.campaignId, allowedIds]);

  React.useEffect(() => {
    if (!user?.campaignId) return;
    fetchLocs();
    const ch = supabase.channel(`live-map-${user.campaignId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_locations_live', filter: `campaignId=eq.${user.campaignId}` }, fetchLocs)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.campaignId, fetchLocs]);

  // Inicializa o mapa uma vez.
  React.useEffect(() => {
    const L = (window as any).L;
    if (!L || !containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([-22.9068, -43.1729], 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
  }, []);

  // Redesenha os marcadores quando as posições mudam.
  React.useEffect(() => {
    const L = (window as any).L;
    const map = mapRef.current; const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const pts: [number, number][] = [];
    locs.forEach((loc) => {
      if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return;
      const ageMin = (Date.now() - new Date(loc.recordedAt).getTime()) / 60000;
      const color = ageMin < 5 ? '#10b981' : ageMin < 30 ? '#f59e0b' : '#64748b';
      const when = ageMin < 1 ? 'agora' : ageMin < 60 ? `${Math.round(ageMin)} min atrás` : `${Math.round(ageMin / 60)}h atrás`;
      const mk = L.circleMarker([loc.lat, loc.lng], { radius: 9, fillColor: color, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9 }).addTo(layer);
      mk.bindPopup(`<b>${loc.userName || 'Membro'}</b><br>${when}`);
      pts.push([loc.lat, loc.lng]);
    });
    if (pts.length) { try { map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 }); } catch { /* ignore */ } }
    setTimeout(() => { try { map.invalidateSize(); } catch { /* ignore */ } }, 100);
  }, [locs]);

  const hasLeaflet = typeof window !== 'undefined' && !!(window as any).L;

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold flex items-center gap-2"><MapPin className="w-5 h-5 text-emerald-400" /> Mapa ao Vivo da Equipe</h2>
        <span className="text-xs text-slate-400 flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {locs.length} em campo</span>
      </div>
      {!hasLeaflet ? (
        <p className="text-sm text-slate-400">Mapa indisponível (biblioteca não carregada). Recarregue a página.</p>
      ) : (
        <>
          <div ref={containerRef} className="w-full h-80 rounded-lg overflow-hidden border border-white/5" />
          <div className="flex items-center gap-4 mt-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> &lt; 5 min</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> &lt; 30 min</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-500" /> mais antigo</span>
          </div>
          {locs.length === 0 && (
            <p className="text-xs text-slate-500 mt-2">Ninguém compartilhando localização agora. Peça à equipe para tocar em “Compartilhar minha localização”.</p>
          )}
        </>
      )}
    </div>
  );
};

export default TeamLiveMap;
