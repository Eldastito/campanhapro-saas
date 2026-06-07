import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, ArrowUp, ArrowDown, Save, Eye, EyeOff, ListChecks,
  Asterisk, Loader2, CheckCircle2, Type as TypeIcon,
} from 'lucide-react';
import { NATIVE_HIDEABLE } from './platformForms';

/**
 * Form Builder (F5a) — Supreme Admin define campos personalizáveis por
 * campanha e por alvo (Visita / Contato CRM / Pesquisa). As definições são
 * salvas em campaign_configs.custom_fields e renderizadas dinamicamente nos
 * formulários da plataforma (ex.: VisitForm). Inclui preview ao vivo.
 */

export type FieldType =
  | 'text' | 'textarea' | 'number' | 'date' | 'email' | 'phone' | 'select' | 'boolean';

export interface CustomField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  placeholder?: string;
  help?: string;
}

type Schema = Record<string, CustomField[]>;

interface Campaign { id: string; name: string; }
interface Props {
  campaigns: Campaign[];
  supremeFetch: (path: string, init?: RequestInit) => Promise<any>;
}

const TARGETS: { key: string; label: string; hint: string }[] = [
  { key: 'visits', label: 'Visita de Campo', hint: 'Campos extras no formulário de visita porta-a-porta.' },
  { key: 'contacts', label: 'Contato (CRM)', hint: 'Campos extras no cadastro de contatos/eleitores.' },
  { key: 'pesquisa', label: 'Pesquisa', hint: 'Perguntas extras nos formulários de pesquisa.' },
];

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Texto' },
  { value: 'textarea', label: 'Texto longo' },
  { value: 'number', label: 'Número' },
  { value: 'date', label: 'Data' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
  { value: 'select', label: 'Lista (seleção)' },
  { value: 'boolean', label: 'Sim/Não' },
];

const emptySchema = (): Schema => ({ visits: [], contacts: [], pesquisa: [] });

