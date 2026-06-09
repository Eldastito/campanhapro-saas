/**
 * Manager Agent — orquestrador do time de IA da War Room.
 *
 * Recebe uma "intenção" do usuário e decide quais sub-agentes chamar,
 * em que ordem, com quais prompts. Loop até consolidar uma resposta final.
 *
 * Cada execução cria 1 row em `manager_runs`. Cada sub-call propaga o
 * `manager_run_id` em `agent_runs` pra agrupar custo/tokens.
 *
 * Limites de segurança:
 *   - MAX_ITERATIONS: cap de loops (evita runaway)
 *   - MAX_RUN_BUDGET_CENTS: cap de custo por execução (USD cents)
 *   - O cap mensal global por campanha (callAgent) também se aplica
 */
import { callAgent, AGENT_CONFIGS, BudgetExceededError } from './aiCallAgent';
import { AGENT_INSTRUCTIONS, CAMPAIGN_MISSION, COMPETITIVE_INTELLIGENCE_GUIDELINE, CRISIS_DEFENSE_GUIDELINE } from './agentInstructions';
import { READ_TOOL_DEFS, executeReadTool, isReadTool } from './agentReadTools';
import { toolsForAgent } from './agentRegistry';
import { retrieveContext } from '../server/modules/rag/knowledgeIngest';

const MAX_ITERATIONS = 8;
const MAX_RUN_BUDGET_CENTS = 200; // ~US$ 2 por execução do Manager (= ~R$ 11)

