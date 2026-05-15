/**
 * Cria usuarios de teste (Lider + Apoiador) usando a Supabase Auth Admin API.
 * Diferente de INSERT direto em auth.users, isso cuida de TODOS os campos
 * obrigatorios do GoTrue (tokens, identidades, etc).
 *
 * Rodar: tsx scratch/seed-test-users.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY obrigatórios no .env');
    process.exit(1);
}

const TARGET_CAMPAIGN_ID = '455d21f3-f254-4b96-b49c-e70192c3fe27'; // campanha demo
const PASSWORD = 'Teste123!';

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false }
});

async function deleteIfExists(email: string) {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = list?.users?.find((u: any) => u.email === email);
    if (found) {
        console.log(`[seed] Removendo existente: ${email} (${found.id})`);
        await admin.auth.admin.deleteUser(found.id);
    }
}

async function createUser(email: string, name: string, type: string, assignedLeaderId: string | null) {
    await deleteIfExists(email);

    const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { name },
    });
    if (error || !data?.user) throw new Error(`Falha ao criar ${email}: ${error?.message}`);
    console.log(`[seed] auth criado: ${email} → ${data.user.id}`);

    // Atualiza public.users (trigger handle_new_auth_user já criou com type='Admin' e campanha nova)
    const { error: updErr } = await admin
        .from('users')
        .update({
            type,
            campaign_id: TARGET_CAMPAIGN_ID,
            name,
            assigned_leader_id: assignedLeaderId,
        })
        .eq('id', data.user.id);
    if (updErr) throw new Error(`Falha ao update users: ${updErr.message}`);

    return data.user.id;
}

async function main() {
    console.log('[seed] Iniciando...');

    // 1. Cria Líder primeiro
    const liderId = await createUser('lider.teste@campanhapro.com', 'Líder Teste', 'Líder', null);

    // team_members do Líder
    await admin.from('team_members').delete().eq('email', 'lider.teste@campanhapro.com');
    const { data: liderMember, error: tmErr } = await admin
        .from('team_members')
        .insert({
            campaign_id: TARGET_CAMPAIGN_ID,
            uid: liderId,
            name: 'Líder Teste',
            role: 'Líder',
            email: 'lider.teste@campanhapro.com',
        })
        .select('id')
        .single();
    if (tmErr) throw new Error(`Falha team_members Líder: ${tmErr.message}`);
    console.log(`[seed] team_members Líder criado: ${liderMember.id}`);

    // 2. Cria Apoiador linkado ao Líder
    const apoiadorId = await createUser(
        'apoiador.teste@campanhapro.com',
        'Apoiador Teste',
        'Apoiador',
        liderId
    );

    await admin.from('team_members').delete().eq('email', 'apoiador.teste@campanhapro.com');
    const { error: tmErr2 } = await admin
        .from('team_members')
        .insert({
            campaign_id: TARGET_CAMPAIGN_ID,
            uid: apoiadorId,
            name: 'Apoiador Teste',
            role: 'Apoiador',
            email: 'apoiador.teste@campanhapro.com',
            assigned_leader_id: liderMember.id,
        });
    if (tmErr2) throw new Error(`Falha team_members Apoiador: ${tmErr2.message}`);
    console.log('[seed] team_members Apoiador criado');

    console.log('\n✅ Usuários de teste prontos:');
    console.log('   Líder    : lider.teste@campanhapro.com / Teste123!');
    console.log('   Apoiador : apoiador.teste@campanhapro.com / Teste123!');
}

main().catch(err => {
    console.error('[seed] ERRO:', err);
    process.exit(1);
});
