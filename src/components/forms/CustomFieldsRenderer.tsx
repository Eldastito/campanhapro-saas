import * as React from 'react';

/**
 * Renderiza campos personalizados (definidos no Form Builder do Supreme) em
 * qualquer formulário da plataforma. Os valores são controlados por `values`
 * e atualizados via `onChange(id, value)`. Suporta os 8 tipos do builder.
 */

export interface RenderableField {
  id: string;
  label: string;
  type: string; // text|textarea|number|date|email|phone|select|boolean
  required?: boolean;
  options?: string[];
  placeholder?: string;
  help?: string;
}

interface Props {
  fields: RenderableField[];
  values: Record<string, any>;
  onChange: (id: string, value: any) => void;
  title?: string;
  className?: string;
}

const CustomFieldsRenderer: React.FC<Props> = ({ fields, values, onChange, title = 'Campos Adicionais da Campanha', className }) => {
  if (!fields || fields.length === 0) return null;
  const inputCls = 'w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none text-white';

  return (
    <div className={className || 'p-4 bg-indigo-900/10 border border-indigo-500/20 rounded-lg space-y-4'}>
      <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">{title}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {fields.map((f) => {
          const v = values?.[f.id] ?? (f.type === 'boolean' ? false : '');
          if (f.type === 'boolean') {
            return (
              <label key={f.id} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-slate-700 cursor-pointer">
                <span className="text-sm font-medium text-slate-300">{f.label}</span>
                <input type="checkbox" className="accent-indigo-500 w-4 h-4" checked={!!v} onChange={(e) => onChange(f.id, e.target.checked)} />
              </label>
            );
          }
          return (
            <div key={f.id}>
              <label className="block text-sm font-medium text-slate-300 mb-1">{f.label}{f.required && <span className="text-rose-400"> *</span>}</label>
              {f.type === 'select' ? (
                <select className={inputCls} value={v} required={f.required} onChange={(e) => onChange(f.id, e.target.value)}>
                  <option value="">{f.placeholder || 'Selecione…'}</option>
                  {(f.options || []).map((o, i) => <option key={i} value={o}>{o}</option>)}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea className={inputCls} rows={2} value={v} placeholder={f.placeholder} required={f.required} onChange={(e) => onChange(f.id, e.target.value)} />
              ) : (
                <input
                  className={inputCls}
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'}
                  value={v}
                  placeholder={f.placeholder}
                  required={f.required}
                  onChange={(e) => onChange(f.id, e.target.value)}
                />
              )}
              {f.help && <p className="text-[10px] text-slate-500 mt-1">{f.help}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CustomFieldsRenderer;
