import * as React from 'react';
import { Camera, Loader2, MapPin, Users, Handshake, CheckCircle2, AlertTriangle, Building2 } from 'lucide-react';
import Card from '../ui/Card';
import { authedFetch } from '../../lib/authedFetch';
import { captureGeo, compressImage, GEO_MESSAGES, type CapturedGeo } from '../../lib/captureUtils';

/**
 * Ferramentas leves de campo do Coordenador/Líder de partido (#83).
 *
 * Aparece APENAS no Dashboard quando o usuário é Coordenador/Líder e a campanha
 * dele está vinculada a um candidato de partido. Registra visita ou reunião
 * com GPS+foto+nota — o check-in vai pro mesmo bucket do candidato e engorda
 * o checkinCount (score). O presidente vê no Telão e nas Provas.
 */
interface MemberCtx {
  role: 'Coordenador' | 'Líder';
  candidate: { id: string; name: string; cargo: string | null; regiao: string | null };
  party: { id: string; name: string };
  mine: { id: string; tipo: string; nota: string | null; createdAt: string }[];
  mineCount: number;
}

const TIPOS: { key: 'visita' | 'reuniao'; label: string; emoji: string; hint: string }[] = [
  { key: 'visita', label: 'Visita', emoji: '🚪', hint: 'Visita a eleitor, casa de apoiador, comércio.' },
  { key: 'reuniao', label: 'Reunião', emoji: '🤝', hint: 'Reunião de equipe, líderes, lideranças locais.' },
];

