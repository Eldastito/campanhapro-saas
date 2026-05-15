import { createClient } from '@supabase/supabase-js';

// node --env-file=.env --import tsx/esm scratch/seed_dashboard_data.ts

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const TARGET_EMAIL = 'examepad@gmail.com';

async function seed() {
  console.log(`🚀 Iniciando Seed Final (Todos os campos obrigatórios) para: ${TARGET_EMAIL}...`);

  const { data: user } = await supabase.from('users').select('id, campaignId').eq('email', TARGET_EMAIL).single();
  if (!user?.campaignId) return console.error('❌ Admin não encontrado.');

  const campaignId = user.campaignId;

  console.log('📍 Gerando 50 visitas completas...');
  const neighborhoods = ['Centro', 'Copacabana', 'Tijuca', 'Barra', 'Méier', 'Bangu'];
  const visits = [];
  
  for (let i = 0; i < 50; i++) {
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(Math.random() * 25));
    
    visits.push({
      campaignId: campaignId,
      data: date.toISOString().split('T')[0],
      resp: `Eleitor Teste ${i}`,
      tel: `(21) 98888-77${i % 10}${i % 10}`,
      nasc: '1985-05-20',
      municipio: 'Rio de Janeiro',
      bairro: neighborhoods[Math.floor(Math.random() * neighborhoods.length)],
      apoiador: 'Apoiador Teste',
      eleitores: 1,      // Campo obrigatório
      participantes: 1,  // Campo obrigatório
      votos: Math.floor(Math.random() * 5) + 1,
      pet: 'nao',
      tipo_pet: '',
      criancas: 'nao',
      solicit: 'Nenhuma',
      realizada: 'sim',
      lider: 'Líder Teste',
      interesse: 'Educação',
      nivel_engajamento: ['baixo', 'medio', 'alto'][Math.floor(Math.random() * 3)],
      observacoes_qualitativas: 'Seed de teste automatizado.'
    });
  }

  const { error: vErr } = await supabase.from('visits').insert(visits);
  if (vErr) console.error('❌ Erro em visits:', vErr.message);
  else console.log('✅ SUCESSO! 50 visitas inseridas. O Dashboard agora deve estar completo.');

  console.log('\n✨ Processo finalizado.');
}

seed();
