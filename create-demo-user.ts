import { createClient } from '@supabase/supabase-js';

// Execute com: node --env-file=.env --import tsx/esm create-demo-user.ts

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ VITE_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não encontrados no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const DEMO_USER = {
  email: 'eldastito@teste.com',
  password: 'CampanhaPro@2024',
  name: 'Apresentação Demo',
  type: 'Admin',
  plan: 'Total',
};

async function main() {
  console.log(`\n🚀 Criando usuário de demonstração: ${DEMO_USER.email}\n`);

  // 1. Verificar se já existe em auth
  const { data: { users: existing } } = await supabase.auth.admin.listUsers();
  const alreadyExists = existing?.find(u => u.email === DEMO_USER.email);

  let authUserId: string;

  if (alreadyExists) {
    await supabase.auth.admin.updateUserById(alreadyExists.id, {
      password: DEMO_USER.password,
      email_confirm: true,
    });
    authUserId = alreadyExists.id;
    console.log(`🔄 Auth user já existe — senha redefinida para: ${DEMO_USER.password}`);
  } else {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: DEMO_USER.email,
      password: DEMO_USER.password,
      email_confirm: true,
      user_metadata: { name: DEMO_USER.name },
    });
    if (error) throw error;
    authUserId = created.user!.id;
    console.log(`✅ Auth user criado: ${DEMO_USER.email}`);
  }

  // 2. Upsert perfil em public.users com Admin/Total e campaignId próprio
  const campaignId = crypto.randomUUID();

  const { error: upsertErr } = await supabase.from('users').upsert({
    id: authUserId,
    email: DEMO_USER.email,
    name: DEMO_USER.name,
    type: DEMO_USER.type,
    plan: DEMO_USER.plan,
    role: 'active',
    campaignId: campaignId,
    isSupremeAdmin: false,
  }, { onConflict: 'id' });

  if (upsertErr) throw new Error(`Falha ao salvar perfil: ${upsertErr.message}`);

  console.log(`✅ Perfil salvo em public.users`);
  console.log(`   type:       ${DEMO_USER.type}`);
  console.log(`   plan:       ${DEMO_USER.plan}`);
  console.log(`   campaignId: ${campaignId}`);

  console.log('\n' + '━'.repeat(50));
  console.log('✅ Usuário de demonstração criado com sucesso!\n');
  console.log(`  Email:  ${DEMO_USER.email}`);
  console.log(`  Senha:  ${DEMO_USER.password}`);
  console.log(`  Plano:  ${DEMO_USER.plan} (acesso total a todas as funcionalidades)`);
  console.log('\nEste usuário pode fazer login em /app e tem acesso a todas as 12 abas.');
}

main().catch((err) => {
  console.error('\n❌ Erro:', err.message);
  process.exit(1);
});
