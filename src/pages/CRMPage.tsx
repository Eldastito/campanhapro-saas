import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, UserPlus, Search, Calendar,
  MessageSquare, Phone, MapPin,
  Sparkles, Target, Activity,
  Filter, MoreVertical, Send, Upload, Zap
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  Tooltip as RechartsTooltip
} from 'recharts';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useProfilePermissions } from '../contexts/PermissionsContext';
import CustomFieldsRenderer from '../components/forms/CustomFieldsRenderer';
import { askCrmSpecialist } from '../services/agentsClientService';
import { logSubmissionGeo } from '../utils/geoTracking';
import { Brain, Loader2 } from 'lucide-react';
import CsvImportModal from '../components/crm/CsvImportModal';
import WhatsAppBlastModal from '../components/crm/WhatsAppBlastModal';
import { authedFetch } from '../lib/authedFetch';
import { usePlanStatus, isAiLocked } from '../hooks/usePlanStatus';
import UpgradeModal, { LockBadge } from '../components/plan/UpgradeModal';
import AiTrialCard from '../components/plan/AiTrialCard';

interface ClassifyContactsButtonProps {
  campaignId: string | undefined;
  onDone?: () => void;
}

const ClassifyContactsButton: React.FC<ClassifyContactsButtonProps> = ({ campaignId, onDone }) => {
  const [running, setRunning] = React.useState(false);
  const [showUpgrade, setShowUpgrade] = React.useState(false);
  const { status } = usePlanStatus();
  const locked = isAiLocked(status);

  const run = async () => {
    if (!campaignId) return;
    if (locked) { setShowUpgrade(true); return; }
    setRunning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/ai/classify-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ campaignId, limit: 30 }),
      });
      const json = await r.json();
      if (!r.ok) {
        // Backend pode devolver PLAN_BLOCKED — mostra o modal em vez de alert.
        if (json.code === 'PLAN_BLOCKED' || json.upgradeMessage) { setShowUpgrade(true); return; }
        throw new Error(json.error || `HTTP ${r.status}`);
      }
      alert(`✅ ${json.classified} de ${json.total} contatos classificados. A IA também sugeriu a próxima ação pra cada um — abra o contato pra ver.`);
      onDone?.();
    } catch (err: any) {
      alert(`Erro: ${err?.message || err}`);
    } finally {
      setRunning(false);
    }
  };
  return (
    <>
      <button
        onClick={run}
        disabled={running || !campaignId}
        className={`px-4 py-2 rounded-xl font-bold flex items-center gap-2 shadow-lg transition-all text-sm ${
          locked
            ? 'bg-purple-600/30 hover:bg-purple-600/40 text-purple-200 border border-purple-400/30'
            : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/20'
        } disabled:opacity-50`}
        title={locked ? 'Recurso do Plano Pro — clique para ver' : 'IA classifica os contatos em Apoiador/Indeciso/Opositor'}
      >
        {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
        Classificar com IA {locked && <LockBadge />}
      </button>
      <UpgradeModal open={showUpgrade} onClose={() => setShowUpgrade(false)} feature="ai_calls" />
    </>
  );
};

