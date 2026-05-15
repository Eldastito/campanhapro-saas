import React, { useState, useEffect, useCallback } from 'react';
import { Bot, TrendingUp, Share2, Map, Send, Loader2, LayoutDashboard, Ticket, ArrowRight, CheckCircle2, Link as LinkIcon, ShieldCheck, Sparkles as SparklesIcon, History, Shield, Zap, X, BellRing, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { askStrategist, askGrowthHacker, askSocialMedia, askFieldCommander, askCreativeProducer, askBackupAgent, askFraudAuditor, runFullPipeline, getPipelineHistory, PipelineResult, generateCreativeImage, createProductionOrder, publishToSocialMedia } from '../services/agentsClientService';
import { createBackup, restoreBackup, BackupData } from '../services/backupService';
import { useAuth } from '../contexts/AuthContext';
import { useProfilePermissions } from '../contexts/PermissionsContext';
import { useAutoPipeline, AutoPipelineNotification } from '../hooks/useAutoPipeline';
import Button from '../components/ui/Button';
import { AlertCircle } from 'lucide-react';
import { SocialConnectionsHub } from '../components/resources/SocialConnectionsHub';
import ManagerRoom from '../components/agents/ManagerRoom';

import { useAgentStore } from '../stores/useAgentStore';

const AgentsHQPage: React.FC = () => {
    const { user } = useAuth();
    const { config } = useProfilePermissions();
    const { activeTab, setActiveTab } = useAgentStore();
    const [isHydrated, setIsHydrated] = useState(false);

    useEffect(() => {
        // Zustand persist hydration check
        const unsub = useAgentStore.persist.onHydrate(() => setIsHydrated(false));
        const unsubFinish = useAgentStore.persist.onFinishHydration(() => setIsHydrated(true));
        
        // Se já estiver hidratado (navegação interna)
        if (useAgentStore.persist.hasHydrated()) {
            setIsHydrated(true);
        }

        return () => {
            unsub();
            unsubFinish();
        };
    }, []);

    useEffect(() => {
        if (isHydrated) {
            console.log("[AgentsHQ] Store hidratado. Aba ativa:", activeTab);
        }
    }, [isHydrated, activeTab]);
    const [currentUsage, setCurrentUsage] = useState(0);
    const [isLimitExceeded, setIsLimitExceeded] = useState(false);
    const [pendingContext, setPendingContext] = useState<string | null>(null);
    const [autoPipelineEnabled, setAutoPipelineEnabled] = useState(true);
    const [notifications, setNotifications] = useState<AutoPipelineNotification[]>([]);

    const handleProductionHandoff = async (origin: string, target: string, content: string) => {
        try {
            await createProductionOrder(user?.campaignId || 'default', origin, target, content);
            setPendingContext(content);
            setActiveTab(target as any);
        } catch (err) {
            console.error("Erro ao criar ordem de produção:", err);
            setPendingContext(content);
            setActiveTab(target as any);
        }
    };
    const handlePublishToSocial = async (content: string, mediaUrl?: string) => {
        if (!user?.campaignId) return;
        
        const activePlatforms = Object.entries(connections)
            .filter(([_, active]) => active)
            .map(([name]) => name);

        if (activePlatforms.length === 0) {
            alert("Nenhuma rede social conectada! Vá na aba 'Conexões' primeiro.");
            return;
        }

        const confirmPost = confirm(`Deseja publicar este conteúdo no ${activePlatforms.join(', ')}?`);
        if (!confirmPost) return;

        try {
            const result = await publishToSocialMedia(user.campaignId, activePlatforms, content, mediaUrl);
            alert(result.message);
        } catch (err) {
            alert("Erro ao publicar: " + (err as any).message);
        }
    };

    const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
    const [connections, setConnections] = useState({
        instagram: false,
        facebook: false,
        whatsapp: false,
        tiktok: false
    });

    const fetchConnections = useCallback(async () => {
        if (!user?.campaignId) return;
        try {
            const { data } = await supabase.from('social_tokens').select('provider').eq('campaignId', user.campaignId);
            const newConn = { instagram: false, facebook: false, whatsapp: false, tiktok: false };
            data?.forEach((t: { provider: string }) => {
                if (t.provider === 'meta') {
                    newConn.instagram = true; newConn.facebook = true; newConn.whatsapp = true;
                } else if (t.provider in newConn) {
                    (newConn as any)[t.provider] = true;
                }
            });
            setConnections(newConn);
        } catch (e) { console.error(e); }
    }, [user?.campaignId]);

    useEffect(() => {
        fetchConnections();
    }, [fetchConnections, activeTab]);

    const handleNotification = useCallback((notif: AutoPipelineNotification) => {
        setNotifications(prev => {
            const exists = prev.find(n => n.id === notif.id);
            if (exists) return prev.map(n => n.id === notif.id ? notif : n);
            return [notif, ...prev].slice(0, 5);
        });
        if (notif.type !== 'running') {
            setTimeout(() => {
                setNotifications(prev => prev.filter(n => n.id !== notif.id));
            }, 8000);
        }
    }, []);

    const { runManualPipeline } = useAutoPipeline({
        campaignId: user?.campaignId,
        enabled: autoPipelineEnabled,
        onNotification: handleNotification
    });

    useEffect(() => {
        if (!user?.campaignId) return;

        const fetchData = async () => {
            const { count, error } = await supabase
                .from('agent_outputs')
                .select('*', { count: 'exact', head: true })
                .eq('campaignId', user.campaignId);
            
            if (error) {
                console.error("Erro ao buscar contagem:", error);
                return;
            }

            const countVal = count || 0;
            setCurrentUsage(countVal);
            if (config?.limits.aiCalls && countVal >= config.limits.aiCalls) {
                setIsLimitExceeded(true);
            } else {
                setIsLimitExceeded(false);
            }
        };

        fetchData();

        const channelId = `agent-outputs-${user.campaignId}`;
        const channel = supabase.channel(channelId)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_outputs', filter: `campaignId=eq.${user.campaignId}` }, fetchData)
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user?.campaignId, config?.limits.aiCalls]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === 'META_AUTH_SUCCESS') {
                setConnections((prev: any) => ({ ...prev, instagram: true, facebook: true }));
            }
            if (event.data?.type === 'TIKTOK_AUTH_SUCCESS') {
                setConnections((prev: any) => ({ ...prev, tiktok: true }));
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const getContextData = async (type: 'field' | 'growth' | 'strategist' | 'social' | 'fraud') => {
        try {
            const limitVal = type === 'field' ? 5 : 20;
            const campaignId = user?.campaignId || 'default';

            const [
                { data: reports },
                { data: pesquisas },
                { data: visits },
                { data: campaign }
            ] = await Promise.all([
                supabase.from('street_reports').select('*').eq('campaignId', campaignId).order('createdAt', { ascending: false }).limit(15),
                supabase.from('pesquisas').select('*').eq('campaignId', campaignId).order('createdAt', { ascending: false }).limit(limitVal),
                supabase.from('visits').select('*').eq('campaignId', campaignId).order('createdAt', { ascending: false }).limit(20),
                supabase.from('campaigns').select('electionDate, electionRole, electionState, electionCity, electionRound, candidateNumber').eq('id', campaignId).maybeSingle(),
            ]);

            let context = "\n\n[DADOS REAIS DA CAMPANHA (EXTRAÍDOS DO BANCO)]\n";

            // Contexto eleitoral — sempre primeiro pra todos os agentes saberem o "alvo"
            if (campaign?.electionDate) {
                const electionDate = new Date(campaign.electionDate);
                const today = new Date();
                const diffDays = Math.ceil((electionDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                context += "--- Alvo Eleitoral ---\n";
                context += `- Data da eleição: ${campaign.electionDate} (${diffDays > 0 ? `${diffDays} dias restantes` : 'Eleição já ocorreu'})\n`;
                if (campaign.electionRole) context += `- Cargo: ${campaign.electionRole}\n`;
                if (campaign.electionState) context += `- UF: ${campaign.electionState}\n`;
                if (campaign.electionCity) context += `- Cidade: ${campaign.electionCity}\n`;
                if (campaign.electionRound) context += `- Turno: ${campaign.electionRound}º\n`;
                if (campaign.candidateNumber) context += `- Número de Urna: ${campaign.candidateNumber}\n`;
                context += "----------------------\n";
            } else {
                context += "[ATENÇÃO] Nenhuma data de eleição cadastrada — peça ao usuário pra configurar em Configurações → Alvo Eleitoral.\n";
            }


            if (type === 'fraud' && visits) {
                context += "--- Dados de Visitas para Auditoria ---\n";
                visits.forEach((v: any) => {
                    context += `- Eleitor: ${v.nomeEleitor || 'N/A'} | Bairro: ${v.bairro} | Votos: ${v.votos} | Notas: ${v.notas || 'Sem notas'}\n`;
                });
            }

            if (pesquisas && pesquisas.length > 0) {
                const rejeicoes = pesquisas.map((p: any) => p.fatorRejeicao).filter(Boolean);
                const dores = pesquisas.map((p: any) => p.dorImediata).filter(Boolean);
                const topRejeicao = rejeicoes.sort((a: any, b: any) => rejeicoes.filter((v: any) => v===a).length - rejeicoes.filter((v: any) => v===b).length).pop() || 'N/A';
                const topDor = dores.sort((a: any, b: any) => dores.filter((v: any) => v===a).length - dores.filter((v: any) => v===b).length).pop() || 'N/A';
                
                context += "--- Insights da Pesquisa Eleitoral Mais Recente ---\n";
                context += `- Amostra: ${pesquisas.length} eleitores.\n`;
                context += `- Dor imediata predominante na base: ${topDor}.\n`;
                context += `- Maior Fator de Rejeição a ser evitado: ${topRejeicao}.\n`;
                context += "--------------------------------------------------------\n";
            }

            if (reports && reports.length > 0) {
                context += "--- Últimos Reportes da Equipe de Rua ---\n";
                reports.forEach((r: any) => {
                    context += `- Bairro: ${r.bairro} | Clima: ${r.clima} | Reclamação: ${r.reclamacao || 'Nenhuma'}\n`;
                });
            }

            return context;
        } catch (error) {
            console.error("Erro ao buscar dados do Supabase:", error);
            return ""; 
        }
    };

    const handleAgentCallGen = async (prompt: string, agentFn: (p: string, cid?: string, uid?: string) => Promise<any>, type: 'field' | 'growth' | 'strategist' | 'social' | 'fraud') => {
        if (isLimitExceeded) {
            alert("Limite de IA excedido para esta campanha.");
            throw new Error("Limit exceeded");
        }
        const context = await getContextData(type);
        const finalPrompt = `${prompt}${context}`;
        return await agentFn(finalPrompt, user?.campaignId || 'default', String(user?.id || 'unknown'));
    };

    const renderTabContent = () => {
        switch (activeTab) {
            case 'manager':
                return <ManagerRoom campaignId={user?.campaignId} />;
            case 'war-room':
                return <WarRoom getContextData={getContextData} isLimitExceeded={isLimitExceeded} user={user} setHistoryRefreshKey={setHistoryRefreshKey} />;
            case 'history':
                return <PipelineHistory campaignId={user?.campaignId || ''} key={historyRefreshKey} />;
            case 'strategist':
                return <AgentRoom 
                    key="strategist"
                    title="O Estrategista" 
                    description="Diretor de Operações Políticas. Serve para análise de cenário, gestão de crise e definição de diretrizes estratégicas baseadas nas pesquisas."
                    examples={[
                        "Como agir estrategicamente baseados no último ponto de maior rejeição apontado pela pesquisa?",
                        "Quais devem ser nossos 3 principais KPIs para esta semana de campanha?",
                        "Com base nas maiores dores mapeadas no município, desenhe as diretrizes para meu plano de governo."
                    ]}
                    agentId="strategist"
                    campaignId={user?.campaignId || 'default'}
                    agentCall={(p) => handleAgentCallGen(p, askStrategist, 'strategist')}
                    placeholder="Ex: Como lidar com nossa taxa de rejeição atual?"
                />;
            case 'growth':
                return <AgentRoom 
                    key="growth"
                    title="O Growth Hacker" 
                    description="Arquiteto de Conversão. Serve para criar réguas de relacionamento e transformar interesse em votos."
                    examples={[
                        "Desenhe um funil de conversão focado em eleitores indecisos que tem a segurança como dor primária.",
                        "Crie uma sequência de de WhatsApp agressiva direcionada às periferias listadas nos reportes.",
                        "Identifique um segmento na amostra de pesquisa perfeito para uma ação 'Member-get-member'."
                    ]}
                    agentId="growth"
                    campaignId={user?.campaignId || 'default'}
                    agentCall={(p) => handleAgentCallGen(p, askGrowthHacker, 'growth')}
                    placeholder="Ex: Crie um funil focado nas dores captadas na pesquisa."
                />;
            case 'social':
                return <AgentRoom 
                    key="social"
                    title="O Social Media" 
                    description="Social Media Creator. Serve para criar conteúdos virais adaptados usando de 'Dores Reais' listadas na Inteligência de dados."
                    examples={[
                        "Crie um roteiro de Reels de 15 segundos sobre a maior reclamação apontada no bairro X.",
                        "Escreva uma legenda agressiva (sem atacar ninguém) sobre a dor imediata descoberta na pesquisa.",
                        "Crie um Story focado em eleitores com Perfil D e Alto Consumo de Info no IG."
                    ]}
                    agentId="social"
                    campaignId={user?.campaignId || 'default'}
                    agentCall={(p) => handleAgentCallGen(p, askSocialMedia, 'social')}
                    placeholder="Ex: Roteiro de TikTok de 60s focando na dor primária."
                    initialPrompt={pendingContext ? `CONTEÚDO RECEBIDO PARA POSTAGEM (Analise/Produção):\n\n${pendingContext}\n\nPor favor, finalize o post viral com base nisso.` : undefined}
                    onClearInitial={() => setPendingContext(null)}
                    onHandoff={(script) => handleProductionHandoff('social', 'creative', script)}
                    onPublish={(content) => handlePublishToSocial(content)}
                />;
            case 'creative':
                return <AgentRoom 
                    key="creative"
                    title="O Produtor Criativo" 
                    description="Artista Digital & Google Flow. Transforma scripts em ativos visuais (imagens e vídeos) de alto impacto."
                    examples={[
                        "Gere uma imagem fótica de uma caminhada lotada no bairro X com estética de esperança.",
                        "Renderize um vídeo de 15s estilo cinemático sobre as obras de asfalto prometidas no script.",
                        "Crie um carrossel de 4 artes focadas na dor de segurança pública mapeada."
                    ]}
                    agentId="creative"
                    campaignId={user?.campaignId || 'default'}
                    agentCall={(p) => askCreativeProducer(p, user?.campaignId || 'default', String(user?.id || 'unknown'))}
                    placeholder="Cole aqui o SCRIPT PARA O PRODUTOR gerado pelo Social Media..."
                    initialPrompt={pendingContext ? `SCRIPT RECEBIDO DO SOCIAL MEDIA:\n\n${pendingContext}\n\nPor favor, processe a geração deste conteúdo.` : undefined}
                    onClearInitial={() => setPendingContext(null)}
                    onExecuteAction={(p) => generateCreativeImage(p, user?.campaignId || 'default', String(user?.id || 'unknown'))}
                    onGeneratePost={(content) => handleProductionHandoff('field', 'social', content)}
                    onPublish={(content, media) => handlePublishToSocial(content, media)}
                />;
            case 'field':
                return <AgentRoom 
                    key="field"
                    title="O Comandante de Campo" 
                    description="Logística de Rua. Usa reportes imediatos para logística, roteirização e inteligência de panfletagem."
                    examples={[
                        "Com base nos reports de hoje, qual bairro deve receber nossa caminhada amanhã?",
                        "Onde estão os maiores focos de reclamação sobre iluminação pública nesta semana?",
                        "Trace uma rota de panfletagem focando na localidade onde as respostas apontam que as pessoas votariam em outros candidatos."
                    ]}
                    agentId="field"
                    campaignId={user?.campaignId || 'default'}
                    agentCall={(p) => handleAgentCallGen(p, askFieldCommander, 'field')}
                    placeholder="Ex: Onde focar panfletagem para mitigar críticas de asfalto detectadas na pesquisa?"
                    onGeneratePost={(content) => handleProductionHandoff('field', 'social', content)}
                />;
            case 'connections':
                return <SocialConnectionsHub />;
            case 'backup':
                return <BackupAgentRoom campaignId={user?.campaignId || ''} user={user} />;
            case 'fraud':
                return <AgentRoom
                    key="fraud"
                    title="Auditor de Integridade"
                    description="Caça-Fraudes de Campanha. Especialista em detectar dados falsos, cadastros suspeitos e inconsistências nos reportes de rua."
                    examples={[
                        "Analise os últimos 10 cadastros de eleitores e procure por padrões de nomes falsos ou CEPs repetidos.",
                        "Identifique se há reportes de rua com textos idênticos vindo de voluntários diferentes.",
                        "Sinale possíveis fraudes no bairro X baseadas nas contradições das notas de atendimento."
                    ]}
                    agentId="fraud"
                    campaignId={user?.campaignId || 'default'}
                    agentCall={(p) => handleAgentCallGen(p, askFraudAuditor, 'fraud')}
                    placeholder="Ex: Verifique a integridade dos cadastros realizados hoje."
                />;
        }
    };

    return (
        <div className="space-y-6">
            {notifications.length > 0 && (
                <div className="space-y-2">
                    {notifications.map(notif => (
                        <div
                            key={notif.id}
                            className={`flex items-start gap-3 p-4 rounded-xl border animate-in slide-in-from-top-2 duration-300 ${
                                notif.type === 'running' 
                                    ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
                                    : notif.type === 'done'
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                    : 'bg-red-500/10 border-red-500/30 text-red-300'
                            }`}
                        >
                            {notif.type === 'running' 
                                ? <Loader2 className="w-5 h-5 animate-spin shrink-0 mt-0.5" />
                                : <BellRing className="w-5 h-5 shrink-0 mt-0.5" />
                            }
                            <div className="flex-1">
                                <p className="text-xs font-bold uppercase tracking-wider mb-0.5 opacity-70">Pipeline Automática</p>
                                <p className="text-sm font-medium">{notif.message}</p>
                            </div>
                            <button
                                onClick={() => setNotifications(prev => prev.filter(n => n.id !== notif.id))}
                                className="text-current opacity-50 hover:opacity-100 transition-opacity shrink-0"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {isLimitExceeded && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-red-400" />
                        <div>
                            <p className="text-sm font-bold text-red-400">Limite de IA Atingido ({currentUsage}/{config?.limits.aiCalls})</p>
                            <p className="text-xs text-red-400/70">O limite de chamadas de IA foi atingido. Contate o Gestor Supremo para expansão.</p>
                        </div>
                    </div>
                </div>
            )}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-50 flex items-center gap-2">
                        <Bot className="w-6 h-6 text-blue-400" />
                        Quartel General de IA
                    </h2>
                    <p className="text-slate-400 mt-1">Sistema Multi-Agente "Voto Inteligente"</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setAutoPipelineEnabled(prev => !prev)}
                        title={autoPipelineEnabled ? 'Automação ativa — clique para pausar' : 'Automação pausada — clique para ativar'}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                            autoPipelineEnabled
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                                : 'bg-slate-700 text-slate-400 border-slate-600 hover:bg-slate-600'
                        }`}
                    >
                        <Zap className={`w-3.5 h-3.5 ${autoPipelineEnabled ? 'animate-pulse' : ''}`} />
                        {autoPipelineEnabled ? 'Automação ON' : 'Automação OFF'}
                    </button>
                    <button
                        onClick={runManualPipeline}
                        title="Rodar análise diária agora"
                        className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20 transition-all"
                    >
                        <SparklesIcon className="w-3.5 h-3.5" />
                        Análise Manual
                    </button>
                    {Object.values(connections).some(v => v) && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 text-green-400 rounded-full text-xs font-medium border border-green-500/20">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            IA Conectada às Redes
                        </div>
                    )}
                </div>
            </div>

            <div className="flex space-x-2 bg-slate-800 p-1 rounded-lg border border-slate-700 overflow-x-auto">
                <button onClick={() => setActiveTab('manager')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'manager' ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}>
                    <Bot className="w-4 h-4" /> Manager
                </button>
                <button onClick={() => setActiveTab('war-room')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'war-room' ? 'bg-red-500/20 text-red-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}>
                    <LayoutDashboard className="w-4 h-4" /> War Room
                </button>
                <button onClick={() => setActiveTab('history')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'history' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}>
                    <History className="w-4 h-4" /> Histórico de Análises
                </button>
                <button onClick={() => setActiveTab('strategist')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'strategist' ? 'bg-blue-500/20 text-blue-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}>
                    <Bot className="w-4 h-4" /> O Estrategista
                </button>
                <button onClick={() => setActiveTab('growth')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'growth' ? 'bg-green-500/20 text-green-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}>
                    <TrendingUp className="w-4 h-4" /> O Growth Hacker
                </button>
                <button onClick={() => setActiveTab('social')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'social' ? 'bg-purple-500/20 text-purple-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}>
                    <Share2 className="w-4 h-4" /> O Social Media
                </button>
                <button onClick={() => setActiveTab('creative')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'creative' ? 'bg-yellow-500/20 text-yellow-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}>
                    <SparklesIcon className="w-4 h-4" /> Produtor Criativo
                </button>
                <button onClick={() => setActiveTab('field')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'field' ? 'bg-orange-500/20 text-orange-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}>
                    <Map className="w-4 h-4" /> Comandante de Campo
                </button>
                <button onClick={() => setActiveTab('backup')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'backup' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}>
                    <Shield className="w-4 h-4" /> Guardião de Dados (Backup)
                </button>
                <button onClick={() => setActiveTab('fraud')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'fraud' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}>
                    <ShieldCheck className="w-4 h-4" /> Auditor de Fraudes
                </button>
                <div className="flex-1" />
                <button onClick={() => setActiveTab('connections')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'connections' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}>
                    <LinkIcon className="w-4 h-4" /> Conexões
                </button>
            </div>

            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 min-h-[500px]">
                {!isHydrated ? (
                    <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                        <Loader2 className="w-8 h-8 animate-spin mb-4 text-blue-400" />
                        <p className="text-sm font-medium">Sincronizando Quartel General...</p>
                    </div>
                ) : (
                    renderTabContent()
                )}
            </div>
        </div>
    );
};

interface AgentRoomProps {
    title: string;
    description: string;
    examples?: string[];
    icon?: React.ReactNode;
    agentId: string;
    campaignId: string;
    agentCall: (prompt: string, agentId: string) => Promise<any>;
    placeholder: string;
    initialPrompt?: string;
    onClearInitial?: () => void;
    onHandoff?: (content: string) => void;
    onExecuteAction?: (content: string, agent_id: string) => Promise<string>;
    onGeneratePost?: (content: string) => void;
    onPublish?: (content: string, media?: string) => void;
}

const AgentRoom: React.FC<AgentRoomProps> = ({ title, description, agentId, campaignId, examples, icon, agentCall, placeholder, initialPrompt, onClearInitial, onGeneratePost, onHandoff, onExecuteAction, onPublish }) => {
    const [input, setInput] = useState('');
    const { histories, setHistory, addMessage } = useAgentStore();
    const history = histories[agentId] || [];
    const [isLoading, setIsLoading] = useState(false);
    const [pendingOrders, setPendingOrders] = useState<any[]>([]);

    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const headers = { 'Authorization': `Bearer ${session?.access_token}` };
                const histRes = await fetch(`/api/agents/history/${agentId}?campaignId=${campaignId}`, { headers });
                const histData = await histRes.json();
                if (histData.history && history.length === 0) {
                    setHistory(agentId, histData.history.map((h: any) => ({ role: h.role, content: h.content })));
                }
                const ordersRes = await fetch(`/api/agents/production-orders?campaignId=${campaignId}&targetAgent=${agentId}`, { headers });
                const ordersData = await ordersRes.json();
                if (ordersData) setPendingOrders(ordersData);
            } catch (err) {
                console.error("Erro ao carregar dados iniciais:", err);
            }
        };
        loadInitialData();
    }, [agentId, campaignId]);

    useEffect(() => {
        if (initialPrompt) {
            setInput(initialPrompt);
            if (onClearInitial) onClearInitial();
        }
    }, [initialPrompt]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;
        const userMsg = input.trim();
        setInput('');
        addMessage(agentId, { role: 'user', content: userMsg });
        setIsLoading(true);
        try {
            const contextPrompt = history.length > 0 
                ? `Histórico da conversa:\n${history.map(h => `${h.role === 'user' ? 'Eu' : 'Você'}: ${h.content}`).join('\n')}\n\nMinha nova mensagem: ${userMsg}`
                : userMsg;
            const response = await agentCall(contextPrompt, agentId);
            addMessage(agentId, { role: 'agent', content: typeof response === 'string' ? response : (response as any).text || "" });
            if (typeof response !== 'string' && (response as any).tool_calls) {
                (response as any).tool_calls.forEach((tool: any) => {
                    addMessage(agentId, { 
                        role: 'agent', 
                        content: `🛡️ **SISTEMA EM AÇÃO:** Analisando integridade via \`${tool.function.name}\`...\nStatus: Verificação autônoma processada no cluster de segurança.` 
                    });
                });
            }
        } catch (error) {
            addMessage(agentId, { role: 'agent', content: "❌ Erro de comunicação com a base. Tente novamente." });
        } finally {
            setIsLoading(false);
        }
    };

    const handleExecuteAction = async (msgIdx: number, content: string) => {
        if (!onExecuteAction) return;
        setIsLoading(true);
        try {
            const resultUrl = await onExecuteAction(content, agentId);
            const newHist = [...history];
            newHist[msgIdx] = { ...newHist[msgIdx], content: newHist[msgIdx].content + `\n\n![ATIVO GERADO](${resultUrl})` };
            setHistory(agentId, newHist);
        } catch (error) {
            alert("Erro ao executar ação automática.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex flex-col md:flex-row md:items-center gap-3 mb-6 pb-4 border-b border-slate-700">
                <div className="p-3 bg-slate-900 rounded-lg border border-slate-700 w-fit">{icon}</div>
                <div className="flex-1">
                    <h3 className="text-xl font-bold text-slate-50">{title}</h3>
                    <p className="text-sm text-slate-400">{description}</p>
                </div>
                {examples && examples.length > 0 && (
                    <div className="hidden lg:block max-w-xs">
                        <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Exemplos de uso:</p>
                        <div className="flex flex-wrap gap-1">
                            {examples.map((ex, i) => (
                                <button key={i} onClick={() => setInput(ex)} className="text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition-colors text-left line-clamp-1">{ex}</button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            
            {/* Galeria de Ativos Recentes (Top 3) */}
            {agentId === 'creative' && history.some(m => m.content.includes('![ATIVO GERADO]')) && (
                <div className="mb-6 animate-in fade-in zoom-in duration-500">
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest flex items-center gap-2">
                        <SparklesIcon className="w-3 h-3 text-yellow-400" /> Ativos Criativos Recentes
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                        {history
                            .filter(m => m.content.includes('![ATIVO GERADO]'))
                            .slice(-3)
                            .map((msg, i) => {
                                const url = msg.content.match(/\!\[ATIVO GERADO\]\((.*?)\)/)?.[1];
                                return (
                                    <div key={i} className="aspect-square rounded-lg border border-slate-700 overflow-hidden bg-slate-900 group relative">
                                        <img src={url} className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                                            <button 
                                                onClick={() => setInput(msg.content.split(')')[1]?.trim())}
                                                className="text-[9px] font-bold text-white bg-indigo-600/80 hover:bg-indigo-600 p-1 rounded text-center"
                                            >
                                                REPRODUZIR
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        }
                    </div>
                </div>
            )}

            {/* Painel de Alertas do Auditor (Top 3) */}
            {agentId === 'fraud' && history.some(m => m.content.includes('🛡️')) && (
                <div className="mb-6 animate-in fade-in slide-in-from-top-2 duration-500 bg-red-500/5 border border-red-500/10 p-4 rounded-xl">
                    <p className="text-[10px] font-bold text-red-400 uppercase mb-3 tracking-widest flex items-center gap-2">
                        <Shield className="w-3 h-3" /> Relatórios de Integridade Recentes
                    </p>
                    <div className="space-y-2">
                        {history
                            .filter(m => m.content.includes('🛡️'))
                            .slice(-3)
                            .map((msg, i) => (
                                <div key={i} className="text-[11px] bg-slate-900/50 border border-red-500/20 text-red-200/70 p-2.5 rounded-lg flex items-center gap-2 italic shadow-sm">
                                    <div className="w-1 h-1 rounded-full bg-red-500" />
                                    {msg.content.replace(/🛡️ \*\*SISTEMA EM AÇÃO:\*\* /g, '').split('...')[0]}...
                                </div>
                            ))
                        }
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-2 max-h-[400px]">
                {pendingOrders.length > 0 && (
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
                        <div className="flex items-center gap-2 mb-3 text-blue-400 font-bold text-sm uppercase tracking-wider"><BellRing className="w-4 h-4" /> ⚡ Ordens de Produção Pendentes</div>
                        <div className="space-y-3">
                            {pendingOrders.map((order) => (
                                <div key={order.id} className="bg-slate-900/50 rounded-md p-3 border border-slate-700">
                                    <p className="text-xs text-slate-400 mb-2">Origem: <span className="text-blue-300 font-medium capitalize">{order.origin_agent}</span></p>
                                    <p className="text-sm text-slate-200 line-clamp-2 italic mb-3">"{order.content}"</p>
                                    <button onClick={() => { setInput(order.content); setPendingOrders(prev => prev.filter(o => o.id !== order.id)); }} className="flex items-center gap-2 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded transition-all"><ArrowRight className="w-3 h-3" /> USAR ESTE CONTEXTO</button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-4 py-10">
                        {icon}
                        <div className="text-center max-w-md">
                            <p className="font-medium mb-2">Aguardando suas ordens, comandante.</p>
                            {examples && (
                                <div className="mt-4 space-y-2">
                                    <p className="text-xs uppercase tracking-wider text-slate-600 font-bold">Tente perguntar:</p>
                                    {examples.map((ex, i) => (
                                        <button key={i} onClick={() => setInput(ex)} className="block w-full text-sm bg-slate-900/50 hover:bg-slate-700 border border-slate-700 p-3 rounded-lg text-slate-400 hover:text-slate-200 transition-all text-left">"{ex}"</button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    history.slice(-10).map((msg, idx) => (
                        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300 relative group`}>
                            <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm relative ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-slate-700/50 backdrop-blur-sm text-slate-100 border border-slate-600/50 rounded-bl-sm'}`}>
                                {msg.role === 'agent' && title === 'O Produtor Criativo' && (
                                    <button 
                                        onClick={async () => {
                                            if (!confirm("Excluir este card permanentemente?")) return;
                                            try {
                                                if (msg.id) await supabase.from('agent_chat_history').delete().eq('id', msg.id);
                                                setHistory(agentId, history.filter((_, i) => i !== idx));
                                            } catch (e) { console.error(e); }
                                        }}
                                        className="absolute -top-2 -right-2 p-1.5 bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-700 z-10"
                                        title="Excluir Card"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                )}
                                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                                    {msg.content.includes('![ATIVO GERADO]') ? (
                                        <div className="flex flex-col gap-3">
                                            <p className="text-xs font-bold text-indigo-400 uppercase tracking-tighter">✨ Novo Ativo Criativo</p>
                                            <div className="relative group rounded-lg overflow-hidden border border-indigo-500/50 shadow-lg">
                                                <img src={msg.content.match(/\!\[ATIVO GERADO\]\((.*?)\)/)?.[1]} alt="Ativo" className="w-full h-auto" />
                                            </div>
                                            <p className="italic text-[10px] opacity-60 line-clamp-2">{msg.content.split(')')[1]}</p>
                                        </div>
                                    ) : (
                                        msg.content.startsWith('🛡️') || msg.content.startsWith('🛠️') ? (
                                            <div className="flex items-center gap-3 py-1 opacity-80">
                                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                                                <span className="text-[11px] font-medium text-indigo-300 italic">{msg.content}</span>
                                            </div>
                                        ) : msg.content
                                    )}
                                </div>
                                {msg.role === 'agent' && title === 'O Comandante de Campo' && onGeneratePost && (
                                    <div className="mt-3 pt-3 border-t border-slate-600">
                                        <p className="text-[10px] text-slate-400 mb-2 font-bold uppercase">Ação da Linha de Montagem:</p>
                                        <button onClick={() => onGeneratePost(msg.content)} className="flex items-center gap-2 text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded-lg font-bold transition-all shadow-lg hover:scale-105 active:scale-95"><Share2 className="w-3 h-3" /> GERAR POST VIRAL AGORA</button>
                                    </div>
                                )}
                                {msg.role === 'agent' && title === 'O Social Media' && onHandoff && (
                                    <div className="mt-3 pt-3 border-t border-slate-600">
                                        <p className="text-[10px] text-slate-400 mb-2 font-bold uppercase">Integração Google Flow:</p>
                                        <button onClick={() => onHandoff(msg.content)} className="flex items-center gap-2 text-xs bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-2 rounded-lg font-bold transition-all shadow-lg hover:scale-105 active:scale-95"><SparklesIcon className="w-3 h-3" /> ENVIAR SCRIPT PARA PRODUÇÃO</button>
                                    </div>
                                )}
                                {msg.role === 'agent' && title === 'O Produtor Criativo' && onExecuteAction && (
                                    <div className="mt-3 pt-3 border-t border-slate-600">
                                        <p className="text-[10px] text-slate-400 mb-2 font-bold uppercase">Execução Automática:</p>
                                        <button onClick={() => handleExecuteAction(idx, msg.content)} disabled={isLoading} className="flex items-center gap-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg font-bold transition-all shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50"><SparklesIcon className="w-3 h-3" /> 🚀 GERAR ATIVO VISUAL (DALL-E 3)</button>
                                    </div>
                                )}
                                {msg.role === 'agent' && title === 'O Produtor Criativo' && onGeneratePost && (
                                    <div className="mt-3 pt-3 border-t border-slate-600">
                                        <p className="text-[10px] text-slate-400 mb-2 font-bold uppercase">Entrega de Ativo:</p>
                                        <button onClick={() => onGeneratePost(msg.content)} className="flex items-center gap-2 text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg font-bold transition-all shadow-lg hover:scale-105 active:scale-95"><CheckCircle2 className="w-3 h-3" /> DEVOLVER PARA SOCIAL MEDIA</button>
                                    </div>
                                )}
                                {msg.role === 'agent' && onPublish && !msg.content.startsWith('🛡️') && (
                                    <div className="mt-3 pt-3 border-t border-slate-600/50">
                                        <button 
                                            onClick={() => {
                                                const mediaUrl = msg.content.match(/\!\[ATIVO GERADO\]\((.*?)\)/)?.[1];
                                                const cleanContent = msg.content.split('![ATIVO GERADO](')[0].replace(/\*\*/g, '').trim();
                                                onPublish(cleanContent, mediaUrl);
                                            }} 
                                            className="w-full flex items-center justify-center gap-2 text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg font-bold transition-all shadow-md active:scale-95"
                                        >
                                            <Send className="w-3 h-3" /> PUBLICAR NAS REDES CONECTADAS
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))
                )}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-slate-700 text-slate-100 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Analisando dados...</span></div>
                    </div>
                )}
            </div>
            <form onSubmit={handleSubmit} className="relative mt-auto">
                <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder} className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-4 pr-12 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" disabled={isLoading} />
                <button type="submit" disabled={!input.trim() || isLoading} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-blue-400 disabled:opacity-50 disabled:hover:text-slate-400 transition-colors"><Send className="w-5 h-5" /></button>
            </form>
        </div>
    );
};

const WarRoom: React.FC<{ getContextData: (type: any) => Promise<string>; isLimitExceeded: boolean; user: any; setHistoryRefreshKey?: React.Dispatch<React.SetStateAction<number>>; }> = ({ getContextData, isLimitExceeded, user, setHistoryRefreshKey }) => {
    const [reports, setReports] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isPipelineRunning, setIsPipelineRunning] = useState(false);
    const [pipelineMessage, setPipelineMessage] = useState("");
    const { warRoomResult: pipelineResult, warRoomStep: pipelineStep, setWarRoomResult: setPipelineResult, setWarRoomStep: setPipelineStep } = useAgentStore();

    useEffect(() => {
        const fetchReports = async () => {
            try {
                const { data } = await supabase.from('street_reports').select('*').eq('campaignId', user?.campaignId).order('createdAt', { ascending: false }).limit(10);
                setReports(data || []);
            } catch (error) { console.error(error); }
            finally { setIsLoading(false); }
        };
        fetchReports();
    }, []);

    const handleRunPipeline = async (contextAddition: string) => {
        if (isLimitExceeded) { alert("Limite excedido."); return; }
        setIsPipelineRunning(true); setPipelineResult(null); setPipelineStep(0);
        try {
            const context = await getContextData('strategist');
            const dataPrompt = `${contextAddition}\n${context}`;
            const history = await getPipelineHistory(user?.campaignId || 'default', 1);
            const historyPrompt = history.length > 0 ? `ANÁLISE ANTERIOR:\nEstrategista: ${history[0].strategist}` : "";
            const result = await runFullPipeline(dataPrompt, (step, msg) => { setPipelineStep(step); setPipelineMessage(msg); }, historyPrompt, user?.campaignId || 'default', String(user?.id || ''));
            
            // Salva no Store (a persistência no banco já foi feita pelo /api/agents/pipeline server-side).
            setPipelineResult(result);
            setPipelineStep(7);

            // Sinaliza pro histórico atualizar (server já gravou em agent_outputs).
            if (setHistoryRefreshKey) setHistoryRefreshKey(prev => prev + 1);

        } catch (error) { 
            console.error("Erro na pipeline:", error);
            setPipelineMessage("Erro na pipeline."); 
        }
        finally { setIsPipelineRunning(false); }
    };

    if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 mb-4"><LayoutDashboard className="w-6 h-6 text-red-400" /><div><h3 className="text-xl font-bold text-slate-50">War Room: Linha de Montagem</h3><p className="text-sm text-slate-400">Fluxo: Estratégia → Growth → Campo → Social → Produtor.</p></div></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-900 rounded-xl p-4 border border-slate-700">
                    <div className="flex items-center justify-between mb-4"><h4 className="text-sm font-semibold text-slate-300 flex items-center gap-2"><Ticket className="w-4 h-4 text-orange-400" /> Gatilhos Ativos</h4><button onClick={() => handleRunPipeline("Geral")} disabled={isPipelineRunning} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1.5 rounded font-bold flex gap-2 items-center"><SparklesIcon className="w-3 h-3"/> Analisar Agora</button></div>
                    <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">{reports.length === 0 ? <p className="text-xs text-slate-500 italic">Sem reportes.</p> : reports.map((r) => (<div key={r.id} className="bg-slate-800 p-3 rounded-lg border border-slate-700"><div className="flex justify-between items-start mb-2"><span className="text-[10px] font-bold uppercase tracking-wider bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded">{r.bairro}</span></div><p className="text-sm text-slate-200 line-clamp-2 mb-3">{r.reclamacao}</p><button onClick={() => handleRunPipeline(`${r.bairro}: ${r.reclamacao}`)} disabled={isPipelineRunning} className="w-full flex items-center justify-center gap-2 text-xs bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-medium disabled:opacity-50 transition-colors">Analisar Ticket <ArrowRight className="w-3 h-3" /></button></div>))}</div>
                </div>
                <div className="bg-slate-900 rounded-xl p-4 border border-slate-700 flex flex-col">
                    <h4 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-400" /> Status da Produção</h4>
                    <div className="flex-1 space-y-4 flex flex-col justify-center">
                        {[ {id:1, n:'Estrategista'}, {id:2, n:'Growth Hacker'}, {id:3, n:'Comandante Campo'}, {id:4, n:'Social Media'}, {id:5, n:'Produtor Criativo'} ].map(s => (
                            <div key={s.id} className="flex items-center gap-3 opacity-50 data-[active=true]:opacity-100" data-active={pipelineStep >= s.id}>
                                <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-[10px] font-bold">{s.id}</div>
                                <div className="flex-1"><p className="text-[11px] font-medium text-slate-200">{s.n}</p><div className="w-full bg-slate-800 h-1 rounded-full mt-1"><div className="bg-blue-500 h-1 rounded-full transition-all" style={{ width: pipelineStep > s.id ? '100%' : pipelineStep === s.id ? '50%' : '0%' }}></div></div></div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-4 p-3 bg-slate-800/80 rounded-lg border border-slate-700 text-center">{isPipelineRunning ? <p className="text-xs text-indigo-400 flex items-center justify-center gap-2 animate-pulse"><Loader2 className="w-3 h-3 animate-spin" /> {pipelineMessage}</p> : pipelineStep === 7 ? <p className="text-xs text-green-400 flex items-center justify-center gap-2 font-bold"><CheckCircle2 className="w-3 h-3" /> Pipeline Concluída!</p> : <p className="text-[10px] text-slate-500">Aguardando gatilho...</p>}</div>
                </div>
            </div>
            {pipelineResult && (
                <div className="mt-8 space-y-4 animate-in fade-in slide-in-from-bottom-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-400"/> Resultado</h3>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {[ {t:'Estrategista', c:pipelineResult.strategist, cl:'text-blue-400'}, {t:'Growth', c:pipelineResult.growth, cl:'text-green-400'}, {t:'Campo', c:pipelineResult.field, cl:'text-orange-400'}, {t:'Social', c:pipelineResult.social, cl:'text-purple-400'} ].map(p => (
                            <div key={p.t} className="bg-slate-900 border border-slate-700 rounded-xl p-5"><h4 className={`font-bold ${p.cl} border-b border-slate-800 pb-2 mb-2`}>{p.t}</h4><div className="text-sm text-slate-300 whitespace-pre-wrap">{p.c}</div></div>
                        ))}
                        <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 lg:col-span-2"><h4 className="font-bold text-yellow-400 border-b border-slate-800 pb-2 mb-2 flex items-center gap-2"><SparklesIcon className="w-4 h-4"/> Produtor Criativo</h4><div className="text-sm text-slate-300 whitespace-pre-wrap mb-4">{pipelineResult.creative_text}</div>
                        {pipelineResult.creativeImageBase64 && ( <div className="mt-4 border border-slate-700 rounded-xl p-2 bg-black/50 text-center"><img src={`data:image/jpeg;base64,${pipelineResult.creativeImageBase64}`} alt="IA" className="w-full max-w-xl mx-auto rounded-lg" /><a href={`data:image/jpeg;base64,${pipelineResult.creativeImageBase64}`} download="midia.jpg" className="inline-block mt-4 bg-yellow-600 text-slate-900 font-bold py-1.5 px-6 rounded-full text-xs">Baixar Imagem</a></div> )}</div>
                    </div>
                </div>
            )}
        </div>
    );
};

const PipelineHistory: React.FC<{ campaignId: string }> = ({ campaignId }) => {
    const [history, setHistory] = useState<PipelineResult[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    useEffect(() => {
        const fetchHistory = async () => {
            if (!campaignId) { setIsLoading(false); return; }
            try { const data = await getPipelineHistory(campaignId, 10); setHistory(data); } catch (err) { console.error(err); } finally { setIsLoading(false); }
        };
        fetchHistory();
    }, [campaignId]);
    if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 mb-4"><History className="w-6 h-6 text-indigo-400" /><div><h3 className="text-xl font-bold text-slate-50">Histórico</h3><p className="text-sm text-slate-400">Análises passadas.</p></div></div>
            {history.length === 0 ? <div className="text-center p-12 bg-slate-900 border border-slate-700 rounded-xl">Sem histórico.</div> : (
                <div className="space-y-4">
                    {history.map((r, idx) => (
                        <div key={idx} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                            <div className="flex justify-between items-center mb-3">
                                <h4 className="font-bold text-slate-400 text-xs uppercase tracking-widest">Análise de IA</h4>
                                <span className="text-[10px] text-slate-50">{r.createdAt ? new Date(r.createdAt).toLocaleString('pt-BR') : 'Data Indisponível'}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <p className="text-[9px] font-bold text-blue-500/70 uppercase">Estrategista</p>
                                    <div className="text-xs text-slate-300 line-clamp-3 bg-slate-800/50 p-2 rounded border border-slate-700/50 italic">"{r.strategist}"</div>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[9px] font-bold text-green-500/70 uppercase">Growth</p>
                                    <div className="text-xs text-slate-300 line-clamp-3 bg-slate-800/50 p-2 rounded border border-slate-700/50 italic">"{r.growth}"</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const BackupAgentRoom: React.FC<{ campaignId: string, user: any }> = ({ campaignId, user }) => {
    const [backups, setBackups] = useState<BackupData[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    useEffect(() => {
        if (!campaignId) return;
        const fetch = async () => {
            const { data } = await supabase.from('backups').select('*').eq('campaignId', campaignId).order('createdAt', { ascending: false }).limit(5);
            setBackups(data || []);
        };
        fetch();
    }, [campaignId]);
    const handleCreate = async () => {
        setIsCreating(true);
        try { await createBackup(campaignId, `Snapshot ${new Date().toLocaleString()}`); alert('Sucesso!'); } catch { alert('Erro!'); }
        finally { setIsCreating(false); }
    };
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
            <AgentRoom key="backup" title="Guardião" description="Backup e Integridade." agentId="backup" campaignId={campaignId} agentCall={(p) => askBackupAgent(p, campaignId, user?.id)} placeholder="Comande o backup..." icon={<Shield className="w-6 h-6 text-emerald-400" />} />
            <div className="space-y-4">
                <div className="flex justify-between items-center"><h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Snapshots</h4><Button onClick={handleCreate} disabled={isCreating} className="bg-emerald-600 h-8 text-xs">{isCreating ? 'Salvando...' : 'Novo Ponto'}</Button></div>
                <div className="space-y-2">{backups.map(b => (<div key={b.id} className="bg-slate-900 p-3 rounded-xl border border-slate-800 flex justify-between items-center"><div className="text-xs font-bold text-white">{b.label}</div><button onClick={() => restoreBackup(b.id)} className="text-[10px] text-emerald-400 hover:underline">Restaurar</button></div>))}</div>
            </div>
        </div>
    );
};

export default AgentsHQPage;
