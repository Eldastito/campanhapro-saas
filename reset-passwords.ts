
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Carregar variáveis do .env
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Erro: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não encontrados no .env');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const emailsToReset = ['eldastito@gmail.com', 'examepad@gmail.com'];
const NEW_PASSWORD = 'CampanhaPro@2024';

async function resetPasswords() {
  console.log('Starting password reset process...');

  for (const email of emailsToReset) {
    try {
      // 1. Buscar usuário pelo email
      const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
      
      if (listError) throw listError;
      
      const user = users.find(u => u.email === email);
      
      if (!user) {
        console.warn(`⚠️ Usuário não encontrado: ${email}`);
        continue;
      }

      // 2. Atualizar senha
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        user.id,
        { password: NEW_PASSWORD }
      );

      if (updateError) throw updateError;

      console.log(`✅ Sucesso: Senha de ${email} resetada para: ${NEW_PASSWORD}`);
    } catch (err: any) {
      console.error(`❌ Erro ao resetar ${email}:`, err.message);
    }
  }

  console.log('\nProcesso finalizado. Agora você pode fazer login com as novas credenciais.');
}

resetPasswords();
