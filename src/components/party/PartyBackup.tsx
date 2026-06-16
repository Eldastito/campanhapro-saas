/**
 * Backup do partido em pendrive / pasta externa (#147c).
 *
 * Card na aba Segurança. Busca TODOS os dados do partido (endpoint escopado —
 * o presidente só baixa o que é dele) e grava num pendrive/pasta que o próprio
 * usuário aponta, via File System Access API. Lembra a pasta pra próxima vez.
 * Sem suporte (Firefox/Safari/celular) → cai pro download.
 */
import React, { useEffect, useState } from 'react';
import { HardDriveDownload, Download, FolderOpen, Loader2, Check, ShieldCheck, AlertTriangle } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';
import {
  supportsDirectoryPicker, pickDirectory, loadSavedDirectory, ensurePermission,
  writeFilesToDir, downloadFile, toCSV, forgetDirectory,
} from '../../lib/usbBackup';

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
};
const slug = (s: string) => (s || 'partido').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function buildFiles(payload: any): { name: string; content: string }[] {
  const base = slug(payload?.party?.name);
  const s = stamp();
  const nameById: Record<string, string> = {};
  (payload?.data?.candidatos || []).forEach((c: any) => { nameById[c.id] = c.displayName; });

  const candidatosCsv = toCSV(payload?.data?.candidatos || [], [
    { label: 'Nome', key: 'displayName' }, { label: 'Cargo', key: 'cargo' },
    { label: 'Cidade', key: 'regiao' }, { label: 'Estado', key: 'estado' },
    { label: 'Telefone', key: 'phone' }, { label: 'Status', key: 'status' },
    { label: 'Recebido', get: (r) => Number(r.valorRecebido || 0).toFixed(2) },
    { label: 'Alocado', get: (r) => Number(r.valorAlocado || 0).toFixed(2) },
    { label: 'Valvula', get: (r) => r.repasseStatus || 'liberado' },
  ]);
  const repassesCsv = toCSV(payload?.data?.repasses || [], [
    { label: 'Data', key: 'data' },
    { label: 'Candidato', get: (r) => nameById[r.candidateId] || '—' },
    { label: 'Valor', get: (r) => Number(r.valor || 0).toFixed(2) },
    { label: 'Finalidade', key: 'descricao' },
  ]);

  return [
    { name: `backup-${base}-${s}.json`, content: JSON.stringify(payload, null, 2) },
    { name: `candidatos-${base}-${s}.csv`, content: candidatosCsv },
    { name: `repasses-${base}-${s}.csv`, content: repassesCsv },
  ];
}

