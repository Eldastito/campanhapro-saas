import * as React from 'react';
import { Plus, Trash2, RefreshCw, CheckCircle2, AlertCircle, X, Loader2, QrCode, Smartphone } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

interface WhatsAppInstance {
  id: string;
  campaignId: string;
  instanceName: string;
  displayName: string;
  phoneNumber: string | null;
  status: 'pending' | 'qrcode' | 'connected' | 'disconnected' | 'deleted';
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABEL: Record<WhatsAppInstance['status'], string> = {
  pending: 'Aguardando',
  qrcode: 'Escaneie o QR',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  deleted: 'Removido',
};

const STATUS_COLOR: Record<WhatsAppInstance['status'], string> = {
  pending: 'text-slate-400 border-slate-700 bg-slate-800/40',
  qrcode: 'text-amber-400 border-amber-500/40 bg-amber-500/5',
  connected: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/5',
  disconnected: 'text-red-400 border-red-500/40 bg-red-500/5',
  deleted: 'text-slate-500 border-slate-700 bg-slate-900',
};

export const WhatsAppInstancesPanel: React.FC = () => {
  const [instances, setInstances] = React.useState<WhatsAppInstance[]>([]);
  const [evolutionConfigured, setEvolutionConfigured] = React.useState(true);
  const [loading, setLoading] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [qrModal, setQrModal] = React.useState<{ instanceId: string; qrCode: string | null } | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [botEnabled, setBotEnabled] = React.useState<boolean | null>(null);
  const [botSaving, setBotSaving] = React.useState(false);

  React.useEffect(() => {
    authedFetch('/api/v1/whatsapp/bot').then(r => r.json()).then(j => setBotEnabled(!!j.enabled)).catch(() => {});
  }, []);

  const toggleBot = async () => {
    const next = !botEnabled;
    if (next && !confirm('Ligar o atendimento automático ao eleitor?\n\nO assistente vai RESPONDER sozinho mensagens recebidas no WhatsApp, identificando-se como automatizado e usando apenas o Argumentário cadastrado. Garanta que o Argumentário (aba Inteligência) está preenchido.')) return;
    setBotSaving(true);
    try {
      const r = await authedFetch('/api/v1/whatsapp/bot', { method: 'POST', body: JSON.stringify({ enabled: next }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Falha ao alterar');
      setBotEnabled(!!j.enabled);
    } catch (e: any) { setError(e.message); }
    finally { setBotSaving(false); }
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch('/api/v1/whatsapp/instances');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar números');
      setInstances(json.instances ?? []);
      setEvolutionConfigured(json.evolutionConfigured !== false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  // Poll status for instances that are not yet connected
  React.useEffect(() => {
    const polling = instances.filter(i => i.status === 'qrcode' || i.status === 'pending');
    if (polling.length === 0) return;
    const interval = setInterval(async () => {
      for (const inst of polling) {
        try {
          const res = await authedFetch(`/api/v1/whatsapp/instances/${inst.id}/status`);
          const json = await res.json();
          if (res.ok && (json.status !== inst.status || json.phoneNumber !== inst.phoneNumber)) {
            setInstances(prev => prev.map(p =>
              p.id === inst.id ? { ...p, status: json.status, phoneNumber: json.phoneNumber ?? p.phoneNumber } : p
            ));
            if (json.status === 'connected' && qrModal?.instanceId === inst.id) {
              setQrModal(null);
            }
          }
        } catch { /* transient */ }
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [instances, qrModal]);

  // Quando o modal de QR abre sem QR pronto (ex.: instância recém-reprovisionada),
  // busca o QR algumas vezes em vez de spinner eterno.
  React.useEffect(() => {
    if (!qrModal || qrModal.qrCode) return;
    let tries = 0;
    const iv = setInterval(async () => {
      tries += 1;
      if (tries > 8) { clearInterval(iv); return; }
      try {
        const res = await authedFetch(`/api/v1/whatsapp/instances/${qrModal.instanceId}/qrcode?poll=1`);
        const j = await res.json();
        if (res.ok && j.qrCode) { setQrModal(m => (m ? { ...m, qrCode: j.qrCode } : m)); clearInterval(iv); }
      } catch { /* segue tentando */ }
    }, 3000);
    return () => clearInterval(iv);
  }, [qrModal]);

  const createInstance = async () => {
    if (newName.trim().length < 2) return;
    setCreating(true);
    setError(null);
    try {
      const res = await authedFetch('/api/v1/whatsapp/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: newName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao criar número');
      setNewName('');
      setAdding(false);
      await load();
      if (json.qrCode) {
        setQrModal({ instanceId: json.instance.id, qrCode: json.qrCode });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const refreshQR = async (instanceId: string) => {
    try {
      const res = await authedFetch(`/api/v1/whatsapp/instances/${instanceId}/qrcode`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao gerar QR');
      setQrModal({ instanceId, qrCode: json.qrCode });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const removeInstance = async (id: string) => {
    if (!confirm('Remover este número? A sessão do WhatsApp será encerrada.')) return;
    setDeletingId(id);
    try {
      const res = await authedFetch(`/api/v1/whatsapp/instances/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? 'Erro ao remover');
      }
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  if (!evolutionConfigured && !loading) {
    return (
      <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-4 mb-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-300">Evolution API não configurada</p>
            <p className="text-xs text-amber-200/70 mt-1">
              Configure as variáveis <code className="bg-slate-900 px-1 rounded">EVOLUTION_API_URL</code> e{' '}
              <code className="bg-slate-900 px-1 rounded">EVOLUTION_GLOBAL_API_KEY</code> no servidor para habilitar
              múltiplos números WhatsApp.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-emerald-400" />
          <h3 className="text-base font-semibold text-slate-200">Números WhatsApp</h3>
          <span className="text-xs text-slate-500">({instances.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40"
            title="Atualizar"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Conectar número
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 mb-3">
        Cada número aparece automaticamente na Caixa de Entrada Omnichannel após pareamento.
        Mensagens recebidas criam contatos automaticamente.
      </p>

      {/* Atendimento automático ao eleitor (bot) */}
      <div className={`rounded-lg border px-3 py-2.5 mb-3 ${botEnabled ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-slate-700 bg-slate-950'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-200">🤖 Atendimento automático ao eleitor</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {botEnabled
                ? 'LIGADO: o assistente responde sozinho as mensagens recebidas, identificando-se como automatizado e usando só o Argumentário.'
                : 'Desligado. Quando ligar, o bot responde mensagens recebidas com base no Argumentário (aba Inteligência), com opt-out e escalonamento humano.'}
            </p>
          </div>
          <button
            onClick={toggleBot}
            disabled={botSaving || botEnabled === null}
            className={`shrink-0 relative w-12 h-6 rounded-full transition-colors disabled:opacity-50 ${botEnabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
            title={botEnabled ? 'Desligar bot' : 'Ligar bot'}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${botEnabled ? 'translate-x-6' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
        </div>
      ) : instances.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-slate-700 rounded-lg">
          <p className="text-sm text-slate-400">Nenhum número conectado ainda.</p>
          <p className="text-xs text-slate-500 mt-1">Clique em "Conectar número" para adicionar o primeiro.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {instances.map(inst => (
            <div key={inst.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-800 bg-slate-950">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-100 truncate">{inst.displayName}</span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_COLOR[inst.status]}`}>
                    {STATUS_LABEL[inst.status]}
                  </span>
                </div>
                {inst.phoneNumber && (
                  <p className="text-xs text-slate-500 mt-0.5">+{inst.phoneNumber}</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {(inst.status === 'qrcode' || inst.status === 'disconnected' || inst.status === 'pending') && (
                  <button
                    onClick={() => refreshQR(inst.id)}
                    className="p-1.5 rounded text-amber-400 hover:bg-amber-500/20"
                    title="Ver QR Code"
                  >
                    <QrCode className="w-4 h-4" />
                  </button>
                )}
                {inst.status === 'connected' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                )}
                <button
                  onClick={() => removeInstance(inst.id)}
                  disabled={deletingId === inst.id}
                  className="p-1.5 rounded text-red-400 hover:bg-red-500/20 disabled:opacity-40"
                  title="Remover"
                >
                  {deletingId === inst.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add modal */}
      {adding && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => !creating && setAdding(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-slate-200">Conectar novo número</h4>
              <button onClick={() => !creating && setAdding(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Dê um nome ao número (ex: "Comercial", "Coordenação"). Depois você escaneará o QR code no celular.
            </p>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Nome do número"
              autoFocus
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-500"
              onKeyDown={e => e.key === 'Enter' && createInstance()}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setAdding(false)} disabled={creating} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
                Cancelar
              </button>
              <button
                onClick={createInstance}
                disabled={creating || newName.trim().length < 2}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {creating ? 'Criando...' : 'Criar e gerar QR'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR modal */}
      {qrModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setQrModal(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-slate-200 flex items-center gap-2">
                <QrCode className="w-4 h-4 text-amber-400" />
                Escaneie o QR Code
              </h4>
              <button onClick={() => setQrModal(null)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="text-xs text-slate-400 space-y-1 mb-3 list-decimal list-inside">
              <li>Abra o WhatsApp no celular</li>
              <li>Toque em <strong>Configurações → Dispositivos Conectados</strong></li>
              <li>Toque em <strong>Conectar um dispositivo</strong></li>
              <li>Aponte a câmera para o QR Code abaixo</li>
            </ol>
            {qrModal.qrCode ? (
              <div className="bg-white p-4 rounded-lg flex items-center justify-center">
                <img
                  src={qrModal.qrCode.startsWith('data:') ? qrModal.qrCode : `data:image/png;base64,${qrModal.qrCode}`}
                  alt="QR Code WhatsApp"
                  className="max-w-full"
                />
              </div>
            ) : (
              <div className="flex items-center justify-center py-10 border border-dashed border-slate-700 rounded-lg">
                <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
              </div>
            )}
            <button
              onClick={() => refreshQR(qrModal.instanceId)}
              className="w-full mt-3 flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Gerar novo QR
            </button>
            <p className="text-[10px] text-slate-500 text-center mt-2">
              O QR Code expira em ~60s. A página atualizará automaticamente após pareamento.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhatsAppInstancesPanel;
