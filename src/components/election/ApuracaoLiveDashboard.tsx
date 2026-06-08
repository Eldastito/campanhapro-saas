import * as React from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { Trophy, Maximize2, Vote, MapPin, Target, Gauge, Settings2, Radio, Flag } from 'lucide-react';
import Confetti from './Confetti';

/**
 * Painel de Apuração ao Vivo (telão/TV). Lê boletins_urna em tempo real e
 * mostra, de forma gamificada: votos apurados x META para eleger, contagem por
 * zona (números e %), seções/urnas escaneadas (número e %). Para a equipe
 * acompanhar no dia da eleição. Config (meta + total de seções) por campanha
 * em localStorage — editável na hora.
 */
interface BURow { votosCandidato: number; votosTotalSecao: number; zona: string | null; secao: string | null; votosAdversarios?: Record<string, number> | null; }

const fmt = (n: number) => (n || 0).toLocaleString('pt-BR');

const ApuracaoLiveDashboard: React.FC = () => {
  const { user } = useAuth();
  const [rows, setRows] = React.useState<BURow[]>([]);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const lsKey = `apuracao_cfg_${user?.campaignId || 'x'}`;
  const [cfg, setCfg] = React.useState<{ meta: number; totalSecoes: number }>({ meta: 0, totalSecoes: 0 });
  const [showCfg, setShowCfg] = React.useState(false);

  // Carrega config (localStorage + meta do cadastro como fallback)
  React.useEffect(() => {
    let loaded = { meta: 0, totalSecoes: 0 };
    try { loaded = { ...loaded, ...JSON.parse(localStorage.getItem(lsKey) || '{}') }; } catch { /* */ }
    setCfg(loaded);
    if (!loaded.meta && user?.campaignId) {
      supabase.from('settings').select('campaignDetails').eq('campaignId', user.campaignId).maybeSingle()
        .then(({ data }) => {
          const cd: any = (data as any)?.campaignDetails || {};
          const meta = Number(cd.metaVotos || cd.meta || 0) || 0;
          if (meta) setCfg((p) => ({ ...p, meta }));
        }, () => {});
    }
  }, [user?.campaignId, lsKey]);

  const saveCfg = (next: { meta: number; totalSecoes: number }) => {
    setCfg(next);
    try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch { /* */ }
  };

  // Dados em tempo real
  React.useEffect(() => {
    if (!user?.campaignId) return;
    const fetchRows = async () => {
      const { data } = await supabase.from('boletins_urna')
        .select('votosCandidato, votosTotalSecao, zona, secao, votosAdversarios').eq('campaignId', user.campaignId);
      setRows((data ?? []) as BURow[]);
    };
    fetchRows();
    const ch = supabase.channel(`apuracao-${user.campaignId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boletins_urna', filter: `campaignId=eq.${user.campaignId}` }, fetchRows)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.campaignId]);

  // Agregações
  const totalVotos = rows.reduce((a, r) => a + (r.votosCandidato || 0), 0);
  const secoesApuradas = new Set(rows.map((r) => `${r.zona || '?'}-${r.secao || '?'}`)).size;
  const porZona = React.useMemo(() => {
    const m = new Map<string, { votos: number; secoes: Set<string> }>();
    rows.forEach((r) => {
      const z = r.zona || 'N/I';
      if (!m.has(z)) m.set(z, { votos: 0, secoes: new Set() });
      const g = m.get(z)!; g.votos += r.votosCandidato || 0; g.secoes.add(`${z}-${r.secao || '?'}`);
    });
    return Array.from(m.entries()).map(([zona, v]) => ({ zona, votos: v.votos, secoes: v.secoes.size }))
      .sort((a, b) => b.votos - a.votos);
  }, [rows]);

  // Adversários (somatório de votosAdversarios por número de candidato)
  const racers = React.useMemo(() => {
    const adv = new Map<string, number>();
    rows.forEach((r) => {
      const va = r.votosAdversarios || {};
      Object.entries(va).forEach(([num, v]) => adv.set(num, (adv.get(num) || 0) + (Number(v) || 0)));
    });
    const list = [
      { id: 'nos', label: 'Nosso candidato', votos: totalVotos, us: true },
      ...Array.from(adv.entries()).map(([num, votos]) => ({ id: num, label: `Nº ${num}`, votos, us: false })),
    ].sort((a, b) => b.votos - a.votos);
    return list.slice(0, 6);
  }, [rows, totalVotos]);

  const finishLine = cfg.meta > 0 ? cfg.meta : Math.max(1, ...racers.map((r) => r.votos)) * 1.15;

  // Confete ao cruzar a linha de chegada (meta) — dispara uma vez.
  const [fire, setFire] = React.useState(false);
  const celebrated = React.useRef(false);
  React.useEffect(() => {
    if (cfg.meta > 0 && totalVotos >= cfg.meta && !celebrated.current) {
      celebrated.current = true;
      setFire(true);
      const t = setTimeout(() => setFire(false), 7000);
      return () => clearTimeout(t);
    }
    if (cfg.meta > 0 && totalVotos < cfg.meta) celebrated.current = false; // rearma se cair abaixo
  }, [totalVotos, cfg.meta]);

  const metaPct = cfg.meta > 0 ? Math.min(100, (totalVotos / cfg.meta) * 100) : 0;
  const faltam = cfg.meta > 0 ? Math.max(0, cfg.meta - totalVotos) : 0;
  const secoesPct = cfg.totalSecoes > 0 ? Math.min(100, (secoesApuradas / cfg.totalSecoes) * 100) : 0;

  const goFull = () => { try { wrapRef.current?.requestFullscreen?.(); } catch { /* */ } };

  return (
    <div ref={wrapRef} className="bg-[#0a0a0b] text-white rounded-2xl p-5 md:p-8 space-y-6">
      <Confetti fire={fire} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-4xl font-black flex items-center gap-3"><Radio className="text-emerald-400 animate-pulse" /> Apuração ao Vivo</h1>
          <p className="text-slate-400 text-sm">Atualização automática conforme os fiscais escaneiam os BUs.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCfg((v) => !v)} className="px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-xs flex items-center gap-1.5"><Settings2 className="w-4 h-4" /> Meta</button>
          <button onClick={goFull} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-bold text-sm flex items-center gap-2"><Maximize2 className="w-4 h-4" /> Telão</button>
        </div>
      </div>

      {showCfg && (
        <div className="bg-slate-900/70 border border-white/10 rounded-xl p-4 flex flex-wrap gap-4 items-end">
          <div>
            <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Meta de votos p/ eleger</label>
            <input type="number" value={cfg.meta || ''} onChange={(e) => saveCfg({ ...cfg, meta: Number(e.target.value) || 0 })}
              className="bg-slate-950 border border-white/10 rounded px-3 py-1.5 text-sm w-40 font-mono" />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Total de seções (p/ %)</label>
            <input type="number" value={cfg.totalSecoes || ''} onChange={(e) => saveCfg({ ...cfg, totalSecoes: Number(e.target.value) || 0 })}
              className="bg-slate-950 border border-white/10 rounded px-3 py-1.5 text-sm w-40 font-mono" />
          </div>
          <p className="text-[11px] text-slate-500">Salvo neste navegador. Defina pra ativar os percentuais.</p>
        </div>
      )}

      {/* Destaque: votos x meta */}
      <div className="bg-gradient-to-br from-emerald-900/30 to-slate-900 border border-emerald-500/30 rounded-2xl p-6 text-center">
        <p className="text-[11px] uppercase tracking-widest text-emerald-400 font-black flex items-center justify-center gap-2"><Vote className="w-4 h-4" /> Votos apurados (nosso candidato)</p>
        <p className="text-6xl md:text-8xl font-black text-white my-2 font-mono tracking-tighter">{fmt(totalVotos)}</p>
        {cfg.meta > 0 ? (
          <>
            <div className="max-w-2xl mx-auto h-5 bg-slate-800 rounded-full overflow-hidden mt-4 border border-white/10">
              <div className={`h-full transition-all duration-700 ${metaPct >= 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-500 to-emerald-500'}`} style={{ width: `${metaPct}%` }} />
            </div>
            <p className="text-sm text-slate-300 mt-2">
              <Target className="w-4 h-4 inline text-amber-400" /> Meta: <b>{fmt(cfg.meta)}</b> · <b className="text-emerald-400">{metaPct.toFixed(1)}%</b> atingido ·
              {faltam > 0 ? <> faltam <b className="text-amber-400">{fmt(faltam)}</b> votos</> : <b className="text-emerald-400"> META ATINGIDA! 🎉</b>}
            </p>
          </>
        ) : (
          <p className="text-xs text-slate-500 mt-2">Defina a meta de votos (botão "Meta") para ver o progresso.</p>
        )}
      </div>

      {/* Corrida Eleitoral */}
      <div className="bg-slate-900/40 rounded-2xl p-5">
        <h2 className="text-lg font-black mb-4 flex items-center gap-2"><Flag className="w-5 h-5 text-emerald-400" /> Corrida Eleitoral
          <span className="text-[11px] font-normal text-slate-500">linha de chegada = {cfg.meta > 0 ? `meta (${fmt(cfg.meta)})` : 'líder atual'}</span>
        </h2>
        <div className="relative space-y-4 pr-10">
          {/* Linha de chegada */}
          <div className="absolute top-0 bottom-0 right-7 w-0.5 bg-white/30" style={{ backgroundImage: 'repeating-linear-gradient(0deg,#fff 0 6px,transparent 6px 12px)' }} />
          <Flag className="absolute -top-1 right-4 w-6 h-6 text-white" />
          {racers.length === 0 ? (
            <p className="text-slate-500 text-sm">Aguardando votos apurados…</p>
          ) : racers.map((r, i) => {
            const pct = Math.min(96, finishLine > 0 ? (r.votos / finishLine) * 100 : 0);
            return (
              <div key={r.id}>
                <div className="flex justify-between text-xs mb-1">
                  <span className={r.us ? 'text-emerald-400 font-bold' : 'text-slate-300'}>{i === 0 ? '👑 ' : ''}{r.label}{r.us ? ' (você)' : ''}</span>
                  <span className="font-mono text-slate-400">{fmt(r.votos)} votos</span>
                </div>
                <div className="relative h-7 bg-slate-800 rounded-full overflow-visible">
                  <div className={`absolute left-0 top-0 h-full rounded-full transition-all duration-1000 ${r.us ? 'bg-gradient-to-r from-emerald-600 to-emerald-400' : 'bg-slate-600'}`} style={{ width: `${pct}%` }} />
                  <span className="absolute -top-1.5 text-2xl transition-all duration-1000" style={{ left: `calc(${pct}% - 4px)` }}>{r.us ? '🏎️' : '🚗'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 rounded-xl p-4 text-center">
          <Gauge className="w-6 h-6 text-sky-400 mx-auto mb-1" />
          <p className="text-3xl font-black text-sky-400">{fmt(secoesApuradas)}</p>
          <p className="text-[11px] text-slate-500 uppercase">Seções apuradas</p>
        </div>
        <div className="bg-slate-900/60 rounded-xl p-4 text-center">
          <Gauge className="w-6 h-6 text-indigo-400 mx-auto mb-1" />
          <p className="text-3xl font-black text-indigo-400">{cfg.totalSecoes > 0 ? `${secoesPct.toFixed(1)}%` : '—'}</p>
          <p className="text-[11px] text-slate-500 uppercase">% das seções{cfg.totalSecoes > 0 ? ` (de ${fmt(cfg.totalSecoes)})` : ''}</p>
        </div>
        <div className="bg-slate-900/60 rounded-xl p-4 text-center">
          <MapPin className="w-6 h-6 text-pink-400 mx-auto mb-1" />
          <p className="text-3xl font-black text-pink-400">{porZona.length}</p>
          <p className="text-[11px] text-slate-500 uppercase">Zonas com apuração</p>
        </div>
        <div className="bg-slate-900/60 rounded-xl p-4 text-center">
          <Trophy className="w-6 h-6 text-yellow-400 mx-auto mb-1" />
          <p className="text-3xl font-black text-yellow-400 truncate">{porZona[0]?.zona ?? '—'}</p>
          <p className="text-[11px] text-slate-500 uppercase">Zona campeã</p>
        </div>
      </div>

      {/* Ranking por zona — números e % */}
      <div className="bg-slate-900/40 rounded-2xl p-5">
        <h2 className="text-lg font-black mb-4 flex items-center gap-2"><Trophy className="w-5 h-5 text-yellow-400" /> Desempenho por Zona Eleitoral</h2>
        {porZona.length === 0 ? (
          <p className="text-slate-500 text-sm">Aguardando os primeiros BUs escaneados pelos fiscais…</p>
        ) : (
          <div className="space-y-3">
            {porZona.map((z, i) => {
              const pct = totalVotos > 0 ? (z.votos / totalVotos) * 100 : 0;
              return (
                <div key={z.zona} className="flex items-center gap-3">
                  <span className={`text-lg font-black w-8 text-center ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-slate-600'}`}>{i + 1}º</span>
                  <span className="w-24 shrink-0 font-bold">Zona {z.zona}</span>
                  <div className="flex-1 h-7 bg-slate-800 rounded-lg overflow-hidden relative">
                    <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700" style={{ width: `${pct}%` }} />
                    <span className="absolute inset-0 flex items-center px-3 text-sm font-bold">{fmt(z.votos)} votos · {pct.toFixed(1)}%</span>
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs text-slate-400">{z.secoes} seç.</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ApuracaoLiveDashboard;
