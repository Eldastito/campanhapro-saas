/**
 * Restaurar dados de um backup (#147f).
 *
 * Lê o arquivo .json gerado pelo backup (PartyBackup), valida o formato e repõe
 * os dados no partido (via POST /party/restore — aditivo/idempotente). Pensado
 * pra quem perdeu dados, trocou de computador ou apagou por engano.
 */
import React, { useRef, useState } from 'react';
import { RotateCcw, Loader2, Check, AlertTriangle, FileUp } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

interface ParsedBackup {
  schema?: string;
  party?: { name?: string };
  exportedAt?: string;
  counts?: Record<string, number>;
  data?: any;
}

const PartyRestore: React.FC<{ onRestored?: () => void }> = ({ onRestored }) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const pickFile = () => { setError(null); setResult(null); fileRef.current?.click(); };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-selecionar o mesmo arquivo
    if (!file) return;
    setError(null); setResult(null); setParsed(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (json?.schema !== 'campanhapro.party-backup') {
        setError('Este arquivo não é um backup de partido do CampanhaPro. Escolha o arquivo .json que você salvou.');
        return;
      }
      setParsed(json);
      setFileName(file.name);
    } catch {
      setError('Não consegui ler o arquivo. Confira se é o .json do backup (não a planilha CSV).');
    }
  };

  const restore = async () => {
    if (!parsed) return;
    setBusy(true); setError(null);
    try {
      const r = await authedFetch('/api/v1/party/restore', { method: 'POST', body: JSON.stringify(parsed) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || j?.error || 'Falha ao restaurar.');
      const x = j.restored || {};
      setResult(`✅ Restaurado: ${x.candidatos || 0} candidato(s), ${x.repasses || 0} repasse(s), ${x.recorrentes || 0} recorrente(s), ${x.comites || 0} comitê(s), ${x.checkins || 0} check-in(s).`);
      setParsed(null); setFileName(null);
      onRestored?.();
    } catch (e: any) {
      setError(e?.message || 'Erro ao restaurar.');
    } finally { setBusy(false); }
  };

  const c = parsed?.counts || {};
  return (
    <div className="bg-[#1c2128] border border-white/10 rounded-3xl p-5 mb-4">
      <div className="flex items-center gap-2 mb-1">
        <RotateCcw className="w-5 h-5 text-emerald-300" />
        <h3 className="font-bold text-white">Recuperar dados de um backup</h3>
      </div>
      <p className="text-sm text-slate-400 mb-3">
        Perdeu dados, trocou de computador ou apagou sem querer? Escolha o arquivo <b>.json</b> do backup
        que você salvou e o app repõe candidatos, repasses, comitês e check-ins. Não duplica o que já existe.
      </p>

      <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} className="hidden" />

      {!parsed ? (
        <button onClick={pickFile} disabled={busy}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-50 text-slate-200 font-bold text-sm">
          <FileUp className="w-4 h-4" /> Escolher arquivo de backup (.json)
        </button>
      ) : (
        <div className="bg-slate-950/60 border border-emerald-500/30 rounded-2xl p-3">
          <p className="text-xs text-slate-400 mb-1.5">
            Arquivo: <b className="text-slate-200">{fileName}</b>
            {parsed.party?.name ? <> · partido <b className="text-slate-200">{parsed.party.name}</b></> : null}
            {parsed.exportedAt ? <> · de {new Date(parsed.exportedAt).toLocaleString('pt-BR')}</> : null}
          </p>
          <p className="text-[11px] text-slate-400 mb-3">
            Vai restaurar: {c.candidatos || 0} candidato(s), {c.repasses || 0} repasse(s), {c.recorrentes || 0} recorrente(s), {c.comites || 0} comitê(s), {c.checkins || 0} check-in(s).
            <br /><span className="text-amber-300">Os candidatos voltam como "pendentes" (precisam refazer o acesso). O que já existe não é duplicado.</span>
          </p>
          <div className="flex gap-2">
            <button onClick={restore} disabled={busy}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Restaurar agora
            </button>
            <button onClick={() => { setParsed(null); setFileName(null); }} disabled={busy}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 font-bold text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {result && <p className="mt-3 text-sm text-emerald-300 flex items-start gap-1.5"><Check className="w-4 h-4 mt-0.5 shrink-0" /> {result}</p>}
      {error && <p className="mt-3 text-sm text-rose-400 flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}</p>}
    </div>
  );
};

export default PartyRestore;
