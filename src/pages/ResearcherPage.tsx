import * as React from 'react';
import { supabase } from '../lib/supabaseClient';
import Header from '../components/Header';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import PesquisaForm from '../components/pesquisa/PesquisaForm';
import PesquisaChart from '../components/dashboard/PesquisaChart';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { updateVoterJourney } from '../services/voterJourneyService';

const ResearcherPage: React.FC = () => {
    const { user } = useAuth();
    const { headerLogo } = useSettings();
    const [isModalOpen, setIsModalOpen] = React.useState(false);
    const [isSaving, setIsSaving] = React.useState(false);
    const [pesquisas, setPesquisas] = React.useState<any[]>([]);

    React.useEffect(() => {
        if (!user?.id) return;
        
        const fetchPesquisas = async () => {
            const { data, error } = await supabase
                .from('pesquisas')
                .select('*')
                .eq('entrevistadorId', user.id);
            
            if (data) {
                setPesquisas(data);
            } else if (error) {
                console.error("Erro ao carregar pesquisas:", error);
            }
        };

        fetchPesquisas();

        // Supabase realtime subscription
        const channelId = `pesquisas-${user.id}`;
        const channel = supabase.channel(channelId)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'pesquisas', filter: `entrevistadorId=eq.${user.id}` },
                () => fetchPesquisas()
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user?.id]);

    if (!user) return null;

    const handleSavePesquisa = async (data: any) => {
        setIsSaving(true);
        try {
            // Sincronizando com o schema oficial do banco de dados (camelCase)
            // Removendo campos de auditoria não presentes no schema para evitar erro 400
            const { error } = await supabase
                .from('pesquisas')
                .insert({
                    ...data,
                    entrevistadorId: user.id,
                    campaignId: user.campaignId
                });
            
            if (error) throw error;
            
            // Atualizar jornada do eleitor se houver identificação
            if (data.nomeEleitor) {
                await updateVoterJourney(data.nomeEleitor, user.campaignId!);
            }

            console.log('Pesquisa salva com sucesso.');
            setIsModalOpen(false);
        } catch (error) {
            console.error('Erro ao salvar pesquisa:', error);
            alert('Falha ao salvar a pesquisa. Verifique os campos e tente novamente.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-800 text-slate-50 font-sans">
            <Header logoUrl={headerLogo} />
            <main className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
                <header className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-100">Painel do Pesquisador</h1>
                    <p className="text-slate-400">Coleta de dados inteligentes para inteligência eleitoral.</p>
                </header>

                <div className="grid md:grid-cols-3 gap-6">
                    <Card className="md:col-span-1">
                        <h2 className="text-xl font-bold mb-4">Acesso Rápido</h2>
                        <Button className="w-full mb-3" onClick={() => setIsModalOpen(true)} disabled={isSaving}>Nova Pesquisa</Button>
                        <Button variant="secondary" className="w-full">Ver Relatórios ({pesquisas.length})</Button>
                    </Card>

                    <Card className="md:col-span-2">
                        <h2 className="text-xl font-bold mb-4">Estatísticas de Campo</h2>
                        <PesquisaChart data={pesquisas} />
                    </Card>
                </div>
            </main>

            {isModalOpen && (
                <Modal 
                    isOpen={isModalOpen} 
                    onClose={() => setIsModalOpen(false)} 
                    title="Nova Pesquisa Eleitoral"
                >
                    <PesquisaForm 
                        onSave={handleSavePesquisa} 
                        onCancel={() => setIsModalOpen(false)} 
                        isSaving={isSaving} 
                    />
                </Modal>
            )}
        </div>
    );
};

export default ResearcherPage;
