import { supabase } from '../lib/supabaseClient';
import {
    STRATEGIST_INSTRUCTION,
    GROWTH_HACKER_INSTRUCTION,
    SOCIAL_MEDIA_INSTRUCTION,
    FIELD_COMMANDER_INSTRUCTION,
    CREATIVE_PRODUCER_INSTRUCTION,
    BACKUP_AGENT_INSTRUCTION,
    FRAUD_AUDITOR_INSTRUCTION,
    CRM_AGENT_INSTRUCTION,
} from '../lib/agentInstructions';

// --- HELPER: chamada autenticada ao backend ---
const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
};

// System instructions agora vêm de src/lib/agentInstructions.ts (fonte única,
// compartilhada com o managerAgent.ts no backend).

// --- PROXY CALL VIA BACKEND AUTENTICADO ---

const callAgent = async (instruction: string, prompt: string, campaignId?: string, _userId?: string, agentId?: string): Promise<any> => {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/agents/chat', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                prompt,
                systemInstruction: instruction,
                campaignId,
                userId: _userId,
                agentId
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erro ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error("Erro ao chamar o Agente:", error);
        throw error;
    }
};

export const askStrategist = (prompt: string, campaignId?: string, userId?: string): Promise<any> => callAgent(STRATEGIST_INSTRUCTION, prompt, campaignId, userId, 'strategist');
export const askGrowthHacker = (prompt: string, campaignId?: string, userId?: string): Promise<any> => callAgent(GROWTH_HACKER_INSTRUCTION, prompt, campaignId, userId, 'growth');
export const askSocialMedia = (prompt: string, campaignId?: string, userId?: string): Promise<any> => callAgent(SOCIAL_MEDIA_INSTRUCTION, prompt, campaignId, userId, 'social');
export const askFieldCommander = (prompt: string, campaignId?: string, userId?: string): Promise<any> => callAgent(FIELD_COMMANDER_INSTRUCTION, prompt, campaignId, userId, 'field');
export const askCreativeProducer = (prompt: string, campaignId?: string, userId?: string): Promise<any> => callAgent(CREATIVE_PRODUCER_INSTRUCTION, prompt, campaignId, userId, 'creative');
export const askBackupAgent = (prompt: string, campaignId?: string, userId?: string): Promise<any> => callAgent(BACKUP_AGENT_INSTRUCTION, prompt, campaignId, userId, 'backup');
export const askCrmSpecialist = (prompt: string, campaignId?: string, userId?: string): Promise<any> => callAgent(CRM_AGENT_INSTRUCTION, prompt, campaignId, userId, 'crm');
export const askFraudAuditor = (prompt: string, campaignId?: string, userId?: string): Promise<any> => callAgent(FRAUD_AUDITOR_INSTRUCTION, prompt, campaignId, userId, 'fraud');

export const generateCreativeImage = async (prompt: string, _campaignId?: string, _userId?: string): Promise<string> => {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/agents/generate-image', {
            method: 'POST',
            headers,
            body: JSON.stringify({ prompt, campaignId: _campaignId, userId: _userId })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erro ${response.status}`);
        }

        const data = await response.json();
        return data.imageUrl || data.imageBase64;
    } catch (error) {
        console.error("Erro no Produtor Criativo (Image Gen):", error);
        throw error;
    }
};

export const askAdvisor = async (campaignDataPrompt: string, _campaignId?: string, _userId?: string): Promise<any[]> => {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/agents/advisor', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                campaignDataPrompt,
                campaignId: _campaignId,
                userId: _userId
            })
        });

        if (!response.ok) {
            throw new Error(`Erro ${response.status}`);
        }

        const data = await response.json();
        return data.tips || [];
    } catch (error) {
        console.error("Erro ao chamar o Advisor:", error);
        throw error;
    }
};

export const generateExecutiveReport = async (campaignDataPrompt: string, _campaignId?: string, _userId?: string): Promise<string> => {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/agents/report', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                campaignDataPrompt,
                campaignId: _campaignId,
                userId: _userId
            })
        });

        if (!response.ok) {
            throw new Error(`Erro ${response.status}`);
        }

        const data = await response.json();
        return data.report || '';
    } catch (error) {
        console.error("Erro no Report:", error);
        return 'Não foi possível gerar um parecer automático no momento.';
    }
};

export interface PipelineResult {
    id?: string;
    createdAt?: any;
    campaignId?: string;
    strategist: string;
    growth: string;
    social: string;
    field: string;
    creativeText: string;
    creativeImageBase64?: string;
}

export const runFullPipeline = async (
    campaignDataPrompt: string,
    onProgress: (step: number, message: string) => void,
    previousHistoryPrompt: string = "",
    campaignId?: string,
    userId?: string
): Promise<PipelineResult> => {
    try {
        const headers = await getAuthHeaders();
        onProgress(1, "Enviando para pipeline server-side...");

        const response = await fetch('/api/agents/pipeline', {
            method: 'POST',
            headers,
            body: JSON.stringify({ campaignDataPrompt, previousHistoryPrompt, campaignId, userId })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erro ${response.status}`);
        }

        const result = await response.json();
        onProgress(7, "Pipeline concluída!");

        return {
            strategist: result.strategist || '',
            growth: result.growth || '',
            social: result.social || '',
            field: result.field || '',
            creativeText: result.creativeText || '',
            creativeImageBase64: result.creativeImageBase64
        };
    } catch (error) {
        console.error("Erro na pipeline server-side:", error);
        throw error;
    }
};

