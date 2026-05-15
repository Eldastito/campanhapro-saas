const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://jvmtcsxoxgzepslxqtdy.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2bXRjc3hveGd6ZXBzbHhxdGR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjUxNjc3MywiZXhwIjoyMDkyMDkyNzczfQ.SvceskeyZRolCTJj8U-u_Ww28s7HlNCMmh2jZzyGiGA';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Erro: VITE_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não encontrados no .env");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

const admins = [
    { email: 'eldastito@gmail.com', password: 'Admin123!' },
    { email: 'examepad@gmail.com', password: 'Admin123!' }
];

async function resetPasswords() {
    console.log("Iniciando reset de senhas administrativas...");
    
    for (const admin of admins) {
        try {
            // 1. Buscar usuário pelo email
            const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
            if (listError) throw listError;
            
            const user = users.find(u => u.email === admin.email);
            
            if (!user) {
                console.warn(`Aviso: Usuário ${admin.email} não localizado no Auth.`);
                continue;
            }

            // 2. Atualizar senha
            const { data, error } = await supabase.auth.admin.updateUserById(
                user.id,
                { password: admin.password, email_confirm: true }
            );

            if (error) {
                console.error(`Erro ao atualizar ${admin.email}:`, error.message);
            } else {
                console.log(`Sucesso: Senha de ${admin.email} resetada e email confirmado.`);
            }
        } catch (err) {
            console.error(`Falha crítica para ${admin.email}:`, err.message);
        }
    }
    
    console.log("Processo concluído.");
}

resetPasswords();
