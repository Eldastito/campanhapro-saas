import React, { useEffect, useState, useCallback } from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { authedFetch } from '../../lib/authedFetch';
import { FileText, Plus, Trash2, Save, ArrowLeft, X, PenLine, Download } from 'lucide-react';
import SignaturePad from './SignaturePad';
import { generateContractPdf } from '../../lib/contractPdf';

/**
 * Aba "Contratos" do Supreme Control — contratos de prestação de serviço /
 * licenciamento de software. O operador preenche os dados variáveis (empresa
 * prestadora, empresa contratante, pessoas, cláusulas, campos extras), salva e
 * lista. Geração de PDF + assinatura desenhada na tela vêm na etapa seguinte.
 *
 * Dados variáveis são objetos/arrays livres (jsonb no banco), para acomodar
 * "outros dados" e cláusulas específicas.
 */
interface Party { razaoSocial?: string; cnpj?: string; endereco?: string; cidade?: string; estado?: string; cep?: string; representante?: string; email?: string; telefone?: string; }
interface Person { nome?: string; papel?: string; cpf?: string; email?: string; }
interface Clause { titulo?: string; texto?: string; }
interface Signature { nome?: string; papel?: string; imageDataUrl?: string; signedAt?: string; }
interface ContractFields { objeto?: string; valor?: string; vigenciaInicio?: string; vigenciaFim?: string; foro?: string; observacoes?: string; }
interface Contract {
  id?: string; title: string; status?: string;
  provider: Party; client: Party; people: Person[]; clauses: Clause[]; fields: ContractFields;
  signatures: Signature[];
  createdAt?: string; updatedAt?: string;
}

const emptyContract: Contract = {
  title: '', status: 'draft', provider: {}, client: {}, people: [], clauses: [], fields: {}, signatures: [],
};

const PARTY_FIELDS: { key: keyof Party; label: string }[] = [
  { key: 'razaoSocial', label: 'Razão social / Nome' },
  { key: 'cnpj', label: 'CNPJ / CPF' },
  { key: 'endereco', label: 'Endereço' },
  { key: 'cidade', label: 'Cidade' },
  { key: 'estado', label: 'UF' },
  { key: 'cep', label: 'CEP' },
  { key: 'representante', label: 'Representante legal' },
  { key: 'email', label: 'E-mail' },
  { key: 'telefone', label: 'Telefone' },
];

const input = 'w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white';

// Top-level (não aninhado no render) para os inputs não perderem o foco a cada tecla.
const PartyForm: React.FC<{ party: Party; label: string; onChange: (k: keyof Party, v: string) => void }> = ({ party, label, onChange }) => (
  <Card className="bg-slate-900 border-white/5 p-4 space-y-3">
    <h4 className="text-xs font-black uppercase tracking-widest text-indigo-400">{label}</h4>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {PARTY_FIELDS.map((f) => (
        <label key={f.key} className="text-[11px] text-slate-400">
          {f.label}
          <input className={input + ' mt-1'} value={party[f.key] || ''} onChange={(ev) => onChange(f.key, ev.target.value)} />
        </label>
      ))}
    </div>
  </Card>
);

