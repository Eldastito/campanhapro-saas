import { supabase } from '../lib/supabaseClient';

export interface BackupData {
    id: string;
    createdAt: any;
    campaignId: string;
    label: string;
    data: string; // JSON string
    stats: {
        visitas: number;
        equipe: number;
        financeiro: number;
    };
}

export const createBackup = async (campaignId: string, label: string = 'Backup Manual') => {
    try {
        // Coleta dados das principais tabelas
        const [visitasRes, equipeRes, incomesRes, expensesRes] = await Promise.all([
            supabase.from('visits').select('*').eq('campaignId', campaignId),
            supabase.from('team_members').select('*').eq('campaignId', campaignId),
            supabase.from('incomes').select('*').eq('campaignId', campaignId),
            supabase.from('expenses').select('*').eq('campaignId', campaignId)
        ]);
        
        if (visitasRes.error) throw visitasRes.error;
        if (equipeRes.error) throw equipeRes.error;
        if (incomesRes.error) throw incomesRes.error;
        if (expensesRes.error) throw expensesRes.error;

        const backupPayload = {
            visitas: visitasRes.data,
            equipe: equipeRes.data,
            financeiro: [...(incomesRes.data || []), ...(expensesRes.data || [])]
        };

        const { data, error } = await supabase.from('backups').insert({
            campaignId,
            label,
            data: JSON.stringify(backupPayload),
            stats: {
                visitas: backupPayload.visitas.length,
                equipe: backupPayload.equipe.length,
                financeiro: backupPayload.financeiro.length
            }
        }).select().single();

        if (error) throw error;
        return data.id;
    } catch (error) {
        console.error("Erro ao criar backup:", error);
        throw error;
    }
};

export const restoreBackup = async (backupId: string) => {
    try {
        const { data: backup, error } = await supabase
            .from('backups')
            .select('*')
            .eq('id', backupId)
            .single();
        
        if (error || !backup) throw new Error("Backup não encontrado.");
        
        const payload = JSON.parse(backup.data);
        
        // Simulação de restauração
        if (payload.visitas && payload.visitas.length > 0) await supabase.from('visits').upsert(payload.visitas);
        if (payload.equipe && payload.equipe.length > 0) await supabase.from('team_members').upsert(payload.equipe);
        if (payload.financeiro && payload.financeiro.length > 0) {
            // Separa incomes e expenses se necessário, ou insere conforme estrutura da tabela de financeiro
            // Para simplicidade e compatibilidade com o que migramos anteriormente:
            await supabase.from('incomes').upsert(payload.financeiro.filter((i: any) => i.tipo === 'receita'));
            await supabase.from('expenses').upsert(payload.financeiro.filter((i: any) => i.tipo === 'despesa'));
        }
        
        return true;
    } catch (error) {
        console.error("Erro ao restaurar backup:", error);
        throw error;
    }
};