const PartyFieldQuickCard: React.FC = () => {
  const [ctx, setCtx] = React.useState<MemberCtx | null>(null);
  const [denied, setDenied] = React.useState(false);
  const [tipo, setTipo] = React.useState<'visita' | 'reuniao'>('visita');
  const [nota, setNota] = React.useState('');
  const [photo, setPhoto] = React.useState<string | null>(null);
  const [geo, setGeo] = React.useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = React.useState<CapturedGeo['status'] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const r = await authedFetch('/api/v1/party/member/me');
        if (r.status === 404 || r.status === 403) { setDenied(true); return; }
        if (!r.ok) { setDenied(true); return; }
        const j = await r.json();
        setCtx(j);
      } catch { setDenied(true); }
    })();
  }, []);

  if (denied || !ctx) return null;

  const tryGeo = async () => {
    const g = await captureGeo();
    setGeoStatus(g.status);
    if (g.status === 'ok' && g.lat != null && g.lng != null) {
      const next = { lat: g.lat, lng: g.lng };
      setGeo(next); return next;
    }
    return geo;
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy('photo');
    try {
      const c = await compressImage(file);
      setPhoto(c);
      setMsg({ kind: 'ok', text: 'Foto pronta ✅ — agora salve o registro.' });
    } catch { setMsg({ kind: 'err', text: 'Não consegui processar a foto.' }); }
    finally { setBusy(null); }
  };

  const pegarGps = async () => {
    setBusy('gps'); setMsg(null);
    try {
      const g = await tryGeo();
      if (g) setMsg({ kind: 'ok', text: 'Localização capturada ✅' });
      else setMsg({ kind: 'warn', text: `📍 ${GEO_MESSAGES[geoStatus || 'error']} Você ainda pode salvar.` });
    } finally { setBusy(null); }
  };

  const salvar = async () => {
    if (!photo && !geo && !nota.trim()) {
      setMsg({ kind: 'warn', text: 'Tire uma foto, capture o GPS ou escreva uma nota antes de salvar.' });
      return;
    }
    setBusy('save'); setMsg(null);
    try {
      const g = await tryGeo();
      const r = await authedFetch('/api/v1/party/member/checkin', {
        method: 'POST',
        body: JSON.stringify({ tipo, lat: g?.lat ?? null, lng: g?.lng ?? null, photo, nota: nota.trim() || null }),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg({ kind: 'err', text: j?.detail || j?.error || 'Erro ao salvar.' });
        return;
      }
      setMsg({ kind: 'ok', text: 'Registro salvo — entra no relatório do candidato ✅' });
      setPhoto(null); setNota('');
      // Recarrega lista pra mostrar
      const r2 = await authedFetch('/api/v1/party/member/me');
      if (r2.ok) setCtx(await r2.json());
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Erro inesperado.' });
    } finally { setBusy(null); }
  };

  return (
    <Card className="no-print p-5 border-t-4 border-t-emerald-500">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg shrink-0">
            <MapPin className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-100 truncate">Registro de campo</h3>
            <p className="text-xs text-slate-400 truncate">
              <Building2 className="w-3 h-3 inline-block -mt-0.5 mr-0.5" />
              {ctx.role} de <b className="text-emerald-300">{ctx.candidate.name}</b>
              {ctx.candidate.cargo ? ` · ${ctx.candidate.cargo}` : ''}
            </p>
          </div>
        </div>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
          {ctx.mineCount} registros
        </span>
      </div>

      {/* Tipo */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {TIPOS.map((t) => (
          <button key={t.key} onClick={() => setTipo(t.key)}
            className={`p-3 rounded-xl border text-left transition-colors ${tipo === t.key ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200' : 'bg-slate-800/60 border-white/10 text-slate-400 hover:text-slate-200'}`}>
            <p className="font-bold text-sm">{t.emoji} {t.label}</p>
            <p className="text-[11px] opacity-70 mt-0.5">{t.hint}</p>
          </button>
        ))}
      </div>

      {/* Nota */}
      <textarea value={nota} onChange={(e) => setNota(e.target.value.slice(0, 300))}
        placeholder={tipo === 'visita' ? 'Quem foi visitado? Bairro? Resultado?' : 'Pauta da reunião, quantas pessoas, onde?'}
        rows={2}
        className="w-full bg-slate-900/60 border border-white/10 rounded-xl p-2.5 text-sm text-white placeholder:text-slate-500 mb-3" />

      {/* Botões captura */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <label className={`flex flex-col items-center justify-center gap-1 p-3 rounded-xl border cursor-pointer text-xs font-bold ${photo ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-slate-800/60 border-white/10 text-slate-300 hover:bg-slate-800'}`}>
          {photo ? <CheckCircle2 className="w-5 h-5" /> : <Camera className="w-5 h-5" />}
          {photo ? 'Foto pronta' : 'Tirar foto'}
          <input type="file" accept="image/*" capture="environment" className="hidden"
            disabled={busy === 'photo'} onChange={(e) => onPhoto(e.target.files?.[0])} />
        </label>
        <button onClick={pegarGps} disabled={!!busy}
          className={`flex flex-col items-center justify-center gap-1 p-3 rounded-xl border text-xs font-bold ${geo ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-slate-800/60 border-white/10 text-slate-300 hover:bg-slate-800'}`}>
          {busy === 'gps' ? <Loader2 className="w-5 h-5 animate-spin" /> : <MapPin className="w-5 h-5" />}
          {geo ? 'GPS ✅' : 'Pegar GPS'}
        </button>
        <button onClick={salvar} disabled={!!busy}
          className="flex flex-col items-center justify-center gap-1 p-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-60">
          {busy === 'save' ? <Loader2 className="w-5 h-5 animate-spin" /> : (tipo === 'visita' ? <Handshake className="w-5 h-5" /> : <Users className="w-5 h-5" />)}
          {busy === 'save' ? 'Enviando…' : 'Salvar'}
        </button>
      </div>

      {/* Feedback */}
      {msg && (
        <div className={`text-xs rounded-lg p-2.5 mb-3 flex items-start gap-2 ${
          msg.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300' :
          msg.kind === 'warn' ? 'bg-amber-500/10 text-amber-300' :
          'bg-rose-500/10 text-rose-300'
        }`}>
          {msg.kind !== 'ok' && <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Últimos registros */}
      {ctx.mine.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">Seus últimos</h4>
          <ul className="space-y-1">
            {ctx.mine.slice(0, 4).map((m) => (
              <li key={m.id} className="text-xs text-slate-400 flex items-center gap-2">
                <span className="text-emerald-400">{m.tipo === 'visita' ? '🚪' : '🤝'}</span>
                <span className="truncate flex-1">{m.nota || (m.tipo === 'visita' ? 'Visita' : 'Reunião')}</span>
                <span className="text-slate-500 text-[10px] shrink-0">{new Date(m.createdAt).toLocaleDateString('pt-BR')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};

export default PartyFieldQuickCard;
