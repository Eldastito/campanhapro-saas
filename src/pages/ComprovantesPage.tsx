import * as React from 'react';
import { Camera, Loader2, Check, X, Upload, FileText, Clock } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { authedFetch } from '../lib/authedFetch';
import { useAuth } from '../contexts/AuthContext';
import { fileToBase64 } from '../utils/helpers';

/**
 * Comprovantes — envio rápido por QUALQUER membro da campanha (evita perder o
 * comprovante). A foto/PDF vai pra uma fila; o OCR (GPT-4o) pré-preenche os
 * campos; o gestor revisa e aprova → vira receita/despesa oficial.
 */

type Kind = 'income' | 'expense';
interface Submission {
  id: string; kind: Kind; imageUrl: string; status: string; ocrStatus: string;
  ocrData?: any; note?: string; submittedByName?: string; rejectionReason?: string;
  createdAt?: string;
}

const inputCls = 'w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-sm';
const ORIGENS = ['Doação Pessoal', 'Recursos Próprios', 'Partido', 'Venda de Material', 'Outra'];
const CATEGORIAS = ['Alimentação', 'Combustível', 'Aluguel de Carro', 'Aluguel de Espaço', 'Material Gráfico', 'Pessoal (Ajuda de Custo)', 'Pessoal (Salário)', 'Advogado', 'Contador', 'Eventos', 'Marketing Digital', 'Outra'];
const FORMAS = ['Dinheiro', 'Cheque', 'Transferência bancária', 'Cartão de débito', 'Cartão de crédito', 'PIX', 'Boleto', 'Outro'];
const TIPOS_GASTO = ['Pessoal', 'Material de campanha (gráfico)', 'Comícios/eventos', 'Propaganda (rádio/TV/internet)', 'Impulsionamento de conteúdo na internet', 'Combustível e lubrificantes', 'Locação/aquisição de veículos', 'Locação de bens móveis/imóveis', 'Serviços advocatícios/contábeis', 'Alimentação', 'Diárias/hospedagem/viagens', 'Tributos e encargos', 'Outras despesas'];

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-300', approved: 'bg-emerald-500/15 text-emerald-300', rejected: 'bg-rose-500/15 text-rose-300',
  };
  const label: Record<string, string> = { pending: 'Em revisão', approved: 'Aprovado', rejected: 'Recusado' };
  return <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full ${map[s] || 'bg-slate-700 text-slate-300'}`}>{label[s] || s}</span>;
};

// ── Upload (todos os perfis) ────────────────────────────────────────────────
const UploadForm: React.FC<{ onSent: () => void }> = ({ onSent }) => {
  const [kind, setKind] = React.useState<Kind>('expense');
  const [imageUrl, setImageUrl] = React.useState<string>('');
  const [fileName, setFileName] = React.useState('');
  const [note, setNote] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { setImageUrl(await fileToBase64(f)); setFileName(f.name); }
    catch { setMsg('Erro ao carregar o arquivo.'); }
  };

  const submit = async () => {
    if (!imageUrl) { setMsg('Anexe a foto ou PDF do comprovante.'); return; }
    setSending(true); setMsg(null);
    try {
      const r = await authedFetch('/api/v1/receipts', { method: 'POST', body: JSON.stringify({ kind, imageUrl, note }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`);
      setImageUrl(''); setFileName(''); setNote('');
      setMsg('Comprovante enviado! O financeiro vai revisar.');
      onSent();
    } catch (e: any) { setMsg(e.message || 'Falha ao enviar.'); }
    finally { setSending(false); }
  };

  return (
    <Card>
      <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2"><Camera className="w-4 h-4 text-indigo-400" /> Enviar comprovante</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Tipo</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={inputCls}>
            <option value="expense">Despesa (gasto / nota fiscal)</option>
            <option value="income">Receita (doação / recurso recebido)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Comprovante (foto ou PDF)</label>
          <label htmlFor="receipt-file" className={inputCls + ' cursor-pointer flex items-center justify-between'}>
            <span className="truncate text-slate-300">{fileName || 'Escolher arquivo…'}</span>
            <Upload className="w-4 h-4 text-slate-400 shrink-0" />
            <input id="receipt-file" type="file" className="hidden" accept="image/*,.pdf" capture="environment" onChange={onFile} />
          </label>
        </div>
      </div>
      <div className="mt-3">
        <Input label="Observação (opcional)" name="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: combustível do dia 12, equipe Zona Norte" />
      </div>
      {msg && <p className="text-xs mt-2 text-slate-300">{msg}</p>}
      <div className="flex justify-end mt-3">
        <Button onClick={submit} disabled={sending} className="flex items-center gap-2">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Enviar
        </Button>
      </div>
      <p className="text-[10px] text-slate-500 mt-2">Dica: no celular, "Escolher arquivo" abre a câmera. O sistema lê o comprovante automaticamente pra agilizar o lançamento.</p>
    </Card>
  );
};

