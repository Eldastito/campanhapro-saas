import * as React from 'react';
import { supabase } from '../lib/supabaseClient';
import { CampaignDetails } from '../types/campaign';
import LoadingScreen from '../components/ui/LoadingScreen';
import { Camera } from 'lucide-react';

interface PublicColinhaPageProps {
    uid: string;
    onBack: () => void;
}

const PublicColinhaPage: React.FC<PublicColinhaPageProps> = ({ uid, onBack }) => {
    const [campaignDetails, setCampaignDetails] = React.useState<CampaignDetails | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        const fetchData = async () => {
            try {
                const { data, error } = await supabase
                    .from('settings')
                    .select('campaignDetails')
                    .eq('id', uid)
                    .single();
                
                if (error) throw error;

                if (data) {
                    setCampaignDetails(data.campaignDetails as CampaignDetails);
                } else {
                    setError('Candidato não encontrado.');
                }
            } catch (err) {
                console.error('Erro ao buscar dados:', err);
                setError('Erro ao carregar os dados.');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [uid]);

    if (loading) return <LoadingScreen />;

    if (error || !campaignDetails) {
        return (
            <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-center">
                <h1 className="text-2xl font-bold text-white mb-4">{error || 'Algo deu errado'}</h1>
                <button 
                    onClick={onBack}
                    className="px-6 py-2 bg-teal-500 text-slate-900 rounded-lg font-bold"
                >
                    Voltar para o Início
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center p-6">
            <div 
                style={{ backgroundColor: '#1e293b', backgroundImage: 'linear-gradient(to bottom right, #1e293b, #0f172a)' }}
                className="w-full max-w-sm border-2 border-[#2dd4bf4d] rounded-3xl p-8 shadow-2xl relative overflow-hidden"
            >
                <div 
                    style={{ backgroundColor: '#2dd4bf1a' }}
                    className="absolute top-0 right-0 p-3 rounded-bl-2xl border-l border-b border-[#2dd4bf33]"
                >
                    <span style={{ color: '#2dd4bf' }} className="text-xs font-bold uppercase tracking-widest">Eleições 2026</span>
                </div>
                
                <div className="space-y-8">
                    <div className="flex flex-col items-center text-center space-y-4">
                        {campaignDetails.candidatePhotoUrl ? (
                            <img 
                                src={campaignDetails.candidatePhotoUrl} 
                                alt="Candidato" 
                                style={{ borderColor: '#2dd4bf' }}
                                className="w-32 h-32 rounded-full border-4 object-cover shadow-lg"
                                referrerPolicy="no-referrer"
                            />
                        ) : (
                            <div 
                                style={{ backgroundColor: '#334155', borderColor: '#2dd4bf' }}
                                className="w-32 h-32 rounded-full border-4 flex items-center justify-center shadow-lg"
                            >
                                <Camera style={{ color: '#64748b' }} size={48} />
                            </div>
                        )}
                        <div>
                            <h4 style={{ color: '#ffffff' }} className="text-3xl font-black uppercase leading-tight">
                                {campaignDetails.nomeUrna || 'Nome do Candidato'}
                            </h4>
                            <p style={{ color: '#2dd4bf' }} className="font-bold text-lg">{campaignDetails.partido || 'Partido'}</p>
                        </div>
                    </div>
                    
                    <div 
                        style={{ backgroundColor: '#ffffff0d', borderColor: '#ffffff1a' }}
                        className="rounded-2xl p-6 border text-center"
                    >
                        <span style={{ color: '#64748b' }} className="text-sm uppercase font-bold tracking-widest block mb-2">Número na Urna</span>
                        <span style={{ color: '#ffffff' }} className="text-6xl font-black tracking-[0.2em]">
                            {campaignDetails.numero || '00.000'}
                        </span>
                    </div>

                    <p style={{ color: '#94a3b8' }} className="text-center text-sm italic">
                        "Juntos por uma cidade melhor!"
                    </p>
                </div>
            </div>
            
            <button 
                onClick={onBack}
                style={{ color: '#64748b' }}
                className="mt-8 hover:text-white transition-colors text-sm font-medium"
            >
                Criar minha própria colinha
            </button>
        </div>
    );
};

export default PublicColinhaPage;
