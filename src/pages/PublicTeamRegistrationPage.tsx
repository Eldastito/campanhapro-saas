import * as React from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { CheckCircle, AlertTriangle, Briefcase, MapPin, User, Landmark } from 'lucide-react';
import { sanitizeData } from '../utils/supabaseUtils';

const PublicTeamRegistrationPage: React.FC = () => {
    const { campaignId } = useParams<{ campaignId: string }>();
    const [isLoading, setIsLoading] = React.useState(false);
    const [isSuccess, setIsSuccess] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    // Form State (CamelCase para bater com o banco)
    const [formData, setFormData] = React.useState({
        name: '',
        email: '',
        phone: '',
        cpf: '',
        rg: '',
        voterId: '',
        zipcode: '',
        address: '',
        neighborhood: '',
        city: '',
        state: '',
        bankName: '',
        bankAgency: '',
        bankAccount: '',
        pixKey: ''
    });

    // Validar campaign_id via verificação de Configs
    React.useEffect(() => {
        const verifyCampaign = async () => {
            if (!campaignId) {
                setError('Link inválido. Código da campanha ausente.');
                return;
            }
            // Apenas verifica se existe a campanha
            const { data, error } = await supabase
                .from('campaign_configs')
                .select('id')
                .eq('id', campaignId)
                .single();
                
            if (error || !data) {
                // Tenta achar via profile Admin (fallback caso o Supreme mandou o ID dele)
                const { data: userData } = await supabase
                    .from('users')
                    .select('id')
                    .eq('id', campaignId)
                    .single();
                    
                if (!userData) {
                    setError('Campanha não encontrada. Solicite um novo link ao gestor.');
                }
            }
        };
        verifyCampaign();
    }, [campaignId]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleCEPBlur = async () => {
        if (formData.zipcode.replace(/\D/g, '').length === 8) {
            try {
                const res = await fetch(`https://viacep.com.br/ws/${formData.zipcode.replace(/\D/g, '')}/json/`);
                const data = await res.json();
                if (!data.erro) {
                    setFormData(prev => ({
                        ...prev,
                        address: data.logradouro,
                        neighborhood: data.bairro,
                        city: data.localidade,
                        state: data.uf
                    }));
                }
            } catch (err) {
                // Ignore API error
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (error) return;
        
        setIsLoading(true);
        setError(null);

        try {
            // Sincronizando com CamelCase conforme o banco de dados
            const payload = {
                campaignId: campaignId,
                role: 'Apoiador',
                ...formData
            };

            const { error: insertError } = await supabase
                .from('team_members')
                .insert(sanitizeData(payload));

            if (insertError) throw insertError;

            setIsSuccess(true);
        } catch (err: any) {
            console.error(err);
            setError('Erro ao enviar cadastro. Tente novamente ou contate o gestor.');
        } finally {
            setIsLoading(false);
        }
    };

    if (isSuccess) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
                <Card className="max-w-md w-full text-center py-10">
                    <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-slate-100 mb-2">Cadastro Enviado!</h2>
                    <p className="text-slate-400">
                        Seus dados foram recebidos com sucesso pela coordenação da campanha.
                    </p>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-900 py-10 px-4 sm:px-6">
            <div className="max-w-3xl mx-auto">
                <div className="text-center mb-8">
                    <Briefcase className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
                    <h1 className="text-3xl font-bold text-slate-100 mb-2">Ficha Cadastral da Equipe</h1>
                    <p className="text-slate-400">
                        Preencha seus dados para efetivação e prestação de contas da campanha.
                    </p>
                </div>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-lg mb-6 flex items-center gap-3">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                        <p>{error}</p>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* SEÇÃO 1: Dados Pessoais */}
                    <Card>
                        <div className="flex items-center gap-2 mb-4 text-emerald-400 border-b border-slate-700 pb-2">
                            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-500">
                                <User className="w-5 h-5" />
                            </span>
                            <h3 className="text-lg font-medium text-slate-100">Dados Pessoais</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="sm:col-span-2">
                                <Input label="Nome Completo" name="name" value={formData.name} onChange={handleChange} required placeholder="Como consta no RG" />
                            </div>
                            <Input label="Email Principal" type="email" name="email" value={formData.email} onChange={handleChange} required />
                            <Input label="Telefone (WhatsApp)" name="phone" value={formData.phone} onChange={handleChange} required />
                            <Input label="CPF" name="cpf" value={formData.cpf} onChange={handleChange} required />
                            <Input label="RG" name="rg" value={formData.rg} onChange={handleChange} required />
                            <div className="sm:col-span-2">
                                <Input label="Título de Eleitor (Opcional)" name="voterId" value={formData.voterId} onChange={handleChange} />
                            </div>
                        </div>
                    </Card>

                    {/* SEÇÃO 2: Endereço */}
                    <Card>
                        <div className="flex items-center gap-2 mb-4 text-emerald-400 border-b border-slate-700 pb-2">
                             <span className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-500">
                                <MapPin className="w-5 h-5" />
                            </span>
                            <h3 className="text-lg font-medium text-slate-100">Endereço Residencial</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="sm:col-span-2 flex gap-4 items-end">
                                <div className="flex-1">
                                    <Input label="CEP" name="zipcode" value={formData.zipcode} onChange={handleChange} onBlur={handleCEPBlur} required placeholder="Apenas números" />
                                </div>
                                <div className="text-xs text-slate-400 pb-3">Digite o CEP e clique fora para buscar.</div>
                            </div>
                            <div className="sm:col-span-2">
                                <Input label="Logradouro (Rua, Av, Número)" name="address" value={formData.address} onChange={handleChange} required />
                            </div>
                            <Input label="Bairro" name="neighborhood" value={formData.neighborhood} onChange={handleChange} required />
                            <Input label="Município" name="city" value={formData.city} onChange={handleChange} required />
                            <Input label="UF (Estado)" name="state" value={formData.state} onChange={handleChange} required maxLength={2} />
                        </div>
                    </Card>

                    {/* SEÇÃO 3: Dados Bancários */}
                    <Card>
                        <div className="flex items-center gap-2 mb-4 text-emerald-400 border-b border-slate-700 pb-2">
                            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-500">
                                <Landmark className="w-5 h-5" />
                            </span>
                            <h3 className="text-lg font-medium text-slate-100">Dados Bancários para Pagamento</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="sm:col-span-2">
                                <Input label="Nome do Banco" name="bankName" value={formData.bankName} onChange={handleChange} required placeholder="Ex: Itaú, Nubank, Caixa" />
                            </div>
                            <Input label="Agência (com dígito)" name="bankAgency" value={formData.bankAgency} onChange={handleChange} required />
                            <Input label="Conta (com dígito)" name="bankAccount" value={formData.bankAccount} onChange={handleChange} required />
                            <div className="sm:col-span-2">
                                <Input label="Chave PIX (Opcional)" name="pixKey" value={formData.pixKey} onChange={handleChange} placeholder="CPF, Email, Telefone..." />
                            </div>
                        </div>
                    </Card>

                    <div className="flex justify-end pt-4">
                        <Button type="submit" disabled={isLoading || !!error} className="w-full sm:w-auto px-8 py-3 text-lg">
                            {isLoading ? 'Enviando Cadastro...' : 'Enviar Cadastro Completo'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PublicTeamRegistrationPage;