// ── Card de revisão (gestor) ────────────────────────────────────────────────
const ReviewCard: React.FC<{ sub: Submission; onDone: () => void }> = ({ sub, onDone }) => {
  const ocr = sub.ocrData || {};
  const [f, setF] = React.useState<Record<string, any>>(() => sub.kind === 'income'
    ? { data: ocr.data || '', valor: ocr.valor ?? '', origem: 'Doação Pessoal', doador: ocr.nome || '', documentoDoador: ocr.documento || '', descricao: ocr.descricao || '', tipoDocumento: 'Recibo', especie: 'Financeira', fonteRecurso: 'Doação de pessoa física', contaReceptora: 'Doações', reciboEleitoral: '' }
    : { data: ocr.data || '', valor: ocr.valor ?? '', categoria: 'Outra', fornecedor: ocr.nome || '', documentoFornecedor: ocr.documento || '', descricao: ocr.descricao || '', tipoDocumento: ocr.tipo || 'Nota Fiscal', formaPagamento: 'Transferência bancária', tipoGasto: 'Outras despesas', dataPagamento: '' });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  const approve = async () => {
    setBusy(true); setErr(null);
    try {
      const fields = { ...f, valor: parseFloat(String(f.valor).replace(',', '.')) || 0, dataPagamento: f.dataPagamento || undefined };
      const r = await authedFetch(`/api/v1/receipts/${sub.id}/approve`, { method: 'POST', body: JSON.stringify({ fields }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`);
      onDone();
    } catch (e: any) { setErr(e.message || 'Falha ao aprovar.'); }
    finally { setBusy(false); }
  };
  const reject = async () => {
    const reason = window.prompt('Motivo da recusa (opcional):') ?? '';
    setBusy(true); setErr(null);
    try {
      const r = await authedFetch(`/api/v1/receipts/${sub.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onDone();
    } catch (e: any) { setErr(e.message || 'Falha ao recusar.'); }
    finally { setBusy(false); }
  };

  const isImg = sub.imageUrl.startsWith('data:image/');
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300">{sub.kind === 'income' ? 'Receita' : 'Despesa'}</span>
          <p className="text-[11px] text-slate-500 mt-1">por {sub.submittedByName || '—'} {sub.note ? `· "${sub.note}"` : ''}</p>
          <p className="text-[10px] text-slate-500">OCR: {sub.ocrStatus === 'done' ? 'lido' : sub.ocrStatus === 'error' ? 'não lido (preencha manual)' : sub.ocrStatus}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3">
        <a href={sub.imageUrl} target="_blank" rel="noreferrer" className="block">
          {isImg
            ? <img src={sub.imageUrl} alt="comprovante" className="rounded-lg border border-slate-700 max-h-44 object-contain bg-white w-full" />
            : <div className="rounded-lg border border-slate-700 h-44 flex flex-col items-center justify-center text-slate-400 text-xs gap-1"><FileText className="w-6 h-6" /> Abrir PDF</div>}
        </a>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Data" type="date" name="data" value={f.data} onChange={(e) => set('data', e.target.value)} />
          <Input label="Valor (R$)" name="valor" value={String(f.valor)} onChange={(e) => set('valor', e.target.value)} />
          {sub.kind === 'income' ? (
            <>
              <div><label className="block text-xs text-slate-400 mb-1">Origem</label><select value={f.origem} onChange={(e) => set('origem', e.target.value)} className={inputCls}>{ORIGENS.map((o) => <option key={o}>{o}</option>)}</select></div>
              <Input label="Doador" name="doador" value={f.doador} onChange={(e) => set('doador', e.target.value)} />
              <Input label="CPF/CNPJ doador" name="documentoDoador" value={f.documentoDoador} onChange={(e) => set('documentoDoador', e.target.value)} />
              <Input label="Recibo eleitoral" name="reciboEleitoral" value={f.reciboEleitoral} onChange={(e) => set('reciboEleitoral', e.target.value)} />
              <div className="col-span-2"><Input label="Descrição" name="descricao" value={f.descricao} onChange={(e) => set('descricao', e.target.value)} /></div>
            </>
          ) : (
            <>
              <div><label className="block text-xs text-slate-400 mb-1">Categoria</label><select value={f.categoria} onChange={(e) => set('categoria', e.target.value)} className={inputCls}>{CATEGORIAS.map((o) => <option key={o}>{o}</option>)}</select></div>
              <Input label="Fornecedor" name="fornecedor" value={f.fornecedor} onChange={(e) => set('fornecedor', e.target.value)} />
              <Input label="CPF/CNPJ fornecedor" name="documentoFornecedor" value={f.documentoFornecedor} onChange={(e) => set('documentoFornecedor', e.target.value)} />
              <div><label className="block text-xs text-slate-400 mb-1">Forma de pagamento</label><select value={f.formaPagamento} onChange={(e) => set('formaPagamento', e.target.value)} className={inputCls}>{FORMAS.map((o) => <option key={o}>{o}</option>)}</select></div>
              <div><label className="block text-xs text-slate-400 mb-1">Tipo de gasto (TSE)</label><select value={f.tipoGasto} onChange={(e) => set('tipoGasto', e.target.value)} className={inputCls}>{TIPOS_GASTO.map((o) => <option key={o}>{o}</option>)}</select></div>
              <div className="col-span-2"><Input label="Descrição" name="descricao" value={f.descricao} onChange={(e) => set('descricao', e.target.value)} /></div>
            </>
          )}
        </div>
      </div>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={reject} disabled={busy} className="flex items-center gap-1.5 text-xs"><X className="w-4 h-4" /> Recusar</Button>
        <Button onClick={approve} disabled={busy} className="bg-emerald-600 hover:bg-emerald-500 flex items-center gap-1.5 text-xs">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Aprovar e lançar</Button>
      </div>
    </Card>
  );
};

const ComprovantesPage: React.FC = () => {
  const { user } = useAuth();
  const isManager = user?.type === 'Admin' || user?.type === 'Coordenador' || user?.type === 'Candidato';
  const [subs, setSubs] = React.useState<Submission[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/api/v1/receipts');
      if (r.ok) setSubs((await r.json()).submissions ?? []);
    } finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const pending = subs.filter((s) => s.status === 'pending');
  const history = subs.filter((s) => s.status !== 'pending');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Camera className="w-6 h-6 text-indigo-400" />
        <h2 className="text-2xl font-bold text-slate-200">Comprovantes</h2>
      </div>

      <UploadForm onSent={load} />

      {isManager && (
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-amber-400" /> Fila de revisão {pending.length > 0 && <span className="text-xs text-slate-500">({pending.length})</span>}</h3>
          {loading ? <div className="flex justify-center py-8 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
            : pending.length === 0 ? <p className="text-sm text-slate-500">Nenhum comprovante aguardando revisão.</p>
            : <div className="space-y-3">{pending.map((s) => <ReviewCard key={s.id} sub={s} onDone={load} />)}</div>}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-3">{isManager ? 'Histórico' : 'Meus envios'}</h3>
        {loading ? <div className="flex justify-center py-8 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
          : (isManager ? history : subs).length === 0 ? <p className="text-sm text-slate-500">Nenhum comprovante ainda.</p>
          : <Card><div className="space-y-1">
              {(isManager ? history : subs).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 px-2 py-2 hover:bg-slate-700/30 rounded text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <a href={s.imageUrl} target="_blank" rel="noreferrer" className="text-indigo-300 hover:text-indigo-200 text-xs shrink-0">ver</a>
                    <span className="text-slate-300 shrink-0">{s.kind === 'income' ? 'Receita' : 'Despesa'}</span>
                    <span className="text-slate-500 truncate">{s.ocrData?.nome || s.note || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.ocrData?.valor != null && <span className="font-mono text-slate-400 text-xs">{(Number(s.ocrData.valor)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>}
                    {statusBadge(s.status)}
                  </div>
                </div>
              ))}
            </div></Card>}
      </div>
    </div>
  );
};

export default ComprovantesPage;
