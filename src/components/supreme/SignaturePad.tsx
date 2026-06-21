import React, { useRef, useState, useEffect, useCallback } from 'react';
import Button from '../ui/Button';
import { Eraser, Check, X } from 'lucide-react';

/**
 * Captura de assinatura desenhada na tela — funciona com mouse, toque e caneta
 * (Pointer Events cobrem stylus em tablet/celular/mesa digital). Devolve a
 * assinatura como PNG (dataURL) via onSave. Traço suavizado; canvas em alta
 * resolução (devicePixelRatio) para a imagem não sair serrilhada no PDF.
 */
interface Props {
  onSave: (dataUrl: string, meta: { nome: string; papel: string }) => void;
  onCancel: () => void;
  saving?: boolean;
}

const SignaturePad: React.FC<Props> = ({ onSave, onCancel, saving }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [nome, setNome] = useState('');
  const [papel, setPapel] = useState('');

  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, []);

  useEffect(() => { setup(); }, [setup]);

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !last.current) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk) setHasInk(true);
  };
  const end = () => { drawing.current = false; last.current = null; };

  const clear = () => { setup(); setHasInk(false); };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return;
    onSave(canvas.toDataURL('image/png'), { nome: nome.trim(), papel: papel.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 w-full max-w-lg space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white">Assinar contrato</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input className="bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="Nome de quem assina" value={nome} onChange={(e) => setNome(e.target.value)} />
          <input className="bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="Papel (ex.: Contratante)" value={papel} onChange={(e) => setPapel(e.target.value)} />
        </div>
        <p className="text-[11px] text-slate-500">Assine com o dedo ou caneta (tablet/celular/mesa digital).</p>
        <canvas
          ref={canvasRef}
          className="w-full h-48 rounded-lg border border-white/10 bg-white touch-none cursor-crosshair"
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} onPointerCancel={end}
        />
        <div className="flex items-center justify-between">
          <Button onClick={clear} className="bg-slate-700 hover:bg-slate-600 h-9 text-xs flex items-center gap-1.5"><Eraser className="w-4 h-4" /> Limpar</Button>
          <Button onClick={save} disabled={!hasInk || saving} className="bg-emerald-600 hover:bg-emerald-500 h-9 text-xs flex items-center gap-1.5">
            <Check className="w-4 h-4" /> {saving ? 'Salvando…' : 'Confirmar assinatura'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SignaturePad;
