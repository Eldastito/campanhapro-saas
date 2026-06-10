import * as React from 'react';
import {
  Landmark, MapPin, Camera, CheckCircle2, Loader2, LogOut, Target, Building2, Navigation, Sparkles, ArrowRight,
} from 'lucide-react';
import { authedFetch } from '../lib/authedFetch';
import { useAuth } from '../contexts/AuthContext';
import { captureGeo, compressImage, isInAppBrowser, GEO_MESSAGES, type CapturedGeo } from '../lib/captureUtils';
import { geocode } from '../lib/geocode';

/**
 * Experiência ENXUTA do candidato dentro do partido: comprova que o dinheiro
 * virou estrutura — cadastra o comitê (foto + GPS) e faz check-ins
 * geolocalizados. Tudo alimenta o painel do presidente e o score.
 */
const PartyCandidatePage: React.FC = () => {
  const { user, logout } = useAuth();
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<any>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  // comitê form
  const [addr, setAddr] = React.useState('');
  const [geo, setGeo] = React.useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = React.useState<CapturedGeo['status'] | null>(null);
  const [photo, setPhoto] = React.useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const inApp = React.useMemo(() => isInAppBrowser(), []);

  const load = React.useCallback(async () => {
    try {
      const r = await authedFetch('/api/v1/party/candidate/me');
      const j = await r.json();
      if (r.ok) { setData(j); setAddr(j.committee?.address || ''); if (j.committee?.lat) { setGeo({ lat: j.committee.lat, lng: j.committee.lng }); setGeoStatus('ok'); } }
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  // GPS best-effort: tenta capturar, atualiza o estado, NUNCA bloqueia. Reaproveita
  // uma captura recente para não pedir permissão de novo a cada ação.
  const tryGeo = async (): Promise<{ lat: number; lng: number } | null> => {
    const g = await captureGeo();
    setGeoStatus(g.status);
    if (g.status === 'ok' && g.lat != null && g.lng != null) {
      const next = { lat: g.lat, lng: g.lng };
      setGeo(next);
      return next;
    }
    return geo; // pode haver um GPS já capturado antes
  };

  const postWithTimeout = async (url: string, body: any) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    try { return await authedFetch(url, { method: 'POST', body: JSON.stringify(body), signal: ctrl.signal }); }
    finally { clearTimeout(t); }
  };

  const capturePhoto = async (file: File | undefined, setter: (s: string) => void) => {
    if (!file) return;
    setPhotoBusy(true); setMsg(null);
    try { setter(await compressImage(file)); setMsg({ kind: 'ok', text: 'Foto pronta ✅ — agora toque em salvar.' }); }
    catch { setMsg({ kind: 'err', text: 'Não consegui processar a foto. Tente tirar de novo.' }); }
    finally { setPhotoBusy(false); }
  };

  const pegarGps = async () => {
    setBusy('gps'); setMsg(null);
    try {
      const g = await tryGeo();
      if (g) setMsg({ kind: 'ok', text: 'Localização capturada ✅' });
      else setMsg({ kind: 'warn', text: `📍 ${GEO_MESSAGES[geoStatus || 'error']} Você ainda pode salvar — mas sem GPS a comprovação fica mais fraca.` });
    } finally { setBusy(null); }
  };

  // Comitê: SEMPRE salva (com ou sem GPS). Ordem de comprovação:
  //   1) GPS no local (prova forte)  2) endereço geocodificado (aproximado)  3) sem localização
  const salvarComite = async () => {
    if (!addr.trim() && !photo && !geo) { setMsg({ kind: 'warn', text: 'Preencha o endereço, tire a foto ou capture o GPS antes de salvar.' }); return; }
    setBusy('comite'); setMsg(null);
    let g = await tryGeo();
    let geoSource: 'gps' | 'address' | undefined = g ? 'gps' : undefined;
    // Fallback: sem GPS, tenta localizar pelo endereço digitado (usa o geocode que já funciona no mapa).
    if (!g && addr.trim()) {
      const gc = await geocode(addr.trim());
      if (gc) { g = gc; geoSource = 'address'; }
    }
    try {
      const r = await postWithTimeout('/api/v1/party/candidate/committee', { address: addr, lat: g?.lat ?? null, lng: g?.lng ?? null, geoSource, photo });
      if (r.ok) {
        setPhoto(null); await load();
        setMsg(geoSource === 'gps' ? { kind: 'ok', text: '✅ Comitê salvo COM GPS no local (prova forte)!' }
             : geoSource === 'address' ? { kind: 'ok', text: '✅ Comitê salvo! Localização aproximada pelo endereço. Para a prova forte, ligue o GPS no local e toque em "Atualizar comitê".' }
             : { kind: 'warn', text: '✅ Comitê salvo — mas SEM localização. Preencha o endereço ou ligue o GPS e toque em "Atualizar comitê".' });
      } else { const j = await r.json().catch(() => ({})); setMsg({ kind: 'err', text: `Erro ao salvar: ${j.detail || j.error || 'tente de novo'}` }); }
    } catch (e: any) { setMsg({ kind: 'err', text: e?.name === 'AbortError' ? 'Demorou demais — verifique sua conexão e tente de novo.' : `Erro ao salvar: ${e.message}` }); }
    finally { setBusy(null); }
  };

  // Check-in: SEMPRE registra (foto obrigatória; GPS best-effort) e dá mensagem clara de enviado/erro.
  const fazerCheckin = async (file: File | undefined) => {
    if (!file) return;
    setBusy('checkin'); setMsg(null);
    let ph: string;
    try { ph = await compressImage(file); }
    catch { setBusy(null); setMsg({ kind: 'err', text: 'Não consegui processar a foto. Tente tirar de novo.' }); return; }
    const g = await tryGeo();
    try {
      const r = await postWithTimeout('/api/v1/party/candidate/checkin', { tipo: 'comite', lat: g?.lat ?? null, lng: g?.lng ?? null, photo: ph });
      if (r.ok) {
        await load();
        setMsg(g ? { kind: 'ok', text: '✅ Check-in ENVIADO com GPS!' }
                 : { kind: 'warn', text: '✅ Check-in ENVIADO — mas sem GPS. Ligue a localização para valer como comprovação.' });
      } else { const j = await r.json().catch(() => ({})); setMsg({ kind: 'err', text: `Erro no check-in: ${j.detail || j.error || 'tente de novo'}` }); }
    } catch (e: any) { setMsg({ kind: 'err', text: e?.name === 'AbortError' ? 'Demorou demais — verifique sua conexão.' : `Erro no check-in: ${e.message}` }); }
    finally { setBusy(null); }
  };

  if (loading) return <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>;

  if (!data?.candidate) {
    return <div className="min-h-screen bg-[#0a0a0b] text-white flex items-center justify-center p-6 text-center"><p className="text-slate-400">Seu cadastro de candidato não foi encontrado. Fale com o presidente do partido.</p></div>;
  }

  const committee = data.committee;
  const metas = data.metas || [];
  const metasDone = metas.filter((m: any) => m.done).length;

  return (
    <div className="p-5 bg-[#0a0a0b] min-h-screen text-white font-sans max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2"><Landmark className="text-indigo-400 w-6 h-6" /> {data.candidate.displayName}</h1>
          <p className="text-gray-400 text-sm">{data.partyName} · comprovação de campanha</p>
        </div>
        <button onClick={() => logout?.()} className="bg-white/5 hover:bg-white/10 px-3 py-2 rounded-xl text-slate-300 flex items-center gap-2 text-sm"><LogOut className="w-4 h-4" /> Sair</button>
      </div>

      {msg && (
        <div className={`mb-4 text-sm rounded-xl px-3 py-2 border ${
          msg.kind === 'ok' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
          : msg.kind === 'warn' ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
          : 'bg-red-500/10 border-red-500/40 text-red-200'}`}>{msg.text}</div>
      )}

      {/* Banner: navegador embutido (WhatsApp/Instagram) bloqueia o GPS — orienta abrir no Chrome/Safari */}
      {inApp && (
        <div className="mb-4 bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 text-sm">
          <p className="font-bold text-amber-200 flex items-center gap-1.5"><Navigation className="w-4 h-4" /> Abra no Chrome ou Safari para liberar o GPS</p>
          <p className="text-amber-100/80 mt-1 text-xs">Você abriu este link dentro do WhatsApp/Instagram, que não deixa o site usar sua localização. Toque nos <b>3 pontinhos</b> (canto da tela) → <b>"Abrir no navegador"</b>. Lá o GPS funciona. <b>Você ainda consegue salvar aqui sem GPS</b>, mas a comprovação fica mais fraca.</p>
        </div>
      )}

      {/* Dica de GPS quando a permissão foi negada/sem sinal (mas o salvamento nunca trava) */}
      {(geoStatus === 'denied' || geoStatus === 'error' || geoStatus === 'timeout') && !inApp && (
        <div className="mb-4 bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 text-sm">
          <p className="font-bold text-amber-200 flex items-center gap-1.5"><Navigation className="w-4 h-4" /> Como liberar sua localização</p>
          <ol className="list-decimal list-inside text-amber-100/80 mt-2 space-y-1 text-xs">
            <li>Ligue o <b>GPS/Localização</b> do celular (arraste a barra de cima).</li>
            <li>Toque no <b>cadeado</b> (ou ⓘ) ao lado do endereço do site, no topo.</li>
            <li>Em <b>Permissões → Localização</b>, escolha <b>Permitir</b>.</li>
            <li>Toque novamente em <b>"Usar minha localização"</b>.</li>
          </ol>
          <button onClick={pegarGps} disabled={busy === 'gps'}
            className="mt-3 text-xs bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg px-3 py-1.5 flex items-center gap-1.5">
            <Navigation className="w-3.5 h-3.5" /> Tentar de novo
          </button>
        </div>
      )}

      {/* Score do candidato — o mesmo que o presidente vê */}
      {data.score && (
        <div className={`mb-4 rounded-3xl p-4 border flex items-center gap-3 ${
          data.score.level === 'green' ? 'bg-emerald-500/10 border-emerald-500/30'
          : data.score.level === 'yellow' ? 'bg-amber-500/10 border-amber-500/30'
          : 'bg-rose-500/10 border-rose-500/30'}`}>
          <span className="text-3xl">{data.score.emoji}</span>
          <div className="min-w-0">
            <p className="font-black text-white">Seu índice de comprovação: {data.score.score}/100</p>
            {data.score.reasons?.length
              ? <p className="text-xs text-slate-300 mt-0.5">Para melhorar: {data.score.reasons.slice(0, 2).join(' · ')}</p>
              : <p className="text-xs text-emerald-300 mt-0.5">Tudo em dia! Continue fazendo check-ins.</p>}
          </div>
        </div>
      )}

      {/* Metas */}
      <div className="bg-gradient-to-br from-purple-600/15 to-fuchsia-600/10 border border-white/10 rounded-3xl p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="font-bold flex items-center gap-2"><Target className="w-5 h-5 text-purple-300" /> Suas metas</p>
          <span className="text-sm font-black text-purple-200">{metasDone}/{metas.length}</span>
        </div>
        <div className="space-y-1.5">
          {metas.map((m: any, i: number) => (
            <div key={i} className={`flex items-center gap-2 text-sm ${m.done ? 'text-emerald-300' : 'text-slate-400'}`}>
              {m.done ? <CheckCircle2 className="w-4 h-4" /> : <div className="w-4 h-4 rounded border border-slate-600" />} {m.label}
            </div>
          ))}
        </div>
      </div>

      {/* Comitê */}
      <div className="bg-[#1c2128] border border-white/5 rounded-3xl p-5 mb-6">
        <p className="font-bold flex items-center gap-2 mb-3"><Building2 className="w-5 h-5 text-indigo-300" /> Comitê</p>
        {committee && committee.lat && (
          <div className="mb-3 text-xs text-emerald-300 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Comitê cadastrado {committee.photo ? '(com foto)' : ''} · GPS ok</div>
        )}
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Endereço do comitê" className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white mb-2" />
        <div className="flex flex-wrap gap-2 mb-2">
          <button onClick={pegarGps} disabled={busy === 'gps'} className={`px-3 py-2 rounded-xl text-sm flex items-center gap-2 ${geo ? 'bg-emerald-600/20 text-emerald-300' : 'bg-white/5 text-slate-200'}`}>
            {busy === 'gps' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />} {geo ? 'Localização capturada' : 'Usar minha localização'}
          </button>
          <label className="px-3 py-2 rounded-xl text-sm flex items-center gap-2 bg-white/5 text-slate-200 cursor-pointer">
            {photoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />} {photoBusy ? 'Processando…' : photo ? 'Foto pronta ✅' : 'Foto do comitê'}
            <input type="file" accept="image/*" className="hidden" disabled={photoBusy} onChange={(e) => capturePhoto(e.target.files?.[0], setPhoto)} />
          </label>
        </div>
        {(photo || committee?.photo) && <img src={photo || committee.photo} alt="comitê" className="w-full max-h-48 object-cover rounded-xl mb-2" />}
        {photo && <p className="text-xs text-amber-300 mb-2 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Foto preparada — toque em <b>salvar</b> abaixo para enviar.</p>}
        <button onClick={salvarComite} disabled={busy === 'comite'} className={`w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2 ${photo ? 'ring-2 ring-amber-400/70 animate-pulse' : ''}`}>
          {busy === 'comite' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />} {busy === 'comite' ? 'Salvando…' : committee ? 'Atualizar comitê' : 'Salvar comitê'}
        </button>
      </div>

      {/* Check-in */}
      <div className="bg-[#1c2128] border border-white/5 rounded-3xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="font-bold flex items-center gap-2"><Camera className="w-5 h-5 text-amber-300" /> Check-in no comitê</p>
          <span className="text-xs text-slate-500">{(data.checkins || []).length} registrados</span>
        </div>
        <p className="text-xs text-slate-400 mb-3">Tire uma foto no comitê — registramos com seu GPS no ato. É a prova de que o comitê está ativo.</p>
        <label className="w-full bg-amber-600 hover:bg-amber-500 rounded-xl px-4 py-3 font-bold flex items-center justify-center gap-2 cursor-pointer">
          {busy === 'checkin' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />} {busy === 'checkin' ? 'Enviando…' : 'Fazer check-in agora'}
          <input type="file" accept="image/*" className="hidden" disabled={busy === 'checkin'} onChange={(e) => fazerCheckin(e.target.files?.[0])} />
        </label>
        {(data.checkins || []).length > 0 && (
          <div className="mt-3 space-y-1">
            {data.checkins.slice(0, 5).map((c: any) => (
              <div key={c.id} className="text-xs text-slate-400 flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> {new Date(c.createdAt).toLocaleString('pt-BR')} {c.lat ? '· GPS ok' : ''}</div>
            ))}
          </div>
        )}
      </div>

      {/* Teaser de upgrade — o candidato já é um tenant; o CampanhaPro completo é um passo. */}
      <a href="/" target="_blank" rel="noreferrer"
        className="mt-6 block bg-gradient-to-br from-indigo-600/20 to-fuchsia-600/10 border border-indigo-500/30 rounded-3xl p-5 hover:border-indigo-400/50 transition-colors">
        <p className="font-bold flex items-center gap-2 text-indigo-200"><Sparkles className="w-5 h-5 text-fuchsia-300" /> Quer a campanha completa?</p>
        <p className="text-sm text-slate-300 mt-1">Este é o modo essencial de comprovação. O <b>CampanhaPro completo</b> traz IA estrategista, CRM de eleitores, pesquisa, agenda com voz, WhatsApp e mapa de calor — tudo já ligado à sua estrutura.</p>
        <span className="inline-flex items-center gap-1.5 mt-3 text-sm font-bold text-fuchsia-300">Conhecer o plano completo <ArrowRight className="w-4 h-4" /></span>
      </a>
    </div>
  );
};

export default PartyCandidatePage;
