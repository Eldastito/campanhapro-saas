import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, AlertTriangle, Send } from 'lucide-react';

/**
 * Página pública de captação (F5b). Renderiza um formulário público pelo slug,
 * sem necessidade de login. Submete via /api/public/forms/:slug/submit, que
 * cria um contato na campanha. Inclui honeypot anti-bot.
 */

interface Field {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  help?: string;
}
interface FormDef { title: string; description?: string; schema: Field[]; successMessage?: string; }

const PublicFormPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [form, setForm] = useState<FormDef | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [values, setValues] = useState<Record<string, any>>({});
  const [hp, setHp] = useState(''); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/public/forms/${slug}`)
      .then(async (r) => {
        if (!r.ok) { setNotFound(true); return null; }
        return r.json();
      })
      .then((b) => { if (b?.form) setForm(b.form); else setNotFound(true); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  const setVal = (id: string, v: any) => setValues((s) => ({ ...s, [id]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    // valida obrigatórios no cliente (o servidor revalida)
    for (const f of form.schema) {
      if (f.required) {
        const v = values[f.id];
        if (v === undefined || v === null || String(v).trim() === '') {
          setError(`Preencha: ${f.label}`); return;
        }
      }
    }
    setError(null); setSubmitting(true);
    try {
      const r = await fetch(`/api/public/forms/${slug}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: values, _hp: hp }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { setError(b?.label ? `Campo obrigatório: ${b.label}` : 'Não foi possível enviar. Tente novamente.'); return; }
      setDone(b?.message || 'Recebemos seu cadastro. Obrigado!');
    } catch {
      setError('Falha de conexão. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }
  if (notFound) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="text-center text-slate-400 max-w-sm">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-amber-400" />
          <h1 className="text-lg font-bold text-white">Formulário indisponível</h1>
          <p className="text-sm mt-1">Este formulário não existe ou foi desativado.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg bg-slate-900/70 border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-8">
        {done ? (
          <div className="text-center py-10">
            <CheckCircle2 className="w-14 h-14 mx-auto mb-4 text-emerald-400" />
            <h1 className="text-xl font-black text-white">Pronto!</h1>
            <p className="text-slate-300 mt-2">{done}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <h1 className="text-2xl font-black text-white">{form?.title}</h1>
              {form?.description && <p className="text-sm text-slate-400 mt-1">{form.description}</p>}
            </div>

            {/* Honeypot — escondido de humanos, atrai bots */}
            <input
              type="text" tabIndex={-1} autoComplete="off" value={hp}
              onChange={(e) => setHp(e.target.value)}
              className="hidden" aria-hidden="true"
            />

            {(form?.schema || []).map((f) => (
              <div key={f.id} className="space-y-1">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                  {f.label} {f.required && <span className="text-rose-400">*</span>}
                </label>
                <FieldInput field={f} value={values[f.id]} onChange={(v) => setVal(f.id, v)} />
                {f.help && <p className="text-[11px] text-slate-500">{f.help}</p>}
              </div>
            ))}

            {error && <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">{error}</p>}

            <button
              type="submit" disabled={submitting}
              className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {submitting ? 'Enviando…' : 'Enviar'}
            </button>
            <p className="text-center text-[10px] text-slate-600">Seus dados são tratados com segurança pela campanha.</p>
          </form>
        )}
      </div>
    </div>
  );
};

const FieldInput: React.FC<{ field: Field; value: any; onChange: (v: any) => void }> = ({ field: f, value, onChange }) => {
  const base = 'w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-500';
  if (f.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="accent-indigo-500 w-4 h-4" />
        {f.placeholder || 'Sim'}
      </label>
    );
  }
  if (f.type === 'textarea') {
    return <textarea value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} className={base + ' h-24 resize-none'} />;
  }
  if (f.type === 'select') {
    return (
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">{f.placeholder || 'Selecione…'}</option>
        {(f.options || []).map((o, i) => <option key={i} value={o}>{o}</option>)}
      </select>
    );
  }
  const htmlType = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text';
  return <input type={htmlType} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} className={base} />;
};

export default PublicFormPage;
