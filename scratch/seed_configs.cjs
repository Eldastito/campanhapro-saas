const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://jvmtcsxoxgzepslxqtdy.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2bXRjc3hveGd6ZXBzbHhxdGR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjUxNjc3MywiZXhwIjoyMDkyMDkyNzczfQ.SvceskeyZRolCTJj8U-u_Ww28s7HlNCMmh2jZzyGiGA';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const campaignIds = [
    'd5705194-be6e-4f0f-93b3-c82e546b34b4',
    '778323b5-59b7-41cf-8fff-6fafa567c96c'
];

async function seed() {
    console.log("Iniciando semeadura de dados...");

    // 1. Platform Stats
    console.log("Semeando platform_stats...");
    await supabase.from('platform_stats').upsert({
        id: 'global',
        totalTokens: 0,
        totalCost: 0
    });

    // 2. Campaign Configs
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
