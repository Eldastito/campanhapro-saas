import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  Instagram,
  Facebook,
  Video,
  CheckCircle2,
  AlertCircle,
  Link2,
  Settings,
  RefreshCw,
  X,
  Key,
  Database,
  HelpCircle,
  BookOpen,
  Twitter,
  Linkedin,
  Sparkles
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import WhatsAppInstancesPanel from './WhatsAppInstancesPanel';
import SocialScenariosPanel from './SocialScenariosPanel';
import WhatsappRoutingPanel from './WhatsappRoutingPanel';

async function authFetch(url: string, init: RequestInit = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const r = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

interface ConnectionStatus {
  provider: string;
  connected: boolean;
  lastUpdated?: string;
  settings?: any;
}

export const SocialConnectionsHub: React.FC = () => {
  const { user } = useAuth();
  const [connections, setConnections] = useState<Record<string, ConnectionStatus>>({
    whatsapp: { provider: 'whatsapp', connected: false },
    instagram: { provider: 'instagram', connected: false },
    facebook: { provider: 'facebook', connected: false },
    tiktok: { provider: 'tiktok', connected: false },
    x: { provider: 'x', connected: false },
    linkedin: { provider: 'linkedin', connected: false },
    kwai: { provider: 'kwai', connected: false },
  });
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [waSettings, setWaSettings] = useState({ phoneNumberId: '', wabaId: '' });
  const [manualSettings, setManualSettings] = useState({ accessToken: '', accountId: '' });
  const [kwaiHandle, setKwaiHandle] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [analyzingIA, setAnalyzingIA] = useState(false);

  useEffect(() => {
    if (configuring === 'whatsapp' && connections.whatsapp?.settings) {
      setWaSettings({
        phoneNumberId: connections.whatsapp.settings.phoneNumberId || '',
        wabaId: connections.whatsapp.settings.wabaId || ''
      });
    } else if (configuring && connections[configuring]?.settings) {
      setManualSettings({
        accessToken: connections[configuring].settings.accessToken || '',
        accountId: connections[configuring].settings.accountId || ''
      });
    } else {
      setManualSettings({ accessToken: '', accountId: '' });
    }
  }, [configuring, connections]);

  useEffect(() => {
    fetchConnections();
  }, []);

  const fetchConnections = async () => {
    if (!user?.campaignId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('social_tokens')
        .select('*')
        .eq('campaignId', user.campaignId);

      if (error) throw error;

      const newStatus: Record<string, ConnectionStatus> = {
        whatsapp: { provider: 'whatsapp', connected: false },
        instagram: { provider: 'instagram', connected: false },
        facebook: { provider: 'facebook', connected: false },
        tiktok: { provider: 'tiktok', connected: false },
        x: { provider: 'x', connected: false },
        linkedin: { provider: 'linkedin', connected: false },
        kwai: { provider: 'kwai', connected: false },
      };

      data?.forEach((token: any) => {
        if (token.provider === 'meta') {
          newStatus.facebook = { provider: 'facebook', connected: true, lastUpdated: token.updatedAt, settings: token.settings };
          newStatus.instagram = { provider: 'instagram', connected: true, lastUpdated: token.updatedAt, settings: token.settings };
          newStatus.whatsapp = { provider: 'whatsapp', connected: true, lastUpdated: token.updatedAt, settings: token.settings };
        } else if (newStatus[token.provider]) {
          newStatus[token.provider] = {
            provider: token.provider,
            connected: true,
            lastUpdated: token.updatedAt,
            settings: token.settings
          };
        }
      });
      setConnections(newStatus);
    } catch (err) {
      console.error('Erro ao carregar conexões:', err);
    } finally {
      setLoading(false);
    }
  };

  const saveManualConnection = async (provider: string) => {
    if (!user?.campaignId) return;
    
    try {
      const { error } = await supabase
        .from('social_tokens')
        .upsert({
          campaignId: user.campaignId,
          provider: provider === 'facebook' || provider === 'instagram' ? 'meta' : provider,
          token: manualSettings.accessToken,
          settings: { 
            accessToken: manualSettings.accessToken, 
            accountId: manualSettings.accountId 
          },
          updatedAt: new Date().toISOString()
        }, { onConflict: 'campaignId,provider' });

      if (error) throw error;
      
      alert(`Conexão com ${provider} salva com sucesso!`);
      setConfiguring(null);
      fetchConnections();
    } catch (err) {
      console.error('Erro ao salvar conexão:', err);
      alert('Erro ao salvar dados de conexão.');
    }
  };

  const saveSettings = async (provider: string, settings: any) => {
    if (!user?.campaignId) return;
    
    try {
      const { error } = await supabase
        .from('social_tokens')
        .update({ settings, updatedAt: new Date().toISOString() })
        .eq('campaignId', user.campaignId)
        .eq('provider', provider === 'whatsapp' ? 'meta' : provider);

      if (error) throw error;
      
      alert('Configurações salvas com sucesso!');
      setConfiguring(null);
      fetchConnections();
    } catch (err) {
      console.error('Erro ao salvar configurações:', err);
      alert('Falha ao salvar. Certifique-se de que a conta está conectada.');
    }
  };

  // ── OAuth & Kwai handlers (#123) ─────────────────────────────────────
  const startOAuth = async (provider: 'x' | 'linkedin') => {
    try {
      const { authorizeUrl } = await authFetch(`/api/v1/social/connect/${provider}/start`, { method: 'POST' });
      window.location.href = authorizeUrl;
    } catch (err: any) {
      alert(`Não consegui iniciar a conexão com ${provider}: ${err?.message || 'erro'}\n\nDica: cheque se o admin do projeto configurou as variáveis de ambiente do provedor.`);
    }
  };

  const connectKwai = async () => {
    if (!kwaiHandle.trim()) return alert('Informe o @ ou URL do perfil Kwai.');
    try {
      const res = await authFetch('/api/v1/social/connect/kwai', {
        method: 'POST',
        body: JSON.stringify({ handleOrUrl: kwaiHandle.trim() }),
      });
      alert(`Perfil Kwai conectado: @${res.handle}`);
      setConfiguring(null);
      setKwaiHandle('');
      fetchConnections();
    } catch (err: any) {
      alert(`Falha ao conectar Kwai: ${err?.message || 'erro'}`);
    }
  };

  const syncProvider = async (provider: string) => {
    setSyncingProvider(provider);
    try {
      await authFetch(`/api/v1/social/sync/${provider}`, { method: 'POST' });
      alert(`Sincronização de ${provider} concluída. Os agentes IA já podem analisar.`);
      fetchConnections();
    } catch (err: any) {
      alert(`Falha ao sincronizar ${provider}: ${err?.message || 'erro'}`);
    } finally {
      setSyncingProvider(null);
    }
  };

  const analyzeWithIA = async () => {
    setAnalyzingIA(true);
    try {
      await authFetch('/api/v1/social/analyze', { method: 'POST', body: JSON.stringify({}) });
      alert('Análise iniciada. O orquestrador delegou pros agentes (Estrategista, Social Media, Growth Hacker). Acompanhe no Quartel General > Histórico.');
    } catch (err: any) {
      alert(`Falha ao iniciar análise: ${err?.message || 'erro'}`);
    } finally {
      setAnalyzingIA(false);
    }
  };

  const providers = [
    { id: 'whatsapp', name: 'WhatsApp Business', icon: MessageSquare, color: '#25D366',
      desc: 'Envio de convites e gestão de bases via API Cloud.', requiresSettings: true, mode: 'manual' as const },
    { id: 'instagram', name: 'Instagram', icon: Instagram, color: '#E4405F',
      desc: 'Análise de engajamento e resposta automática a comentários.', mode: 'manual' as const },
    { id: 'facebook', name: 'Facebook Pages', icon: Facebook, color: '#1877F2',
      desc: 'Gestão de anúncios e posts na página oficial.', mode: 'manual' as const },
    { id: 'tiktok', name: 'TikTok for Business', icon: Video, color: '#000000',
      desc: 'Monitoramento de trends e performance de vídeos.', mode: 'manual' as const },
    { id: 'x', name: 'X (Twitter)', icon: Twitter, color: '#1DA1F2',
      desc: 'OAuth oficial — métricas do perfil, posts recentes, engajamento.', mode: 'oauth' as const },
    { id: 'linkedin', name: 'LinkedIn (Company Page)', icon: Linkedin, color: '#0A66C2',
      desc: 'OAuth oficial — perfil + métricas da Company Page do candidato.', mode: 'oauth' as const },
    { id: 'kwai', name: 'Kwai (perfil público)', icon: Video, color: '#FF6B00',
      desc: 'Leitura pública do perfil — seguidores, vídeos, engajamento estimado.', mode: 'kwai' as const },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-slate-900/50 p-4 rounded-xl border border-slate-700/50 mb-2">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
            <Link2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Integração de APIs</h3>
            <p className="text-xs text-slate-400">Conecte as redes sociais para postagem automática.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={analyzeWithIA}
            disabled={analyzingIA}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-purple-500/20"
            title="Dispara orquestrador IA com snapshots das redes sociais"
          >
            <Sparkles className={`w-4 h-4 ${analyzingIA ? 'animate-spin' : ''}`} />
            {analyzingIA ? 'INICIANDO...' : 'ANALISAR COM IA'}
          </button>
          <button
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-indigo-500/20"
          >
            <HelpCircle className="w-4 h-4" />
            TOKENS
          </button>
        </div>
      </div>

      <WhatsAppInstancesPanel />

      <WhatsappRoutingPanel />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {providers.map((p) => {
          const status = connections[p.id];
          return (
            <div 
              key={p.id}
              className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 hover:border-slate-600 transition-all"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div 
                    className="p-2 rounded-lg"
                    style={{ backgroundColor: `${p.color}20`, color: p.color }}
                  >
                    <p.icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{p.name}</h3>
                    <p className="text-xs text-slate-400">{p.desc}</p>
                  </div>
                </div>
                {status.connected ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full">
                    <CheckCircle2 className="w-3 h-3" />
                    Ativo
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-400/10 px-2 py-1 rounded-full">
                    <AlertCircle className="w-3 h-3" />
                    Pendente
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {p.mode === 'oauth' && !status.connected ? (
                  <button
                    onClick={() => startOAuth(p.id as 'x' | 'linkedin')}
                    className="flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                  >
                    <Link2 className="w-4 h-4" />
                    Conectar via OAuth
                  </button>
                ) : p.mode === 'kwai' && !status.connected ? (
                  <button
                    onClick={() => setConfiguring(p.id)}
                    className="flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Informar perfil público
                  </button>
                ) : (
                  <button
                    onClick={() => setConfiguring(p.id)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                      status.connected ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
                    }`}
                  >
                    <Settings className="w-4 h-4" />
                    {status.connected ? 'Configurar' : 'Conectar via API'}
                  </button>
                )}
                {status.connected && (p.mode === 'oauth' || p.mode === 'kwai') && (
                  <button
                    onClick={() => syncProvider(p.id)}
                    disabled={syncingProvider === p.id}
                    className="p-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg transition-colors"
                    title="Sincronizar agora"
                  >
                    <RefreshCw className={`w-4 h-4 ${syncingProvider === p.id ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>
              
              {status.lastUpdated && (
                <p className="text-[10px] text-slate-500 mt-3 italic">
                  Última sincronização: {new Date(status.lastUpdated).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <SocialScenariosPanel />

      {/* Modal de Configuração Genérico */}
      {configuring && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-300">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-600" />
            
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg">
                    <Settings className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-bold text-white">Configurar {providers.find(p => p.id === configuring)?.name}</h3>
              </div>
              <button onClick={() => setConfiguring(null)} className="text-slate-500 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>

            {configuring === 'kwai' ? (
              <div className="space-y-4">
                <p className="text-sm text-slate-400 leading-relaxed">
                  Cole o <b>@usuário</b> ou a <b>URL</b> do perfil público do candidato no Kwai. Vamos ler os dados públicos (seguidores, vídeos, bio).
                </p>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Perfil Kwai</label>
                  <div className="relative">
                    <Video className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                    <input
                      type="text"
                      value={kwaiHandle}
                      onChange={(e) => setKwaiHandle(e.target.value)}
                      placeholder="@candidato ou https://kwai.com/@candidato"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-orange-500 outline-none transition-all placeholder:text-slate-700"
                    />
                  </div>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-[11px] text-amber-200/80">
                  ⚠️ Kwai não tem API pública. Lemos via scraping leve do perfil público. Se o Kwai mudar o HTML, pode quebrar — a IA é avisada.
                </div>
              </div>
            ) : configuring === 'whatsapp' ? (
              <div className="space-y-4">
                <p className="text-sm text-slate-400 leading-relaxed">
                  Insira os identificadores da sua conta na <b>Meta Business Cloud API</b> para habilitar o envio de mensagens.
                </p>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Phone Number ID</label>
                  <div className="relative">
                    <Database className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                    <input 
                      type="text" 
                      value={waSettings.phoneNumberId}
                      onChange={(e) => setWaSettings(prev => ({ ...prev, phoneNumberId: e.target.value }))}
                      placeholder="Ex: 1056345892..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-700"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">WABA ID (Business Account)</label>
                  <div className="relative">
                    <Database className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                    <input 
                      type="text" 
                      value={waSettings.wabaId}
                      onChange={(e) => setWaSettings(prev => ({ ...prev, wabaId: e.target.value }))}
                      placeholder="Ex: 2394857203..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-700"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-slate-400 leading-relaxed">
                  Forneça o <b>Access Token</b> e o <b>Account ID</b> da sua conta profissional para integração direta.
                </p>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Access Token</label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                    <input 
                      type="password" 
                      value={manualSettings.accessToken}
                      onChange={(e) => setManualSettings(prev => ({ ...prev, accessToken: e.target.value }))}
                      placeholder="Cole o token de acesso aqui..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-700"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Account / Page ID</label>
                  <div className="relative">
                    <Database className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                    <input 
                      type="text" 
                      value={manualSettings.accountId}
                      onChange={(e) => setManualSettings(prev => ({ ...prev, accountId: e.target.value }))}
                      placeholder="ID da página ou conta..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-700"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 mt-8">
              <button 
                onClick={() => setConfiguring(null)}
                className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (configuring === 'kwai') return connectKwai();
                  if (configuring === 'whatsapp') return saveSettings('whatsapp', waSettings);
                  return saveManualConnection(configuring!);
                }}
                className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-95"
              >
                Salvar Configurações
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal de Ajuda / Manual */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[60] p-4 animate-in fade-in zoom-in-95 duration-300">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl">
                  <BookOpen className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-white">Manual de Conexão API</h3>
              </div>
              <button onClick={() => setShowHelp(false)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-all">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
              <div className="prose prose-invert max-w-none space-y-8">
                <section>
                  <h4 className="flex items-center gap-2 text-indigo-400 font-bold text-lg mb-4">
                    <Facebook className="w-5 h-5" /> Facebook & Instagram (Meta)
                  </h4>
                  <div className="bg-slate-800/50 rounded-2xl p-5 border border-slate-700/50 space-y-4">
                    <p className="text-sm text-slate-300 leading-relaxed">
                      Utilizamos a <b>Meta Cloud API</b>. Você precisará criar um aplicativo no portal de desenvolvedores.
                    </p>
                    <div className="space-y-3">
                      <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-1">1</div>
                        <p className="text-xs text-slate-400">Acesse o <b>Meta for Developers</b> e crie um App do tipo "Negócios".</p>
                      </div>
                      <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-1">2</div>
                        <p className="text-xs text-slate-400">Gere um <b>Access Token de Longa Duração</b> com as permissões <i>pages_manage_posts</i> e <i>instagram_content_publish</i>.</p>
                      </div>
                      <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-1">3</div>
                        <p className="text-xs text-slate-400">O <b>Page ID</b> é o identificador numérico da sua página profissional.</p>
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <h4 className="flex items-center gap-2 text-emerald-400 font-bold text-lg mb-4">
                    <MessageSquare className="w-5 h-5" /> WhatsApp Business
                  </h4>
                  <div className="bg-slate-800/50 rounded-2xl p-5 border border-slate-700/50 space-y-4">
                    <div className="space-y-3">
                      <p className="text-xs text-slate-300"><b>Phone Number ID:</b> Identificador único do seu número na Meta.</p>
                      <p className="text-xs text-slate-300"><b>WABA ID:</b> Identificador da sua conta de negócios do WhatsApp.</p>
                    </div>
                  </div>
                </section>

                <section>
                  <h4 className="flex items-center gap-2 text-white font-bold text-lg mb-4">
                    <Video className="w-5 h-5" /> TikTok for Business
                  </h4>
                  <div className="bg-slate-800/50 rounded-2xl p-5 border border-slate-700/50">
                    <p className="text-sm text-slate-300">Acesse o <b>TikTok for Developers</b>, crie um App e habilite as permissões de upload de vídeo para obter seu token e o ID da conta profissional.</p>
                  </div>
                </section>

                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5 flex gap-4">
                  <AlertCircle className="w-6 h-6 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-amber-500 mb-1">Atenção com a Segurança</p>
                    <p className="text-xs text-amber-200/70">Nunca compartilhe seus tokens. Eles permitem postagens diretas em suas redes. Recomendamos o uso de <b>Tokens de Sistema</b> para conexões permanentes.</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="p-6 bg-slate-950/50 border-t border-slate-800 flex justify-end">
              <button 
                onClick={() => setShowHelp(false)}
                className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl transition-all"
              >
                Entendi, vamos conectar!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
