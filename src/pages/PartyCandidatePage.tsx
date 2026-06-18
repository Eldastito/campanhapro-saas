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
// As 4 fotos padronizadas que provam o comitê sem dar margem a fraude.
const COMMITTEE_SLOTS = [
  { key: 'fachada', label: 'Fachada', hint: 'Frente do comitê com o NÚMERO e o nome da RUA visíveis.' },
  { key: 'interior', label: 'Interior', hint: 'Por dentro: mesas, cadeiras, estrutura funcionando.' },
  { key: 'placa', label: 'Placa / material', hint: 'Placa, banner ou material de campanha no local.' },
  { key: 'equipe', label: 'Selfie da equipe', hint: 'Você (e a equipe) dentro do comitê, mostrando que está ativo.' },
];

const PartyCandidatePage: React.FC = () => {
  const { logout } = useAuth();
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<any>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  // comitê form
  const [addr, setAddr] = React.useState('');
  const [geo, setGeo] = React.useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = React.useState<CapturedGeo['status'] | null>(null);
  // 4 slots: cada um é data URL (nova foto), URL assinada (carregada do banco) ou null.
  const [photos, setPhotos] = React.useState<(string | null)[]>([null, null, null, null]);
  const [photoBusySlot, setPhotoBusySlot] = React.useState<number | null>(null);
  const inApp = React.useMemo(() => isInAppBrowser(), []);

  const load = React.useCallback(async () => {
    try {
      const r = await authedFetch('/api/v1/party/candidate/me');
      const j = await r.json();
      if (r.ok) {
        setData(j); setAddr(j.committee?.address || '');
        if (j.committee?.lat) { setGeo({ lat: j.committee.lat, lng: j.committee.lng }); setGeoStatus('ok'); }
        const loaded = j.committee?.photos || [];
        setPhotos([0, 1, 2, 3].map((i) => loaded[i] || null));
      }
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

  const capturePhotoSlot = async (i: number, file: File | undefined) => {
    if (!file) return;
    setPhotoBusySlot(i); setMsg(null);
    try {
      const compressed = await compressImage(file);
      setPhotos((prev) => prev.map((p, idx) => (idx === i ? compressed : p)));
      setMsg({ kind: 'ok', text: `Foto "${COMMITTEE_SLOTS[i].label}" pronta ✅ — toque em salvar quando terminar as 4.` });
    } catch { setMsg({ kind: 'err', text: 'Não consegui processar a foto. Tente tirar de novo.' }); }
    finally { setPhotoBusySlot(null); }
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
  const photoCount = photos.filter(Boolean).length;
  const salvarComite = async () => {
    if (!addr.trim() && photoCount === 0 && !geo) { setMsg({ kind: 'warn', text: 'Preencha o endereço, tire as fotos ou capture o GPS antes de salvar.' }); return; }
    setBusy('comite'); setMsg(null);
    let g = await tryGeo();
    let geoSource: 'gps' | 'address' | undefined = g ? 'gps' : undefined;
    // Fallback: sem GPS, tenta localizar pelo endereço digitado (usa o geocode que já funciona no mapa).
    if (!g && addr.trim()) {
      const gc = await geocode(addr.trim());
      if (gc) { g = gc; geoSource = 'address'; }
    }
    // Cada slot vira: data URL (nova), "KEEP" (já estava salva) ou null (vazio).
    const payloadPhotos = photos.map((p) => (p ? (p.startsWith('data:') ? p : 'KEEP') : null));
    try {
      const r = await postWithTimeout('/api/v1/party/candidate/committee', { address: addr, lat: g?.lat ?? null, lng: g?.lng ?? null, geoSource, photos: payloadPhotos });
      if (r.ok) {
        await load();
        const faltam = COMMITTEE_SLOTS.length - photoCount;
        const fotosMsg = faltam > 0 ? ` Faltam ${faltam} foto(s) para a comprovação completa.` : ' As 4 fotos estão completas! ✅';
        setMsg(geoSource === 'gps' ? { kind: faltam > 0 ? 'warn' : 'ok', text: `✅ Comitê salvo COM GPS no local.${fotosMsg}` }
             : geoSource === 'address' ? { kind: 'warn', text: `✅ Comitê salvo (localização aproximada pelo endereço). Para prova forte, ligue o GPS no local e atualize.${fotosMsg}` }
             : { kind: 'warn', text: `✅ Comitê salvo — SEM localização. Ligue o GPS e atualize.${fotosMsg}` });
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
        <div className="flex items-center justify-between mb-1">
          <p className="font-bold flex items-center gap-2"><Building2 className="w-5 h-5 text-indigo-300" /> Comitê</p>
          <span className={`text-xs font-bold ${photoCount === 4 ? 'text-emerald-300' : 'text-amber-300'}`}>{photoCount}/4 fotos</span>
        </div>
        <p className="text-xs text-slate-400 mb-3">Envie as <b>4 fotos</b> abaixo no local, com o GPS ligado. É o que prova que o comitê existe de verdade.</p>

        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Endereço do comitê (rua, número, bairro)" className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white mb-2" />
        <button onClick={pegarGps} disabled={busy === 'gps'} className={`w-full mb-3 px-3 py-2 rounded-xl text-sm flex items-center justify-center gap-2 ${geo ? 'bg-emerald-600/20 text-emerald-300' : 'bg-white/5 text-slate-200'}`}>
          {busy === 'gps' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />} {geo ? 'Localização capturada ✅' : 'Usar minha localização (GPS)'}
        </button>

        {/* 4 slots de foto padronizados */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {COMMITTEE_SLOTS.map((slot, i) => (
            <label key={slot.key} className="relative block rounded-xl overflow-hidden border border-white/10 bg-slate-950 cursor-pointer aspect-[4/3]">
              {photos[i]
                ? <img src={photos[i] as string} alt={slot.label} className="absolute inset-0 w-full h-full object-cover" />
                : <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
                    {photoBusySlot === i ? <Loader2 className="w-5 h-5 animate-spin text-indigo-300" /> : <Camera className="w-5 h-5 text-slate-500 mb-1" />}
                  </div>}
              {/* rótulo + dica sempre visíveis */}
              <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1">
                <p className="text-[11px] font-bold text-white flex items-center gap-1">{photos[i] ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <span className="text-amber-300">{i + 1}.</span>} {slot.label}</p>
                <p className="text-[9px] text-slate-300 leading-tight">{slot.hint}</p>
              </div>
              <input type="file" accept="image/*" className="hidden" disabled={photoBusySlot !== null} onChange={(e) => capturePhotoSlot(i, e.target.files?.[0])} />
            </label>
          ))}
        </div>

        <button onClick={salvarComite} disabled={busy === 'comite'} className={`w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2 ${photos.some((p) => p && p.startsWith('data:')) ? 'ring-2 ring-amber-400/70 animate-pulse' : ''}`}>
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

      {/* Cortesia da plataforma — o partido contratou o produto Partido; aqui oferecemos
          o ESSENCIAL do CampanhaPro de cortesia + caminho pago pro completo. */}
      <div className="mt-6 bg-gradient-to-br from-indigo-600/15 to-fuchsia-600/10 border border-indigo-500/30 rounded-3xl p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="bg-indigo-500/20 border border-indigo-500/30 rounded-2xl p-2.5 shrink-0">
            <Sparkles className="w-5 h-5 text-fuchsia-300" />
          </div>
          <div>
            <p className="font-black text-indigo-100 text-lg leading-tight">CampanhaPro de cortesia</p>
            <p className="text-xs text-slate-400">Cedido por <b>{data.partyName || 'seu partido'}</b></p>
          </div>
        </div>
        <p className="text-sm text-slate-300 mb-4">
          Além de prestar contas, você pode <b>organizar sua campanha</b>: CRM de eleitores,
          agenda, formulários, equipe — tudo grátis enquanto durar o piloto. Quer mais?
          O <b className="text-fuchsia-300">Plano Pro</b> tem IA estrategista, dossiê de adversários e Dia D.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button onClick={() => { import('./PartyCandidateShell').then((m) => m.setPartyView('platform')); }}
            className="bg-indigo-600 hover:bg-indigo-500 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2 text-white">
            <Sparkles className="w-4 h-4" /> Acessar a plataforma
          </button>
          <a href="/assinar" target="_blank" rel="noreferrer"
            className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2 text-fuchsia-200 text-sm">
            Conhecer Plano Pro <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Compliance / LGPD — transparência, não vigilância */}
      <div className="mt-6 mb-2 text-[11px] leading-relaxed text-slate-500 border-t border-white/5 pt-4">
        <p className="font-bold text-slate-400 mb-1">Privacidade e transparência</p>
        <p>
          A foto e a localização do comitê/check-ins são registradas no ato apenas para <b>comprovar a aplicação dos recursos da campanha</b> ao presidente do seu partido — é prestação de contas, não monitoramento pessoal.
          Os dados ficam armazenados com segurança e são usados só para essa finalidade (LGPD, art. 7º). Você pode falar com a coordenação do partido para corrigir ou remover informações.
        </p>
      </div>
    </div>
  );
};

export default PartyCandidatePage;
