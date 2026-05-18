/**
 * CSV / TSV bulk import for contacts.
 * Uses FileReader + manual parser — no extra dependencies.
 * Inserts directly via Supabase (follows existing CRMPage pattern).
 */
import * as React from 'react';
import {
  Upload, X, AlertCircle, Loader2, CheckCircle2,
  FileText, ChevronRight
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

interface CsvImportModalProps {
  campaignId: string;
  onDone: (count: number) => void;
  onClose: () => void;
}

type CsvRow = Record<string, string>;
type FieldKey = 'name' | 'phone' | 'neighborhood' | 'electoralZone' | 'electoralSection' | 'classification';

const FIELD_LABELS: Record<FieldKey, string> = {
  name: 'Nome *',
  phone: 'Telefone',
  neighborhood: 'Bairro',
  electoralZone: 'Zona Eleitoral',
  electoralSection: 'Seção Eleitoral',
  classification: 'Classificação',
};

// Heuristic: map CSV header → likely field
const HEADER_HINTS: Record<string, FieldKey> = {
  nome: 'name', name: 'name', eleitor: 'name', 'nome completo': 'name',
  telefone: 'phone', phone: 'phone', fone: 'phone', celular: 'phone',
  whatsapp: 'phone', tel: 'phone', numero: 'phone', 'número': 'phone',
  bairro: 'neighborhood', neighborhood: 'neighborhood', localidade: 'neighborhood',
  zona: 'electoralZone', 'zona eleitoral': 'electoralZone', electoralzone: 'electoralZone',
  seção: 'electoralSection', secao: 'electoralSection', 'seção eleitoral': 'electoralSection',
  electoralsection: 'electoralSection',
  classificacao: 'classification', 'classificação': 'classification',
  classification: 'classification', status: 'classification', perfil: 'classification',
};

const VALID_CLASSIFICATIONS = new Set(['Multiplicador', 'Apoiador', 'Indeciso', 'Neutro', 'Rejeição', 'Rejeicao']);
const CLASSIFICATION_MAP: Record<string, string> = {
  multiplicador: 'Multiplicador', apoiador: 'Apoiador', indeciso: 'Indeciso',
  neutro: 'Neutro', 'rejeição': 'Rejeição', rejeicao: 'Rejeição',
};

// ---------------------------------------------------------------------------
// Parser — handles quoted fields, comma/semicolon/tab separators
// ---------------------------------------------------------------------------
function parseCSV(text: string): { headers: string[]; rows: CsvRow[] } {
  // Normalize line endings, strip BOM
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = clean.split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return { headers: [], rows: [] };

  // Detect separator from first line
  const firstLine = lines[0];
  const sep = firstLine.includes('\t') ? '\t'
    : firstLine.includes(';') ? ';'
    : ',';

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === sep && !inQuote) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  };

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().trim());
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    const row: CsvRow = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? ''; });
    rows.push(row);
  }
  return { headers, rows };
}