const MANAGER_SYSTEM_PROMPT = `# System Prompt: Chefe de Gabinete (Manager Agent / CEO da War Room)

${CAMPAIGN_MISSION}

${COMPETITIVE_INTELLIGENCE_GUIDELINE}

${CRISIS_DEFENSE_GUIDELINE}

# SEU PAPEL
Você é o Chefe de Gabinete da campanha. Recebe uma INTENÇÃO do candidato/coordenador
e ORQUESTRA agressivamente os 7 especialistas (sub-agentes) pra resolvê-la com profundidade.

## REGRA DE OURO: Você NUNCA finaliza com 1 só agente quando a intenção pede ação.

Se a intenção menciona:
- "publicar / postar / criar conteúdo" → você OBRIGATORIAMENTE chama: **CRM** (entender base), **Strategist** (diretriz), **Social** (texto), e se tiver imagem **Creative** (roteiro visual). Chame em paralelo.
- "auditar / verificar fraude / olhar suspeito" → SEMPRE **CRM** + **Fraud** (Fraud nunca trabalha sozinho — precisa contexto do CRM).
- "campo / rua / panfletagem / mobilização" → **Field** + **CRM** (saber onde estão os indecisos).
- "estratégia / o que fazer / como ganhar" → **Strategist** + (CRM e Field em paralelo).
- "engajar / converter indecisos / aumentar base" → **Growth** + **CRM** + **Strategist**.
- "tudo / análise completa / relatório geral" → TODOS os 7 (Strategist, Growth, Field, Social, Creative, CRM, Fraud) em 2 ondas.

## Sub-agentes (cada um é uma TOOL)

- **call_strategist**: Diretor Político. KPIs, diretriz, leitura de cenário.
- **call_growth**: Arquiteto de Conversão. Funis, réguas de mensagem, campanhas de captação.
- **call_field**: Comandante de Campo. Rotas, panfletagem, mobilização territorial.
- **call_social**: Social Media. Roteiros prontos pra Instagram/WhatsApp, neutralização de ataques.
- **call_creative**: Produtor Criativo. Descrição visual de imagens/vídeos (não gera imagem, só descreve).
- **call_crm**: Especialista em CRM Eleitoral. Segmenta a base, identifica multiplicadores e indecisos.
- **call_fraud**: Auditor de Integridade. Score de risco com evidência.

## Padrão de execução em 3 fases

**FASE 1 — DESCOBERTA (paralelo)**: chame os agentes que DESCREVEM o estado atual (CRM, Field, Fraud).
**FASE 2 — DECISÃO (paralelo)**: alimentando os outputs da Fase 1, chame Strategist + Growth pra desenhar a ação.
**FASE 3 — EXECUÇÃO (paralelo)**: chame Social/Creative pra produzir os ativos prontos pra publicar.

Não pule fases. Não chame um único agente exceto se a intenção for explicitamente "só me responda X" (saudação, pergunta trivial).

## FILTRO DE ESCOPO (PRIMEIRA COISA QUE VOCÊ FAZ)

Antes de chamar QUALQUER agente, classifique a intenção:

- **DENTRO DO ESCOPO** (campanha eleitoral, base de eleitores, conteúdo político, mobilização, ataques/defesa, demandas da população relacionadas ao candidato/propostas) → siga normalmente.
- **FORA DO ESCOPO** (receita de bolo, ajudar com programação, conselho pessoal não-político, etc.) → **NÃO chame nenhum agente**. Chame **finalize** com este sumário:
  > "Sou o Chefe de Gabinete da campanha. Só posso ajudar com temas eleitorais e relacionados. Reformule sua intenção dentro desse contexto, por favor."

## INTELIGÊNCIA COMPETITIVA E DEFESA (responsabilidade contínua)

Mesmo quando a intenção do usuário NÃO é sobre adversários ou crise, você deve:
1. Considerar se a ação proposta pode dar margem pra ataque do adversário (e blindar).
2. Se a intenção MENCIONAR adversário, ataque, fake news, manchete negativa ou crise:
   - Ative o **Protocolo de Defesa** descrito no CRISIS_DEFENSE_GUIDELINE acima.
   - Sempre chame o **Auditor de Fraude** primeiro pra verificar se o ataque é orgânico ou bot/fake.
   - Em paralelo, chame o **Estrategista** pra ler o cenário macro.
   - Depois, chame o **Social Media** pra preparar resposta (se necessário).
3. Se você suspeitar de movimento competitivo (ex: pauta nova de adversário ganhando tração) mesmo sem o usuário pedir explicitamente, mencione no sumário final como **"Alerta competitivo"** com sugestão de ação.

## Restrições

- Você tem **${MAX_ITERATIONS} rodadas no total** (cada rodada = 1 round de chamadas paralelas). Use bem.
- Cada \`call_X\` deve ter um **prompt específico** pro especialista (não a intenção crua) e um **reason** curto explicando porque chamou.
- Não invente dados. Se faltar contexto factual, peça pro CRM/Field trazer.
- Conteúdo gerado por IA sempre marca "[Conteúdo gerado por IA]" no sumário final.
- **NUNCA produza ataque pessoal contra adversários nominalmente** (risco jurídico). Defenda propostas próprias; rebata fato com fato.

## Formato do finalize

Ao chamar **finalize**, passe um \`summary\` com:
1. **Decisão** (1-2 frases consolidando o que será feito)
2. **Ações concretas** (lista numerada: quem / o quê / quando / métrica de sucesso)
3. **Conteúdo pronto pra usar** (se aplicável: copie o post, o roteiro, a rota, etc.)
4. **Próximo passo humano** (uma única ação que o usuário deve fazer agora)
`;

const MANAGER_TOOLS = [
    'strategist','growth','field','social','creative','crm','fraud'
].map(agentId => ({
    type: 'function',
    function: {
        name: `call_${agentId}`,
        description: `Aciona o especialista ${agentId}. Passe um prompt CLARO e específico — não jogue a intenção crua, traduza pro escopo dele.`,
        parameters: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: 'Pergunta/tarefa específica pro especialista, em português, com contexto necessário.' },
                reason: { type: 'string', description: 'Por que você está chamando este especialista agora (1 frase). Vai pro log.' }
            },
            required: ['prompt']
        }
    }
})).concat([{
    type: 'function',
    function: {
        name: 'finalize',
        description: 'Encerra a execução com um sumário consolidado pro usuário humano.',
        parameters: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'Texto final consolidado em português.' }
            },
            required: ['summary']
        }
    }
} as any]);

