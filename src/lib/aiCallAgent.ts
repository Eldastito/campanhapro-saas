/**
 * callAgent — orquestrador único de chamadas a IA com:
 *   - Provider chain: OpenAI → Anthropic → Gemini (cai pro próximo se 1 falhar)
 *   - Retry com backoff exponencial (3 tentativas dentro do mesmo provider)
 *   - Timeout de 60s
 *   - Budget hard cap por campanha (R$100/mês)
 *   - Log estruturado em agent_runs (tokens, custo, latência, erro)
 *   - Tool calling padronizado (mesmo formato OpenAI; outros providers serão
 *     adaptados quando entrarem no chain)
 *
 * Importar APENAS no server.ts (usa SUPABASE_SERVICE_ROLE_KEY pra escrever em agent_runs).
 */
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type Provider = 'openai' | 'anthropic' | 'gemini';

export interface AgentConfig {
    /** ID interno (strategist, growth, manager, etc.) */
    agentId: string;
    /** Modelo preferido (sobrescreve default do provider) */
    model?: { openai?: string; anthropic?: string; gemini?: string };
    /** Temperature (0–1). Default 0.7. Strategist menor, Creative maior. */
    temperature?: number;
    /** Max tokens da resposta. Default 4000. */
    maxTokens?: number;
}

export interface CallAgentOpts {
    campaignId: string;
    userId?: string | null;
    /** Pra agrupar calls do mesmo Manager. */
    managerRunId?: string | null;
    systemInstruction?: string;
    /** Tools no formato OpenAI; o helper converte pros outros providers. */
    tools?: any[];
    /** Override pra pular providers (debug). */
    forceProvider?: Provider;
    /**
     * Quando true E o provider for Anthropic, anexa o tool nativo `web_search_20250305`
     * (max 5 buscas por chamada, ~$0.05 USD). Útil pro Manager fazer monitoramento
     * competitivo e defesa de imagem em tempo real.
     */
    enableWebSearch?: boolean;
}

export interface CallAgentResult {
    text: string;
    toolCalls: any[];
    provider: Provider;
    model: string;
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
    costCentsUsd: number;
    runId: string;
    /** Buscas web realizadas (Anthropic web_search). 0 quando não usou. */
    webSearches?: number;
    /** Citações extraídas da web (URLs e títulos pra exibir/auditar). */
    citations?: Array<{ url: string; title: string; cited_text?: string }>;
}

export class BudgetExceededError extends Error {
    constructor(public spentCents: number, public capCents: number) {
        super(`Budget mensal de R$${(capCents / 100 * BRL_PER_USD).toFixed(2)} atingido nesta campanha (já gastou US$${(spentCents / 100).toFixed(2)}).`);
        this.name = 'BudgetExceededError';
    }
}

// ---------------------------------------------------------------------------
// Config global (ajustável)
// ---------------------------------------------------------------------------

/** Cap mensal por campanha em centavos USD. R$100 ≈ $18.18 (taxa abaixo). */
const BRL_PER_USD = Number(process.env.BRL_PER_USD || 5.50);
const MONTHLY_CAP_CENTS_USD = Math.round(10000 / BRL_PER_USD); // R$100/mês → cents USD

/** Order of providers — Anthropic primeiro (suporta web_search nativo). */
const PROVIDER_CHAIN: Provider[] = ['anthropic', 'openai', 'gemini'];

const TIMEOUT_MS = 60_000;
const MAX_RETRIES_PER_PROVIDER = 3;

/** Modelos default por provider. */
const DEFAULT_MODELS: Record<Provider, string> = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5',
    gemini: 'gemini-1.5-flash',
};

/** Tabela de preços (USD por 1M tokens). Atualizar quando mudar. */
const PRICING: Record<string, { in: number; out: number }> = {
    // OpenAI
    'gpt-4o-mini':                { in: 0.15, out: 0.60 },
    'gpt-4o':                     { in: 2.50, out: 10.00 },
    // Anthropic — Claude 4.x family
    'claude-haiku-4-5':           { in: 1.00, out: 5.00 },
    'claude-haiku-4-5-20251001':  { in: 1.00, out: 5.00 },
    'claude-sonnet-4-5':          { in: 3.00, out: 15.00 },
    'claude-sonnet-4-5-20250929': { in: 3.00, out: 15.00 },
    'claude-sonnet-4-6':          { in: 3.00, out: 15.00 },
    'claude-opus-4-7':            { in: 15.00, out: 75.00 },
    // Gemini
    'gemini-1.5-flash':           { in: 0.075, out: 0.30 },
    'gemini-1.5-pro':             { in: 1.25, out: 5.00 },
};

