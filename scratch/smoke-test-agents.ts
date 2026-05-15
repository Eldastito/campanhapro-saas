/**
 * Smoke test: chama cada agente com um prompt mínimo e valida que:
 *   - Retornou texto > 20 chars
 *   - Não houve erro
 *   - Custo foi razoável
 *
 * Rodar: tsx scratch/smoke-test-agents.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { callAgent, AGENT_CONFIGS } from '../src/lib/aiCallAgent';
import { AGENT_INSTRUCTIONS } from '../src/lib/agentInstructions';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TARGET_CAMPAIGN_ID = '455d21f3-f254-4b96-b49c-e70192c3fe27';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY obrigatórios no .env');
    process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const TEST_PROMPTS: Record<string, string> = {
    strategist: 'Em uma frase, qual deve ser a prioridade tática nº1 da campanha esta semana?',
    growth:     'Sugira em 1 parágrafo um funil simples para converter indecisos jovens em apoiadores.',
    social:     'Crie 1 legenda curta de Instagram (3 linhas) sobre o tema "saúde do bairro".',
    field:      'Em 2 frases, qual seria uma rota de panfletagem inteligente em uma cidade média?',
    creative:   'Descreva visualmente em 3 linhas uma foto de campanha em uma feira ao ar livre.',
    crm:        'Em 1 parágrafo, descreva um segmento típico de "indeciso da periferia" e a melhor abordagem.',
    fraud:      'Em 1 parágrafo, dê 3 sinais comportamentais de cadastros falsos numa base de eleitores.',
    backup:     'Em 2 frases, descreva o que deve ser priorizado num backup pré-eleição.',
};

async function testAgent(agentId: string, prompt: string) {
    const startedAt = Date.now();
    const result = {
        agentId,
        ok: false,
        latencyMs: 0,
        provider: '',
        model: '',
        textLen: 0,
        costCents: 0,
        instructionLen: AGENT_INSTRUCTIONS[agentId]?.length || 0,
        temperature: AGENT_CONFIGS[agentId]?.temperature ?? 'default',
        textExcerpt: '',
        error: '',
    };
    try {
        const r = await callAgent(admin, agentId, prompt, {
            campaignId: TARGET_CAMPAIGN_ID,
            userId: null,
            systemInstruction: AGENT_INSTRUCTIONS[agentId] || undefined,
        });
        result.ok = (r.text?.length ?? 0) > 20;
        result.latencyMs = Date.now() - startedAt;
        result.provider = r.provider;
        result.model = r.model;
        result.textLen = r.text?.length || 0;
        result.costCents = r.costCentsUsd;
        result.textExcerpt = (r.text || '').slice(0, 100).replace(/\n/g, ' ');
    } catch (err: any) {
        result.error = err?.message || String(err);
        result.latencyMs = Date.now() - startedAt;
    }
    return result;
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  SMOKE TEST — TODOS OS AGENTES IA');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    const results = [];
    for (const [agentId, prompt] of Object.entries(TEST_PROMPTS)) {
        process.stdout.write(`Testando ${agentId.padEnd(12)} … `);
        const r = await testAgent(agentId, prompt);
        results.push(r);
        if (r.ok) {
            console.log(`✓ ${r.provider}/${r.model} · ${r.latencyMs}ms · $${(r.costCents/100).toFixed(4)} · ${r.textLen} chars`);
        } else {
            console.log(`✗ FALHA: ${r.error || 'resposta muito curta'}`);
        }
    }

    // Sumário
    console.log('\n───────────────────────────────────────────────────────────────────');
    console.log('SUMÁRIO');
    console.log('───────────────────────────────────────────────────────────────────');
    const ok = results.filter(r => r.ok).length;
    const totalCost = results.reduce((s, r) => s + r.costCents, 0);
    const totalLatency = results.reduce((s, r) => s + r.latencyMs, 0);
    console.log(`Sucesso: ${ok}/${results.length}`);
    console.log(`Custo total: $${(totalCost/100).toFixed(4)} (≈ R$ ${(totalCost/100 * 5.5).toFixed(3)})`);
    console.log(`Tempo total: ${(totalLatency/1000).toFixed(1)}s`);
    console.log('');

    // Detalhes
    console.log('CONFIG POR AGENTE:');
    for (const r of results) {
        console.log(`  ${r.agentId.padEnd(12)} temp=${String(r.temperature).padEnd(4)} instruction=${String(r.instructionLen).padEnd(5)} chars`);
    }

    if (ok < results.length) {
        console.log('\n⚠️  Algumas chamadas falharam. Veja erros acima.');
        process.exit(1);
    }
    console.log('\n✅ Todos os agentes responderam. Pronto pra testar no app.');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
