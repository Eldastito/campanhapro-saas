import React, { useEffect, useState } from 'react';
import Card from '../ui/Card';
import { authedFetch } from '../../lib/authedFetch';

/**
 * Cadastro das chaves públicas Ed25519 do TSE (uma por UF/ano).
 *
 * O TSE publica essas chaves após a Cerimônia de Lacração e Assinatura
 * Digital (geralmente 2-3 meses antes da eleição). Enquanto não estão
 * cadastradas, o BUScanner devolve status "no_key" e o fiscal vê um
 * aviso amarelo — não bloqueia a apuração, mas avisa que a verificação
 * cripto não pode ser feita.
 */
interface TseKey {
  uf: string;
  year: number;
  public_key_hex: string;
  notes: string | null;
  updated_at: string;
}

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const TseKeysPanel: React.FC = () => {
  const [keys, setKeys] = useState<TseKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ uf: 'RJ', year: new Date().getFullYear(), public_key_hex: '', notes: '' });

  const load = async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/api/v1/supreme/tse-keys');
      if (r.ok) {
        const j = await r.json();
        setKeys(j.keys || []);
      }
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await authedFetch('/api/v1/supreme/tse-keys', {
        method: 'POST', body: JSON.stringify(form),
      });
      const j = await r.json().catch(() => ({} as any));
      if (r.ok) {
        setForm({ uf: 'RJ', year: new Date().getFullYear(), public_key_hex: '', notes: '' });
        await load();
      } else {
        setError(j.error === 'public_key_hex_invalid' ? `Chave inválida (esperado 64 caracteres hex, recebido ${j.got || 0})`
          : j.error === 'uf_invalid' ? 'UF inválida'
          : j.error === 'year_invalid' ? 'Ano inválido'
          : j.error || 'Falha ao salvar');
      }
    } catch (e: any) {
      setError(e?.message || 'Erro de rede');
    } finally { setBusy(false); }
  };

  const remove = async (uf: string, year: number) => {
    if (!confirm(`Apagar chave Ed25519 de ${uf}/${year}? Fiscais dessa UF voltarão pra "no_key".`)) return;
    setBusy(true);
    try {
      await authedFetch(`/api/v1/supreme/tse-keys/${uf}/${year}`, { method: 'DELETE' });
      await load();
    } finally { setBusy(false); }
  };

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h3 className="font-black text-white text-sm tracking-tight">🗝️ Chaves Ed25519 do TSE (Dia D)</h3>
        <p className="text-[10px] text-slate-500 mt-1">
          Chaves públicas que o TSE divulga após a Cerimônia de Lacração — uma por UF/ano. Enquanto não cadastradas, fiscais veem aviso amarelo no BU.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
        <div className="md:col-span-2">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider">UF</label>
          <select value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value })}
            className="w-full bg-slate-950 border border-white/10 rounded-lg px-2 py-1.5 text-white text-sm mt-1">
            {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider">Ano</label>
          <input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
            className="w-full bg-slate-950 border border-white/10 rounded-lg px-2 py-1.5 text-white text-sm mt-1" />
        </div>
        <div className="md:col-span-8">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider">Chave pública (hex — 64 chars / 32 bytes)</label>
          <input type="text" value={form.public_key_hex} placeholder="ex.: a1b2c3..."
            onChange={(e) => setForm({ ...form, public_key_hex: e.target.value })}
            className="w-full bg-slate-950 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs font-mono mt-1" />
        </div>
        <div className="md:col-span-10">
          <input type="text" value={form.notes} placeholder="Notas (opcional — ex.: 'TSE Diário Oficial 12/08/2026')"
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full bg-slate-950 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs" />
        </div>
        <div className="md:col-span-2">
          <button onClick={save} disabled={busy || !form.public_key_hex}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-lg">
            {busy ? '…' : 'Salvar'}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}

      <div className="border-t border-white/5 pt-3">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Chaves cadastradas ({keys.length})</p>
        {loading ? (
          <p className="text-xs text-slate-500">Carregando…</p>
        ) : keys.length === 0 ? (
          <p className="text-xs text-slate-500 italic">Nenhuma chave cadastrada ainda. Fiscais verão aviso "Chave pública TSE não configurada" no BU.</p>
        ) : (
          <div className="space-y-1.5">
            {keys.map((k) => (
              <div key={`${k.uf}-${k.year}`} className="flex items-center gap-3 bg-slate-950/60 rounded-lg px-3 py-2">
                <span className="text-xs font-black text-white w-12">{k.uf}/{k.year}</span>
                <span className="text-[10px] font-mono text-slate-400 truncate flex-1">{k.public_key_hex.slice(0, 16)}…{k.public_key_hex.slice(-8)}</span>
                {k.notes && <span className="text-[10px] text-slate-500 truncate max-w-[200px]">{k.notes}</span>}
                <button onClick={() => remove(k.uf, k.year)}
                  className="text-[10px] text-rose-400 hover:text-rose-300 ml-2">Remover</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};

export default TseKeysPanel;