// savePipelineResult removida — o /api/agents/pipeline já persiste em agent_outputs
// usando o schema correto (campaign_id/agent_type/output_type/content/metadata).

export const getPipelineHistory = async (campaignId: string, maxResults: number = 3): Promise<PipelineResult[]> => {
    try {
        // Lê do schema atual: result fica em metadata.output (schema novo do server.ts).
        const { data, error } = await supabase
            .from('agent_outputs')
            .select('*')
            .eq('campaignId', campaignId)
            .eq('agentType', 'war-room-pipeline')
            .order('createdAt', { ascending: false })
            .limit(maxResults);

        if (error) throw error;

        return (data || []).map((row: any) => {
            const output = row.metadata?.output || {};
            return {
                id: row.id,
                createdAt: row.createdAt,
                campaignId: row.campaignId,
                strategist: output.strategist || '',
                growth: output.growth || '',
                social: output.social || '',
                field: output.field || '',
                creativeText: output.creativeText || '',
                creativeImageBase64: output.creativeImageBase64,
            } as PipelineResult;
        });
    } catch (e: any) {
        console.error("Erro ao buscar histórico da pipeline", e);
        return [];
    }
};

/**
 * Run do Orquestrador (Manager) — uma análise completa que decompõe a
 * intenção, delega aos sub-agentes (Estrategista, CRM, Growth, etc) e
 * consolida o resultado.
 */
export interface ManagerRun {
    id: string;
    intent: string;
    finalSummary: string | null;
    iterations: number;
    status: 'running' | 'done' | 'error' | 'budget_exceeded' | 'max_iterations' | string;
    startedAt: string;
    finishedAt: string | null;
    /** Custo em centavos USD — NÃO mostrar pro usuário (#111). Só Supreme vê. */
    totalCostCentsUsd?: number;
}

/**
 * Histórico de execuções do Orquestrador (Quartel General de IA).
 * Fonte canônica: tabela manager_runs (populada pelo managerAgent.ts).
 *
 * Substituiu getPipelineHistory que lia agent_outputs filtrado por
 * agentType='war-room-pipeline' (pipeline legado, tabela vazia em produção).
 */
export const getManagerRuns = async (campaignId: string, limit = 20): Promise<ManagerRun[]> => {
    if (!campaignId) return [];
    try {
        const headers = await getAuthHeaders();
        const r = await fetch(`/api/agents/manager/runs?campaignId=${encodeURIComponent(campaignId)}&limit=${limit}`, { headers });
        if (!r.ok) {
            console.warn('[getManagerRuns] status', r.status);
            return [];
        }
        const json = await r.json();
        return (json?.runs || []) as ManagerRun[];
    } catch (e: any) {
        console.error('Erro ao buscar histórico do Manager', e);
        return [];
    }
};

export const createProductionOrder = async (campaignId: string, originAgent: string, targetAgent: string, content: string) => {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/agents/production-order', {
        method: 'POST',
        headers,
        body: JSON.stringify({ campaignId, originAgent, targetAgent, content })
    });
    return response.json();
};

export const fetchProductionOrders = async (campaignId: string, targetAgent: string) => {
    const headers = await getAuthHeaders();
    const response = await fetch(`/api/agents/production-orders?campaignId=${campaignId}&targetAgent=${targetAgent}`, {
        headers
    });
    return response.json();
};

export const publishToSocialMedia = async (campaignId: string, platforms: string[], content: string, mediaUrl?: string) => {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/agents/publish-social', {
        method: 'POST',
        headers,
        body: JSON.stringify({ campaignId, platforms, content, mediaUrl })
    });
    return response.json();
};
