import { useSettings } from '../contexts/SettingsContext';
import CampaignDetailsForm from '../components/settings/CampaignDetailsForm';
import Card from '../components/ui/Card';
import { CogIcon, RefreshIcon } from '../components/icons';
import { syncVoterJourneys } from '../services/voterJourneyService';
import { useAuth } from '../contexts/AuthContext';
import * as React from 'react';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Brain, AlertTriangle } from 'lucide-react';
import AgendaPanel from '../components/agenda/AgendaPanel';
import VoiceCommandButton from '../components/agenda/VoiceCommandButton';
import ExternalMemoryRefreshCard from '../components/dashboard/ExternalMemoryRefreshCard';

const SettingsPage = () => {
    const { campaignDetails, updateCampaignDetails } = useSettings();

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <CogIcon className="h-8 w-8 text-sky-400" />
                <h2 className="text-2xl font-bold text-slate-200">Configurações da Campanha</h2>
            </div>

            <Card>
                <h3 className="text-lg font-bold text-slate-300 mb-4">Dados do Candidato e Orçamento</h3>
                <p className="text-sm text-slate-400 mb-6">
                    Preencha as informações oficiais da sua campanha. O valor do orçamento será usado como base para os cálculos no dashboard financeiro.
                </p>
                <CampaignDetailsForm
                    initialDetails={campaignDetails}
                    onSave={updateCampaignDetails}
                />
            </Card>

            <PublicCaptureLinkSection />

            <SettingsAgendaWrapper />

            <ProactiveMonitorSection />

            <DailyBriefingSection />

            {/* Memória externa da IA (#56) — task admin 1x/dia, fica junto das outras de IA */}
            <ExternalMemoryRefreshCard />

            <AIHealthSection />

            <MaintenanceSection />
        </div>
    );
};

const SettingsAgendaWrapper = () => {
    const { user } = useAuth();
    return <AgendaPanel voiceSlot={<VoiceCommandButton campaignId={user?.campaignId} />} />;
};

const ProactiveMonitorSection = () => {
    const { user } = useAuth();
    const [enabled, setEnabled] = useState(false);
    const [intervalHours, setIntervalHours] = useState(6);
    const [keywords, setKeywords] = useState('');
    const [lastRunAt, setLastRunAt] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!user?.campaignId) return;
        let alive = true;
        (async () => {
            const { data } = await supabase
                .from('campaigns')
                .select('proactiveMonitoringEnabled, proactiveMonitoringIntervalHours, proactiveMonitoringKeywords, proactiveMonitoringLastRunAt')
                .eq('id', user.campaignId)
                .maybeSingle();
            if (!alive || !data) return;
            setEnabled(!!data.proactiveMonitoringEnabled);
            setIntervalHours(data.proactiveMonitoringIntervalHours || 6);
            setKeywords(data.proactiveMonitoringKeywords || '');
            setLastRunAt(data.proactiveMonitoringLastRunAt || null);
            setLoaded(true);
        })();
        return () => { alive = false; };
    }, [user?.campaignId]);

    const save = async (newEnabled?: boolean, newInterval?: number, newKeywords?: string) => {
        if (!user?.campaignId) return;
        setSaving(true);
        const payload: any = {
            proactiveMonitoringEnabled: newEnabled ?? enabled,
            proactiveMonitoringIntervalHours: newInterval ?? intervalHours,
            proactiveMonitoringKeywords: newKeywords ?? keywords,
        };
        const { error } = await supabase.from('campaigns').update(payload).eq('id', user.campaignId);
        setSaving(false);
        if (error) alert('Erro ao salvar: ' + error.message);
    };

    return (
        <Card className="border-t-4 border-t-amber-500">
            <div className="flex items-center gap-3 mb-2">
                <AlertTriangle className="w-6 h-6 text-amber-400" />
                <h3 className="text-lg font-bold text-slate-300">Monitoramento Proativo (Defesa)</h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">
                Quando ativo, o Manager Agent roda automaticamente em segundo plano (a cada N horas)
                buscando na web por menções, ataques ou notícias sobre o candidato. Achados viram alertas
                no War Room. Cada execução custa em torno de R$ 0,30–R$ 1,50 dependendo do que encontrar.
            </p>

            <label className="flex items-center justify-between gap-4 mb-4 p-3 bg-slate-800/50 rounded-xl">
                <div>
                    <p className="text-sm font-bold text-slate-200">Ativar monitoramento automático</p>
                    <p className="text-[11px] text-slate-500">
                        {enabled
                            ? `Ativo · Próxima varredura quando passar ${intervalHours}h da última execução`
                            : 'Desativado · Manager só roda quando você acionar manualmente'}
                    </p>
                </div>
                <input
                    type="checkbox"
                    checked={enabled}
                    disabled={!loaded || saving}
                    onChange={e => { setEnabled(e.target.checked); save(e.target.checked); }}
                    className="w-6 h-6"
                />
            </label>

            {enabled && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                        <label className="text-xs text-slate-400 block mb-1">Intervalo entre varreduras</label>
                        <select
                            value={intervalHours}
                            onChange={e => { const v = Number(e.target.value); setIntervalHours(v); save(undefined, v); }}
                            disabled={saving}
                            className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3"
                        >
                            <option value={1}>A cada 1h (alto custo)</option>
                            <option value={3}>A cada 3h</option>
                            <option value={6}>A cada 6h (padrão)</option>
                            <option value={12}>A cada 12h</option>
                            <option value={24}>1 vez por dia</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-slate-400 block mb-1">Palavras-chave extras (separadas por vírgula)</label>
                        <input
                            type="text"
                            value={keywords}
                            onChange={e => setKeywords(e.target.value)}
                            onBlur={() => save(undefined, undefined, keywords)}
                            disabled={saving}
                            placeholder="Ex: nome do partido, slogan, apelido"
                            className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3"
                        />
                    </div>
                </div>
            )}

            {lastRunAt && (
                <p className="text-[11px] text-slate-500">
                    Última execução: {new Date(lastRunAt).toLocaleString()}
                </p>
            )}
        </Card>
    );
};

