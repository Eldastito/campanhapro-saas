import * as React from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, CheckCircle2, ClipboardPaste, ShieldCheck, Loader2, RefreshCcw } from 'lucide-react';
import { parseBU, qrIndex, votosDoCandidato, CARGO_NOMES, BUParsed } from '../../lib/buParser';

/**
 * Leitor de QR Code do Boletim de Urna (padrão TSE 2026). O BU pode ter de 1 a 4
 * QR Codes — o fiscal escaneia todos; quando completos, remontamos e parseamos.
 * Fallback de colagem manual (cola o texto dos QRs) p/ testar/sem câmera.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  candidateNumber?: string;     // número do nosso candidato (settings)
  cargoCodigo?: number | null;  // código do cargo disputado (TSE)
  onConfirm: (bu: BUParsed) => Promise<void> | void;
}

const READER_ID = 'bu-qr-reader';

const BUScanner: React.FC<Props> = ({ open, onClose, candidateNumber, cargoCodigo, onConfirm }) => {
  const [collected, setCollected] = React.useState<Record<number, string>>({});
  const [total, setTotal] = React.useState<number>(0);
  const [parsed, setParsed] = React.useState<BUParsed | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [manualMode, setManualMode] = React.useState(false);
  const [manualText, setManualText] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const qrRef = React.useRef<any>(null);
  const collectedRef = React.useRef<Record<number, string>>({});

  const stopCamera = React.useCallback(async () => {
    try { if (qrRef.current?.isScanning) await qrRef.current.stop(); } catch { /* ignore */ }
    try { qrRef.current?.clear?.(); } catch { /* ignore */ }
    qrRef.current = null;
  }, []);

  const finalize = React.useCallback(async (texts: string[]) => {
    await stopCamera();
    setParsed(parseBU(texts));
  }, [stopCamera]);

  const handleDecoded = React.useCallback((text: string) => {
    const idx = qrIndex(text);
    if (!idx) { setError('QR lido não é um Boletim de Urna válido.'); return; }
    setError(null);
    if (collectedRef.current[idx.n]) return; // já temos este
    collectedRef.current = { ...collectedRef.current, [idx.n]: text };
    setCollected(collectedRef.current);
    setTotal(idx.total);
    if (Object.keys(collectedRef.current).length >= idx.total) {
      finalize(Object.values(collectedRef.current));
    }
  }, [finalize]);

  // Inicia a câmera ao abrir (e não estando no modo manual / já parseado)
  React.useEffect(() => {
    if (!open || manualMode || parsed) return;
    let active = true;
    const start = async () => {
      try {
        const inst = new Html5Qrcode(READER_ID, { verbose: false } as any);
        qrRef.current = inst;
        await inst.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 260, height: 260 } },
          (decoded: string) => active && handleDecoded(decoded),
          () => { /* frame sem QR — silencioso */ },
        );
      } catch (e: any) {
        setError('Não foi possível abrir a câmera. Use a colagem manual abaixo. ' + (e?.message || ''));
      }
    };
    start();
    return () => { active = false; stopCamera(); };
  }, [open, manualMode, parsed, handleDecoded, stopCamera]);

  React.useEffect(() => { if (!open) { stopCamera(); reset(); } /* eslint-disable-next-line */ }, [open]);

  const reset = () => {
    collectedRef.current = {};
    setCollected({}); setTotal(0); setParsed(null); setError(null); setManualText('');
  };

  const handleManualParse = () => {
    // separa por QRBU (cada QR começa com QRBU:n:x); aceita também linhas
    const parts = manualText.split(/(?=QRBU:\d+:\d+)/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) { setError('Cole o texto dos QR Codes (cada um começa com QRBU:...).'); return; }
    setParsed(parseBU(parts));
    setError(null);
  };

  const handleConfirm = async () => {
    if (!parsed) return;
    setSaving(true);
    try { await onConfirm(parsed); reset(); onClose(); }
    catch (e: any) { setError(e?.message || 'Falha ao salvar.'); }
    finally { setSaving(false); }
  };

  if (!open) return null;

  const collectedCount = Object.keys(collected).length;
  const resultado = parsed ? votosDoCandidato(parsed, candidateNumber || '', cargoCodigo) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md overflow-y-auto">
      <div className="bg-[#161b22] w-full max-w-lg rounded-3xl p-6 border border-white/15 shadow-2xl relative my-8">
        <button onClick={() => { stopCamera(); reset(); onClose(); }} className="absolute top-4 right-4 text-gray-500 hover:text-white"><X className="w-6 h-6" /></button>

        <div className="text-center mb-5">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <Camera className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Leitor de Boletim de Urna</h2>
          <p className="text-gray-400 text-sm">Padrão TSE 2026 · escaneie todos os QR Codes do BU.</p>
        </div>

        {error && <p className="text-xs bg-red-500/10 text-red-400 rounded-lg p-3 mb-3">{error}</p>}

        {/* RESULTADO */}
        {parsed ? (
          <div className="space-y-4">
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-1" />
              <p className="text-sm text-emerald-300 font-bold">BU lido com sucesso</p>
              <p className="text-[11px] text-slate-400">
                {parsed.header.uf || '—'} · Município {parsed.header.municipio || '—'} · Zona {parsed.header.zona || '—'} · Seção {parsed.header.secao || '—'}
                {parsed.header.turno ? ` · ${parsed.header.turno}º turno` : ''}
              </p>
            </div>

            {candidateNumber && (
              <div className="bg-slate-900/60 rounded-xl p-4 text-center">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Votos do nosso candidato ({candidateNumber}{cargoCodigo ? ` · ${CARGO_NOMES[cargoCodigo] || ''}` : ''})</p>
                <p className="text-4xl font-black text-emerald-400 mt-1">{resultado?.votos ?? 0}</p>
                {resultado?.cargo && <p className="text-[11px] text-slate-500">de {resultado.cargo.total ?? 0} votos no cargo · {resultado.cargo.brancos ?? 0} brancos · {resultado.cargo.nulos ?? 0} nulos</p>}
              </div>
            )}

            <div className="max-h-40 overflow-y-auto space-y-2">
              {parsed.cargos.map((c, i) => (
                <div key={i} className="bg-slate-900/40 rounded-lg p-2 text-xs">
                  <p className="font-bold text-slate-300">{CARGO_NOMES[c.codigo] || `Cargo ${c.codigo}`} <span className="text-slate-500">· {Object.keys(c.candidatos).length} candidato(s) · total {c.total ?? '—'}</span></p>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-slate-500 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> {parsed.assinatura ? 'Assinatura digital presente no BU.' : 'Sem assinatura (verifique se leu o último QR).'}</p>

            <div className="flex gap-2">
              <button onClick={reset} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-300 text-sm flex items-center justify-center gap-2"><RefreshCcw className="w-4 h-4" /> Ler outro</button>
              <button onClick={handleConfirm} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Confirmar e salvar
              </button>
            </div>
          </div>
        ) : manualMode ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Cole o texto dos QR Codes do BU (cada um começa com <code className="text-slate-300">QRBU:</code>). Pode colar todos juntos.</p>
            <textarea value={manualText} onChange={(e) => setManualText(e.target.value)} rows={6}
              placeholder="QRBU:1:1 VRQR:1.5 VRCH:... ORIG:VOTA ... HASH:... ASSI:..."
              className="w-full bg-slate-950 border border-white/10 rounded-lg p-2 text-[11px] font-mono text-slate-200" />
            <div className="flex gap-2">
              <button onClick={() => setManualMode(false)} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-300 text-sm">Voltar à câmera</button>
              <button onClick={handleManualParse} className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm">Processar</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div id={READER_ID} className="w-full rounded-2xl overflow-hidden border-2 border-emerald-500/40 bg-black min-h-[240px]" />
            <div className="flex items-center justify-center gap-2 text-sm">
              {Array.from({ length: total || 1 }).map((_, i) => (
                <span key={i} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${collected[i + 1] ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400'}`}>{i + 1}</span>
              ))}
              <span className="text-slate-400 text-xs ml-2">{collectedCount}/{total || '?'} QR lidos</span>
            </div>
            <button onClick={() => { stopCamera(); setManualMode(true); }} className="w-full py-2 rounded-xl border border-white/10 text-slate-300 text-sm flex items-center justify-center gap-2">
              <ClipboardPaste className="w-4 h-4" /> Colar texto manualmente
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BUScanner;
