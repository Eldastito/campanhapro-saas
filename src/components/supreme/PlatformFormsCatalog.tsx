import React, { useMemo, useState } from 'react';
import { FileText, Eye, Sparkles, Users, ChevronRight } from 'lucide-react';
import { PLATFORM_FORMS, CatalogField } from './platformForms';

/**
 * Catálogo dos formulários REAIS da plataforma (por perfil), com preview
 * read-only dos campos. Permite ao Supreme Admin revisar com o cliente o que
 * cada formulário (ex.: do Pesquisador) já captura e planejar melhorias.
 */

const TYPE_LABEL: Record<string, string> = {
  text: 'Texto', tel: 'Telefone', email: 'E-mail', password: 'Senha', number: 'Número',
  date: 'Data', time: 'Hora', select: 'Lista', textarea: 'Texto longo', toggle: 'Sim/Não',
  checkbox: 'Caixa', file: 'Arquivo', image: 'Imagem', buttongroup: 'Botões', multiselect: 'Multi-seleção',
};

const PlatformFormsCatalog: React.FC = () => {
  const [profile, setProfile] = useState<string>('todos');
  const [selectedId, setSelectedId] = useState<string>(PLATFORM_FORMS[0]?.id ?? '');

  const profiles = useMemo(() => {
    const set = new Set<string>();
    PLATFORM_FORMS.forEach((f) => f.profiles.forEach((p) => set.add(p)));
    return ['todos', ...Array.from(set).sort()];
  }, []);

  const visible = useMemo(
    () => (profile === 'todos' ? PLATFORM_FORMS : PLATFORM_FORMS.filter((f) => f.profiles.includes(profile))),
    [profile]
  );

  const selected = PLATFORM_FORMS.find((f) => f.id === selectedId) || visible[0] || null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
            <FileText className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-white">Catálogo de Formulários da Plataforma</h3>
            <p className="text-[11px] text-slate-500">Veja os campos reais de cada formulário (por perfil) para revisar com o cliente.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-500" />
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none text-slate-200"
          >
            {profiles.map((p) => <option key={p} value={p}>{p === 'todos' ? 'Todos os perfis' : p}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Lista de formulários */}
        <div className="space-y-2 lg:col-span-1">
          {visible.map((f) => (
            <button
              key={f.id}
              onClick={() => setSelectedId(f.id)}
              className={`w-full text-left p-3 rounded-xl border transition-all ${
                selected?.id === f.id ? 'bg-cyan-600/15 border-cyan-500/50' : 'bg-slate-900/60 border-white/5 hover:border-white/15'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white">{f.name}</span>
                <ChevronRight className={`w-4 h-4 shrink-0 ${selected?.id === f.id ? 'text-cyan-400' : 'text-slate-600'}`} />
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {f.profiles.map((p) => (
                  <span key={p} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400">{p}</span>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-500">
                <span>{f.fields.length} campos</span>
                {f.customFields && <span className="flex items-center gap-0.5 text-emerald-400"><Sparkles className="w-3 h-3" /> personalizável</span>}
              </div>
            </button>
          ))}
          {visible.length === 0 && <p className="text-xs text-slate-600 p-4">Nenhum formulário para este perfil.</p>}
        </div>

        {/* Preview do formulário selecionado */}
        <div className="lg:col-span-2">
          {selected && (
            <div className="bg-slate-950/60 border border-white/5 rounded-xl p-5">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="flex items-center gap-2 text-slate-300">
                  <Eye className="w-4 h-4" />
                  <span className="text-[11px] font-black uppercase tracking-widest">{selected.name}</span>
                </div>
                {selected.customFields ? (
                  <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Aceita campos personalizados</span>
                ) : (
                  <span className="text-[9px] px-2 py-0.5 rounded bg-slate-700/40 text-slate-400">Campos fixos (código)</span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mb-1">{selected.purpose}</p>
              <p className="text-[10px] text-slate-600 mb-4 font-mono">{selected.file}</p>

              <div className="space-y-3">
                {selected.fields.map((f, i) => (
                  <div key={i} className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5 flex-wrap">
                      {f.label} {f.required && <span className="text-rose-400">*</span>}
                      <span className="text-[8px] uppercase px-1 py-0.5 rounded bg-white/5 text-slate-500">{TYPE_LABEL[f.type] || f.type}</span>
                    </label>
                    <CatalogPreviewInput field={f} />
                    {f.note && <p className="text-[10px] text-slate-600 italic">{f.note}</p>}
                  </div>
                ))}
              </div>

              {selected.customFields && (
                <p className="text-[11px] text-emerald-400/80 mt-4 pt-3 border-t border-white/5">
                  💡 Este formulário aceita campos extras — use a aba acima ("Campos internos") no alvo <strong>{selected.customTarget}</strong> para adicionar/editar.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const CatalogPreviewInput: React.FC<{ field: CatalogField }> = ({ field: f }) => {
  const base = 'w-full bg-slate-900 border border-white/10 rounded px-2 py-1.5 text-xs text-slate-400';
  if (f.type === 'toggle') {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="w-9 h-5 rounded-full bg-slate-700 relative"><span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-slate-400" /></span>
        {f.note?.includes('/') ? f.note : 'Sim / Não'}
      </div>
    );
  }
  if (f.type === 'checkbox') return <label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" disabled className="accent-indigo-500" /> {f.label}</label>;
  if (f.type === 'textarea') return <textarea disabled className={base + ' h-14 resize-none'} />;
  if (f.type === 'file' || f.type === 'image') return <div className={base + ' text-slate-600'}>{f.type === 'image' ? '🖼️ upload de imagem' : '📎 anexar arquivo'}</div>;
  if (f.type === 'select') {
    return (
      <select disabled className={base}>
        <option>{f.options?.length ? 'Selecione…' : (f.note || 'Selecione…')}</option>
        {(f.options || []).map((o, i) => <option key={i}>{o}</option>)}
      </select>
    );
  }
  if (f.type === 'buttongroup' || f.type === 'multiselect') {
    const opts = f.options || ['Opção A', 'Opção B'];
    return (
      <div className="flex flex-wrap gap-1.5">
        {opts.map((o, i) => <span key={i} className="text-[10px] px-2 py-1 rounded border border-white/10 bg-slate-900 text-slate-400">{o}</span>)}
      </div>
    );
  }
  const htmlType = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time'
    : f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : f.type === 'password' ? 'password' : 'text';
  return <input disabled type={htmlType} className={base} />;
};

export default PlatformFormsCatalog;
