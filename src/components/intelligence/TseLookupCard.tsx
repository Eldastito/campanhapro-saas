import * as React from 'react';
import Card from '../ui/Card';
import { authedFetch } from '../../lib/authedFetch';
import { Landmark, Loader2, Search, ExternalLink, CheckCircle2, AlertCircle, Save } from 'lucide-react';

/**
 * TSE / DivulgaCand Lookup (#58).
 *
 * Busca candidato real no TSE por nome + UF + ano e ingere dados estruturados
 * (número, partido, cargo, situação, bens declarados) na RAG como FONTE
 * ANCORADA. Os agentes vão tratar como fato verificável, não como inferência.
 */
const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

interface CandidatoMatch {
  sqCandidato: number; nomeUrna: string; nomeCompleto: string;
  numero: string;
  partido: { sigla: string; nome: string };
  cargo: string; situacao: string;
}
interface Detail extends CandidatoMatch {
  bensDeclarados?: number; escolaridade?: string; ocupacao?: string;
  estadoCivil?: string; linkOficial?: string;
}
interface Result {
  ano: number; uf: string;
  eleicao: { id: number; nome: string; ano: number } | null;
  matches: CandidatoMatch[];
  detail?: Detail | null;
}

const brl = (n?: number) => n != null ? 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—';

const TseLookupCard: React.FC = () => {
  const [nome, setNome] = React.useState('');
  const [uf, setUf] = React.useState('SP');
  const [ano, setAno] = React.useState(2024);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState<number | null>(null);
  const [data, setData] = React.useState<Result | null>(null);
  const [savedSq, setSavedSq] = React.useState<Set<number>>(new Set());
  const [err, setErr] = React.useState<string | null>(null);

  const search = async () => {
    if (!nome.trim()) { setErr('Informe o nome do candidato'); return; }
    setLoading(true); setErr(null); setData(null);
    try {
      const r = await authedFetch('/api/v1/intel/tse/lookup', {
        method: 'POST',
        body: JSON.stringify({ nome: nome.trim(), uf, ano }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Falha na busca');
      if (!j.eleicao) { setErr(`Nenhuma eleição encontrada em ${uf} ${ano}. Tente outro ano.`); return; }
      if (!j.matches?.length) { setErr(`Nenhum candidato com "${nome.trim()}" em ${uf} ${ano}.`); return; }
      setData(j);
    } catch (e: any) { setErr(e?.message || 'Erro'); }
    finally { setLoading(false); }
  };

  const save = async (sqCandidato: number) => {
    if (!data?.eleicao) return;
    setSaving(sqCandidato); setErr(null);
    try {
      const r = await authedFetch('/api/v1/intel/tse/save', {
        method: 'POST',
        body: JSON.stringify({ ano: data.ano, uf: data.uf, idEleicao: data.eleicao.id, sqCandidato }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Falha ao salvar');
      setSavedSq(prev => new Set(prev).add(sqCandidato));
    } catch (e: any) { setErr(e?.message || 'Erro ao salvar'); }
    finally { setSaving(null); }
  };

  return (
    <Card className="p-5 border-t-4 border-t-amber-500">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg">
          <Landmark className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-100">Importar do TSE / DivulgaCand</h3>
          <p className="text-xs text-slate-400">Dados oficiais (número, partido, bens declarados) → memória da IA como fonte ancorada.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 mb-3">
        <input value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Nome do candidato"
          className="sm:col-span-6 bg-slate-900/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
        <select value={uf} onChange={(e) => setUf(e.target.value)}
          className="sm:col-span-2 bg-slate-900/60 border border-white/10 rounded-lg px-2 py-2 text-sm text-white">
          {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={ano} onChange={(e) => setAno(Number(e.target.value))}
          className="sm:col-span-2 bg-slate-900/60 border border-white/10 rounded-lg px-2 py-2 text-sm text-white">
          {[2026, 2024, 2022, 2020, 2018, 2016].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={search} disabled={loading}
          className="sm:col-span-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-2 py-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Buscar
        </button>
      </div>

      {err && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 text-xs text-amber-300 flex items-start gap-2 mb-3">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{err}</span>
        </div>
      )}

      {data && data.matches.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            <b>{data.matches.length}</b> candidato(s) encontrado(s) · Eleição: <b className="text-amber-300">{data.eleicao?.nome || data.ano}</b>
          </p>
          {data.matches.map((m) => {
            const isSaved = savedSq.has(m.sqCandidato);
            const isSaving = saving === m.sqCandidato;
            const isOnly = data.matches.length === 1 && data.detail;
            return (
              <div key={m.sqCandidato} className="bg-slate-900/60 border border-white/10 rounded-xl p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-bold text-white">{m.nomeCompleto || m.nomeUrna}</p>
                    {m.nomeUrna && m.nomeUrna !== m.nomeCompleto && (
                      <p className="text-[11px] text-slate-500">urna: {m.nomeUrna}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-1">
                      <b className="text-amber-300">{m.numero}</b>
                      {' · '}{m.partido.sigla}{m.partido.nome ? ` (${m.partido.nome})` : ''}
                      {' · '}{m.cargo}
                      {m.situacao && <> · <span className="text-emerald-300">{m.situacao}</span></>}
                    </p>
                    {isOnly && data.detail?.bensDeclarados != null && (
                      <p className="text-xs text-slate-300 mt-1.5">
                        💰 Bens declarados: <b>{brl(data.detail.bensDeclarados)}</b>
                        {data.detail.ocupacao && <> · {data.detail.ocupacao}</>}
                        {data.detail.escolaridade && <> · {data.detail.escolaridade}</>}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {data.detail?.linkOficial && (
                      <a href={data.detail.linkOficial} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" /> Ver no TSE
                      </a>
                    )}
                    {isSaved ? (
                      <span className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Salvo na IA
                      </span>
                    ) : (
                      <button onClick={() => save(m.sqCandidato)} disabled={isSaving}
                        className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1 px-2.5 py-1.5 rounded-lg">
                        {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Importar pra IA
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <p className="text-[10px] text-slate-500 pt-2 border-t border-white/5">
            Os dados importados ficam na <b>memória ancorada</b> da IA. Quando o Consultor ou o Intel Competitivo pesquisarem o candidato, vão usar esses dados como fato verificado, não como inferência.
          </p>
        </div>
      )}
    </Card>
  );
};

export default TseLookupCard;