const DailyBriefingSection = () => {
    const { user } = useAuth();
    const [enabled, setEnabled] = useState(false);
    const [lastRunAt, setLastRunAt] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!user?.campaignId) return;
        let alive = true;
        (async () => {
            const { data } = await supabase.from('campaigns')
                .select('dailyBriefingEnabled, dailyBriefingLastRunAt')
                .eq('id', user.campaignId).maybeSingle();
            if (!alive || !data) return;
            setEnabled(!!data.dailyBriefingEnabled);
            setLastRunAt(data.dailyBriefingLastRunAt || null);
            setLoaded(true);
        })();
        return () => { alive = false; };
    }, [user?.campaignId]);

    const save = async (newEnabled: boolean) => {
        if (!user?.campaignId) return;
        setSaving(true);
        const { error } = await supabase.from('campaigns').update({ dailyBriefingEnabled: newEnabled }).eq('id', user.campaignId);
        setSaving(false);
        if (error) alert('Erro ao salvar: ' + error.message);
    };

    return (
        <Card className="border-t-4 border-t-indigo-500">
            <div className="flex items-center gap-3 mb-2">
                <AlertTriangle className="w-6 h-6 text-indigo-400" />
                <h3 className="text-lg font-bold text-slate-300">Briefing Diário (Análise interna)</h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">
                Diferente do monitoramento (que olha a internet), o Briefing Diário roda o Orquestrador 1x/dia
                de manhã para ANALISAR os dados da plataforma (visitas, contatos, funil, atividade da equipe) e
                DELEGAR tarefas aos agentes. Os achados viram alertas no War Room. Custo aproximado: R$ 0,30–R$ 1,50/dia.
            </p>
            <label className="flex items-center justify-between gap-4 p-3 bg-slate-800/50 rounded-xl">
                <div>
                    <p className="text-sm font-bold text-slate-200">Ativar briefing diário automático</p>
                    <p className="text-[11px] text-slate-500">
                        {enabled ? 'Ativo · roda toda manhã (horário de Brasília)' : 'Desativado'}
                    </p>
                </div>
                <input type="checkbox" checked={enabled} disabled={!loaded || saving}
                    onChange={e => { setEnabled(e.target.checked); save(e.target.checked); }} className="w-6 h-6" />
            </label>
            {lastRunAt && <p className="text-[11px] text-slate-500 mt-2">Última execução: {new Date(lastRunAt).toLocaleString()}</p>}
        </Card>
    );
};

