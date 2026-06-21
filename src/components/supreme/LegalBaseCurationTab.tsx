import * as React from 'react';
import { Loader2, Check, X, Upload, Scale, FileText } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { authedFetch } from '../../lib/authedFetch';

const ORGS = ['TSE', 'TRE', 'CNJ', 'DJe', 'SPCE', 'OAB', 'OUTRO'];
const BASE = '/api/v1/supreme/legal-base';

interface SourceDoc {
  id: string; source: string; title: string; sourceOrg: string;
  sourceUrl: string | null; docNumber: string | null; electionYear: number | null;
  status: string; chunkCount: number; createdAt: string;
}

const LegalBaseCurationTab: React.FC = () => {
  const [queue, setQueue] = React.useState<SourceDoc[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  // form
  const [title, setTitle] = React.useState('');
  const [sourceOrg, setSourceOrg] = React.useState('TSE');
  const [content, setContent] = React.useState('');
  const [pdfBase64, setPdfBase64] = React.useState('');
  const [pdfName, setPdfName] = React.useState('');
  const [sourceUrl, setSourceUrl] = React.useState('');
  const [docNumber, setDocNumber] = React.useState('');
  const [electionYear, setElectionYear] = React.useState('');
  const [importing, setImporting] = React.useState(false);
  const [importMsg, setImportMsg] = React.useState<string | null>(null);

  const loadQueue = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await authedFetch(`${BASE}/queue`);
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || 'Falha ao carregar fila');
      setQueue(json.documents || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { loadQueue(); }, [loadQueue]);

  const onPdf = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfName(file.name);
    const reader = new FileReader();
    reader.onload = () => setPdfBase64(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const doImport = async () => {
    if (!title.trim()) { setImportMsg('Informe o título.'); return; }
    if (!content.trim() && !pdfBase64) { setImportMsg('Cole o texto ou anexe um PDF.'); return; }
    setImporting(true); setImportMsg(null);
    try {
      const body: any = { title, sourceOrg };
      if (pdfBase64) body.pdfBase64 = pdfBase64; else body.content = content;
      if (sourceUrl.trim()) body.sourceUrl = sourceUrl.trim();
      if (docNumber.trim()) body.docNumber = docNumber.trim();
      if (electionYear.trim()) body.electionYear = Number(electionYear);
      const r = await authedFetch(`${BASE}/import`, { method: 'POST', body: JSON.stringify(body) });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || 'Falha no import');
      setImportMsg(json.status === 'unchanged' ? 'Documento idêntico já existe (sem mudança).' : `Importado: ${json.chunks} trechos na fila de revisão.`);
      setTitle(''); setContent(''); setPdfBase64(''); setPdfName(''); setSourceUrl(''); setDocNumber(''); setElectionYear('');
      loadQueue();
    } catch (err: any) {
      setImportMsg(err.message);
    } finally {
      setImporting(false);
    }
  };

  const act = async (id: string, action: 'approve' | 'reject') => {
    let reason: string | undefined;
    if (action === 'reject') {
      reason = window.prompt('Motivo da rejeição (opcional):') || undefined;
    }
    setBusyId(id);
    try {
      const r = await authedFetch(`${BASE}/${id}/${action}`, {
        method: 'POST',
        body: action === 'reject' ? JSON.stringify({ reason }) : undefined,
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || 'Falha');
      setQueue((q) => q.filter((d) => d.id !== id));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Scale className="w-5 h-5 text-indigo-400" />
        <h3 className="text-lg font-bold text-slate-200">Base Jurídica — Curadoria</h3>
      </div>

      {/* Import */}
      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-sky-400" />
          <h4 className="text-sm font-semibold text-slate-200">Adicionar regra / documento</h4>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (ex.: Resolução TSE 23.607/2019)"
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 sm:col-span-2" />
          <select value={sourceOrg} onChange={(e) => setSourceOrg(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200">
            {ORGS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="Nº do documento (opcional)"
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="URL da fonte oficial (opcional)"
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
          <input value={electionYear} onChange={(e) => setElectionYear(e.target.value)} placeholder="Ano eleitoral (opcional)" inputMode="numeric"
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
        </div>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5}
          placeholder="Cole o texto da norma/manual/jurisprudência…"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <FileText className="w-4 h-4" />
            <span>{pdfName || 'ou anexar PDF'}</span>
            <input type="file" accept="application/pdf" onChange={onPdf} className="hidden" />
          </label>
          <Button onClick={doImport} disabled={importing}>
            {importing ? <><Loader2 className="w-4 h-4 animate-spin" /> Importando…</> : 'Importar p/ revisão'}
          </Button>
          {importMsg && <span className="text-xs text-slate-400">{importMsg}</span>}
        </div>
        <p className="text-[11px] text-slate-500">Documentos entram como <b>pendentes</b> e só viram fonte ativa após aprovação aqui.</p>
      </Card>

      {/* Fila */}
      <Card>
        <h4 className="text-sm font-semibold text-slate-200 mb-3">Fila de revisão</h4>
        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : queue.length === 0 ? (
          <p className="text-xs text-slate-500">Nada pendente de revisão.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {queue.map((d) => (
              <li key={d.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-200 truncate">{d.title}</p>
                  <p className="text-[11px] text-slate-500">
                    {[d.sourceOrg, d.docNumber, d.electionYear].filter(Boolean).join(' · ')} · {d.chunkCount} trechos
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="secondary" onClick={() => act(d.id, 'approve')} disabled={busyId === d.id}
                    className="!px-3 !py-1 text-xs">
                    {busyId === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Aprovar
                  </Button>
                  <Button variant="danger" onClick={() => act(d.id, 'reject')} disabled={busyId === d.id}
                    className="!px-3 !py-1 text-xs">
                    <X className="w-3 h-3" /> Rejeitar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default LegalBaseCurationTab;