/** Custo do web_search nativo da Anthropic — US$ 10 por 1.000 buscas = 1 cent USD por busca. */
const WEB_SEARCH_COST_CENTS_PER_USE = 1;

const calcCostCents = (model: string, tokensIn: number, tokensOut: number): number => {
    const p = PRICING[model];
    if (!p) return 0;
    const usd = (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out;
    return Math.ceil(usd * 100);
};

// ---------------------------------------------------------------------------
// Budget check (lê agent_runs do mês corrente)
// ---------------------------------------------------------------------------

const getMonthSpentCents = async (supabaseAdmin: any, campaignId: string): Promise<number> => {
    if (!supabaseAdmin) return 0;
    // Agregação no Postgres — barato e preciso.
    const { data, error } = await supabaseAdmin.rpc('agent_month_spent_cents', { p_campaign_id: campaignId });
    if (!error && typeof data === 'number') return data;
    // Fallback: SELECT manual (caso a RPC ainda não exista no banco).
    const startOfMonth = new Date(); startOfMonth.setUTCDate(1); startOfMonth.setUTCHours(0,0,0,0);
    const { data: rows } = await supabaseAdmin
        .from('agent_runs')
        .select('cost_cents_usd')
        .eq('campaign_id', campaignId)
        .gte('created_at', startOfMonth.toISOString());
    return (rows || []).reduce((s: number, r: any) => s + (r.cost_cents_usd || 0), 0);
};

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface RawCallResult {
    text: string;
    toolCalls: any[];
    tokensIn: number;
    tokensOut: number;
    model: string;
    /** Buscas web executadas (Anthropic web_search). */
    webSearches?: number;
    /** Citações extraídas (URL, title, cited_text). */
    citations?: Array<{ url: string; title: string; cited_text?: string }>;
}

/** OpenAI Chat Completions com tool calling. */
const callOpenAI = async (
    config: AgentConfig,
    systemInstruction: string | undefined,
    prompt: string,
    tools: any[] | undefined
): Promise<RawCallResult> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY ausente');
    const model = config.model?.openai || DEFAULT_MODELS.openai;

    const messages: any[] = [];
    if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
    messages.push({ role: 'user', content: prompt });

    const body: any = {
        model,
        messages,
        temperature: config.temperature ?? 0.7,
        max_tokens: config.maxTokens ?? 4000,
    };
    if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
    }

    const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        body,
        {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: TIMEOUT_MS,
        }
    );

    const msg = response.data.choices[0].message;
    const usage = response.data.usage || {};
    return {
        text: msg.content || '',
        toolCalls: msg.tool_calls || [],
        tokensIn: usage.prompt_tokens || 0,
        tokensOut: usage.completion_tokens || 0,
        model,
    };
};

/** Anthropic Messages API com tool use + web_search nativo. */
const callAnthropic = async (
    config: AgentConfig,
    systemInstruction: string | undefined,
    prompt: string,
    tools: any[] | undefined,
    enableWebSearch: boolean
): Promise<RawCallResult> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente');
    const model = config.model?.anthropic || DEFAULT_MODELS.anthropic;

    const client = new Anthropic({ apiKey });

    // Converte tools do formato OpenAI -> Anthropic.
    const anthropicTools: any[] = (tools || []).map(t => ({
        name: t.function?.name || t.name,
        description: t.function?.description || t.description,
        input_schema: t.function?.parameters || t.input_schema || { type: 'object', properties: {} },
    }));

    // Anexa o tool nativo de busca web (server tool, executado pela Anthropic).
    if (enableWebSearch) {
        anthropicTools.push({
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 5,
            user_location: { type: 'approximate', country: 'BR', timezone: 'America/Sao_Paulo' },
        });
    }

    const response = await client.messages.create({
        model,
        max_tokens: config.maxTokens ?? 4000,
        temperature: config.temperature ?? 0.7,
        system: systemInstruction,
        messages: [{ role: 'user', content: prompt }],
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    });

    let text = '';
    const toolCalls: any[] = [];
    const citations: Array<{ url: string; title: string; cited_text?: string }> = [];
    for (const block of response.content as any[]) {
        if (block.type === 'text') {
            text += block.text;
            // Coleta citações (web_search adiciona aqui)
            for (const cit of block.citations || []) {
                if (cit.url) citations.push({ url: cit.url, title: cit.title || '', cited_text: cit.cited_text });
            }
        } else if (block.type === 'tool_use') {
            // Normaliza pro shape do OpenAI (compatibilidade com handler existente)
            toolCalls.push({
                id: block.id,
                type: 'function',
                function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input),
                },
            });
        }
        // server_tool_use e web_search_tool_result são executados internamente pela Anthropic
        // — não viram tool_calls pra a gente executar; só geram citações no texto final.
    }

    const webSearches = (response.usage as any)?.server_tool_use?.web_search_requests || 0;

    return {
        text,
        toolCalls,
        tokensIn: response.usage.input_tokens,
        tokensOut: response.usage.output_tokens,
        model,
        webSearches,
        citations: citations.length > 0 ? citations : undefined,
    };
};

