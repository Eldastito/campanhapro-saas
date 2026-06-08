import React, { useState, useEffect } from 'react';
import { QrCode, AlertTriangle, CheckCircle, BarChart3, Users, MapPin, RefreshCcw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import BUScanner from '../components/election/BUScanner';
import { votosDoCandidato, cargoNomeToCodigo, BUParsed } from '../lib/buParser';

interface BUData {
  id: string;
  stationId: string;
  votosCandidato: number;
  votosTotalSecao: number;
  createdAt: string;
}

interface Incident {
  id: string;
  type: string;
  description: string;
  severity: string;
  status: string;
  createdAt: string;
}

interface TeamPing {
  userId: string;
  lat: number;
  lng: number;
  recordedAt: string;
  memberName: string;
  leaderName: string | null;
}

const FRESH_PING_MS = 30 * 60 * 1000; // 30 min — mais antigo é considerado offline e ocultado

const ElectionDayPage: React.FC = () => {
  const { user: _user } = useAuth();
  const [buResults, setBuResults] = useState<BUData[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [neighborhoodStats, setNeighborhoodStats] = useState<any>({});
  const [teamPings, setTeamPings] = useState<TeamPing[]>([]);
  const [scanning, setScanning] = useState(false);
  const [candNumber, setCandNumber] = useState<string>('');
  const [cargoCodigo, setCargoCodigo] = useState<number | null>(null);
  const [showFullMap, setShowFullMap] = useState(false);
  const [mapMode, setMapMode] = useState<'strategic' | 'real'>('strategic');
  const [_loading, setLoading] = useState(true);
  const mapRef = React.useRef<any>(null);
  const teamLayerRef = React.useRef<any>(null);

  // Mapeamento de Coordenadas Reais (Latitude, Longitude) e Relativas (% Top, % Left)
  const NEIGHBORHOOD_MAP: Record<string, { top: string, left: string, lat: number, lng: number }> = {
    'Centro': { top: '55%', left: '52%', lat: -22.9068, lng: -43.1729 },
    'Copacabana': { top: '62%', left: '55%', lat: -22.9694, lng: -43.1868 },
    'Tijuca': { top: '52%', left: '48%', lat: -22.9301, lng: -43.2367 },
    'Bangu': { top: '48%', left: '35%', lat: -22.8753, lng: -43.4652 },
    'Campo Grande': { top: '50%', left: '25%', lat: -22.9029, lng: -43.5591 },
    'Duque de Caxias': { top: '35%', left: '48%', lat: -22.7856, lng: -43.3117 },
    'Niterói': { top: '56%', left: '62%', lat: -22.8856, lng: -43.1153 },
    'São Gonçalo': { top: '50%', left: '68%', lat: -22.8269, lng: -43.0539 },
    'Nova Iguaçu': { top: '38%', left: '38%', lat: -22.7557, lng: -43.4605 },
    'Belford Roxo': { top: '32%', left: '42%', lat: -22.7641, lng: -43.3995 },
    'Jardim América': { top: '45%', left: '45%', lat: -22.8123, lng: -43.3214 },
    'Vila Nova': { top: '40%', left: '40%', lat: -22.7534, lng: -43.4423 }
  };

  useEffect(() => {
    fetchElectionData();
    fetchTeamPings();

    // Inscrição em tempo real para novos BUs e Incidentes
    const buSubscription = supabase
      .channel('election-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'boletins_urna' }, (payload: { new: BUData }) => {
        setBuResults(prev => [payload.new, ...prev]);
        fetchElectionData(); // Recarrega estatísticas
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'election_incidents' }, (payload: { new: Incident }) => {
        setIncidents(prev => [payload.new, ...prev]);
      })
      .subscribe();

    // Assinatura em tempo real para pings de geolocalização da equipe
    const teamSub = supabase
      .channel('team-locations-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_locations_live' }, () => {
        fetchTeamPings();
      })
      .subscribe();

    // Refresh periódico para esconder pings que ficaram velhos sem deletar (30min+)
    const refreshInterval = setInterval(fetchTeamPings, 60_000);

    return () => {
      supabase.removeChannel(buSubscription);
      supabase.removeChannel(teamSub);
      clearInterval(refreshInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_user?.campaignId]);

  const fetchTeamPings = async () => {
    if (!_user?.campaignId) return;
    try {
      // RLS garante que só pings da própria campanha voltam.
      const { data: pings, error: pingsErr } = await supabase
        .from('team_locations_live')
        .select('userId, lat, lng, recordedAt');
      if (pingsErr) throw pingsErr;
      if (!pings || pings.length === 0) {
        setTeamPings([]);
        return;
      }

      // Filtra pings antigos (offline)
      const fresh = pings.filter((p: any) => {
        const t = new Date(p.recordedAt).getTime();
        return !isNaN(t) && Date.now() - t < FRESH_PING_MS;
      });

      // Busca nome do membro + nome do líder via team_members.
      const userIds = fresh.map((p: any) => p.userId);
      const { data: members } = await supabase
        .from('team_members')
        .select('uid, name, assignedLeaderId')
        .in('uid', userIds);

      const leaderIds = [...new Set(
        (members || [])
          .map((m: any) => m.assignedLeaderId)
          .filter(Boolean)
      )];
      const { data: leaders } = leaderIds.length
        ? await supabase
            .from('team_members')
            .select('id, name')
            .in('id', leaderIds)
        : { data: [] };

      const leaderById = new Map<string, string>();
      (leaders || []).forEach((l: any) => leaderById.set(String(l.id), l.name));
      const memberByUid = new Map<string, any>();
      (members || []).forEach((m: any) => memberByUid.set(String(m.uid), m));

      const enriched: TeamPing[] = fresh.map((p: any) => {
        const member = memberByUid.get(String(p.userId));
        return {
          userId: p.userId,
          lat: p.lat,
          lng: p.lng,
          recordedAt: p.recordedAt,
          memberName: member?.name || 'Membro da equipe',
          leaderName: member?.assignedLeaderId
            ? leaderById.get(String(member.assignedLeaderId)) || null
            : null,
        };
      });

      setTeamPings(enriched);
    } catch (err) {
      console.error('[ElectionDay] Erro ao buscar pings da equipe:', err);
    }
  };

  const fetchElectionData = async () => {
    try {
      if (!_user?.campaignId) return;
      const [{ data: bus }, { data: incs }, { data: contacts }] = await Promise.all([
        supabase.from('boletins_urna').select('*').eq('campaignId', _user.campaignId).order('createdAt', { ascending: false }),
        supabase.from('election_incidents').select('*').eq('campaignId', _user.campaignId).order('createdAt', { ascending: false }),
        supabase.from('contacts').select('neighborhood, classification').eq('campaignId', _user.campaignId)
      ]);

      setBuResults(bus || []);
      setIncidents(incs || []);

      // Dados de Demonstração (Fallback) se o banco estiver vazio
      const initialStats: any = {
        'Centro': { count: 15, alert: false },
        'Jardim América': { count: 42, alert: false },
        'Vila Nova': { count: 8, alert: true },
        'Bangu': { count: 25, alert: false },
        'Duque de Caxias': { count: 60, alert: false }
      };

      // Processar estatísticas de bairro reais do CRM
      const stats: any = contacts && contacts.length > 0 ? {} : initialStats;
      
      if (contacts && contacts.length > 0) {
        contacts.forEach((c: any) => {
          if (c.neighborhood) {
            if (!stats[c.neighborhood]) stats[c.neighborhood] = { count: 0, alert: false };
            stats[c.neighborhood].count++;
          }
        });
      }

      // Marcar bairros com incidentes abertos
      incs?.filter((i: any) => i.status === 'open').forEach((i: any) => {
        Object.keys(NEIGHBORHOOD_MAP).forEach(name => {
          if (i.description.includes(name)) {
            if (!stats[name]) stats[name] = { count: 0, alert: true };
            stats[name].alert = true;
          }
        });
      });

      setNeighborhoodStats(stats);
    } catch (err) {
      console.error("Erro ao carregar dados do Dia D:", err);
    } finally {
      setLoading(false);
    }
  };

  // Sincroniza markers da equipe sempre que os pings mudam ou o mapa abre.
  useEffect(() => {
    const L = (window as any).L;
    const layer = teamLayerRef.current;
    const map = mapRef.current;
    if (!L || !layer || !map) return;

    layer.clearLayers();
    teamPings.forEach(p => {
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 8,
        fillColor: '#a855f7',
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.95,
      });
      const popupHtml = `
        <div style="font-family: system-ui, sans-serif; min-width: 160px;">
          <div style="font-weight: 700; color: #111;">${p.memberName}</div>
          <div style="font-size: 11px; color: #555; margin-top: 2px;">
            Líder: <b>${p.leaderName ?? '— sem líder atribuído —'}</b>
          </div>
          <div style="font-size: 10px; color: #888; margin-top: 4px;">
            Última atualização: ${new Date(p.recordedAt).toLocaleTimeString()}
          </div>
        </div>
      `;
      marker.bindPopup(popupHtml);
      marker.addTo(layer);
    });
  }, [teamPings, mapMode, showFullMap]);

  const totalVotosIA = buResults.reduce((acc, curr) => acc + curr.votosCandidato, 0);
  const totalSeçõesApuradas = buResults.length;

  // Carrega número de urna + cargo do candidato (p/ casar com o BU).
  useEffect(() => {
    if (!_user?.campaignId) return;
    supabase.from('settings').select('campaignDetails').eq('campaignId', _user.campaignId).maybeSingle()
      .then(({ data }) => {
        const cd: any = (data as any)?.campaignDetails || {};
        setCandNumber(String(cd.numeroUrna || cd.numero || '').trim());
        setCargoCodigo(cargoNomeToCodigo(cd.cargoDisputado || cd.cargo));
      }, () => {});
  }, [_user?.campaignId]);

  // Salva o BU lido na apuração paralela.
  const handleBUConfirm = async (bu: BUParsed) => {
    if (!_user?.campaignId) throw new Error('Sem campanha vinculada.');
    const res = votosDoCandidato(bu, candNumber, cargoCodigo);
    const cargo = res.cargo;
    const adversarios = cargo ? Object.fromEntries(Object.entries(cargo.candidatos).filter(([num]) => num !== candNumber)) : {};
    const { error } = await supabase.from('boletins_urna').insert({
      campaignId: _user.campaignId,
      fiscalId: _user.id ? String(_user.id) : null,
      rawContent: bu.raw,
      votosCandidato: res.votos,
      votosTotalSecao: cargo?.total ?? bu.header.comparecimento ?? 0,
      votosAdversarios: adversarios,
      hashAuthenticity: bu.hash || null,
      uf: bu.header.uf || null,
      municipio: bu.header.municipio || null,
      zona: bu.header.zona || null,
      secao: bu.header.secao || null,
      cargo: cargo?.codigo ?? cargoCodigo ?? null,
    });
    if (error) throw error;
    fetchElectionData();
  };

  return (
    <div className="p-6 bg-[#0a0a0b] min-h-screen text-white">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <BarChart3 className="text-emerald-400" /> 
            Operação Dia D: Apuração Paralela
          </h1>
          <p className="text-gray-400">Acompanhamento em tempo real das seções eleitorais.</p>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={() => setScanning(true)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors"
          >
            <QrCode className="w-5 h-5" /> Escanear BU (Fiscal)
          </button>
          <button className="bg-white/5 hover:bg-white/10 px-4 py-2 rounded-lg flex items-center gap-2 transition-colors">
            <RefreshCcw className="w-4 h-4" /> Atualizar
          </button>
        </div>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-[#161b22] p-6 rounded-2xl border border-white/5">
          <p className="text-gray-400 text-sm mb-1 uppercase tracking-wider">Votos Apurados (IA)</p>
          <h2 className="text-4xl font-black text-emerald-400">{totalVotosIA.toLocaleString()}</h2>
          <div className="mt-2 text-xs text-emerald-500/80 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Crescimento Real-time
          </div>
        </div>

        <div className="bg-[#161b22] p-6 rounded-2xl border border-white/5">
          <p className="text-gray-400 text-sm mb-1 uppercase tracking-wider">Seções Apuradas</p>
          <h2 className="text-4xl font-black text-blue-400">{totalSeçõesApuradas}</h2>
          <p className="text-xs text-gray-500 mt-2">De um total de 842 seções</p>
        </div>

        <div className="bg-[#161b22] p-6 rounded-2xl border border-white/5">
          <p className="text-gray-400 text-sm mb-1 uppercase tracking-wider">Incidentes Ativos</p>
          <h2 className={`text-4xl font-black ${incidents.filter(i => i.status === 'open').length > 0 ? 'text-red-400' : 'text-gray-500'}`}>
            {incidents.filter(i => i.status === 'open').length}
          </h2>
          <p className="text-xs text-gray-500 mt-2">Clique para ver detalhes</p>
        </div>

        <div className="bg-[#161b22] p-6 rounded-2xl border border-white/5">
          <p className="text-gray-400 text-sm mb-1 uppercase tracking-wider">Fiscais Ativos</p>
          <h2 className="text-4xl font-black text-yellow-400">142</h2>
          <p className="text-xs text-gray-500 mt-2">Check-in via Geolocalização</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Lista de Incidentes */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-[#161b22] p-6 rounded-2xl border border-white/5 h-full">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <AlertTriangle className="text-red-400 w-5 h-5" /> Feed de Incidentes
            </h3>
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              {incidents.length === 0 ? (
                <div className="text-center py-10 text-gray-600">
                  <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  Nenhum incidente crítico reportado.
                </div>
              ) : (
                incidents.map((incident) => (
                  <div key={incident.id} className="p-4 rounded-xl bg-white/5 border-l-4 border-red-500 hover:bg-white/10 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-bold uppercase text-red-400">{incident.type.replace('_', ' ')}</span>
                      <span className="text-[10px] text-gray-500">{new Date(incident.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-sm text-gray-300">{incident.description}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Últimas Apurações e Mapa */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-[#161b22] p-6 rounded-2xl border border-white/5">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Users className="text-blue-400 w-5 h-5" /> Últimas Seções Apuradas (Scanner Fiscal)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-white/10">
                    <th className="pb-3 px-2">SEÇÃO</th>
                    <th className="pb-3 px-2">LOCAL</th>
                    <th className="pb-3 px-2">VOTOS (IA)</th>
                    <th className="pb-3 px-2">STATUS</th>
                    <th className="pb-3 px-2">HORA</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {buResults.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-gray-600 italic">
                        Aguardando as primeiras leituras de QR Code...
                      </td>
                    </tr>
                  ) : (
                    buResults.map((bu) => (
                      <tr key={bu.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-2 font-mono">{bu.stationId.slice(0, 4)}</td>
                        <td className="py-3 px-2 text-gray-400 text-xs">Escola Municipal José Bonifácio</td>
                        <td className="py-3 px-2 font-bold text-emerald-400">{bu.votosCandidato}</td>
                        <td className="py-3 px-2">
                          <span className="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase">
                            Auditado IA
                          </span>
                        </td>
                        <td className="py-3 px-2 text-gray-500 text-xs">{new Date(bu.createdAt).toLocaleTimeString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-[#161b22] p-6 rounded-2xl border border-white/5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <MapPin className="text-emerald-400 w-5 h-5" /> Distribuição de Votos por Bairro
              </h3>
              <button 
                onClick={() => setShowFullMap(true)}
                className="text-emerald-400 text-xs hover:underline active:opacity-50"
              >
                Ver Mapa Completo
              </button>
            </div>
            <div 
              className="h-64 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center relative overflow-hidden group cursor-pointer"
              onClick={() => setShowFullMap(true)}
            >
              <div className="absolute inset-0 bg-[url('https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Brazil_Rio_de_Janeiro_location_map.svg/1024px-Brazil_Rio_de_Janeiro_location_map.svg.png')] opacity-20 grayscale invert brightness-150 transition-opacity"></div>
              <div className="text-center relative z-10 p-6 bg-black/60 rounded-xl backdrop-blur-sm border border-white/10">
                <TrendingUp className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
                <p className="text-sm font-bold">Mapa de Calor Ativo</p>
                <p className="text-xs text-gray-400">Processando coordenadas das seções apuradas...</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Mapa Completo (full-screen) */}
      {showFullMap && (
        <div className="fixed inset-0 z-[100] bg-black animate-in fade-in duration-300">
          <div className="bg-[#161b22] w-screen h-screen border-0 shadow-2xl relative overflow-hidden flex flex-col">
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <MapPin className="text-emerald-400 w-6 h-6" />
                <div>
                  <h3 className="text-xl font-bold">Monitoramento Geográfico em Tempo Real</h3>
                  <p className="text-xs text-gray-500">Visualização de densidade eleitoral por zona e bairro</p>
                </div>
              </div>
              
              <div className="flex gap-2">
                <div className="flex bg-white/5 p-1 rounded-xl border border-white/5 mr-4">
                  <button 
                    onClick={() => setMapMode('strategic')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${mapMode === 'strategic' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'}`}
                  >
                    Estratégico
                  </button>
                  <button 
                    onClick={() => setMapMode('real')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${mapMode === 'real' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:text-white'}`}
                  >
                    Real (GPS)
                  </button>
                </div>
                <button 
                  onClick={() => setShowFullMap(false)}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-white transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="flex-1 relative bg-black/40 overflow-hidden">
              {mapMode === 'strategic' ? (
                <>
                  <div className="absolute inset-0 bg-[url('https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Brazil_Rio_de_Janeiro_location_map.svg/1024px-Brazil_Rio_de_Janeiro_location_map.svg.png')] bg-contain bg-no-repeat bg-center opacity-30 grayscale invert brightness-125"></div>
                  <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/10 via-transparent to-blue-500/10"></div>
                  {Object.entries(neighborhoodStats).map(([name, data]: any) => {
                    const coords = NEIGHBORHOOD_MAP[name];
                    if (!coords) return null;
                    return (
                      <div 
                        key={name}
                        className="absolute group cursor-pointer"
                        style={{ top: coords.top, left: coords.left }}
                      >
                        <div className={`w-6 h-6 rounded-full animate-ping absolute ${data.alert ? 'bg-red-500' : data.count > 10 ? 'bg-emerald-500' : 'bg-blue-500'}`}></div>
                        <div className={`w-6 h-6 rounded-full relative ${data.alert ? 'bg-red-500' : data.count > 10 ? 'bg-emerald-500' : 'bg-blue-500'} shadow-[0_0_20px_rgba(16,185,129,0.5)]`}></div>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-black/90 text-white text-[10px] rounded border border-white/10 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none">
                          <p className="font-bold">{name}</p>
                          <p>{data.count} Apoiadores</p>
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div id="leaflet-map" className="w-full h-full z-10" ref={(el) => {
                  if (el && !mapRef.current) {
                    const L = (window as any).L;
                    if (!L) return;
                    const map = L.map(el).setView([-22.9068, -43.1729], 11);
                    mapRef.current = map;
                    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
                    }).addTo(map);
                    Object.entries(neighborhoodStats).forEach(([name, data]: any) => {
                      const coords = NEIGHBORHOOD_MAP[name];
                      if (coords && coords.lat) {
                        const marker = L.circleMarker([coords.lat, coords.lng], {
                          radius: 12,
                          fillColor: data.alert ? '#ef4444' : data.count > 10 ? '#10b981' : '#3b82f6',
                          color: '#fff',
                          weight: 2,
                          opacity: 1,
                          fillOpacity: 0.8
                        }).addTo(map);
                        marker.bindPopup(`<b>${name}</b><br>${data.count} Apoiadores`);
                        if (data.count > 10 || data.alert) {
                          setInterval(() => {
                            marker.setRadius(marker.getRadius() === 12 ? 18 : 12);
                          }, 1000);
                        }
                      }
                    });
                    // Layer separada para pings da equipe — atualizada via useEffect abaixo.
                    teamLayerRef.current = L.layerGroup().addTo(map);
                  }
                }}></div>
              )}

              {/* Legenda Flutuante */}
              <div className="absolute bottom-8 left-8 p-4 bg-black/80 backdrop-blur-md rounded-2xl border border-white/10 space-y-3 min-w-[200px]">
                <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500">Legenda</h4>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></div>
                  <span className="text-xs">Forte Concentração</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                  <span className="text-xs">Em Apuração</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <span className="text-xs">Alerta de Incidente</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                  <span className="text-xs">
                    Equipe ao vivo {teamPings.length > 0 && `(${teamPings.length})`}
                  </span>
                </div>
              </div>

              {/* Sidebar de Dados do Mapa */}
              <div className="absolute top-8 right-8 w-64 p-6 bg-black/80 backdrop-blur-md rounded-2xl border border-white/10 space-y-6">
                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Bairro Líder</p>
                  <p className="text-lg font-black text-emerald-400">Jardim América</p>
                  <p className="text-[10px] text-gray-500">78% das seções auditadas</p>
                </div>
                <div className="h-px bg-white/5"></div>
                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Zona Crítica</p>
                  <p className="text-lg font-black text-red-400">Vila Nova</p>
                  <p className="text-[10px] text-red-500/70 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> 2 Incidentes reportados
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 bg-white/[0.02] border-t border-white/5 flex justify-between items-center">
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Online</span>
                <span>Última atualização: agora mesmo</span>
              </div>
              <button 
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-bold transition-all"
                onClick={() => window.print()}
              >
                Exportar Mapa PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leitor real de QR Code do BU (padrão TSE 2026) */}
      <BUScanner
        open={scanning}
        onClose={() => setScanning(false)}
        candidateNumber={candNumber}
        cargoCodigo={cargoCodigo}
        onConfirm={handleBUConfirm}
      />
    </div>
  );
};

const style = document.createElement('style');
style.textContent = `
  @keyframes scan {
    from { top: 0; }
    to { top: 100%; }
  }
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: #30363d;
    border-radius: 10px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #484f58;
  }
`;
document.head.appendChild(style);

const X = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
);

const TrendingUp = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-9 9-4-4-6 6" /></svg>
);

export default ElectionDayPage;