// Instruções dos sub-agentes vêm de AGENT_INSTRUCTIONS (fonte única).
// Quando o Manager chama via tool, anexamos uma diretriz curta de FORMATO DA RESPOSTA
// pra obter outputs mais concisos (Manager precisa consolidar tudo).
const SUB_AGENT_RESPONSE_HINT: Record<string, string> = {
    strategist: '\n\n---\n[FORMATO PRO MANAGER]: Responda em até 200 palavras, com KPIs concretos.',
    growth:     '\n\n---\n[FORMATO PRO MANAGER]: Responda em até 200 palavras, com sequência prática (dia 1, dia 3, etc.).',
    field:      '\n\n---\n[FORMATO PRO MANAGER]: Responda em até 200 palavras, com bairros e horários específicos.',
    social:     '\n\n---\n[FORMATO PRO MANAGER]: Devolva 1 ou 2 posts prontos pra publicar (≤180 palavras cada). Sempre marque "[Conteúdo gerado por IA]".',
    creative:   '\n\n---\n[FORMATO PRO MANAGER]: Descrição visual em 3 parágrafos curtos, sem gerar imagem.',
    crm:        '\n\n---\n[FORMATO PRO MANAGER]: Liste 3-5 segmentos identificáveis e ação por segmento.',
    fraud:      '\n\n---\n[FORMATO PRO MANAGER]: Atribua score de risco 0-100 com justificativa em até 150 palavras.',
};

const buildSubAgentInstruction = (agentId: string): string => {
    const base = AGENT_INSTRUCTIONS[agentId] || `Você é o agente ${agentId}.`;
    const hint = SUB_AGENT_RESPONSE_HINT[agentId] || '';
    return base + hint;
};

interface SubAgentResult { text: string; costCents: number; tokensIn: number; tokensOut: number; latencyMs: number; toolsUsed: string[]; }

/**
 * Roda UM sub-agente com as capacidades da Fase 1: injeta memória RAG no prompt,
 * oferece as ferramentas de LEITURA pertinentes (registry), executa as que o
 * agente chamar e faz um follow-up pra consolidar — para o sub-agente do
 * orquestrador deixar de responder "no vácuo".
 */
async function runSubAgent(
    supabaseAdmin: any, subAgentId: string, prompt: string,
    ctx: { campaignId: string; userId?: string | null; managerRunId: string }
): Promise<SubAgentResult> {
    const { campaignId, userId, managerRunId } = ctx;

    // RAG: memória relevante (best-effort, timeout interno).
    let effectivePrompt = prompt;
    const memoria = await retrieveContext(supabaseAdmin, campaignId, prompt, 4);
    if (memoria) {
        effectivePrompt = `CONTEXTO DA CAMPANHA (memória — use o relevante, não invente além disto):\n${memoria}\n\n---\n\n${prompt}`;
    }

    const tools = toolsForAgent(READ_TOOL_DEFS, subAgentId);
    const sub = await callAgent(supabaseAdmin, subAgentId, effectivePrompt, {
        campaignId, userId, managerRunId,
        systemInstruction: buildSubAgentInstruction(subAgentId),
        tools: tools.length ? tools : undefined,
    });

    let text = sub.text;
    let costCents = sub.costCentsUsd, tokensIn = sub.tokensIn, tokensOut = sub.tokensOut, latencyMs = sub.latencyMs;
    const toolsUsed: string[] = [];

    const readCalls = (sub.toolCalls || []).filter((c: any) => isReadTool(c.function?.name));
    if (readCalls.length) {
        const results: { name: string; output: any }[] = [];
        for (const c of readCalls) {
            const name = c.function.name;
            let cargs: any = {}; try { cargs = JSON.parse(c.function.arguments || '{}'); } catch { /* ignore */ }
            toolsUsed.push(name);
            results.push({ name, output: await executeReadTool(supabaseAdmin, campaignId, name, cargs) });
        }
        // Follow-up: alimenta os dados reais de volta pra resposta final do sub-agente.
        const followup = await callAgent(
            supabaseAdmin, subAgentId,
            `${effectivePrompt}\n\n[DADOS REAIS CONSULTADOS]\n${results.map(r => `- ${r.name}: ${JSON.stringify(r.output).slice(0, 1500)}`).join('\n')}\n\nUse estes dados reais (não invente) e gere a resposta final.`,
            { campaignId, userId, managerRunId, systemInstruction: buildSubAgentInstruction(subAgentId) }
        );
        if (followup.text) text = followup.text;
        costCents += followup.costCentsUsd; tokensIn += followup.tokensIn; tokensOut += followup.tokensOut; latencyMs += followup.latencyMs;
    }

    return { text, costCents, tokensIn, tokensOut, latencyMs, toolsUsed };
}