/** Gemini fallback (sem tools por enquanto — Gemini é último recurso). */
const callGemini = async (
    config: AgentConfig,
    systemInstruction: string | undefined,
    prompt: string
): Promise<RawCallResult> => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY ausente');
    const model = config.model?.gemini || DEFAULT_MODELS.gemini;
    const fullPrompt = systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await axios.post(url, {
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: {
            temperature: config.temperature ?? 0.7,
            maxOutputTokens: config.maxTokens ?? 4000,
        },
    }, { timeout: TIMEOUT_MS });

    const candidate = response.data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p: any) => p.text).join('') || '';
    const usage = response.data.usageMetadata || {};
    return {
        text,
        toolCalls: [],
        tokensIn: usage.promptTokenCount || 0,
        tokensOut: usage.candidatesTokenCount || 0,
        model,
    };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Configuração POR AGENTE — temperatura, modelo preferido, etc.
 * Mantém os defaults sensíveis (Strategist mais determinístico, Creative mais criativo).
 */
export const AGENT_CONFIGS: Record<string, AgentConfig> = {
    // Manager merece o modelo melhor (decisões orquestradas, raciocínio multi-step + web_search)
    manager:    { agentId: 'manager',    temperature: 0.3, model: { anthropic: 'claude-sonnet-4-5', openai: 'gpt-4o-mini' } },
    strategist: { agentId: 'strategist', temperature: 0.4 },
    growth:     { agentId: 'growth',     temperature: 0.7 },
    social:     { agentId: 'social',     temperature: 0.8 },
    field:      { agentId: 'field',      temperature: 0.4 },
    creative:   { agentId: 'creative',   temperature: 0.9 },
    crm:        { agentId: 'crm',        temperature: 0.5 },
    fraud:      { agentId: 'fraud',      temperature: 0.2 }, // Auditor: máximo determinismo
    backup:     { agentId: 'backup',     temperature: 0.2 },
    secretary:  { agentId: 'secretary',  temperature: 0.1, maxTokens: 1000 }, // JSON estrito → mínima criatividade
    advisor:    { agentId: 'advisor',    temperature: 0.6 },
    pipeline:   { agentId: 'pipeline',   temperature: 0.7, maxTokens: 6000 },
};

/**
 * Chamada principal. Retorna resultado da IA + dados de auditoria.
 * Lança BudgetExceededError se a campanha estourou o cap mensal.
 */