const CRMPage: React.FC = () => {
  const { user } = useAuth();
  const { config } = useProfilePermissions();
  const contactCustomDefs = (config?.customFields?.contacts as any[]) || [];
  // Campos nativos ocultados pelo Supreme Admin para esta campanha (Form Builder).
  const hiddenC: string[] = ((config?.customFields as any)?._hidden?.contacts) || [];
  const hideC = (k: string) => hiddenC.includes(k);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [generatingInsight, setGeneratingInsight] = useState(false);
  const [upgradeFor, setUpgradeFor] = useState<string | null>(null);
  const { status: planStatus } = usePlanStatus();
  const aiLocked = isAiLocked(planStatus);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterPauta, setFilterPauta] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<any | null>(null);
  const [isScriptModalOpen, setIsScriptModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);
  const [isBlastOpen, setIsBlastOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [newContact, setNewContact] = useState({
    name: '',
    phone: '',
    classification: 'Neutro',
    neighborhood: '',
    electoralZone: '',
    electoralSection: '',
    tags: [] as string[],
    // Funil / jornada (Fase A)
    funnelStage: 'capturado',
    voteIntention: '',
    voteCertainty: '' as string,
    objection: '',
    isMultiplier: false,
    influenceCount: 0,
    whatsappOptin: false,
    preferredChannel: '',
    source: 'crm_manual',  // origem/canal de aquisição (ROI por canal)
    customFields: {} as Record<string, any>,
  });

  const pautasInteresse = useMemo(() => {
    const counts: Record<string, number> = {};
    contacts.forEach(c => {
      if (c.tags && Array.isArray(c.tags)) {
        c.tags.forEach((tag: string) => {
          counts[tag] = (counts[tag] || 0) + 1;
        });
      }
    });

    const cores = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    return Object.entries(counts).map(([nome, contatos], idx) => ({
      nome,
      contatos,
      cor: cores[idx % cores.length]
    })).sort((a, b) => b.contatos - a.contatos);
  }, [contacts]);


  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      if (!user?.campaignId) return;
      const { data, error } = await supabase
        .from('contacts')
        .select(`
          *,
          voter_journey (
            currentStage,
            nextBestAction,
            nextActionReason,
            trustScore,
            engagementScore
          )
        `)
        .eq('campaignId', user.campaignId)
        .order('lastInteractionAt', { ascending: false });

      if (error) throw error;
      setContacts(data || []);
    } catch (err) {
      console.error("Erro ao carregar contatos:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredContacts = contacts.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.phone && c.phone.includes(searchTerm));
    const matchesCategory = filterCategory ? c.classification === filterCategory : true;
    const matchesPauta = filterPauta ? (c.tags && Array.isArray(c.tags) && c.tags.includes(filterPauta)) : true;

    return matchesSearch && matchesCategory && matchesPauta;
  });

  const openScriptModal = (contact: any) => {
    setSelectedContact(contact);
    setIsScriptModalOpen(true);
  };

  const generateAIRecommendation = async () => {
    if (aiLocked) { setUpgradeFor('ai_calls'); return; }
    setGeneratingInsight(true);
    try {
      const prompt = `Analise minha base de contatos com ${contacts.length} registros e me dê um insight estratégico rápido sobre quem focar hoje ou tendências detectadas.`;
      const response = await askCrmSpecialist(prompt, user?.campaignId);
      setAiInsight(typeof response === 'string' ? response : (response?.text || response?.content || JSON.stringify(response)));
    } catch (err: any) {
      // Backend pode devolver PLAN_BLOCKED
      if (err?.code === 'PLAN_BLOCKED' || err?.message?.includes?.('Plano')) { setUpgradeFor('ai_calls'); return; }
      setAiInsight("Não foi possível gerar um insight no momento.");
    } finally {
      setGeneratingInsight(false);
    }
  };

  const handleAddContact = async () => {
    if (!newContact.name?.trim()) {
      alert('Informe o nome do contato.');
      return;
    }
    if (!user?.campaignId) {
      alert('Sua sessão não tem uma campanha vinculada. Faça login novamente.');
      return;
    }
    try {
      const { data: created, error } = await supabase.from('contacts').insert([{
        ...newContact,
        campaignId: user.campaignId,
        createdAt: new Date().toISOString(),
        // coerções p/ colunas tipadas (evita '' em integer)
        voteCertainty: newContact.voteCertainty === '' ? null : Number(newContact.voteCertainty),
        voteIntention: newContact.voteIntention || null,
        objection: newContact.objection?.trim() || null,
        influenceCount: newContact.isMultiplier ? (Number(newContact.influenceCount) || 0) : 0,
      }]).select('id').single();

      if (error) throw error;

      // Log de geolocalização da submissão (não-bloqueante, anti-fraude).
      void logSubmissionGeo({
        campaignId: user.campaignId,
        userId: user.id ? String(user.id) : null,
        action: 'create_contact',
        targetTable: 'contacts',
        targetId: created?.id || null,
      });

      setIsAddModalOpen(false);
      setNewContact({ name: '', phone: '', classification: 'Neutro', neighborhood: '', electoralZone: '', electoralSection: '', tags: [], funnelStage: 'capturado', voteIntention: '', voteCertainty: '', objection: '', isMultiplier: false, influenceCount: 0, whatsappOptin: false, preferredChannel: '', source: 'crm_manual', customFields: {} });
      fetchContacts();
    } catch (err: any) {
      console.error("Erro ao adicionar contato:", err);
      const detail = err?.message || err?.error_description || JSON.stringify(err);
      alert(`Erro ao salvar contato.\n\nDetalhe: ${detail}`);
    }
  };

  const aniversariantesDoDia = contacts.filter(c => {
    if (!c.birthDate) return false;
    const today = new Date();
    const bday = new Date(c.birthDate);
    return today.getDate() === bday.getDate() && today.getMonth() === bday.getMonth();
  });

  return (
    <div className="p-6 bg-[#0a0a0b] min-h-screen text-white font-sans">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Users className="text-blue-400" /> CRM Inteligente
          </h1>
          <p className="text-gray-400">Gestão de eleitores e apoiadores assistida por IA.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 mr-2">
            <button
              onClick={() => setViewMode('table')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'table' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-white'}`}
              title="Visualização em Lista"
            >
              <Users className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'kanban' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-white'}`}
              title="Visualização em Kanban"
            >
              <Activity className="w-4 h-4" />
            </button>
          </div>
          <ClassifyContactsButton campaignId={user?.campaignId} onDone={fetchContacts} />
          {(() => {
            const limit = planStatus?.limits.whatsapp_per_day ?? planStatus?.limits.whatsappPerDay ?? 999999;
            const used = planStatus?.usage?.whatsappToday ?? 0;
            const remaining = Math.max(0, limit - used);
            const showCounter = limit < 999999;
            const exhausted = showCounter && remaining === 0;
            return (
              <button
                onClick={() => exhausted ? setUpgradeFor('whatsapp_blast') : setIsBlastOpen(true)}
                className="bg-emerald-700 hover:bg-emerald-600 px-4 py-2 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-emerald-700/20 transition-all text-sm"
                title={showCounter ? `Você tem ${remaining} de ${limit} disparos hoje` : 'Disparar mensagem em massa via WhatsApp'}
              >
                <Zap className="w-4 h-4" /> Disparar WA
                {showCounter && <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${exhausted ? 'bg-rose-500/30 text-rose-100' : 'bg-emerald-900/40 text-emerald-200'}`}>{used}/{limit}</span>}
              </button>
            );
          })()}
          <button
            onClick={() => setIsCsvImportOpen(true)}
            className="bg-indigo-700 hover:bg-indigo-600 px-4 py-2 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-700/20 transition-all text-sm"
          >
            <Upload className="w-4 h-4" /> Importar CSV
          </button>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-blue-600/20 transition-all"
          >
            <UserPlus className="w-4 h-4" /> Novo Contato
          </button>
        </div>
      </div>

      {/* Trial 24h IA — só pro plano grátis. Mostra progresso → elegível → ativo → expirado. */}
      <AiTrialCard className="mb-6" />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-[#161b22] p-6 rounded-3xl border border-white/5 relative overflow-hidden group">
          <div className="relative z-10">
            <div className="flex justify-between items-start mb-4">
              <Target className="text-blue-400 w-8 h-8" />
            </div>
            <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest">Base de Votos Úteis</h3>
            <p className="text-3xl font-black mt-1">{contacts.length}</p>
            <p className="text-[10px] text-gray-500 mt-2 italic">Contatos cadastrados</p>
          </div>
        </div>

        <div className="bg-[#161b22] p-6 rounded-3xl border border-white/5 relative overflow-hidden group">
          <div className="relative z-10">
            <Activity className="text-emerald-400 w-8 h-8 mb-4" />
            <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest">Taxa de Conversão</h3>
            <p className="text-3xl font-black mt-1">
              {contacts.length > 0 ? ((contacts.filter(c => c.classification === 'Apoiador').length / contacts.length) * 100).toFixed(1) : 0}%
            </p>
            <p className="text-[10px] text-gray-500 mt-2 italic">Indecisos → Apoiadores</p>
          </div>
        </div>

        <div className="bg-[#161b22] p-6 rounded-3xl border border-white/5 relative overflow-hidden group">
          <div className="relative z-10">
            <Calendar className="text-purple-400 w-8 h-8 mb-4" />
            <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest">Aniversariantes</h3>
            <p className="text-3xl font-black mt-1">{aniversariantesDoDia.length}</p>
            <button className="text-[10px] text-purple-400 font-bold mt-2 hover:underline">Ver lista e enviar WhatsApp →</button>
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-600/10 to-indigo-600/10 p-6 rounded-3xl border border-blue-500/20 relative flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-xs flex items-center gap-2 text-blue-300 uppercase tracking-widest">
              <Sparkles className="w-4 h-4" /> IA CRM Insight {aiLocked && <LockBadge />}
            </h3>
            <button
              onClick={generateAIRecommendation}
              disabled={generatingInsight}
              className="text-[10px] bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded-full border border-white/10"
            >
              {generatingInsight ? '...' : aiLocked ? 'Desbloquear' : 'Atualizar'}
            </button>
          </div>
          <div className="bg-black/20 rounded-xl p-3 border border-white/5 min-h-[60px]">
            <p className="text-[11px] text-gray-400 leading-tight italic">
              {aiLocked
                ? '🔒 Insights de IA estão no Plano Pro. Veja o que você está perdendo →'
                : aiInsight ? `"${aiInsight.substring(0, 80)}..."` : "Clique em atualizar para novas recomendações."}
            </p>
          </div>
        </div>
      </div>


      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-[#161b22] p-6 rounded-3xl border border-white/5">
            <div className="relative mb-6">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
              <input
                type="text"
                placeholder="Buscar eleitor..."
                className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">Sentimento da Base</h4>
            <div className="h-40 w-full mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Apoiadores', value: contacts.filter(c => c.classification === 'Apoiador' || c.classification === 'Multiplicador').length },
                      { name: 'Indecisos', value: contacts.filter(c => c.classification === 'Indeciso' || c.classification === 'Neutro').length },
                      { name: 'Rejeição', value: contacts.filter(c => c.classification === 'Rejeição').length },
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={55}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    <Cell fill="#10b981" />
                    <Cell fill="#3b82f6" />
                    <Cell fill="#ef4444" />
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontSize: '10px' }}
                    itemStyle={{ color: '#e6edf3' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="flex justify-between items-center mb-4">
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Classificação</h4>
              {(filterCategory || filterPauta) && (
                <button
                  onClick={() => { setFilterCategory(null); setFilterPauta(null); }}
                  className="text-[10px] text-blue-400 hover:text-blue-300"
                >
                  Limpar
                </button>
              )}
            </div>
            <div className="space-y-2">
              {['Multiplicador', 'Apoiador', 'Indeciso', 'Neutro', 'Rejeição'].map(cat => (
                <label
                  key={cat}
                  onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
                  className={`flex items-center justify-between group cursor-pointer p-1 rounded-lg transition-all ${filterCategory === cat ? 'bg-white/5 border border-white/10' : ''
                    }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${cat === 'Apoiador' ? 'bg-emerald-500' :
                      cat === 'Rejeição' ? 'bg-red-500' :
                        cat === 'Multiplicador' ? 'bg-yellow-500' : 'bg-blue-500'
                      }`} />
                    <span className={`text-sm ${filterCategory === cat ? 'text-white font-bold' : 'text-gray-400 group-hover:text-white'}`}>{cat}</span>
                  </div>
                  <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded-full text-gray-500">
                    {contacts.filter(c => c.classification === cat).length}
                  </span>
                </label>
              ))}
            </div>

            <hr className="my-6 border-white/5" />

            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Filter className="w-3 h-3" /> Pautas de Interesse
            </h4>
            <div className="flex flex-wrap gap-2 mb-6">
              {pautasInteresse.map(pauta => (
                <span
                  key={pauta.nome}
                  onClick={() => setFilterPauta(filterPauta === pauta.nome ? null : pauta.nome)}
                  className={`text-[9px] font-bold px-2 py-1 rounded-md border transition-all cursor-pointer ${filterPauta === pauta.nome
                    ? 'bg-blue-600 border-blue-400 text-white'
                    : 'bg-white/5 border-white/5 text-gray-400 hover:border-blue-500/50 hover:text-white'
                    }`}
                  style={{ borderLeft: filterPauta === pauta.nome ? undefined : `3px solid ${pauta.cor}` }}
                >
                  {pauta.nome} ({pauta.contatos})
                </span>
              ))}
            </div>


          </div>
        </div>

        <div className="lg:col-span-3">
          {viewMode === 'table' ? (
            <div className="bg-[#161b22] rounded-3xl border border-white/5 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-white/[0.02] border-b border-white/5">
                    <tr className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                      <th className="py-4 px-6">Eleitor</th>
                      <th className="py-4 px-6">Localização</th>
                      <th className="py-4 px-6">Status</th>
                      <th className="py-4 px-6">Pautas</th>
                      <th className="py-4 px-6 text-center">Último Contato</th>
                      <th className="py-4 px-6 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {loading ? (
                      <tr><td colSpan={6} className="py-10 text-center text-gray-500">Carregando CRM...</td></tr>
                    ) : filteredContacts.length === 0 ? (
                      <tr><td colSpan={6} className="py-20 text-center">
                        <Users className="w-12 h-12 text-gray-600 mx-auto mb-4 opacity-20" />
                        <p className="text-gray-500 italic">Nenhum contato encontrado para estes filtros.</p>
                      </td></tr>
                    ) : (
                      filteredContacts.map(contact => (
                        <tr key={contact.id} className="hover:bg-white/[0.02] transition-colors group">
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-sm">
                                {contact.name.charAt(0)}
                              </div>
                              <div>
                                <p className="font-bold text-sm group-hover:text-blue-400 transition-colors">{contact.name}</p>
                                <p className="text-[10px] text-gray-500 flex items-center gap-1">
                                  <Phone className="w-2 h-2" /> {contact.phone || 'Sem fone'}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1 text-xs text-gray-300">
                                <MapPin className="w-3 h-3 text-blue-400" /> {contact.neighborhood || 'Bairro N/I'}
                              </div>
                              <span className="text-[9px] text-gray-500">
                                {contact.electoralZone ? `Zona ${contact.electoralZone} • Seção ${contact.electoralSection}` : 'Zona/Seção N/I'}
                              </span>
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            <div className="flex flex-col gap-1">
                              <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase w-fit ${contact.classification === 'Apoiador' ? 'bg-emerald-500/10 text-emerald-400' :
                                contact.classification === 'Multiplicador' ? 'bg-yellow-500/10 text-yellow-400' :
                                  contact.classification === 'Rejeição' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
                                }`}>
                                {contact.classification}
                              </span>
                              {contact.voter_journey?.[0] && (
                                <span className="text-[9px] text-purple-400 font-bold bg-purple-500/10 px-2 py-0.5 rounded-full w-fit flex items-center gap-1">
                                  <Sparkles className="w-2 h-2" /> {contact.voter_journey[0].currentStage.replace('_', ' ')}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            <div className="flex flex-col gap-1">
                              <div className="flex flex-wrap gap-1 max-w-[150px]">
                                {contact.tags && Array.isArray(contact.tags) ? (
                                  contact.tags.map((t: string) => (
                                    <span key={t} className="text-[9px] bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded text-blue-400 font-medium">
                                      {t}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[9px] text-gray-600 italic">Nenhuma pauta</span>
                                )}
                              </div>
                              {contact.voter_journey?.[0]?.nextBestAction && (
                                <div className="text-[10px] text-emerald-400 font-bold mt-1 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20 animate-pulse">
                                  NBA: {contact.voter_journey[0].nextBestAction}
                                </div>
                              )}
                              {/* Ação acionável sugerida pelo classificador IA (#114).
                                  Curta (≤140 chars), com verbo no início. */}
                              {contact.nextAction && (
                                <div className="text-[10px] text-indigo-300 font-medium mt-1 bg-indigo-500/10 px-2 py-1 rounded border border-indigo-500/20" title={contact.supportReasoning || ''}>
                                  🎯 {contact.nextAction}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-6 text-center">
                            <p className="text-xs text-gray-500">
                              {contact.lastInteractionAt ? new Date(contact.lastInteractionAt).toLocaleDateString() : 'Nunca'}
                            </p>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => openScriptModal(contact)}
                                className="p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500 text-emerald-500 hover:text-white transition-all border border-emerald-500/20 group/btn"
                              >
                                <Send className="w-4 h-4" />
                              </button>
                              <button className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 transition-all border border-white/5">
                                <MoreVertical className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 h-[70vh] overflow-x-auto pb-4">
              {['Multiplicador', 'Apoiador', 'Neutro', 'Rejeição'].map((status) => (
                <div
                  key={status}
                  className="bg-black/20 rounded-3xl border border-white/5 flex flex-col min-w-[280px]"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async (e) => {
                    const contactId = e.dataTransfer.getData('contactId');
                    if (!contactId) return;
                    try {
                      const { error } = await supabase
                        .from('contacts')
                        .update({ classification: status })
                        .eq('id', contactId);
                      if (!error) fetchContacts();
                    } catch (err) { console.error(err); }
                  }}
                >
                  <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02] rounded-t-3xl">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${status === 'Apoiador' ? 'bg-emerald-500' :
                        status === 'Rejeição' ? 'bg-red-500' :
                          status === 'Multiplicador' ? 'bg-yellow-500' : 'bg-blue-500'
                        }`} />
                      {status}
                    </h4>
                    <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded-full text-gray-500 font-bold">
                      {filteredContacts.filter(c => c.classification === status).length}
                    </span>
                  </div>

                  <div className="p-3 flex-1 overflow-y-auto space-y-3 custom-scrollbar">
                    {filteredContacts.filter(c => c.classification === status).map(contact => (
                      <div
                        key={contact.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('contactId', contact.id)}
                        className="bg-[#1c2128] p-4 rounded-2xl border border-white/5 shadow-lg cursor-grab active:cursor-grabbing hover:border-blue-500/30 transition-all group"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <p className="font-bold text-xs group-hover:text-blue-400 transition-colors">{contact.name}</p>
                          <button onClick={() => openScriptModal(contact)} className="text-emerald-500 hover:scale-110 transition-all">
                            <Send className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-gray-500 mb-3">
                          <MapPin className="w-2.5 h-2.5 text-blue-400" /> {contact.neighborhood || 'N/I'}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-auto">
                          {(contact.tags || []).slice(0, 2).map((t: string) => (
                            <span key={t} className="text-[8px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/10">
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isScriptModalOpen && selectedContact && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#161b22] border border-white/10 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <MessageSquare className="text-emerald-400" /> Scripts para {selectedContact.name}
                </h3>
                <p className="text-xs text-gray-500">Sugestões personalizadas pela IA da Campanha.</p>
              </div>
              <button onClick={() => setIsScriptModalOpen(false)} className="text-gray-500 hover:text-white">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {[
                { titulo: 'Abordagem Inicial (Apoiador)', texto: `Olá ${selectedContact.name}, aqui é da equipe do candidato. Estamos passando para agradecer seu apoio no bairro ${selectedContact.neighborhood || 'seu bairro'}!` },
                { titulo: 'Pauta: Saúde e Bem-estar', texto: `Oi ${selectedContact.name}, vimos que você se interessa por Saúde. O candidato acabou de lançar uma proposta sobre o novo hospital regional...` },
                { titulo: 'Convite para Reunião', texto: `Tudo bem, ${selectedContact.name}? Teremos uma reunião estratégica com multiplicadores nesta quinta. Contamos com sua presença!` }
              ].map((script, idx) => (
                <ScriptSendCard key={idx} script={script} contact={selectedContact} />
              ))}
            </div>
          </div>
        </div>
      )}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#161b22] border border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
              <h3 className="font-bold text-lg">Novo Contato Inteligente</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-gray-500 hover:text-white">✕</button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] text-gray-500 font-bold uppercase">Nome Completo</label>
                  <input
                    type="text"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="Ex: João da Silva"
                    value={newContact.name}
                    onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 font-bold uppercase">WhatsApp / Telefone</label>
                  <input
                    type="text"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="(00) 00000-0000"
                    value={newContact.phone}
                    onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-4">
                {!hideC('neighborhood') && (
                <div>
                  <label className="text-[10px] text-gray-500 font-bold uppercase">Bairro</label>
                  <input
                    type="text"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="Ex: Centro"
                    value={newContact.neighborhood}
                    onChange={(e) => setNewContact({ ...newContact, neighborhood: e.target.value })}
                  />
                </div>
                )}
                {!hideC('zonaSecao') && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] text-gray-500 font-bold uppercase">Zona</label>
                    <input
                      type="text"
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
                      placeholder="Ex: 142"
                      value={newContact.electoralZone}
                      onChange={(e) => setNewContact({ ...newContact, electoralZone: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 font-bold uppercase">Seção</label>
                    <input
                      type="text"
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
                      placeholder="Ex: 04"
                      value={newContact.electoralSection}
                      onChange={(e) => setNewContact({ ...newContact, electoralSection: e.target.value })}
                    />
                  </div>
                </div>
                )}

                {/* ===== Funil / Jornada do eleitor (alimenta a IA) ===== */}
                {!hideC('funil') && (
                <div className="pt-3 mt-1 border-t border-white/5">
                  <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest mb-3">Funil de Conversão (para a IA)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] text-gray-500 font-bold uppercase">Intenção de voto</label>
                      <select
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                        value={newContact.voteIntention}
                        onChange={(e) => setNewContact({ ...newContact, voteIntention: e.target.value })}
                      >
                        <option value="">—</option>
                        <option value="apoia">Já apoia</option>
                        <option value="vai_votar">Vai votar</option>
                        <option value="indeciso">Indeciso</option>
                        <option value="rejeita">Rejeita</option>
                        <option value="nao_disse">Não disse</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 font-bold uppercase">Certeza do voto (0–10)</label>
                      <select
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                        value={newContact.voteCertainty}
                        onChange={(e) => setNewContact({ ...newContact, voteCertainty: e.target.value })}
                      >
                        <option value="">—</option>
                        {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className="text-[10px] text-gray-500 font-bold uppercase">Estágio no funil</label>
                      <select
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                        value={newContact.funnelStage}
                        onChange={(e) => setNewContact({ ...newContact, funnelStage: e.target.value })}
                      >
                        <option value="capturado">Capturado</option>
                        <option value="qualificado">Qualificado</option>
                        <option value="relacionamento">Relacionamento</option>
                        <option value="comprometido">Comprometido</option>
                        <option value="multiplicador">Multiplicador</option>
                        <option value="votante">Votante</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 font-bold uppercase">Canal preferido</label>
                      <select
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                        value={newContact.preferredChannel}
                        onChange={(e) => setNewContact({ ...newContact, preferredChannel: e.target.value })}
                      >
                        <option value="">—</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="ligacao">Ligação</option>
                        <option value="presencial">Presencial</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="text-[10px] text-gray-500 font-bold uppercase">Origem do contato (de onde veio)</label>
                    <select
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                      value={newContact.source}
                      onChange={(e) => setNewContact({ ...newContact, source: e.target.value })}
                    >
                      <option value="crm_manual">Cadastro manual</option>
                      <option value="indicacao">Indicação</option>
                      <option value="evento">Evento / comício</option>
                      <option value="visita">Visita porta a porta</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="redes_sociais">Redes sociais</option>
                      <option value="public_form">Formulário público</option>
                      <option value="pesquisa">Pesquisa</option>
                      <option value="outro">Outro</option>
                    </select>
                    <p className="text-[9px] text-gray-600 mt-1">Alimenta o ROI por canal (custo por lead) na análise da IA.</p>
                  </div>

                  {(newContact.voteIntention === 'indeciso' || newContact.voteIntention === 'rejeita') && (
                    <div className="mt-4">
                      <label className="text-[10px] text-gray-500 font-bold uppercase">Objeção / barreira</label>
                      <input
                        type="text"
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
                        placeholder="Por que está indeciso / rejeita?"
                        value={newContact.objection}
                        onChange={(e) => setNewContact({ ...newContact, objection: e.target.value })}
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-4 mt-4">
                    <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                      <input type="checkbox" className="accent-blue-500" checked={newContact.isMultiplier}
                        onChange={(e) => setNewContact({ ...newContact, isMultiplier: e.target.checked })} />
                      É multiplicador (influencia outros)
                    </label>
                    {newContact.isMultiplier && (
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] text-gray-500 font-bold uppercase">Influencia ~</label>
                        <input type="number" min={0}
                          className="w-20 bg-black/40 border border-white/10 rounded-xl px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                          value={newContact.influenceCount}
                          onChange={(e) => setNewContact({ ...newContact, influenceCount: Number(e.target.value) })} />
                        <span className="text-[10px] text-gray-500">pessoas</span>
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                      <input type="checkbox" className="accent-blue-500" checked={newContact.whatsappOptin}
                        onChange={(e) => setNewContact({ ...newContact, whatsappOptin: e.target.checked })} />
                      Autoriza contato no WhatsApp
                    </label>
                  </div>
                </div>
                )}
              </div>
            </div>
            {contactCustomDefs.length > 0 && (
              <div className="px-6 pb-4">
                <CustomFieldsRenderer
                  fields={contactCustomDefs}
                  values={newContact.customFields}
                  onChange={(id, val) => setNewContact({ ...newContact, customFields: { ...newContact.customFields, [id]: val } })}
                />
              </div>
            )}
            <div className="p-6 bg-white/[0.02] border-t border-white/5 flex gap-3">
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="flex-1 px-4 py-2 rounded-xl border border-white/10 hover:bg-white/5 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddContact}
                className="flex-1 bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-xl font-bold transition-all shadow-lg shadow-blue-600/20"
              >
                Salvar Eleitor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {isCsvImportOpen && user?.campaignId && (
        <CsvImportModal
          campaignId={user.campaignId}
          onDone={(_count) => { fetchContacts(); }}
          onClose={() => setIsCsvImportOpen(false)}
        />
      )}

      {/* WhatsApp Blast Modal */}
      {isBlastOpen && user?.campaignId && (
        <WhatsAppBlastModal
          totalContactsAll={contacts.length}
          onClose={() => setIsBlastOpen(false)}
        />
      )}

      {/* Modal de upgrade — Opção C (confronto + medo de perder) */}
      <UpgradeModal open={!!upgradeFor} onClose={() => setUpgradeFor(null)} feature={upgradeFor || 'default'} />
    </div>
  );
};

/**
 * Card de envio de script via Evolution API (mesmo padrão do Telemarketing
 * Ativo do Call Center). Substituiu o `window.open('https://wa.me/…')` antigo
 * — agora a mensagem vai pela instância da campanha, aparece na Caixa de
 * Entrada como outbound e participa do funil do call center.
 */
const ScriptSendCard: React.FC<{
  script: { titulo: string; texto: string };
  contact: { id?: string; name?: string; phone?: string | null };
}> = ({ script, contact }) => {
  const [status, setStatus] = React.useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errMsg, setErrMsg] = React.useState<string>('');

  const send = async () => {
    if (!contact.phone) { setStatus('error'); setErrMsg('Contato sem telefone.'); return; }
    setStatus('sending'); setErrMsg('');
    try {
      const r = await authedFetch('/api/v1/channels/send', {
        method: 'POST',
        body: JSON.stringify({
          channel: 'whatsapp',
          to: contact.phone.replace(/\D/g, ''),
          text: script.texto,
          contactId: contact.id,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({} as any));
        throw new Error(j?.error || `HTTP ${r.status}`);
      }
      setStatus('sent');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e: any) {
      setStatus('error');
      setErrMsg(e?.message ?? 'Falha ao enviar.');
    }
  };

  const label = status === 'sending' ? 'Enviando…'
    : status === 'sent' ? '✅ Enviado'
    : status === 'error' ? 'Tentar de novo'
    : 'Enviar via WhatsApp';
  const colorCls = status === 'sent' ? 'bg-emerald-700 hover:bg-emerald-700'
    : status === 'error' ? 'bg-rose-600 hover:bg-rose-500'
    : 'bg-emerald-600 hover:bg-emerald-500';

  return (
    <div className="bg-black/40 border border-white/5 p-4 rounded-2xl group hover:border-emerald-500/30 transition-all">
      <h4 className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-2">{script.titulo}</h4>
      <p className="text-sm text-gray-300 italic mb-4">"{script.texto}"</p>
      <button
        onClick={send}
        disabled={status === 'sending' || status === 'sent'}
        className={`w-full ${colorCls} disabled:opacity-70 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all`}
      >
        {status === 'sending' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} {label}
      </button>
      {status === 'error' && errMsg && (
        <p className="text-[10px] text-rose-400 mt-1.5">{errMsg}{/^no_/.test(errMsg) || /conect/i.test(errMsg) ? ' Verifique a conexão do WhatsApp em Recursos.' : ''}</p>
      )}
      {status === 'sent' && (
        <p className="text-[10px] text-emerald-400 mt-1.5">Mensagem entrou na Caixa de Entrada como outbound.</p>
      )}
    </div>
  );
};

export default CRMPage;
