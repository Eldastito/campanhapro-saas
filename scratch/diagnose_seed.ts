
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function diagnose() {
  const email = 'examepad@gmail.com';
  console.log(`🔍 Diagnosticando acesso para: ${email}`);

  // 1. Checar Usuário
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, "campaignId", campaign_id')
    .eq('email', email)
    .single();

  if (userError) {
    console.error('❌ Erro ao buscar usuário:', userError);
    return;
  }

  console.log('👤 Usuário encontrado:', user);
  const activeCampaignId = user.campaignId || user.campaign_id;

  // 2. Checar Visitas
  const { count, error: visitsError } = await supabase
    .from('visits')
    .select('*', { count: 'exact', head: true })
    .eq('campaignId', activeCampaignId);

  console.log(`📍 Visitas no banco com campaignId (${activeCampaignId}):`, count || 0);

  // 3. Checar se existem visitas com o OUTRO ID (caso haja duplicidade de coluna)
  if (user.campaign_id && user.campaign_id !== user.campaignId) {
    const { count: count2 } = await supabase
      .from('visits')
      .select('*', { count: 'exact', head: true })
      .eq('campaignId', user.campaign_id);
    console.log(`📍 Visitas no banco com campaign_id (${user.campaign_id}):`, count2 || 0);
  }

  // 4. Checar a função de segurança (RLS)
  const { data: rlsId, error: rlsError } = await supabase.rpc('get_user_campaign_id');
  console.log('🛡️ O que a função de segurança (RLS) retorna para o sistema:', rlsId || 'NULL');
}

diagnose();
