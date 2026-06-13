import * as React from 'react';
import { Map as MapIcon, Users, MapPin, Radio, Maximize2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useVisits } from '../contexts/VisitsContext';
import { geocodeMany, LatLng } from '../lib/geocode';
import { RJ_MUNICIPALITIES } from '../data/rj-locations';

/**
 * Mapa estratégico da campanha (Coordenação/Candidato). Plota onde há EQUIPE/
 * LIDERANÇAS (cadastro dos membros), onde já houve VISITAS, e quem está AO VIVO
 * em campo (GPS). Geocodifica bairro/município com cache. Modo telão (fullscreen).
 */
const norm = (s?: string) => (s || '').trim();
const waLink = (phone?: string) => {
  const d = (phone || '').replace(/\D/g, '');
  if (!d) return '';
  return `https://wa.me/${d.length <= 11 ? '55' + d : d}`;
};
const qStr = (bairro: string, municipio: string) => [bairro, municipio, 'RJ', 'Brasil'].filter(Boolean).join(', ');
const esc = (s: any) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c));

interface LiveLoc { userId: string; userName: string | null; lat: number; lng: number; recordedAt: string; }

const CampaignMapPage: React.FC = () => {
  const { user } = useAuth();
  const { teamMembers } = useTeam();
  const { visits } = useVisits();

  const [coords, setCoords] = React.useState<Record<string, LatLng>>({});
  const [geocoding, setGeocoding] = React.useState(false);
  const [layers, setLayers] = React.useState({ equipe: true, visitas: true, live: true, votos: false, reunioes: true, sentimento: true });
  const [live, setLive] = React.useState<LiveLoc[]>([]);
  const [meetings, setMeetings] = React.useState<any[]>([]);
  // Heat de sentimento por bairro (#52) — vem da rota /intelligence/neighborhood-heat
  const [sentiment, setSentiment] = React.useState<Array<{
    bairro: string; municipio: string; total: number; score: number;
    level: 'green' | 'yellow' | 'red' | 'unknown';
    apoiadores: number; multiplicadores: number; simpatizantes: number;
    indecisos: number; rejeitadores: number; desconhecidos: number;
  }>>([]);

  // Filtros (cascata município→bairro, igual ao formulário, + por líder)
  const [fMunicipio, setFMunicipio] = React.useState('');
  const [fBairro, setFBairro] = React.useState('');
  const [fLeader, setFLeader] = React.useState('');

  const municipios = React.useMemo(() => RJ_MUNICIPALITIES.map((m) => m.name).sort(), []);
  const bairrosDoMunicipio = React.useMemo(() => {
    if (!fMunicipio) return [];
    const mun = RJ_MUNICIPALITIES.find((m) => m.name === fMunicipio);
    return mun ? [...mun.neighborhoods].sort() : [];
  }, [fMunicipio]);
  const leaders = React.useMemo(
    () => (teamMembers as any[]).filter((m) => m.role === 'Líder' && m.userId).map((m) => ({ id: m.userId, name: m.name })),
    [teamMembers],
  );
  const matchFilters = React.useCallback((municipio: string, bairro: string, leaderId?: string | null) => {
    if (fMunicipio && municipio !== fMunicipio) return false;
    if (fBairro && bairro !== fBairro) return false;
    if (fLeader && (leaderId || '') !== fLeader) return false;
    return true;
  }, [fMunicipio, fBairro, fLeader]);

  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const lgRef = React.useRef<{ equipe?: any; visitas?: any; votos?: any; reunioes?: any; live?: any }>({});
  const doneRef = React.useRef<Set<string>>(new Set());

  // ── Agrupamentos ───────────────────────────────────────────────────
  const equipeGroups = React.useMemo(() => {
    const map = new Map<string, { municipio: string; bairro: string; members: any[] }>();
    (teamMembers as any[]).forEach((m) => {
      const municipio = norm(m.municipio); const bairro = norm(m.bairro);
      if (!municipio && !bairro) return;
      if (!matchFilters(municipio, bairro, m.assignedLeaderId)) return;
      const key = qStr(bairro, municipio);
      if (!map.has(key)) map.set(key, { municipio, bairro, members: [] });
      map.get(key)!.members.push(m);
    });
    return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
  }, [teamMembers, matchFilters]);

  const visitaGroups = React.useMemo(() => {
    const map = new Map<string, { municipio: string; bairro: string; total: number; realizadas: number; votos: number }>();
    (visits as any[]).forEach((v) => {
      const municipio = norm(v.municipio); const bairro = norm(v.bairro);
      if (!municipio && !bairro) return;
      if (!matchFilters(municipio, bairro, v.leaderId)) return;
      const key = qStr(bairro, municipio);
      if (!map.has(key)) map.set(key, { municipio, bairro, total: 0, realizadas: 0, votos: 0 });
      const g = map.get(key)!; g.total++;
      if (v.realizada === 'sim') { g.realizadas++; g.votos += Number(v.votos) || 0; }
    });
    return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
  }, [visits, matchFilters]);

  const meetingGroups = React.useMemo(() => {
    const map = new Map<string, { municipio: string; bairro: string; total: number; titulos: string[] }>();
    (meetings as any[]).forEach((mt) => {
      const municipio = norm(mt.municipio); const bairro = norm(mt.bairro);
      if (!municipio && !bairro) return;
      if (!matchFilters(municipio, bairro, null)) return;
      const key = qStr(bairro, municipio);
      if (!map.has(key)) map.set(key, { municipio, bairro, total: 0, titulos: [] });
      const g = map.get(key)!; g.total++; if (mt.title) g.titulos.push(mt.title);
    });
    return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
  }, [meetings, matchFilters]);

  const semLocalizacao = (teamMembers as any[]).filter((m) => !norm(m.municipio) && !norm(m.bairro)).length;

  // ── Geocodificação (cacheada) ──────────────────────────────────────
  React.useEffect(() => {
    const targets = new Set<string>();
    equipeGroups.forEach((g) => targets.add(g.key));
    visitaGroups.forEach((g) => targets.add(g.key));
    meetingGroups.forEach((g) => targets.add(g.key));
    // Sentimento usa mesma chave municipio|bairro
    sentiment.forEach((b) => {
      const key = `${norm(b.municipio)}|${norm(b.bairro)}`;
      if (key !== '|') targets.add(key);
    });
    const todo = Array.from(targets).filter((q) => !doneRef.current.has(q));
    if (!todo.length) return;
    todo.forEach((q) => doneRef.current.add(q));
    let cancelled = false;
    setGeocoding(true);
    geocodeMany(todo).then((res) => { if (!cancelled) { setCoords((prev) => ({ ...prev, ...res })); setGeocoding(false); } });
    return () => { cancelled = true; };
  }, [equipeGroups, visitaGroups, meetingGroups, sentiment]);

  // ── Ao vivo (GPS) ──────────────────────────────────────────────────
  React.useEffect(() => {
    if (!user?.campaignId) return;
    const fetchLive = async () => {
      const { data } = await supabase.from('team_locations_live').select('userId, userName, lat, lng, recordedAt').eq('campaignId', user.campaignId);
      setLive((data ?? []) as LiveLoc[]);
    };
    fetchLive();
    const ch = supabase.channel(`campmap-live-${user.campaignId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_locations_live', filter: `campaignId=eq.${user.campaignId}` }, fetchLive)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.campaignId]);

  // ── Reuniões ───────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!user?.campaignId) return;
    supabase.from('meeting_records').select('id, title, bairro, municipio').eq('campaignId', user.campaignId)
      .then(({ data }) => setMeetings(data ?? []), () => {});
  }, [user?.campaignId]);

  // ── Heat de sentimento por bairro ─────────────────────────────────
  React.useEffect(() => {
    if (!user?.campaignId) return;
    (async () => {
      try {
        const { authedFetch } = await import('../lib/authedFetch');
        const r = await authedFetch('/api/v1/intelligence/neighborhood-heat');
        if (r.ok) {
          const j = await r.json();
          setSentiment(j.heat ?? []);
        }
      } catch { /* silencia: sentimento é layer opcional */ }
    })();
  }, [user?.campaignId]);

  // ── Mapa (init uma vez) ────────────────────────────────────────────
  React.useEffect(() => {
    const L = (window as any).L;
    if (!L || !mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current).setView([-22.9068, -43.1729], 9);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(map);
    lgRef.current.equipe = L.layerGroup().addTo(map);
    lgRef.current.visitas = L.layerGroup().addTo(map);
    lgRef.current.votos = L.layerGroup().addTo(map);
    lgRef.current.reunioes = L.layerGroup().addTo(map);
    lgRef.current.live = L.layerGroup().addTo(map);
    lgRef.current.sentimento = L.layerGroup().addTo(map);
    mapRef.current = map;
  }, []);

  // ── Desenho dos marcadores ─────────────────────────────────────────
  React.useEffect(() => {
    const L = (window as any).L; const map = mapRef.current;
    if (!L || !map) return;
    const pts: [number, number][] = [];

    // Equipe
    lgRef.current.equipe?.clearLayers();
    if (layers.equipe) equipeGroups.forEach((g) => {
      const c = coords[g.key]; if (!c) return;
      const n = g.members.length;
      const mk = L.circleMarker([c.lat, c.lng], { radius: Math.min(10 + n * 2, 26), fillColor: '#6366f1', color: '#fff', weight: 2, fillOpacity: 0.85 });
      const lista = g.members.slice(0, 12).map((m: any) => {
        const wa = waLink(m.phone);
        const tel = m.phone ? (wa ? ` · <a href="${wa}" target="_blank">${esc(m.phone)}</a>` : ` · ${esc(m.phone)}`) : '';
        return `<li><b>${esc(m.name)}</b> <span style="opacity:.7">(${esc(m.role || '—')})</span>${tel}</li>`;
      }).join('');
      mk.bindPopup(`<div style="min-width:200px"><b>${esc(g.bairro || g.municipio)}</b>${g.bairro && g.municipio ? ` — ${esc(g.municipio)}` : ''}<br/><span style="color:#818cf8">${n} pessoa(s) na equipe</span><ul style="margin:6px 0 0;padding-left:16px">${lista}</ul></div>`);
      mk.addTo(lgRef.current.equipe); pts.push([c.lat, c.lng]);
    });

    // Visitas
    lgRef.current.visitas?.clearLayers();
    if (layers.visitas) visitaGroups.forEach((g) => {
      const c = coords[g.key]; if (!c) return;
      const mk = L.circleMarker([c.lat, c.lng], { radius: Math.min(8 + g.realizadas * 1.5, 24), fillColor: '#10b981', color: '#fff', weight: 1.5, fillOpacity: 0.7 });
      mk.bindPopup(`<b>${esc(g.bairro || g.municipio)}</b><br/>${g.realizadas} visita(s) realizada(s)${g.total - g.realizadas > 0 ? ` · ${g.total - g.realizadas} agendada(s)` : ''}`);
      mk.addTo(lgRef.current.visitas); pts.push([c.lat, c.lng]);
    });

    // Votos estimados (calor por bairro)
    lgRef.current.votos?.clearLayers();
    if (layers.votos) visitaGroups.forEach((g) => {
      const c = coords[g.key]; if (!c || !g.votos) return;
      const color = g.votos >= 100 ? '#dc2626' : g.votos >= 40 ? '#f97316' : g.votos >= 15 ? '#eab308' : '#a3a3a3';
      const mk = L.circleMarker([c.lat, c.lng], { radius: Math.min(10 + Math.sqrt(g.votos) * 2, 34), fillColor: color, color: '#fff', weight: 1, fillOpacity: 0.55 });
      mk.bindPopup(`<b>${esc(g.bairro || g.municipio)}</b><br/>≈ ${g.votos} votos estimados (${g.realizadas} visitas)`);
      mk.addTo(lgRef.current.votos); pts.push([c.lat, c.lng]);
    });

    // Reuniões
    lgRef.current.reunioes?.clearLayers();
    if (layers.reunioes) meetingGroups.forEach((g) => {
      const c = coords[g.key]; if (!c) return;
      const mk = L.circleMarker([c.lat, c.lng], { radius: Math.min(8 + g.total * 2, 22), fillColor: '#f472b6', color: '#fff', weight: 2, fillOpacity: 0.85 });
      const lista = g.titulos.slice(0, 8).map((t) => `<li>${esc(t)}</li>`).join('');
      mk.bindPopup(`<div style="min-width:180px"><b>${esc(g.bairro || g.municipio)}</b><br/><span style="color:#f472b6">${g.total} reunião(ões)</span><ul style="margin:6px 0 0;padding-left:16px">${lista}</ul></div>`);
      mk.addTo(lgRef.current.reunioes); pts.push([c.lat, c.lng]);
    });

    // Sentimento por bairro (#52) — heat dos contatos classificados.
    // Verde=apoio>rejeição; amarelo=neutro; vermelho=rejeição>apoio; cinza=poucos dados.
    lgRef.current.sentimento?.clearLayers();
    if (layers.sentimento) sentiment.forEach((b) => {
      if (!matchFilters(b.municipio, b.bairro, null)) return;
      const c = coords[`${norm(b.municipio)}|${norm(b.bairro)}`]; if (!c) return;
      const color = b.level === 'green' ? '#10b981'
        : b.level === 'yellow' ? '#eab308'
        : b.level === 'red' ? '#dc2626'
        : '#475569'; // unknown
      // Raio cresce com sqrt(total) pra não dominar visualmente bairros grandes
      const radius = Math.min(8 + Math.sqrt(b.total) * 3, 36);
      const mk = L.circleMarker([c.lat, c.lng], { radius, fillColor: color, color: '#fff', weight: 1.5, fillOpacity: 0.55 });
      mk.bindPopup(
        `<div style="min-width:200px">
          <b>${esc(b.bairro)}</b>${b.municipio ? ` — ${esc(b.municipio)}` : ''}<br/>
          <span style="color:${color};font-weight:bold">Score: ${b.score >= 0 ? '+' : ''}${b.score}</span>
          <span style="color:#94a3b8"> · ${b.total} contato(s)</span>
          <table style="margin-top:6px;font-size:11px;color:#cbd5e1;border-collapse:collapse">
            <tr><td>🥇 Multiplicadores</td><td style="text-align:right;padding-left:8px">${b.multiplicadores}</td></tr>
            <tr><td>✅ Apoiadores</td><td style="text-align:right">${b.apoiadores}</td></tr>
            <tr><td>👍 Simpatizantes</td><td style="text-align:right">${b.simpatizantes}</td></tr>
            <tr><td>🤔 Indecisos</td><td style="text-align:right">${b.indecisos}</td></tr>
            <tr><td>❌ Rejeitadores</td><td style="text-align:right">${b.rejeitadores}</td></tr>
            <tr><td style="color:#64748b">— Desconhecidos</td><td style="text-align:right;color:#64748b">${b.desconhecidos}</td></tr>
          </table>
        </div>`
      );
      mk.addTo(lgRef.current.sentimento); pts.push([c.lat, c.lng]);
    });

    // Ao vivo
    lgRef.current.live?.clearLayers();
    if (layers.live) live.forEach((loc) => {
      if (typeof loc.lat !== 'number') return;
      const ageMin = (Date.now() - new Date(loc.recordedAt).getTime()) / 60000;
      const color = ageMin < 5 ? '#22d3ee' : ageMin < 30 ? '#f59e0b' : '#64748b';
      const mk = L.circleMarker([loc.lat, loc.lng], { radius: 7, fillColor: color, color: '#fff', weight: 2, fillOpacity: 0.95 });
      mk.bindPopup(`<b>${esc(loc.userName || 'Membro')}</b><br/>em campo · ${ageMin < 1 ? 'agora' : Math.round(ageMin) + ' min'}`);
      mk.addTo(lgRef.current.live); pts.push([loc.lat, loc.lng]);
    });

    if (pts.length) { try { map.fitBounds(pts, { padding: [50, 50], maxZoom: 13 }); } catch { /* ignore */ } }
    setTimeout(() => { try { map.invalidateSize(); } catch { /* ignore */ } }, 120);
  }, [coords, layers, equipeGroups, visitaGroups, meetingGroups, live, sentiment]);

  const toggle = (k: keyof typeof layers) => setLayers((p) => ({ ...p, [k]: !p[k] }));
  const goFullscreen = () => { try { wrapRef.current?.requestFullscreen?.(); } catch { /* ignore */ } };

  const hasLeaflet = typeof window !== 'undefined' && !!(window as any).L;
  const totalEquipe = equipeGroups.reduce((a, g) => a + g.members.length, 0);
  const totalVisitas = visitaGroups.reduce((a, g) => a + g.realizadas, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><MapIcon className="w-6 h-6 text-indigo-400" /> Mapa da Campanha</h1>
          <p className="text-sm text-slate-400">Onde há equipe/lideranças, onde já visitamos e quem está em campo agora.</p>
        </div>
        <button onClick={goFullscreen} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold">
          <Maximize2 className="w-4 h-4" /> Projetar no telão
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-800 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-500 font-bold">Pessoas na equipe</p><p className="text-2xl font-black text-indigo-400">{totalEquipe}</p></div>
        <div className="bg-slate-800 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-500 font-bold">Locais c/ equipe</p><p className="text-2xl font-black text-indigo-300">{equipeGroups.length}</p></div>
        <div className="bg-slate-800 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-500 font-bold">Visitas realizadas</p><p className="text-2xl font-black text-emerald-400">{totalVisitas}</p></div>
        <div className="bg-slate-800 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-500 font-bold">Em campo agora</p><p className="text-2xl font-black text-cyan-400">{live.length}</p></div>
      </div>

      <div ref={wrapRef} className="bg-slate-900 rounded-xl p-3">
        {/* Filtros (cascata município → bairro + por líder) */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select value={fMunicipio} onChange={(e) => { setFMunicipio(e.target.value); setFBairro(''); }}
                  className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="">Todos os municípios</option>
            {municipios.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={fBairro} onChange={(e) => setFBairro(e.target.value)} disabled={!fMunicipio}
                  className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 disabled:opacity-40">
            <option value="">{fMunicipio ? 'Todos os bairros' : 'Selecione o município'}</option>
            {bairrosDoMunicipio.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={fLeader} onChange={(e) => setFLeader(e.target.value)}
                  className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="">Todas as lideranças</option>
            {leaders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {(fMunicipio || fBairro || fLeader) && (
            <button onClick={() => { setFMunicipio(''); setFBairro(''); setFLeader(''); }}
                    className="text-xs text-slate-400 hover:text-white underline">Limpar filtros</button>
          )}
        </div>

        {/* Controles de camada */}
        <div className="flex flex-wrap items-center gap-4 mb-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer text-slate-300">
            <input type="checkbox" checked={layers.equipe} onChange={() => toggle('equipe')} className="accent-indigo-500" />
            <span className="flex items-center gap-1"><Users className="w-4 h-4 text-indigo-400" /> Equipe / Lideranças</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer text-slate-300">
            <input type="checkbox" checked={layers.visitas} onChange={() => toggle('visitas')} className="accent-emerald-500" />
            <span className="flex items-center gap-1"><MapPin className="w-4 h-4 text-emerald-400" /> Visitas</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer text-slate-300">
            <input type="checkbox" checked={layers.reunioes} onChange={() => toggle('reunioes')} className="accent-pink-500" />
            <span className="flex items-center gap-1"><Users className="w-4 h-4 text-pink-400" /> Reuniões</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer text-slate-300">
            <input type="checkbox" checked={layers.votos} onChange={() => toggle('votos')} className="accent-orange-500" />
            <span className="flex items-center gap-1"><MapPin className="w-4 h-4 text-orange-400" /> Votos estimados</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer text-slate-300">
            <input type="checkbox" checked={layers.live} onChange={() => toggle('live')} className="accent-cyan-500" />
            <span className="flex items-center gap-1"><Radio className="w-4 h-4 text-cyan-400" /> Ao vivo (GPS)</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer text-slate-300" title="Heat de sentimento por bairro — soma apoiadores/rejeitadores dos contatos do CRM classificados pela IA.">
            <input type="checkbox" checked={layers.sentimento} onChange={() => toggle('sentimento')} className="accent-rose-500" />
            <span className="flex items-center gap-1">🌡️ Sentimento <span className="text-[10px] text-slate-500">({sentiment.length})</span></span>
          </label>
          {geocoding && <span className="flex items-center gap-1 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> localizando pontos…</span>}
        </div>

        {!hasLeaflet ? (
          <p className="text-sm text-slate-400 p-6">Mapa indisponível (biblioteca não carregada). Recarregue a página.</p>
        ) : (
          <div ref={mapDivRef} className="w-full h-[60vh] min-h-[420px] rounded-lg overflow-hidden border border-white/5 bg-black" />
        )}

        {semLocalizacao > 0 && (
          <p className="text-[11px] text-amber-400/80 mt-2">
            ⚠️ {semLocalizacao} membro(s) sem município/bairro no cadastro não aparecem no mapa. Preencha o endereço em Equipes para plotá-los.
          </p>
        )}
      </div>
    </div>
  );
};

export default CampaignMapPage;