const PartyBackup: React.FC = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [dirName, setDirName] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const supported = supportsDirectoryPicker();

  useEffect(() => {
    loadSavedDirectory().then((d) => { if (d?.name) setDirName(d.name); });
    try { setLastAt(localStorage.getItem('party_backup_last')); } catch { /* */ }
  }, []);

  const fetchPayload = async () => {
    const r = await authedFetch('/api/v1/party/backup');
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || 'falha_no_backup');
    return j;
  };

  const markDone = (msg: string) => {
    setResult(msg);
    const now = new Date().toISOString();
    try { localStorage.setItem('party_backup_last', now); } catch { /* */ }
    setLastAt(now);
  };

  // Grava direto na pasta/pendrive (escolhe se ainda não tem; lembra depois).
  const saveToDrive = async (forcePick = false) => {
    setBusy(true); setError(null); setResult(null);
    try {
      const payload = await fetchPayload();
      const files = buildFiles(payload);
      if (!supported) { downloadFile(files[0].name, files[0].content); markDone('Backup baixado pra pasta Downloads — copie pro seu pendrive.'); return; }

      let dir = forcePick ? null : await loadSavedDirectory();
      if (dir && !(await ensurePermission(dir))) dir = null;
      if (!dir) { dir = await pickDirectory(); if (!(await ensurePermission(dir))) throw new Error('permissao_negada'); }

      await writeFilesToDir(dir, files);
      setDirName(dir.name);
      markDone(`✅ Backup gravado em "${dir.name}": ${payload.counts.candidatos} candidatos, ${payload.counts.repasses} repasses, ${payload.counts.recorrentes} recorrentes.`);
    } catch (e: any) {
      if (e?.name === 'AbortError') { /* usuário cancelou o seletor — silencioso */ }
      else if (e?.message === 'permissao_negada') setError('Você precisa permitir a gravação na pasta escolhida.');
      else setError(e?.message || 'Não consegui gerar o backup.');
    } finally { setBusy(false); }
  };

  // Sempre baixa (sem pasta fixa) — funciona em qualquer navegador.
  const justDownload = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const payload = await fetchPayload();
      for (const f of buildFiles(payload)) downloadFile(f.name, f.content, f.name.endsWith('.json') ? 'application/json' : 'text/csv');
      markDone('Backup baixado pra pasta Downloads (JSON + 2 planilhas). Copie pro seu pendrive.');
    } catch (e: any) {
      setError(e?.message || 'Não consegui gerar o backup.');
    } finally { setBusy(false); }
  };

  const trocarPasta = async () => {
    await forgetDirectory(); setDirName(null);
    saveToDrive(true);
  };

  return (
    <div className="bg-[#1c2128] border border-white/10 rounded-3xl p-5 mb-4">
      <div className="flex items-center gap-2 mb-1">
        <HardDriveDownload className="w-5 h-5 text-indigo-300" />
        <h3 className="font-bold text-white">Backup em pendrive / pasta externa</h3>
      </div>
      <p className="text-sm text-slate-400 mb-3">
        Salva <b>todos os dados do seu partido</b> (candidatos, repasses, comitês, check-ins, recorrentes e válvula)
        numa unidade física que você escolher. Os dados são só do seu partido — ninguém vê os de outro.
      </p>

      {/* Estado atual */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-[11px]">
        {supported ? (
          dirName ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              <FolderOpen className="w-3.5 h-3.5" /> Pasta atual: <b>{dirName}</b>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-700/40 text-slate-300 border border-white/10">
              <FolderOpen className="w-3.5 h-3.5" /> Nenhuma pasta escolhida ainda
            </span>
          )
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <AlertTriangle className="w-3.5 h-3.5" /> Seu navegador só permite download (use Chrome/Edge no computador pra gravar direto)
          </span>
        )}
        {lastAt && <span className="text-slate-500">Último backup: {new Date(lastAt).toLocaleString('pt-BR')}</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => saveToDrive(false)} disabled={busy}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-sm">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDriveDownload className="w-4 h-4" />}
          {supported ? (dirName ? 'Salvar backup agora' : 'Escolher pendrive e salvar') : 'Gerar backup'}
        </button>
        {supported && dirName && (
          <button onClick={trocarPasta} disabled={busy}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-50 text-slate-200 font-bold text-sm">
            <FolderOpen className="w-4 h-4" /> Trocar pasta/pendrive
          </button>
        )}
        <button onClick={justDownload} disabled={busy}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-50 text-slate-200 font-bold text-sm">
          <Download className="w-4 h-4" /> Só baixar arquivo
        </button>
      </div>

      {result && <p className="mt-3 text-sm text-emerald-300 flex items-start gap-1.5"><Check className="w-4 h-4 mt-0.5 shrink-0" /> {result}</p>}
      {error && <p className="mt-3 text-sm text-rose-400 flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}</p>}

      <p className="mt-3 text-[11px] text-slate-500 flex items-start gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
        Plugue o pendrive antes de salvar. O arquivo vai direto do seu navegador pra unidade escolhida — nada passa por terceiros.
        O backup automático na nuvem continua rodando todo dia; este é a sua cópia física por cima.
      </p>
    </div>
  );
};

export default PartyBackup;
