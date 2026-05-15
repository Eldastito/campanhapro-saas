import * as React from 'react';
import { useTeam } from '../../contexts/TeamContext';
import Card from '../ui/Card';
import { User, MapPin, Landmark, Briefcase, Phone, Mail, AlertTriangle } from 'lucide-react';

interface SupporterProfileCardProps {
    supporterName: string;
}

const SupporterProfileCard: React.FC<SupporterProfileCardProps> = ({ supporterName }) => {
    const { teamMembers } = useTeam();

    const supporterData = React.useMemo(() => {
        // Find the team member that matches the selected name exactly
        return teamMembers.find(member => member.name.toLowerCase() === supporterName.toLowerCase());
    }, [teamMembers, supporterName]);

    if (!supporterName) return null;

    if (!supporterData) {
        return (
            <Card className="border-t-4 border-t-amber-500 bg-slate-800/80">
                <div className="flex items-center gap-3 mb-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    <h3 className="text-lg font-bold text-slate-200">Perfil Profissional: {supporterName}</h3>
                </div>
                <p className="text-sm text-slate-400">
                    Este apoiador gerou dados de visitas, mas não possui uma ficha de equipe cadastrada. 
                    Envie o Link de Cadastro para que ele preencha seus dados.
                </p>
            </Card>
        );
    }

    return (
        <Card className="border-t-4 border-t-[#4ac7f0] bg-slate-800/80 shadow-lg relative overflow-hidden">
            {/* Background Accent */}
            <div className="absolute -right-10 -top-10 text-[#4ac7f0] opacity-5">
                <Briefcase className="w-48 h-48" />
            </div>

            <div className="flex items-center gap-3 mb-6 relative z-10">
                <div className="p-2 bg-gradient-to-r from-[#4ac7f0] to-[#1abc9c] rounded-lg">
                    <User className="w-6 h-6 text-white" />
                </div>
                <div>
                    <h3 className="text-xl font-bold text-slate-100">{supporterData.name}</h3>
                    <p className="text-sm font-medium text-[#4ac7f0] uppercase tracking-wider">{supporterData.role}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10">
                {/* Contato & Identificação */}
                <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-700 pb-1">Contato & Identificação</h4>
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                        <Phone className="w-4 h-4 text-slate-400" />
                        <span>{supporterData.phone || 'Não informado'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                        <Mail className="w-4 h-4 text-slate-400" />
                        <span className="truncate" title={supporterData.email}>{supporterData.email}</span>
                    </div>
                    <div className="mt-2 pt-2 border-t border-slate-700/50 text-sm">
                        <p><span className="text-slate-400">CPF:</span> {supporterData.cpf || 'Não preenchido'}</p>
                        <p><span className="text-slate-400">RG:</span> {supporterData.rg || 'Não preenchido'}</p>
                        <p><span className="text-slate-400">Título:</span> {supporterData.voter_id || 'Não preenchido'}</p>
                    </div>
                </div>

                {/* Endereço */}
                <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-700 pb-1">Endereço Residencial</h4>
                    <div className="flex gap-2 text-sm text-slate-300 items-start">
                        <MapPin className="w-4 h-4 text-slate-400 mt-1 flex-shrink-0" />
                        <div>
                            {supporterData.address ? (
                                <>
                                    <p>{supporterData.address}</p>
                                    <p>{supporterData.neighborhood} - {supporterData.city}/{supporterData.state}</p>
                                    <p className="text-slate-500 mt-1">CEP: {supporterData.zip_code}</p>
                                </>
                            ) : (
                                <span className="text-slate-500 italic">Endereço não cadastrado</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Pagamento */}
                <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-700 pb-1">Dados de Pagamento</h4>
                    <div className="flex gap-2 text-sm text-slate-300 items-start">
                        <Landmark className="w-4 h-4 text-slate-400 mt-1 flex-shrink-0" />
                        <div>
                            {supporterData.bank_name ? (
                                <>
                                    <p className="font-medium text-emerald-400">{supporterData.bank_name}</p>
                                    <p>Agência: <span className="text-slate-200">{supporterData.bank_agency}</span></p>
                                    <p>Conta: <span className="text-slate-200">{supporterData.bank_account}</span></p>
                                    {supporterData.pix_key && (
                                        <p className="mt-1 pt-1 border-t border-slate-700/50">
                                            PIX: <span className="text-[#4ac7f0] select-all">{supporterData.pix_key}</span>
                                        </p>
                                    )}
                                </>
                            ) : (
                                <span className="text-slate-500 italic">Dados bancários não preenchidos</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export default SupporterProfileCard;