function autoDetectMapping(headers: string[]): Partial<Record<FieldKey, string>> {
  const mapping: Partial<Record<FieldKey, string>> = {};
  for (const h of headers) {
    const key = HEADER_HINTS[h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')];
    if (key && !mapping[key]) mapping[key] = h;
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CsvImportModal: React.FC<CsvImportModalProps> = ({ campaignId, onDone, onClose }) => {
  const [step, setStep] = React.useState<'upload' | 'map' | 'preview' | 'importing' | 'done'>('upload');
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<CsvRow[]>([]);
  const [mapping, setMapping] = React.useState<Partial<Record<FieldKey, string>>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [importCount, setImportCount] = React.useState(0);
  const [skippedCount, setSkippedCount] = React.useState(0);
  const [progress, setProgress] = React.useState(0);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? '');
      const { headers: h, rows: r } = parseCSV(text);
      if (h.length === 0) { setError('Arquivo vazio ou formato inválido.'); return; }
      setHeaders(h);
      setRows(r);
      setMapping(autoDetectMapping(h));
      setStep('map');
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  const mappingComplete = !!mapping.name;
  const preview = rows.slice(0, 5);
  const allFields: FieldKey[] = ['name', 'phone', 'neighborhood', 'electoralZone', 'electoralSection', 'classification'];

  const importContacts = async () => {
    setStep('importing');
    setError(null);

    try {
      // Fetch existing phones to skip duplicates
      const { data: existing } = await supabase
        .from('contacts')
        .select('phone')
        .eq('campaignId', campaignId);
      const existingPhones = new Set((existing ?? []).map((r: any) => String(r.phone ?? '').replace(/\D/g, '')));

      const BATCH = 50;
      let inserted = 0;
      let skipped = 0;
      const now = new Date().toISOString();

      const toInsert = rows
        .map(row => {
          const name = mapping.name ? (row[mapping.name] ?? '').trim() : '';
          if (!name) return null;

          const rawPhone = mapping.phone ? (row[mapping.phone] ?? '').replace(/\D/g, '') : '';
          if (rawPhone && existingPhones.has(rawPhone)) { skipped++; return null; }

          const rawClass = mapping.classification
            ? (row[mapping.classification] ?? '').trim()
            : '';
          const normalizedClass = CLASSIFICATION_MAP[rawClass.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')];
          const classification = VALID_CLASSIFICATIONS.has(rawClass)
            ? rawClass
            : (normalizedClass ?? 'Neutro');

          return {
            campaignId,
            name,
            phone: rawPhone || null,
            neighborhood: mapping.neighborhood ? (row[mapping.neighborhood] ?? '').trim() || null : null,
            electoralZone: mapping.electoralZone ? (row[mapping.electoralZone] ?? '').trim() || null : null,
            electoralSection: mapping.electoralSection ? (row[mapping.electoralSection] ?? '').trim() || null : null,
            classification,
            source: 'csv_import',
            tags: [],
            createdAt: now,
          };
        })
        .filter(Boolean) as Record<string, unknown>[];

      for (let i = 0; i < toInsert.length; i += BATCH) {
        const batch = toInsert.slice(i, i + BATCH);
        const { error: insertErr } = await supabase.from('contacts').insert(batch);
        if (insertErr) throw insertErr;
        inserted += batch.length;
        setProgress(Math.round(((i + BATCH) / toInsert.length) * 100));
      }

      setImportCount(inserted);
      setSkippedCount(skipped + (rows.length - toInsert.length - skipped));
      setStep('done');
    } catch (e: any) {
      setError(e.message);
      setStep('preview');
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#0d1117] border border-white/10 rounded-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-lg flex items-center gap-2 text-white">
            <Upload className="w-5 h-5 text-blue-400" />
            Importar Contatos via CSV
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 mb-4 text-sm text-red-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Step: upload */}
        {step === 'upload' && (
          <div>
            <p className="text-sm text-gray-400 mb-5">
              Aceita CSV, TSV ou arquivo com separador ponto-e-vírgula. A primeira linha deve ser o cabeçalho.
            </p>
            <div
              className="border-2 border-dashed border-white/10 rounded-2xl p-10 text-center cursor-pointer hover:border-blue-500/40 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <FileText className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">Clique para selecionar o arquivo</p>
              <p className="text-xs text-gray-600 mt-1">.csv · .tsv · .txt</p>
            </div>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleFile} />

            <div className="mt-4 p-3 bg-white/[0.03] rounded-xl border border-white/5">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Exemplo de cabeçalho</p>
              <code className="text-[11px] text-gray-400 font-mono">nome,telefone,bairro,zona,seção,classificacao</code>
            </div>
          </div>
        )}

        {/* Step: map */}
        {(step === 'map' || step === 'preview') && (
          <div>
            <p className="text-sm text-gray-400 mb-4">
              {rows.length} linhas detectadas. Associe as colunas do seu arquivo.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-5">
              {allFields.map(field => (
                <div key={field}>
                  <label className="text-xs text-gray-500 block mb-1">
                    {FIELD_LABELS[field]}
                  </label>
                  <select
                    value={mapping[field] ?? ''}
                    onChange={e => setMapping(prev => ({ ...prev, [field]: e.target.value || undefined }))}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="">(não importar)</option>
                    {headers.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Preview */}
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Prévia (5 primeiras linhas)</p>
            <div className="overflow-x-auto rounded-xl border border-white/5 mb-5">
              <table className="w-full text-xs">
                <thead className="bg-white/[0.03]">
                  <tr>
                    {allFields.filter(f => mapping[f]).map(f => (
                      <th key={f} className="px-3 py-2 text-left text-gray-500 font-semibold">
                        {FIELD_LABELS[f].replace(' *', '')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {preview.map((row, i) => (
                    <tr key={i}>
                      {allFields.filter(f => mapping[f]).map(f => (
                        <td key={f} className="px-3 py-2 text-gray-300 truncate max-w-[120px]">
                          {mapping[f] ? row[mapping[f]!] : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center">
              <button onClick={() => setStep('upload')} className="text-sm text-gray-500 hover:text-white">
                ← Trocar arquivo
              </button>
              <button
                onClick={importContacts}
                disabled={!mappingComplete}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
                Importar {rows.length} contatos
              </button>
            </div>
          </div>
        )}

        {/* Step: importing */}
        {step === 'importing' && (
          <div className="text-center py-10">
            <Loader2 className="w-10 h-10 text-blue-400 animate-spin mx-auto mb-4" />
            <p className="text-white font-bold">Importando contatos…</p>
            <div className="w-full bg-white/5 rounded-full h-2 mt-4">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">{progress}%</p>
          </div>
        )}

        {/* Step: done */}
        {step === 'done' && (
          <div className="text-center py-10">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
            <p className="text-white font-bold text-lg">Importação concluída!</p>
            <p className="text-gray-400 mt-2">
              <span className="text-emerald-400 font-bold">{importCount}</span> contatos importados
              {skippedCount > 0 && (
                <> · <span className="text-yellow-400 font-bold">{skippedCount}</span> ignorados (duplicados sem nome)</>
              )}
            </p>
            <button
              onClick={() => { onDone(importCount); onClose(); }}
              className="mt-6 px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
            >
              Fechar e atualizar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CsvImportModal;