const AIHealthSection = () => {
    const { user } = useAuth();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.campaignId) return;
        let alive = true;
        const load = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const r = await fetch(`/api/ai/health?campaignId=${user.campaignId}`, {
                    headers: { Authorization: `Bearer ${session?.access_token}` },
                });
                if (!r.ok) throw new Error(await r.text());
                const json = await r.json();
                if (alive) setData(json);
            } catch (e) {
                console.error('[AIHealth]', e);
            } finally {
                if (alive) setLoading(false);
            }
        };
        load();
        const intv = setInterval(load, 60_000); // refresh a cada minuto
        return () => { alive = false; clearInterval(intv); };
    }, [user?.campaignId]);

    const used = data?.month_total_brl ?? 0;
    const cap = data?.cap_brl ?? 100;
    const pct = Math.min(100, (used / cap) * 100);
    const overBudget = pct >= 100;
    const warning = pct >= 80;

    const topAgents = data?.by_agent
        ? Object.entries(data.by_agent as Record<string, { runs: number; cost_cents: number }>)
              .sort(([, a], [, b]) => b.cost_cents - a.cost_cents)
              .slice(0, 5)
        : [];

    return (
        <Card className="border-t-4 border-t-indigo-500">
            <div className="flex items-center gap-3 mb-4">
                <Brain className="w-6 h-6 text-indigo-400" />
                <h3 className="text-lg font-bold text-slate-300">AI Health</h3>
                {data?.errors_count > 0 && (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-red-400">
                        <AlertTriangle className="w-3 h-3" /> {data.errors_count} erro(s) este mês
                    </span>
                )}
            </div>

            {loading && <p className="text-sm text-slate-500">Carregando uso de IA…</p>}

            {!loading && data && (
                <>
                    <div className="mb-4">
                        <div className="flex justify-between items-baseline mb-2">
                            <p className="text-xs text-slate-400">Consumo de IA deste mês</p>
                            <p className={`text-xl font-black ${overBudget ? 'text-red-400' : warning ? 'text-yellow-400' : 'text-emerald-400'}`}>
                                {pct}% <span className="text-xs text-slate-500">do limite mensal</span>
                            </p>
                        </div>
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div
                                className={`h-full transition-all ${overBudget ? 'bg-red-500' : warning ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                        </div>
                        {overBudget && (
                            <p className="text-xs text-red-400 mt-2">
                                ⚠️ Limite mensal de IA atingido. Novas chamadas estão bloqueadas até virar o mês ou trocar de plano.
                            </p>
                        )}
                        {!overBudget && warning && (
                            <p className="text-xs text-yellow-400 mt-2">
                                Você está usando bastante IA esse mês. Considere o upgrade pro Plano Total (IA ilimitada).
                            </p>
                        )}
                    </div>

                    {/* Regra #111: usuário NÃO vê valores em R$/$/tokens. Só % e contadores. */}
                    <div className="grid grid-cols-2 gap-3 mb-4 text-center">
                        <Stat label="Chamadas este mês" value={data.runs_count} />
                        <Stat label="Erros" value={data.errors_count} className={data.errors_count > 0 ? 'text-red-400' : ''} />
                    </div>

                    {topAgents.length > 0 && (
                        <div>
                            <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">Agentes mais usados</p>
                            <ul className="space-y-1.5">
                                {topAgents.map(([agent, st]) => (
                                    <li key={agent} className="flex justify-between items-center text-sm">
                                        <span className="text-slate-300">{agent}</span>
                                        <span className="text-xs text-slate-500">{st.runs} chamada(s)</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </>
            )}
        </Card>
    );
};

const Stat: React.FC<{ label: string; value: any; className?: string }> = ({ label, value, className }) => (
    <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
        <p className={`text-lg font-black text-slate-200 ${className || ''}`}>{value}</p>
    </div>
);

const PublicCaptureLinkSection = () => {
    const { user } = useAuth();
    const [copied, setCopied] = useState(false);

    const captureUrl = user?.campaignId
        ? `${window.location.origin}/cadastro?c=${user.campaignId}`
        : '';

    const handleCopy = async () => {
        if (!captureUrl) return;
        try {
            await navigator.clipboard.writeText(captureUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback para contextos sem clipboard API (HTTP, browsers antigos)
            const ta = document.createElement('textarea');
            ta.value = captureUrl;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <Card className="border-t-4 border-t-blue-500">
            <h3 className="text-lg font-bold text-slate-300 mb-2">Link de Captura Pública</h3>
            <p className="text-sm text-slate-400 mb-6">
                Compartilhe este link em redes sociais, WhatsApp ou QR codes. Quem se cadastrar será adicionado automaticamente à sua base de eleitores com a origem <code className="bg-slate-700 px-1 rounded">App Externa</code>.
            </p>
            {captureUrl ? (
                <div className="flex flex-col sm:flex-row gap-3">
                    <input
                        readOnly
                        value={captureUrl}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-slate-200 text-sm font-mono"
                        onFocus={(e) => e.target.select()}
                    />
                    <button
                        onClick={handleCopy}
                        className={`px-6 py-3 rounded-xl font-bold transition-all ${
                            copied
                                ? 'bg-emerald-600 text-white'
                                : 'bg-blue-600 hover:bg-blue-500 text-white'
                        }`}
                    >
                        {copied ? '✓ Copiado!' : 'Copiar Link'}
                    </button>
                </div>
            ) : (
                <p className="text-sm text-amber-400">
                    Aguardando ID da campanha para gerar o link.
                </p>
            )}
        </Card>
    );
};

const MaintenanceSection = () => {
    const { user } = useAuth();
    const [syncing, setSyncing] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    const handleSync = async () => {
        if (!user?.campaignId) return;
        setSyncing(true);
        setResult(null);
        try {
            const count = await syncVoterJourneys(user.campaignId);
            setResult(`Sucesso! ${count} eleitores sincronizados com o motor de jornada.`);
        } catch (e) {
            setResult("Erro ao sincronizar dados.");
        } finally {
            setSyncing(false);
        }
    };

    return (
        <Card className="border-t-4 border-t-yellow-500">
            <h3 className="text-lg font-bold text-slate-300 mb-2">Manutenção e Sincronização</h3>
            <p className="text-sm text-slate-400 mb-6">
                Use esta ferramenta para atualizar a jornada de todos os eleitores antigos que ainda não possuem estágio de voto calculado.
            </p>
            <button 
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-2 bg-yellow-600 hover:bg-yellow-500 text-white px-6 py-2 rounded-xl font-bold transition-all disabled:opacity-50"
            >
                <RefreshIcon className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Sincronizando...' : 'Sincronizar Jornada do Eleitor'}
            </button>
            {result && <p className="mt-4 text-sm font-bold text-emerald-400">{result}</p>}
        </Card>
    );
};

export default SettingsPage;