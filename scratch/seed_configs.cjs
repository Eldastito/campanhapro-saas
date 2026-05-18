require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Erro: VITE_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não encontrados no .env");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const campaignIds = [
    'd5705194-be6e-4f0f-93b3-c82e546b34b4',
    '778323b5-59b7-41cf-8fff-6fafa567c96c'
];

async function seed() {
    console.log("Iniciando semeadura de dados...");

    console.log("Semeando platform_stats...");
    await supabase.from('platform_stats').upsert({
        id: 'global',
        totalTokens: 0,
        totalCost: 0
    });

    console.log("Semeando campaign_configs...");
    for (const cid of campaignIds) {
        await supabase.from('campaign_configs').upsert({
            id: cid,
            features: ['Dashboard', 'Agentes IA', 'Calculadora', 'Visitas', 'Engajamento', 'Recursos', 'Equipes', 'Financeiro', 'Treinamento', 'Ferramentas', 'Permissões', 'Configurações', 'Ajuda'],
            limits: { aiCalls: 1000, teamMembers: 500, visits: 100000 },
            status: 'active'
        });
    }

    console.log("Semeadura concluída!");
}

seed();