export async function callAgent(
    supabaseAdmin: any,
    agentId: string,
    prompt: string,
    opts: CallAgentOpts
): Promise<CallAgentResult> {
    const config = AGENT_CONFIGS[agentId] || { agentId };

    // 1. Budget check (não-bloqueante se Supabase admin não disponível)
    if (supabaseAdmin) {
        const spent = await getMonthSpentCents(supabaseAdmin, opts.campaignId);
        if (spent >= MONTHLY_CAP_CENTS_USD) {
            // Loga a tentativa bloqueada pra rastreabilidade
            await supabaseAdmin.from('agent_runs').insert({
                campaign_id: opts.campaignId,
                user_id: opts.userId || null,
                manager_run_id: opts.managerRunId || null,
                agent_id: agentId,
                provider: 'none',
                model: 'none',
                action: 'budget_blocked',
                prompt_excerpt: prompt.slice(0, 500),
                tokens_in: 0,
                tokens_out: 0,
                cost_cents_usd: 0,
                status: 'budget_exceeded',
                error: `Mensal ${spent} cents >= cap ${MONTHLY_CAP_CENTS_USD}`,
            }).then(() => {}, (e: any) => console.error('[callAgent] log budget_exceeded falhou:', e));
            throw new BudgetExceededError(spent, MONTHLY_CAP_CENTS_USD);
        }
    }

    // 2. Tenta cada provider em ordem; dentro de cada, retry com backoff.
    const providers = opts.forceProvider ? [opts.forceProvider] : PROVIDER_CHAIN;
    let lastError: any = null;

    for (const provider of providers) {
        for (let attempt = 1; attempt <= MAX_RETRIES_PER_PROVIDER; attempt++) {
            const startedAt = Date.now();
            try {
                let raw: RawCallResult;
                if (provider === 'openai') {
                    raw = await callOpenAI(config, opts.systemInstruction, prompt, opts.tools);
                } else if (provider === 'anthropic') {
                    raw = await callAnthropic(config, opts.systemInstruction, prompt, opts.tools, !!opts.enableWebSearch);
                } else {
                    raw = await callGemini(config, opts.systemInstruction, prompt);
                }
                const latencyMs = Date.now() - startedAt;
                const costCents = calcCostCents(raw.model, raw.tokensIn, raw.tokensOut)
                    + (raw.webSearches || 0) * WEB_SEARCH_COST_CENTS_PER_USE;

                // Log de sucesso
                let runId = '';
                if (supabaseAdmin) {
                    const { data } = await supabaseAdmin.from('agent_runs').insert({
                        campaign_id: opts.campaignId,
                        user_id: opts.userId || null,
                        manager_run_id: opts.managerRunId || null,
                        agent_id: agentId,
                        provider,
                        model: raw.model,
                        action: 'chat',
                        prompt_excerpt: prompt.slice(0, 500),
                        response_excerpt: (raw.text || '').slice(0, 500),
                        tokens_in: raw.tokensIn,
                        tokens_out: raw.tokensOut,
                        cost_cents_usd: costCents,
                        latency_ms: latencyMs,
                        status: 'ok',
                        metadata: {
                            temperature: config.temperature,
                            attempt,
                            tools_offered: opts.tools?.length || 0,
                            tools_called: raw.toolCalls.length,
                            web_searches: raw.webSearches || 0,
                            citations: raw.citations || null,
                        },
                    }).select('id').single();
                    runId = data?.id || '';

                    // Phase 8 — billing: mirror cost into usage_records for plan budget tracking
                    try {
                        await supabaseAdmin.from('usage_records').insert({
                            campaign_id: opts.campaignId,
                            metric: 'ai_call',
                            quantity: 1,
                            cost_cents: costCents,
                            metadata: { provider, model: raw.model, agentId, runId },
                        });
                    } catch (e) {
                        // never block on billing telemetry
                    }
                }

                return {
                    text: raw.text,
                    toolCalls: raw.toolCalls,
                    provider,
                    model: raw.model,
                    latencyMs,
                    tokensIn: raw.tokensIn,
                    tokensOut: raw.tokensOut,
                    costCentsUsd: costCents,
                    runId,
                    webSearches: raw.webSearches,
                    citations: raw.citations,
                };
            } catch (err: any) {
                lastError = err;
                const latencyMs = Date.now() - startedAt;
                const isLastAttempt = attempt === MAX_RETRIES_PER_PROVIDER;
                const willRetry = !isLastAttempt;

                // Log de erro
                if (supabaseAdmin) {
                    await supabaseAdmin.from('agent_runs').insert({
                        campaign_id: opts.campaignId,
                        user_id: opts.userId || null,
                        manager_run_id: opts.managerRunId || null,
                        agent_id: agentId,
                        provider,
                        model: config.model?.[provider] || DEFAULT_MODELS[provider],
                        action: 'chat',
                        prompt_excerpt: prompt.slice(0, 500),
                        tokens_in: 0,
                        tokens_out: 0,
                        cost_cents_usd: 0,
                        latency_ms: latencyMs,
                        status: err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '') ? 'timeout' : 'error',
                        error: String(err?.message || err).slice(0, 500),
                        metadata: { attempt, willRetry, willFallbackProvider: isLastAttempt && provider !== providers[providers.length - 1] },
                    }).then(() => {}, (e: any) => console.error('[callAgent] log error falhou:', e));
                }

                console.warn(`[callAgent] ${agentId} via ${provider} (attempt ${attempt}/${MAX_RETRIES_PER_PROVIDER}) falhou:`, err?.message);

                if (willRetry) {
                    await sleep(500 * Math.pow(2, attempt - 1)); // 500ms, 1s, 2s
                }
            }
        }
        // Esgotou retries deste provider — passa pro próximo no chain.
    }

    // Todos os providers falharam.
    throw new Error(
        `Todos os providers de IA falharam (${providers.join(', ')}). Último erro: ${lastError?.message || 'desconhecido'}`
    );
}
