import { createClient } from '@supabase/supabase-js';

// Carrega variáveis de ambiente via --env-file=.env no comando de execução
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ VITE_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não encontrados.');
  console.error('   Execute com: node --env-file=.env --import tsx/esm create-test-users.ts');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// IDs de campanha para vincular os usuários de teste ao admin examepad
const ADMIN_EMAIL = 'examepad@gmail.com';
const PASSWORD = 'CampanhaPro@2024';

const TEST_USERS = [
  { email: 'lider@teste.com',          name: 'Líder Teste',          type: 'Líder' },
  { email: 'colaborador@teste.com',    name: 'Colaborador Teste',    type: 'Colaborador' },
  { email: 'apoiador@teste.com',       name: 'Apoiador Teste',       type: 'Apoiador' },
  { email: 'entrevistador@teste.com',  name: 'Entrevistador Teste',  type: 'Pesquisador' },
];

async function main() {
  console.log('🚀 Iniciando criação de usuários de teste...\n');

  // Buscar campaignId do admin para vincular os usuários de teste
  const { data: adminUser } = await supabase
    .from('users')
    .select('campaignId, "campaignId"')
    .eq('email', ADMIN_EMAIL)
    .single();

  const campaignId = adminUser?.campaignId || adminUser?.['campaignId'] || null;

  if (!campaignId) {
    console.warn(`⚠️  Admin ${ADMIN_EMAIL} não encontrado ou sem campaignId.`);
    console.warn('   Os usuários de teste serão criados sem vínculo de campanha.\n');
  } else {
    console.log(`✅ CampaignId do admin: ${campaignId}\n`);
  }

  for (const u of TEST_USERS) {
    try {
      // 1. Criar ou atualizar na tabela auth.users
      const { data: { users: existing } } = await supabase.auth.admin.listUsers();
      const alreadyExists = existing?.find(e => e.email === u.email);

      let authUserId: string;

      if (alreadyExists) {
        // Atualizar senha e garantir confirmação
        await supabase.auth.admin.updateUserById(alreadyExists.id, {
          password: PASSWORD,
          email_confirm: true,
        });
        authUserId = alreadyExists.id;
        console.log(`🔄 Auth user já existe, senha atualizada: ${u.email}`);
      } else {
        const { data: created, error: createErr } = await supabase.auth.admin.createUser({
          email: u.email,
          password: PASSWORD,
          email_confirm: true,
          user_metadata: { name: u.name },
        });
        if (createErr) throw createErr;
        authUserId = created.user!.id;
        console.log(`✅ Auth user criado: ${u.email}`);
      }

      // 2. Upsert na tabela users
      const { error: upsertErr } = await supabase.from('users').upsert({
        id: authUserId,
        email: u.email,
        name: u.name,
        type: u.type,
        plan: 'Essencial',
        role: 'active',
        campaignId: campaignId,
        isSupremeAdmin: false,
      }, { onConflict: 'id' });

      if (upsertErr) throw upsertErr;
      console.log(`   └─ Perfil salvo na tabela users com type: ${u.type}\n`);

    } catch (err: any) {
      console.error(`❌ Erro ao criar ${u.email}: ${err.message}\n`);
    }
  }

  console.log('━'.repeat(50));
  console.log('✅ Processo finalizado!');
  console.log('\nContas criadas:');
  TEST_USERS.forEach(u => console.log(`  ${u.type.padEnd(15)} ${u.email}  /  ${PASSWORD}`));
  console.log('\nExecute o SQL em sql/12_fix_admin_access.sql no Supabase Dashboard para verificar.');
}

main().catch(console.error);