export interface ManagerEvent {
    type: 'started' | 'manager_thinking' | 'tool_call' | 'tool_result' | 'iteration' | 'finalized' | 'error' | 'budget_exceeded';
    data: any;
    timestamp: string;
}

export interface ManagerRunResult {
    managerRunId: string;
    status: 'done' | 'error' | 'budget_exceeded' | 'max_iter';
    finalSummary: string;
    iterations: number;
    totalCostCents: number;
    totalTokensIn: number;
    totalTokensOut: number;
    plan: any[];
    error?: string;
}

interface RunManagerOpts {
    supabaseAdmin: any;
    campaignId: string;
    userId?: string | null;
    intent: string;
    onEvent?: (event: ManagerEvent) => void;
}

const emit = (cb: ((e: ManagerEvent) => void) | undefined, type: ManagerEvent['type'], data: any) => {
    if (cb) cb({ type, data, timestamp: new Date().toISOString() });
};

export async function runManager({
    supabaseAdmin, campaignId, userId, intent, onEvent
}: RunManagerOpts): Promise<ManagerRunResult> {
    if (!supabaseAdmin) throw new Error('supabaseAdmin necessário pro Manager');

    // 1. Cria a row do manager_run
    const { data: row, error: rowErr } = await supabaseAdmin.from('manager_runs').insert({
        campaignId,
        userId: userId || null,
        intent,
        status: 'running',
        plan: [],
        startedAt: new Date().toISOString(),
    }).select('id').single();
    if (rowErr) throw new Error('Erro ao criar manager_run: ' + rowErr.message);
    const managerRunId: string = row.id;
    emit(onEvent, 'started', { managerRunId, intent });

    const plan: any[] = [];
    let totalCost = 0, totalIn = 0, totalOut = 0;
    let iterations = 0;
    let finalSummary = '';
    let status: ManagerRunResult['status'] = 'done';
    let errorMsg: string | undefined;

    // Histórico que cresce a cada turno e alimenta o próximo prompt do Manager
    const history: { role: string; content: string }[] = [
        { role: 'user', content: `INTENÇÃO DO USUÁRIO:\n${intent}` }
    ];

    try {
        while (iterations < MAX_ITERATIONS) {
            iterations += 1;
            emit(onEvent, 'iteration', { iteration: iterations, max: MAX_ITERATIONS });

            // Cap de orçamento por execução do Manager
            if (totalCost >= MAX_RUN_BUDGET_CENTS) {
                status = 'budget_exceeded';
                errorMsg = `Orçamento da execução estourado (${totalCost}/${MAX_RUN_BUDGET_CENTS} cents USD)`;
                emit(onEvent, 'budget_exceeded', { totalCost, cap: MAX_RUN_BUDGET_CENTS });
                break;
            }

            emit(onEvent, 'manager_thinking', { iteration: iterations });

            // Renderiza histórico em texto pro Manager (sem precisar tool_results encadeados — mais portável entre providers)
            const historyText = history.map(h => `### ${h.role.toUpperCase()}\n${h.content}`).join('\n\n');
            const managerResponse = await callAgent(
                supabaseAdmin, 'manager',
                historyText + `\n\nVocê tem ${MAX_ITERATIONS - iterations} rodadas restantes e ${MAX_RUN_BUDGET_CENTS - totalCost} cents de budget. Decida o próximo passo.`,
                {
                    campaignId, userId,
                    managerRunId,
                    systemInstruction: MANAGER_SYSTEM_PROMPT,
                    tools: MANAGER_TOOLS as any,
                    enableWebSearch: true, // permite que o Manager pesquise notícias/redes em tempo real
                }
            );
            totalCost += managerResponse.costCentsUsd;
            totalIn += managerResponse.tokensIn;
            totalOut += managerResponse.tokensOut;

            const calls = managerResponse.toolCalls || [];

            // Manager respondeu sem tool? Trata como resposta direta = finalize implícito
            if (calls.length === 0) {
                finalSummary = managerResponse.text || '(sem texto final)';
                emit(onEvent, 'finalized', { summary: finalSummary, implicit: true });
                break;
            }

            // Procura finalize nas tools
            const finalizeCall = calls.find((c: any) => c.function.name === 'finalize');
            if (finalizeCall) {
                const args = JSON.parse(finalizeCall.function.arguments || '{}');
                finalSummary = args.summary || managerResponse.text || '';
                emit(onEvent, 'finalized', { summary: finalSummary, implicit: false });
                break;
            }

            // Executa todas as outras tools EM PARALELO (cada uma é call_<agentId>)
            const subResults = await Promise.all(calls.map(async (c: any) => {
                const args = JSON.parse(c.function.arguments || '{}');
                const subAgentId = c.function.name.replace(/^call_/, '');
                if (!AGENT_CONFIGS[subAgentId]) {
                    return { call: c, error: `Sub-agente desconhecido: ${subAgentId}` };
                }
                emit(onEvent, 'tool_call', { agent: subAgentId, prompt: args.prompt, reason: args.reason });
                try {
                    const sub = await runSubAgent(supabaseAdmin, subAgentId, args.prompt, { campaignId, userId, managerRunId });
                    totalCost += sub.costCents;
                    totalIn += sub.tokensIn;
                    totalOut += sub.tokensOut;
                    emit(onEvent, 'tool_result', { agent: subAgentId, response: sub.text, costCents: sub.costCents, latencyMs: sub.latencyMs, toolsUsed: sub.toolsUsed });
                    plan.push({ iteration: iterations, agent: subAgentId, prompt: args.prompt, reason: args.reason, toolsUsed: sub.toolsUsed, response_excerpt: sub.text.slice(0, 300) });
                    return { call: c, response: sub.text };
                } catch (e: any) {
                    emit(onEvent, 'tool_result', { agent: subAgentId, error: e?.message });
                    plan.push({ iteration: iterations, agent: subAgentId, prompt: args.prompt, error: e?.message });
                    return { call: c, error: e?.message };
                }
            }));

            // Adiciona ao histórico um turn "assistant" + um "user" com os resultados
            history.push({
                role: 'assistant',
                content: `Decisão (rodada ${iterations}): ${managerResponse.text || '(sem reflexão)'}\n\nTools chamadas:\n` + calls.map((c: any) => `- ${c.function.name}: ${c.function.arguments}`).join('\n')
            });
            history.push({
                role: 'user',
                content: 'RESULTADOS DAS TOOLS:\n\n' + subResults.map((r: any) => {
                    const agent = r.call.function.name.replace(/^call_/, '');
                    return `### ${agent}\n${r.error ? '[ERRO] ' + r.error : r.response}`;
                }).join('\n\n')
            });
        }

        if (iterations >= MAX_ITERATIONS && !finalSummary) {
            status = 'max_iter';
            errorMsg = `Atingiu ${MAX_ITERATIONS} rodadas sem finalize`;
            // Tenta uma última finalização forçada
            try {
                const force = await callAgent(supabaseAdmin, 'manager',
                    history.map(h => `### ${h.role.toUpperCase()}\n${h.content}`).join('\n\n') + '\n\nVocê atingiu o limite de rodadas. Consolide AGORA o que tem em um sumário final.',
                    { campaignId, userId, managerRunId, systemInstruction: MANAGER_SYSTEM_PROMPT }
                );
                totalCost += force.costCentsUsd;
                finalSummary = force.text;
            } catch { /* mantém finalSummary vazio */ }
        }
    } catch (err: any) {
        if (err instanceof BudgetExceededError) {
            status = 'budget_exceeded';
            errorMsg = err.message;
            emit(onEvent, 'budget_exceeded', { error: err.message });
        } else {
            status = 'error';
            errorMsg = err?.message || String(err);
            emit(onEvent, 'error', { error: errorMsg });
        }
    }

    // Atualiza row do manager_run com resultado final
    await supabaseAdmin.from('manager_runs').update({
        plan,
        finalSummary,
        totalCostCentsUsd: totalCost,
        totalTokensIn: totalIn,
        totalTokensOut: totalOut,
        iterations,
        status,
        error: errorMsg || null,
        finishedAt: new Date().toISOString(),
    }).eq('id', managerRunId);

    return {
        managerRunId,
        status,
        finalSummary,
        iterations,
        totalCostCents: totalCost,
        totalTokensIn: totalIn,
        totalTokensOut: totalOut,
        plan,
        error: errorMsg,
    };
}
