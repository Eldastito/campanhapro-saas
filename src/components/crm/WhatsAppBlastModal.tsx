/**
 * WhatsApp mass-send modal — creates a blast via Evolution API.
 * Sends are processed server-side with 2.5s delay between messages.
 * LGPD: coordinator explicitly selects and confirms the contact list.
 */
import * as React from 'react';
import {
  X, Smartphone, Loader2, CheckCircle2, AlertCircle,
  Zap, Users, Clock, ChevronRight
} from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

interface WhatsAppInstance {
  id: string;
  displayName: string;
  phoneNumber: string | null;
  status: string;
}

interface BlastStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  totalContacts: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  startedAt: string | null;
  completedAt: string | null;
}

interface WhatsAppBlastModalProps {
  totalContactsAll: number;
  onClose: () => void;
}

const CLASSIFICATIONS = ['Multiplicador', 'Apoiador', 'Indeciso', 'Neutro', 'Rejeição'];

export const WhatsAppBlastModal: React.FC<WhatsAppBlastModalProps> = ({
  totalContactsAll,
  onClose,
}) => {
  const [step, setStep] = React.useState<'config' | 'confirm' | 'running' | 'done'>('config');

  // Config
  const [instances, setInstances] = React.useState<WhatsAppInstance[]>([]);
  const [loadingInstances, setLoadingInstances] = React.useState(true);
  const [selectedInstance, setSelectedInstance] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [filterAll, setFilterAll] = React.useState(true);
  const [filterClass, setFilterClass] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  // Progress
  const [blastId, setBlastId] = React.useState<string | null>(null);
  const [blastStatus, setBlastStatus] = React.useState<BlastStatus | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    authedFetch('/api/v1/whatsapp/instances')
      .then(r => r.json())
      .then(json => {
        setInstances((json.instances ?? []).filter((i: WhatsAppInstance) => i.status === 'connected'));
      })
      .catch(() => {})
      .finally(() => setLoadingInstances(false));
  }, []);

  // Poll progress when blast is running
  React.useEffect(() => {
    if (!blastId || step !== 'running') return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await authedFetch(`/api/v1/whatsapp/blasts/${blastId}`);
        const json = await res.json();
        if (!res.ok) return;
        setBlastStatus(json.blast);
        if (json.blast.status === 'completed' || json.blast.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setStep('done');
        }
      } catch {}
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [blastId, step]);

  const toggleClass = (c: string) => {
    setFilterClass(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
  };

  const estimatedMinutes = React.useMemo(() => {
    // Throttle anti-queima: 5-15s aleatório por envio → ~10s médio.
    const count = filterAll ? totalContactsAll : (filterClass.length ? totalContactsAll : 0);
    return Math.ceil((count * 10) / 60);
  }, [filterAll, filterClass, totalContactsAll]);

  const canStart = selectedInstance && title.trim() && message.trim() && (filterAll || filterClass.length > 0);

  const startBlast = async () => {
    if (!canStart) return;
    setError(null);
    try {
      const res = await authedFetch('/api/v1/whatsapp/blasts', {
        method: 'POST',
        body: JSON.stringify({
          instanceId: selectedInstance,
          title: title.trim(),
          message: message.trim(),
          contactFilter: filterAll ? { all: true } : { classification: filterClass },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao iniciar disparo');
      setBlastId(json.blastId);
      setBlastStatus({
        id: json.blastId,
        status: 'running',
        totalContacts: json.totalContacts,
        sentCount: 0,
        failedCount: 0,
        skippedCount: 0,
        startedAt: new Date().toISOString(),
        completedAt: null,
      });
      setStep('running');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const pct = blastStatus && blastStatus.totalContacts > 0
    ? Math.round(((blastStatus.sentCount + blastStatus.failedCount) / blastStatus.totalContacts) * 100)
    : 0;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={step === 'running' || step === 'done' ? undefined : onClose}
    >
      <div
        className="bg-[#0d1117] border border-white/10 rounded-2xl max-w-lg w-full p-6"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-lg flex items-center gap-2 text-white">
            <Zap className="w-5 h-5 text-emerald-400" />
            Disparar Mensagem em Massa
          </h3>
          {step !== 'running' && (
            <button onClick={onClose} className="text-gray-500 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 mb-4 text-sm text-red-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Step: config */}
        {step === 'config' && (
          <div className="space-y-4">
            {/* Instance picker */}
            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Número WhatsApp para envio *</label>
              {loadingInstances ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Carregando instâncias…
                </div>
              ) : instances.length === 0 ? (
                <p className="text-sm text-yellow-400">
                  Nenhum número conectado. Conecte um número em Recursos → Conexões Sociais.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {instances.map(inst => (
                    <label
                      key={inst.id}
                      className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all ${
                        selectedInstance === inst.id
                          ? 'border-emerald-500/50 bg-emerald-500/10'
                          : 'border-white/10 hover:border-white/20'
                      }`}
                    >
                      <input
                        type="radio"
                        name="instance"
                        value={inst.id}
                        checked={selectedInstance === inst.id}
                        onChange={() => setSelectedInstance(inst.id)}
                        className="hidden"
                      />
                      <Smartphone className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">{inst.displayName}</p>
                        {inst.phoneNumber && (
                          <p className="text-[10px] text-gray-500">+{inst.phoneNumber}</p>
                        )}
                      </div>
                      {selectedInstance === inst.id && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Title */}
            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Nome do disparo *</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="ex: Convite para evento 15/06"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Message */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-gray-400">Mensagem *</label>
                <span className="text-[10px] text-gray-600">Variáveis: {'{{nome}}'} · {'{{bairro}}'}</span>
              </div>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder={'Olá {{nome}}! Temos novidades para o bairro {{bairro}}…'}
                rows={4}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500 resize-none"
              />
              <p className="text-[10px] text-gray-600 mt-1">{message.length} caracteres</p>
            </div>

            {/* Filter */}
            <div>
              <label className="text-xs text-gray-400 block mb-1.5 flex items-center gap-1">
                <Users className="w-3 h-3" /> Para quem enviar?
              </label>
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={filterAll}
                  onChange={e => { setFilterAll(e.target.checked); if (e.target.checked) setFilterClass([]); }}
                  className="rounded"
                />
                <span className="text-sm text-white">Todos os contatos com telefone</span>
              </label>
              {!filterAll && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {CLASSIFICATIONS.map(c => (
                    <button
                      key={c}
                      onClick={() => toggleClass(c)}
                      className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                        filterClass.includes(c)
                          ? 'bg-blue-600 border-blue-400 text-white'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:border-blue-500/50'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {estimatedMinutes > 0 && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Tempo estimado: ~{estimatedMinutes} minutos (2,5s entre envios)
              </p>
            )}

            <button
              onClick={() => setStep('confirm')}
              disabled={!canStart}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <ChevronRight className="w-4 h-4" />
              Revisar e confirmar
            </button>
          </div>
        )}

        {/* Step: confirm */}
        {step === 'confirm' && (
          <div className="space-y-4">
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4">
              <p className="text-sm font-bold text-rose-300 mb-2">🛑 Risco de banimento do chip — leia antes</p>
              <ul className="text-[11px] text-rose-200/80 space-y-1 list-disc pl-4">
                <li><b>Meta bane chips</b> que disparam pra contatos que não te escreveram antes. Risco é REAL.</li>
                <li>Para mitigar, o sistema espalha os envios em <b>5–15s aleatórios</b> entre cada msg (não dá pra disparar tudo de uma vez).</li>
                <li>Adicionamos automaticamente <b>"Pra parar de receber: responda SAIR"</b> no rodapé da sua mensagem (LGPD + reduz denúncia).</li>
                <li>Quanto MAIS contatos nunca te escreveram, MAIOR o risco. Recomendado: começar pequeno (50–100) e ver se chegam respostas.</li>
              </ul>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Número:</span>
                <span className="text-white">{instances.find(i => i.id === selectedInstance)?.displayName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Destinatários:</span>
                <span className="text-white">{filterAll ? 'Todos os contatos' : filterClass.join(', ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Nome do disparo:</span>
                <span className="text-white">{title}</span>
              </div>
            </div>

            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <p className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wider">Prévia (como o eleitor vai ver)</p>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">
                {message.replace(/\{\{nome\}\}/gi, 'João Silva').replace(/\{\{bairro\}\}/gi, 'Centro')}
                {!/sair|stop|cancelar|descadastr/i.test(message) && (
                  <span className="text-amber-300/80 italic">{'\n\n_Pra parar de receber: responda SAIR._'}</span>
                )}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('config')}
                className="flex-1 py-2 rounded-xl border border-white/10 text-gray-400 hover:text-white text-sm"
              >
                ← Editar
              </button>
              <button
                onClick={startBlast}
                className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" />
                Disparar agora
              </button>
            </div>
          </div>
        )}

        {/* Step: running */}
        {step === 'running' && blastStatus && (
          <div className="space-y-5">
            <div className="text-center">
              <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mx-auto mb-3" />
              <p className="text-white font-bold">Enviando mensagens…</p>
              <p className="text-gray-500 text-sm mt-1">Não feche esta janela.</p>
            </div>

            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                <span>{blastStatus.sentCount + blastStatus.failedCount} / {blastStatus.totalContacts}</span>
                <span>{pct}%</span>
              </div>
              <div className="w-full bg-white/5 rounded-full h-2">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
              <div className="bg-emerald-500/10 rounded-xl p-3">
                <p className="text-xl font-black text-emerald-400">{blastStatus.sentCount}</p>
                <p className="text-[10px] text-gray-500">Enviados</p>
              </div>
              <div className="bg-red-500/10 rounded-xl p-3">
                <p className="text-xl font-black text-red-400">{blastStatus.failedCount}</p>
                <p className="text-[10px] text-gray-500">Falhas</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-xl font-black text-gray-400">
                  {blastStatus.totalContacts - blastStatus.sentCount - blastStatus.failedCount}
                </p>
                <p className="text-[10px] text-gray-500">Restantes</p>
              </div>
            </div>
          </div>
        )}

        {/* Step: done */}
        {step === 'done' && blastStatus && (
          <div className="text-center space-y-4">
            {blastStatus.status === 'completed' ? (
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            ) : (
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
            )}
            <div>
              <p className="text-white font-bold text-lg">
                {blastStatus.status === 'completed' ? 'Disparo concluído!' : 'Disparo encerrado com erros'}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
              <div className="bg-emerald-500/10 rounded-xl p-3">
                <p className="text-xl font-black text-emerald-400">{blastStatus.sentCount}</p>
                <p className="text-[10px] text-gray-500">Enviados</p>
              </div>
              <div className="bg-red-500/10 rounded-xl p-3">
                <p className="text-xl font-black text-red-400">{blastStatus.failedCount}</p>
                <p className="text-[10px] text-gray-500">Falhas</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-xl font-black text-gray-400">{blastStatus.totalContacts}</p>
                <p className="text-[10px] text-gray-500">Total</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="px-8 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default WhatsAppBlastModal;
