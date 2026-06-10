import * as React from 'react';
import {
  Landmark, MapPin, Camera, CheckCircle2, Loader2, LogOut, Target, Building2, Navigation,
} from 'lucide-react';
import { authedFetch } from '../lib/authedFetch';
import { useAuth } from '../contexts/AuthContext';
import { getGeo, compressImage } from '../lib/captureUtils';

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
  const [msg, setMsg] = React.useState<string | null>(null);
  // comitê form
  const [addr, setAddr] = React.useState('');
  const [geo, setGeo] = React.useState<{ lat: number; lng: number } | null>(null);
  const [photo, setPhoto] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await authedFetch('/api/v1/party/candidate/me');
      const j = await r.json();
      if (r.ok) { setData(j); setAddr(j.committee?.address || ''); if (j.committee?.lat) setGeo({ lat: j.committee.lat, lng: j.committee.lng }); }
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const capturePhoto = async (file: File | undefined, setter: (s: string) => void) => {
    if (!file) return;
    try { setter(await compressImage(file)); } catch (e: any) { setMsg(e.message); }
  };

  const pegarGps = async () => {
    setBusy('gps'); setMsg(null);
    try { setGeo(await getGeo()); setMsg('Localização capturada ✅'); }
    catch (e: any) { setMsg(`📍 ${e.message} Você ainda pode salvar — mas a localização deixa a comprovação mais forte. Autorize o GPS nas permissões do navegador/celular.`); }
    finally { setBusy(null); }
  };

  // GPS é OPCIONAL — não bloqueia o salvamento (só fortalece a prova).
  const salvarComite = async () => {
    if (!addr.trim() && !photo && !geo) { setMsg('Preencha o endereço, a localização ou uma foto.'); return; }
    setBusy('comite'); setMsg(null);
    try {
      const r = await authedFetch('/api/v1/party/candidate/committee', {
        method: 'POST', body: JSON.stringify({ address: addr, lat: geo?.lat ?? null, lng: geo?.lng ?? null, photo }),
      });
      if (r.ok) { setPhoto(null); await load(); setMsg('Comitê salvo!' + (geo ? '' : ' (sem GPS — autorize a localização para a comprovação ficar forte.)')); }
      else { const j = await r.json().catch(() => ({})); setMsg(`Erro ao salvar: ${j.detail || j.error || 'tente de novo'}`); }
    } catch (e: any) { setMsg(`Erro ao salvar: ${e.message}`); }
    finally { setBusy(null); }
  };

  const fazerCheckin = async (file: File | undefined) => {
    if (!file) return;
    setBusy('checkin'); setMsg(null);
    try {
      const ph = await compressImage(file);
      let g: { lat: number; lng: number } | null = null;
      try { g = await getGeo(); } catch { /* GPS opcional — segue sem */ }
      const r = await authedFetch('/api/v1/party/candidate/checkin', {
        method: 'POST', body: JSON.stringify({ tipo: 'comite', lat: g?.lat ?? null, lng: g?.lng ?? null, photo: ph }),
      });
      if (r.ok) { await load(); setMsg('Check-in registrado!' + (g ? ' (com GPS ✅)' : ' (sem GPS — autorize a localização para a prova ficar forte.)')); }
      else { const j = await r.json().catch(() => ({})); setMsg(`Erro no check-in: ${j.detail || j.error || 'tente de novo'}`); }
    } catch (e: any) { setMsg(`Erro no check-in: ${e.message}`); }
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

      {msg && <div className="mb-4 text-sm bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 rounded-xl px-3 py-2">{msg}</div>}

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
            <Camera className="w-4 h-4" /> {photo ? 'Foto pronta' : 'Foto do comitê'}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => capturePhoto(e.target.files?.[0], setPhoto)} />
          </label>
        </div>
        {(photo || committee?.photo) && <img src={photo || committee.photo} alt="comitê" className="w-full max-h-48 object-cover rounded-xl mb-2" />}
        <button onClick={salvarComite} disabled={busy === 'comite'} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2">
          {busy === 'comite' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />} {committee ? 'Atualizar comitê' : 'Salvar comitê'}
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
          {busy === 'checkin' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />} Fazer check-in agora
          <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy === 'checkin'} onChange={(e) => fazerCheckin(e.target.files?.[0])} />
        </label>
        {(data.checkins || []).length > 0 && (
          <div className="mt-3 space-y-1">
            {data.checkins.slice(0, 5).map((c: any) => (
              <div key={c.id} className="text-xs text-slate-400 flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> {new Date(c.createdAt).toLocaleString('pt-BR')} {c.lat ? '· GPS ok' : ''}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PartyCandidatePage;
