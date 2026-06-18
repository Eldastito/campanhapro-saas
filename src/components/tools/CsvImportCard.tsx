/**
 * Import CSV (#140).
 *
 * Permite importar contatos OU equipe via planilha CSV. Parse client-side
 * (sem upload de arquivo bruto pro servidor), preview das primeiras 5
 * linhas, validação de header. Dedupe por phone no backend.
 */
import React, { useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import Card from '../ui/Card';
import { supabase } from '../../lib/supabaseClient';

type Tipo = 'contacts' | 'team';

async function authFetch(url: string, init: RequestInit): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const r = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

// Parser CSV simples — aceita ; ou , como separador, suporta aspas.
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === sep && !inQ) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = split(lines[0]).map(h => h.toLowerCase().trim());
  const rows = lines.slice(1).map(line => {
    const cells = split(line);
    const r: Record<string, string> = {};
    headers.forEach((h, i) => { r[h] = (cells[i] || '').trim(); });
    return r;
  }).filter(r => Object.values(r).some(v => v));
  return { headers, rows };
}

const CsvImportCard: React.FC = () => {
  const [tipo, setTipo] = useState<Tipo>('contacts');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [filename, setFilename] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const onFile = (file: File) => {
    setFilename(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const parsed = parseCsv(text);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
    };
    reader.readAsText(file, 'utf-8');
  };

  const doImport = async () => {
    if (rows.length === 0) return;
    setImporting(true);
    setResult(null);
    try {
      const url = tipo === 'contacts' ? '/api/v1/toolbox/import/contacts' : '/api/v1/toolbox/import/team';
      const r = await authFetch(url, { method: 'POST', body: JSON.stringify({ rows }) });
      const msg = tipo === 'contacts'
        ? `✅ ${r.inserted} contato(s) importado(s). ${r.skipped > 0 ? `${r.skipped} duplicados ignorados.` : ''} ${r.skippedNoName > 0 ? `${r.skippedNoName} sem nome ignorados.` : ''}`
        : `✅ ${r.inserted} membro(s) importado(s).`;
      setResult(msg);
      setRows([]); setHeaders([]); setFilename('');
    } catch (err: any) {
      setResult('❌ Falha: ' + (err?.message || 'erro'));
    } finally {
      setImporting(false);
    }
  };

  const expectedHeaders = tipo === 'contacts'
    ? ['name (ou nome)', 'phone (ou telefone)', 'email', 'neighborhood (ou bairro)', 'city (ou cidade)']
    : ['name (ou nome)', 'email', 'phone (ou telefone)', 'role (Apoiador|Líder|Colaborador|Pesquisador|Fiscal)', 'cost (ou custo)', 'neighborhood', 'city'];

  return (
    <Card className="border-l-4 border-l-violet-500">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-violet-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Import de Planilha (CSV)</h3>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 mb-3">
        Importa em massa de planilha existente. Parsing local (não enviamos o arquivo bruto). Dedupe por telefone.
      </p>

      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setTipo('contacts')}
          className={`flex-1 px-3 py-2 text-xs font-bold rounded-lg ${tipo === 'contacts' ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400'}`}
        >
          Contatos (CRM)
        </button>
        <button
          onClick={() => setTipo('team')}
          className={`flex-1 px-3 py-2 text-xs font-bold rounded-lg ${tipo === 'team' ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400'}`}
        >
          Equipe (membros)
        </button>
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 mb-3 text-[11px] text-slate-400">
        <b>Colunas aceitas:</b> {expectedHeaders.join(' / ')}
        <br />
        <b>Separador:</b> aceita <code>,</code> ou <code>;</code> · <b>Aspas:</b> opcionais
      </div>

      <label className="flex items-center justify-center gap-2 w-full py-3 mb-3 bg-slate-800 hover:bg-slate-700 border border-dashed border-slate-600 rounded-xl cursor-pointer text-sm text-slate-300">
        <Upload className="w-4 h-4" />
        {filename || 'Selecionar arquivo CSV'}
        <input
          type="file" accept=".csv,text/csv,text/plain"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          className="hidden"
        />
      </label>

      {rows.length > 0 && (
        <>
          <p className="text-xs text-slate-400 mb-2">
            <b>{rows.length}</b> linha(s) detectada(s). Preview:
          </p>
          <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-x-auto mb-3">
            <table className="w-full text-[10px] text-slate-300">
              <thead>
                <tr className="bg-slate-800 text-slate-400 uppercase">
                  {headers.map(h => <th key={h} className="px-2 py-1 text-left">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    {headers.map(h => <td key={h} className="px-2 py-1">{r[h] || '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 5 && (
              <p className="text-[10px] text-slate-500 italic px-2 py-1 border-t border-slate-800">
                + {rows.length - 5} linha(s)
              </p>
            )}
          </div>

          <button
            onClick={doImport}
            disabled={importing}
            className="w-full flex items-center justify-center gap-2 py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold rounded-xl"
          >
            <CheckCircle2 className="w-4 h-4" />
            {importing ? 'Importando...' : `Importar ${rows.length} registro(s)`}
          </button>
        </>
      )}

      {result && (
        <div className={`mt-3 p-3 rounded-lg text-xs ${result.startsWith('✅') ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-red-500/10 text-red-300 border border-red-500/30'}`}>
          {result}
        </div>
      )}
    </Card>
  );
};

export default CsvImportCard;