const ContractsTab: React.FC = () => {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signSaving, setSignSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/api/v1/supreme/contracts');
      if (r.ok) setList((await r.json()).contracts ?? []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { setError(null); setEditing({ ...emptyContract, provider: {}, client: {}, people: [], clauses: [], fields: {} }); };
  const openEdit = async (id: string) => {
    setError(null);
    const r = await authedFetch(`/api/v1/supreme/contracts/${id}`);
    if (r.ok) {
      const c = (await r.json()).contract;
      setEditing({ ...emptyContract, ...c, provider: c.provider || {}, client: c.client || {}, people: c.people || [], clauses: c.clauses || [], fields: c.fields || {}, signatures: c.signatures || [] });
    }
  };

  const handleSign = async (imageDataUrl: string, meta: { nome: string; papel: string }) => {
    if (!editing?.id) return;
    setSignSaving(true); setError(null);
    try {
      const r = await authedFetch(`/api/v1/supreme/contracts/${editing.id}/sign`, {
        method: 'POST', body: JSON.stringify({ nome: meta.nome, papel: meta.papel, imageDataUrl }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`);
      const c = (await r.json()).contract;
      setEditing((e) => e && ({ ...e, signatures: c.signatures || [], status: c.status }));
      setSigning(false);
    } catch (e: any) { setError(e.message || 'Falha ao salvar assinatura.'); }
    finally { setSignSaving(false); }
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.title.trim()) { setError('Dê um título ao contrato.'); return; }
    setSaving(true); setError(null);
    try {
      const id = editing.id;
      const r = await authedFetch(id ? `/api/v1/supreme/contracts/${id}` : '/api/v1/supreme/contracts', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({
          title: editing.title, status: editing.status,
          provider: editing.provider, client: editing.client,
          people: editing.people, clauses: editing.clauses, fields: editing.fields,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`);
      setEditing(null);
      await load();
    } catch (e: any) { setError(e.message || 'Falha ao salvar.'); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Excluir este contrato?')) return;
    await authedFetch(`/api/v1/supreme/contracts/${id}`, { method: 'DELETE' });
    await load();
  };

  // ---- helpers de edição de objetos/arrays ----
  const setParty = (which: 'provider' | 'client', key: keyof Party, val: string) =>
    setEditing((e) => e && ({ ...e, [which]: { ...e[which], [key]: val } }));
  const setField = (key: keyof ContractFields, val: string) =>
    setEditing((e) => e && ({ ...e, fields: { ...e.fields, [key]: val } }));
  const addPerson = () => setEditing((e) => e && ({ ...e, people: [...e.people, {}] }));
  const setPerson = (i: number, key: keyof Person, val: string) =>
    setEditing((e) => e && ({ ...e, people: e.people.map((p, j) => j === i ? { ...p, [key]: val } : p) }));
  const delPerson = (i: number) => setEditing((e) => e && ({ ...e, people: e.people.filter((_, j) => j !== i) }));
  const addClause = () => setEditing((e) => e && ({ ...e, clauses: [...e.clauses, {}] }));
  const setClause = (i: number, key: keyof Clause, val: string) =>
    setEditing((e) => e && ({ ...e, clauses: e.clauses.map((c, j) => j === i ? { ...c, [key]: val } : c) }));
  const delClause = (i: number) => setEditing((e) => e && ({ ...e, clauses: e.clauses.filter((_, j) => j !== i) }));

  // ===================== EDITOR =====================
  if (editing) {
    return (
      <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setEditing(null)} className="text-sm text-slate-400 hover:text-white flex items-center gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          <div className="flex items-center gap-2">
            <Button onClick={() => generateContractPdf(editing)} className="bg-slate-700 hover:bg-slate-600 flex items-center gap-2">
              <Download className="w-4 h-4" /> Gerar PDF
            </Button>
            <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 flex items-center gap-2">
              <Save className="w-4 h-4" /> {saving ? 'Salvando…' : 'Salvar contrato'}
            </Button>
          </div>
        </div>
        {error && <p className="text-xs text-rose-400">{error}</p>}

        <Card className="bg-slate-900 border-white/5 p-4 space-y-3">
          <label className="text-[11px] text-slate-400">Título do contrato
            <input className={input + ' mt-1'} placeholder="Ex.: Contrato de Licenciamento de Software — CampanhaPro"
              value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          </label>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PartyForm party={editing.provider} label="Contratada (presta o serviço / licencia)" onChange={(k, v) => setParty('provider', k, v)} />
          <PartyForm party={editing.client} label="Contratante" onChange={(k, v) => setParty('client', k, v)} />
        </div>

        {/* Campos do contrato */}
        <Card className="bg-slate-900 border-white/5 p-4 space-y-3">
          <h4 className="text-xs font-black uppercase tracking-widest text-amber-400">Objeto & condições</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="text-[11px] text-slate-400 md:col-span-2">Objeto do contrato
              <textarea className={input + ' mt-1 min-h-[64px]'} value={editing.fields.objeto || ''} onChange={(e) => setField('objeto', e.target.value)} />
            </label>
            <label className="text-[11px] text-slate-400">Valor
              <input className={input + ' mt-1'} placeholder="R$ ..." value={editing.fields.valor || ''} onChange={(e) => setField('valor', e.target.value)} />
            </label>
            <label className="text-[11px] text-slate-400">Foro
              <input className={input + ' mt-1'} value={editing.fields.foro || ''} onChange={(e) => setField('foro', e.target.value)} />
            </label>
            <label className="text-[11px] text-slate-400">Vigência — início
              <input type="date" className={input + ' mt-1'} value={editing.fields.vigenciaInicio || ''} onChange={(e) => setField('vigenciaInicio', e.target.value)} />
            </label>
            <label className="text-[11px] text-slate-400">Vigência — fim
              <input type="date" className={input + ' mt-1'} value={editing.fields.vigenciaFim || ''} onChange={(e) => setField('vigenciaFim', e.target.value)} />
            </label>
            <label className="text-[11px] text-slate-400 md:col-span-2">Observações
              <textarea className={input + ' mt-1 min-h-[48px]'} value={editing.fields.observacoes || ''} onChange={(e) => setField('observacoes', e.target.value)} />
            </label>
          </div>
        </Card>

        {/* Pessoas envolvidas */}
        <Card className="bg-slate-900 border-white/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-widest text-emerald-400">Pessoas envolvidas</h4>
            <Button onClick={addPerson} className="h-8 text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Adicionar</Button>
          </div>
          {editing.people.length === 0 && <p className="text-xs text-slate-500">Nenhuma pessoa adicionada.</p>}
          {editing.people.map((p, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end border-t border-white/5 pt-2">
              <input className={input} placeholder="Nome" value={p.nome || ''} onChange={(e) => setPerson(i, 'nome', e.target.value)} />
              <input className={input} placeholder="Papel (ex.: testemunha)" value={p.papel || ''} onChange={(e) => setPerson(i, 'papel', e.target.value)} />
              <input className={input} placeholder="CPF" value={p.cpf || ''} onChange={(e) => setPerson(i, 'cpf', e.target.value)} />
              <div className="flex gap-2">
                <input className={input} placeholder="E-mail" value={p.email || ''} onChange={(e) => setPerson(i, 'email', e.target.value)} />
                <button onClick={() => delPerson(i)} className="text-rose-400 hover:text-rose-300 shrink-0"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </Card>

        {/* Cláusulas específicas */}
        <Card className="bg-slate-900 border-white/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-widest text-violet-400">Cláusulas específicas</h4>
            <Button onClick={addClause} className="h-8 text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Adicionar</Button>
          </div>
          {editing.clauses.length === 0 && <p className="text-xs text-slate-500">Nenhuma cláusula específica.</p>}
          {editing.clauses.map((c, i) => (
            <div key={i} className="space-y-2 border-t border-white/5 pt-2">
              <div className="flex gap-2">
                <input className={input} placeholder={`Cláusula ${i + 1} — título`} value={c.titulo || ''} onChange={(e) => setClause(i, 'titulo', e.target.value)} />
                <button onClick={() => delClause(i)} className="text-rose-400 hover:text-rose-300 shrink-0"><X className="w-4 h-4" /></button>
              </div>
              <textarea className={input + ' min-h-[64px]'} placeholder="Texto da cláusula" value={c.texto || ''} onChange={(e) => setClause(i, 'texto', e.target.value)} />
            </div>
          ))}
        </Card>

        {/* Assinaturas */}
        <Card className="bg-slate-900 border-white/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-widest text-emerald-400">Assinaturas</h4>
            {editing.id ? (
              <Button onClick={() => setSigning(true)} className="h-8 text-xs flex items-center gap-1.5"><PenLine className="w-3.5 h-3.5" /> Coletar assinatura</Button>
            ) : (
              <span className="text-[11px] text-slate-500">Salve o contrato para coletar assinaturas.</span>
            )}
          </div>
          {editing.signatures.length === 0 && <p className="text-xs text-slate-500">Nenhuma assinatura coletada.</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {editing.signatures.map((s, i) => (
              <div key={i} className="bg-slate-950 border border-white/5 rounded-lg p-2">
                {s.imageDataUrl && <img src={s.imageDataUrl} alt="assinatura" className="h-16 bg-white rounded" />}
                <p className="text-[11px] text-slate-300 mt-1">{s.nome || 'Assinante'}{s.papel ? ` — ${s.papel}` : ''}</p>
                <p className="text-[10px] text-slate-600">{s.signedAt ? new Date(s.signedAt).toLocaleString('pt-BR') : ''}</p>
              </div>
            ))}
          </div>
        </Card>

        <p className="text-[10px] text-slate-600">A assinatura desenhada na tela é embutida no PDF (assinatura eletrônica simples, Lei 14.063). Para validade plena, considere certificado ICP-Brasil/gov.br.</p>
      </div>

      {signing && <SignaturePad onSave={handleSign} onCancel={() => setSigning(false)} saving={signSaving} />}
      </>
    );
  }

  // ===================== LISTA =====================
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-indigo-400" />
          <h2 className="text-xl font-black text-white tracking-tight">Contratos</h2>
          <span className="text-[10px] text-slate-500">{list.length}</span>
        </div>
        <Button onClick={openNew} className="bg-indigo-600 hover:bg-indigo-500 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Novo contrato
        </Button>
      </div>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/40">
              <th className="text-left px-4 py-2">Título</th>
              <th className="text-left px-4 py-2">Contratante</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Atualizado</th>
              <th className="text-right px-4 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="text-center text-slate-500 py-6 text-xs">Carregando…</td></tr>}
            {!loading && list.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500 py-6 text-xs">Nenhum contrato ainda. Clique em "Novo contrato".</td></tr>}
            {list.map((c) => (
              <tr key={c.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-2.5"><button onClick={() => openEdit(c.id)} className="text-white hover:text-indigo-300 font-semibold text-left">{c.title}</button></td>
                <td className="px-4 py-2.5 text-slate-300">{c.client?.razaoSocial || '—'}</td>
                <td className="px-4 py-2.5"><span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{c.status || 'draft'}</span></td>
                <td className="px-4 py-2.5 text-slate-400 text-xs">{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString('pt-BR') : '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => remove(c.id)} className="text-rose-400 hover:text-rose-300"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

export default ContractsTab;