const newField = (): CustomField => ({
  id: `f_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
  label: 'Novo campo',
  type: 'text',
  required: false,
});

const FormBuilder: React.FC<Props> = ({ campaigns, supremeFetch }) => {
  const [selCampaign, setSelCampaign] = useState<string>(campaigns[0]?.id ?? '');
  const [target, setTarget] = useState<string>('visits');
  const [schema, setSchema] = useState<Schema>(emptySchema());
  const [hidden, setHidden] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fields = schema[target] ?? [];

  // Carrega o schema da campanha selecionada
  useEffect(() => {
    if (!selCampaign) return;
    let cancelled = false;
    setLoading(true); setError(null);
    supremeFetch(`/forms/${selCampaign}`)
      .then((r) => { if (!cancelled) { setSchema({ ...emptySchema(), ...(r?.schema || {}) }); setHidden(r?.hidden || {}); setDirty(false); } })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Falha ao carregar'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selCampaign, supremeFetch]);

  const mutate = (next: CustomField[]) => {
    setSchema((s) => ({ ...s, [target]: next }));
    setDirty(true);
  };
  const patchField = (i: number, patch: Partial<CustomField>) =>
    mutate(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const addField = () => mutate([...fields, newField()]);
  const removeField = (i: number) => mutate(fields.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const copy = [...fields];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    mutate(copy);
  };

  // ── Campos NATIVOS (hardcoded) que podem ser ocultados por campanha ──
  const nativeFields = NATIVE_HIDEABLE[target] ?? [];
  const hiddenForTarget = hidden[target] ?? [];
  const isHidden = (key: string) => hiddenForTarget.includes(key);
  const toggleHidden = (key: string) => {
    setHidden((h) => {
      const cur = h[target] ?? [];
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      return { ...h, [target]: next };
    });
    setDirty(true);
  };

  const save = async () => {
    if (!selCampaign) return;
    setSaving(true); setError(null);
    try {
      const r = await supremeFetch(`/forms/${selCampaign}`, {
        method: 'PUT',
        body: JSON.stringify({ schema, hidden }),
      });
      if (r?.schema) setSchema({ ...emptySchema(), ...r.schema });
      if (r?.hidden) setHidden(r.hidden);
      setDirty(false);
      setSavedAt(Date.now());
    } catch (e: any) {
      setError(e?.message || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const totalFields = useMemo(
    () => TARGETS.reduce((acc, t) => acc + (schema[t.key]?.length ?? 0), 0),
    [schema]
  );

  const activeTargetMeta = TARGETS.find((t) => t.key === target)!;

  return (
    <div className="space-y-6">
      {/* Cabeçalho: campanha + contador */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
            <ListChecks className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-white">Form Builder</h3>
            <p className="text-[11px] text-slate-500">Campos personalizáveis por campanha · {totalFields} campo(s) no total</p>
          </div>
        </div>
        <select
          value={selCampaign}
          onChange={(e) => setSelCampaign(e.target.value)}
          className="bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-sm outline-none text-slate-200 min-w-[240px]"
        >
          {campaigns.length === 0 && <option value="">Nenhuma campanha</option>}
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.id.substring(0, 8)})</option>
          ))}
        </select>
      </div>

      {/* Abas de alvo */}
      <div className="flex flex-wrap gap-2">
        {TARGETS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTarget(t.key)}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
              target === t.key ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-900 text-slate-400 hover:text-white border border-white/5'
            }`}
          >
            {t.label}
            <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] ${target === t.key ? 'bg-white/20' : 'bg-white/5'}`}>
              {schema[t.key]?.length ?? 0}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 -mt-3">{activeTargetMeta.hint}</p>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</div>
      )}

      {/* CAMPOS NATIVOS — ocultar/mostrar campos fixos (hardcoded) do formulário */}
      {nativeFields.length > 0 ? (
        <div className="bg-slate-900/40 border border-white/5 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <EyeOff className="w-4 h-4 text-amber-400" />
            <span className="text-[11px] font-black uppercase tracking-widest text-amber-400">Campos nativos do formulário</span>
          </div>
          <p className="text-[11px] text-slate-500 mb-3">
            Desligue os campos que esta campanha não deve ver. O formulário real ({activeTargetMeta.label}) deixa de exibi-los.
            <span className="text-slate-600"> {hiddenForTarget.length} oculto(s).</span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {nativeFields.map((nf) => {
              const off = isHidden(nf.key);
              return (
                <button
                  key={nf.key}
                  onClick={() => toggleHidden(nf.key)}
                  disabled={!selCampaign || loading}
                  className={`flex items-center justify-between gap-2 text-left px-3 py-2 rounded-lg border transition-all disabled:opacity-40 ${
                    off ? 'bg-slate-950/60 border-white/5 opacity-60' : 'bg-slate-900 border-white/10 hover:border-amber-500/40'
                  }`}
                >
                  <span>
                    <span className={`text-xs font-semibold ${off ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{nf.label}</span>
                    {nf.note && <span className="block text-[10px] text-slate-600">{nf.note}</span>}
                  </span>
                  {off
                    ? <EyeOff className="w-4 h-4 shrink-0 text-slate-600" />
                    : <Eye className="w-4 h-4 shrink-0 text-emerald-400" />}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-slate-600 italic">
          (Ocultar campos nativos ainda não disponível para “{activeTargetMeta.label}”. Disponível na Pesquisa.)
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* EDITOR */}
        <div className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-500 text-xs p-6"><Loader2 className="w-4 h-4 animate-spin" /> carregando…</div>
          ) : fields.length === 0 ? (
            <div className="text-center text-slate-600 text-xs border border-dashed border-white/10 rounded-xl py-10">
              Nenhum campo ainda. Clique em “Adicionar campo”.
            </div>
          ) : (
            fields.map((f, i) => (
              <div key={f.id} className="bg-slate-900/60 border border-white/5 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    value={f.label}
                    onChange={(e) => patchField(i, { label: e.target.value })}
                    placeholder="Rótulo do campo"
                    className="flex-1 bg-slate-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-indigo-500"
                  />
                  <select
                    value={f.type}
                    onChange={(e) => patchField(i, { type: e.target.value as FieldType })}
                    className="bg-slate-950 border border-white/10 rounded px-2 py-1.5 text-xs text-slate-300 outline-none"
                  >
                    {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>

                {f.type === 'select' && (
                  <input
                    value={(f.options || []).join(', ')}
                    onChange={(e) => patchField(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    placeholder="Opções separadas por vírgula (ex: Sim, Não, Talvez)"
                    className="w-full bg-slate-950 border border-white/10 rounded px-2 py-1.5 text-[11px] text-slate-300 outline-none focus:border-indigo-500"
                  />
                )}

                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={f.placeholder || ''}
                    onChange={(e) => patchField(i, { placeholder: e.target.value })}
                    placeholder="Placeholder (opcional)"
                    className="bg-slate-950 border border-white/10 rounded px-2 py-1 text-[11px] text-slate-400 outline-none"
                  />
                  <input
                    value={f.help || ''}
                    onChange={(e) => patchField(i, { help: e.target.value })}
                    placeholder="Texto de ajuda (opcional)"
                    className="bg-slate-950 border border-white/10 rounded px-2 py-1 text-[11px] text-slate-400 outline-none"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
                    <input type="checkbox" checked={f.required} onChange={(e) => patchField(i, { required: e.target.checked })} className="accent-indigo-500" />
                    <Asterisk className="w-3 h-3 text-rose-400" /> Obrigatório
                  </label>
                  <div className="flex items-center gap-1">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 rounded hover:bg-white/10 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5 text-slate-400" /></button>
                    <button onClick={() => move(i, 1)} disabled={i === fields.length - 1} className="p-1 rounded hover:bg-white/10 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5 text-slate-400" /></button>
                    <button onClick={() => removeField(i)} className="p-1 rounded hover:bg-red-500/20"><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>
                  </div>
                </div>
              </div>
            ))
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={addField}
              disabled={!selCampaign || loading}
              className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed border-white/15 text-xs text-slate-300 hover:border-indigo-500 hover:text-white transition-all disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar campo
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving || loading}
              className="flex items-center justify-center gap-1.5 h-9 px-5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500 transition-all disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? 'Salvando…' : dirty ? 'Salvar' : savedAt ? 'Salvo' : 'Salvar'}
            </button>
          </div>
          {savedAt && !dirty && (
            <p className="flex items-center gap-1 text-[11px] text-emerald-400"><CheckCircle2 className="w-3 h-3" /> Alterações salvas e ativas para a campanha.</p>
          )}
        </div>

        {/* PREVIEW */}
        <div className="bg-slate-950/60 border border-white/5 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4 text-slate-400">
            <Eye className="w-4 h-4" />
            <span className="text-[11px] font-black uppercase tracking-widest">Preview — {activeTargetMeta.label}</span>
          </div>
          {fields.length === 0 ? (
            <p className="text-xs text-slate-600 flex items-center gap-2"><TypeIcon className="w-4 h-4" /> Os campos aparecerão aqui conforme você os adiciona.</p>
          ) : (
            <div className="space-y-3">
              {fields.map((f) => (
                <div key={f.id} className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                    {f.label || '—'} {f.required && <span className="text-rose-400">*</span>}
                  </label>
                  <PreviewInput field={f} />
                  {f.help && <p className="text-[10px] text-slate-500">{f.help}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** Renderiza um input desabilitado representando como o campo aparece pro usuário. */
const PreviewInput: React.FC<{ field: CustomField }> = ({ field: f }) => {
  const base = 'w-full bg-slate-900 border border-white/10 rounded px-2 py-1.5 text-xs text-slate-400';
  if (f.type === 'boolean') {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="w-9 h-5 rounded-full bg-slate-700 relative"><span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-slate-400" /></span>
        {f.placeholder || 'Sim / Não'}
      </div>
    );
  }
  if (f.type === 'textarea') return <textarea disabled placeholder={f.placeholder} className={base + ' h-16 resize-none'} />;
  if (f.type === 'select') {
    return (
      <select disabled className={base}>
        <option>{f.placeholder || 'Selecione…'}</option>
        {(f.options || []).map((o, i) => <option key={i}>{o}</option>)}
      </select>
    );
  }
  const htmlType = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text';
  return <input disabled type={htmlType} placeholder={f.placeholder || ''} className={base} />;
};

export default FormBuilder;
