import { supabase } from '../../lib/supabaseClient';
import * as React from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { useTeam } from '../../contexts/TeamContext';
import { TeamMember, TeamMemberRole } from '../../types/teams';
import { EditIcon, TrashIcon } from '../icons';
import Input from '../ui/Input';
import { RefreshCw, Ban, CheckCircle, Lock, KeyRound, Copy, Check } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { authedFetch } from '../../lib/authedFetch';

const emptyMember: Omit<TeamMember, 'id'> = {
    name: '', email: '', phone: '', role: 'Apoiador', password: '', cost: 0,
    cpf: '', rg: '', voterId: '', address: '', neighborhood: '', city: '', state: '', zipcode: '',
    bankName: '', bankAgency: '', bankAccount: '', pixKey: ''
};

const TeamMemberForm: React.FC<{ onSave: (member: Omit<TeamMember, 'id'> | TeamMember) => void, onCancel: () => void, initialData?: TeamMember | null }> = ({ onSave, onCancel, initialData }) => {
    const [formData, setFormData] = React.useState(initialData || emptyMember);
    const [activeTab, setActiveTab] = React.useState<'pessoal' | 'endereco' | 'banco'>('pessoal');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        setFormData(prev => ({
            ...prev, 
            [name]: type === 'number' ? parseFloat(value) || 0 : value
        }));
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex gap-2 border-b border-slate-700 pb-2 mb-4">
                <button type="button" onClick={() => setActiveTab('pessoal')} className={`px-3 py-1 rounded-md text-sm transition-colors ${activeTab === 'pessoal' ? 'bg-slate-700 text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}>Pessoal e Conta</button>
                <button type="button" onClick={() => setActiveTab('endereco')} className={`px-3 py-1 rounded-md text-sm transition-colors ${activeTab === 'endereco' ? 'bg-slate-700 text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}>Endereço</button>
                <button type="button" onClick={() => setActiveTab('banco')} className={`px-3 py-1 rounded-md text-sm transition-colors ${activeTab === 'banco' ? 'bg-slate-700 text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}>Dados Bancários</button>
            </div>

            {activeTab === 'pessoal' && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                    <Input label="Nome Completo" name="name" value={formData.name} onChange={handleChange} required />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Email (para login)" type="email" name="email" value={formData.email} onChange={handleChange} required />
                        <Input label="Telefone" name="phone" value={formData.phone} onChange={handleChange} required />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Senha" type="password" name="password" value={formData.password || ''} onChange={handleChange} required={!initialData} placeholder={initialData ? "Deixe em branco" : ""} />
                        <Input label="Custo Mensal (R$)" type="number" name="cost" value={formData.cost?.toString() || '0'} onChange={handleChange} />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <Input label="CPF" name="cpf" value={formData.cpf || ''} onChange={handleChange} />
                        <Input label="RG" name="rg" value={formData.rg || ''} onChange={handleChange} />
                        <Input label="Título Eleitor" name="voterId" value={formData.voterId || ''} onChange={handleChange} />
                    </div>
                    <div>
                        <label htmlFor="role" className="block text-sm font-medium text-slate-300 mb-1">Função</label>
                        <select id="role" name="role" value={formData.role} onChange={handleChange} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                            {(['Apoiador', 'Líder', 'Colaborador', 'Pesquisador', 'Fiscal'] as TeamMemberRole[]).map(role => <option key={role} value={role}>{role}</option>)}
                        </select>
                    </div>
                </div>
            )}

            {activeTab === 'endereco' && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                    <Input label="CEP" name="zipcode" value={formData.zipcode || ''} onChange={handleChange} />
                    <Input label="Logradouro" name="address" value={formData.address || ''} onChange={handleChange} />
                    <Input label="Bairro" name="neighborhood" value={formData.neighborhood || ''} onChange={handleChange} />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Município" name="city" value={formData.city || ''} onChange={handleChange} />
                        <Input label="Estado (UF)" name="state" value={formData.state || ''} onChange={handleChange} maxLength={2} />
                    </div>
                </div>
            )}

            {activeTab === 'banco' && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                    <Input label="Nome do Banco" name="bankName" value={formData.bankName || ''} onChange={handleChange} placeholder="Ex: Itaú, Nubank" />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Agência" name="bankAgency" value={formData.bankAgency || ''} onChange={handleChange} />
                        <Input label="Conta" name="bankAccount" value={formData.bankAccount || ''} onChange={handleChange} />
                    </div>
                    <Input label="Chave PIX" name="pixKey" value={formData.pixKey || ''} onChange={handleChange} />
                </div>
            )}

            <div className="flex justify-end gap-3 pt-6 border-t border-slate-700">
                <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
                <Button type="submit">Salvar Membro</Button>
            </div>
        </form>
    );
};


const TeamManager: React.FC = () => {
    const { teamMembers, addTeamMember, updateTeamMember, deleteTeamMember } = useTeam();
    const { sendPasswordReset, user } = useAuth();
    const [isModalOpen, setIsModalOpen] = React.useState(false);
    const [editingMember, setEditingMember] = React.useState<TeamMember | null>(null);
    const [isActing, setIsActing] = React.useState<string | null>(null);
    // "Gerar acesso" — modal mostra o link de convite p/ copiar e mandar pro membro
    const [grantInfo, setGrantInfo] = React.useState<{ memberName: string; url: string; reused?: boolean } | null>(null);
    const [copied, setCopied] = React.useState(false);

    const handleGrantAccess = async (member: TeamMember) => {
        setIsActing(`grant-${member.id}`);
        try {
            const r = await authedFetch(`/api/v1/team/members/${member.id}/invite`, { method: 'POST' });
            const j = await r.json().catch(() => ({} as any));
            if (r.ok) {
                setGrantInfo({ memberName: member.name, url: j.inviteUrl, reused: !!j.reused });
            } else {
                const detail = j.error || `HTTP ${r.status}`;
                const msg = detail === 'member_email_missing_or_invalid'
                    ? 'O membro precisa ter um e-mail válido cadastrado antes.'
                    : detail === 'already_has_access'
                    ? 'Este membro já tem acesso ao app.'
                    : `Erro: ${detail}`;
                alert(msg);
            }
        } catch {
            alert('Erro de conexão. Tente novamente.');
        } finally { setIsActing(null); }
    };
    const copyGrantLink = () => {
        if (!grantInfo) return;
        navigator.clipboard?.writeText(grantInfo.url)
            .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
    };

    const handleResetPassword = async (email: string) => {
        setIsActing(email);
        try {
            await sendPasswordReset(email);
            alert('Email de recuperação enviado com sucesso!');
        } catch (error) {
            alert('Erro ao enviar email de recuperação.');
        } finally {
            setIsActing(null);
        }
    };

    const handleSetPassword = async (email: string) => {
        const pass = prompt(`Definir nova senha para ${email}:`);
        if (!pass || pass.length < 6) {
            if (pass) alert("A senha deve ter pelo menos 6 caracteres.");
            return;
        }

        setIsActing(email);
        try {
            const { error } = await supabase.functions.invoke('set-password', {
                body: { email, newPassword: pass }
            });
            if (error) throw error;
            alert("Senha alterada com sucesso!");
        } catch (error: any) {
            alert(`Erro ao definir senha: ${error.message}`);
        } finally {
            setIsActing(null);
        }
    };

    const handleToggleBlock = async (member: TeamMember) => {
        const newRole = member.role === 'blocked' ? 'Apoiador' : 'blocked'; // Simplificação: se bloqueado volta como apoiador
        await updateTeamMember({ ...member, role: newRole as any });
    };

    const openAddModal = () => {
        setEditingMember(null);
        setIsModalOpen(true);
    }

    const openEditModal = (member: TeamMember) => {
        setEditingMember(member);
        setIsModalOpen(true);
    }
    
    const closeModal = () => {
        setIsModalOpen(false);
        setEditingMember(null);
    }

    const handleSave = async (memberData: Omit<TeamMember, 'id'> | TeamMember) => {
        try {
            if ('id' in memberData) {
                await updateTeamMember(memberData);
            } else {
                await addTeamMember(memberData);
            }
            alert('Membro salvo com sucesso!');
            closeModal();
        } catch (error: any) {
            // Mostra o motivo (ex.: e-mail já é membro, senha curta, etc.) em vez de falhar em silêncio.
            alert(error?.message || 'Não foi possível salvar o membro. Tente novamente.');
        }
    }

    const handleDelete = (id: string | number) => {
        deleteTeamMember(id);
    }

    const handleCopyLink = () => {
        const url = `${window.location.origin}/cadastro-equipe/${user?.campaignId || user?.id}`;
        navigator.clipboard.writeText(url);
        alert('Link de cadastro copiado para a área de transferência!');
    };

    return (
    <Card>
      <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
        <h3 className="text-lg font-bold text-slate-300">Membros da Equipe</h3>
        <div className="flex gap-2">
            <Button variant="secondary" onClick={handleCopyLink}>Copiar Link de Cadastro</Button>
            <Button onClick={openAddModal}>Adicionar Membro</Button>
        </div>
      </div>
       <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-slate-300">
                <thead className="text-xs text-slate-400 uppercase bg-slate-700">
                    <tr>
                        <th className="px-4 py-3">Nome</th>
                        <th className="px-4 py-3">Função</th>
                        <th className="px-4 py-3">Custo (R$)</th>
                        <th className="px-4 py-3">Telefone</th>
                        <th className="px-4 py-3 text-center">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    {teamMembers.map(member => (
                        <tr key={member.id} className="bg-slate-800 border-b border-slate-700 hover:bg-slate-700/50">
                            <td className="px-4 py-3 font-medium">{member.name}</td>
                            <td className="px-4 py-3">{member.role}</td>
                            <td className="px-4 py-3">R$ {member.cost?.toLocaleString('pt-BR') || '0'}</td>
                            <td className="px-4 py-3">{member.phone}</td>
                            <td className="px-4 py-3 text-center">
                                <div className="flex justify-center gap-2">
                                    {/* Órfão (sem login)? Mostra "Gerar acesso" em destaque e esconde os botões
                                        de senha (não fazem sentido sem conta no Auth ainda). */}
                                    {!member.userId ? (
                                        <button
                                            onClick={() => handleGrantAccess(member)}
                                            title="Gerar link de acesso (membro sem login)"
                                            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors ${isActing === `grant-${member.id}` ? 'text-slate-500' : 'text-amber-300 bg-amber-500/10 hover:bg-amber-500/20'}`}
                                        >
                                            <KeyRound className="w-3.5 h-3.5" /> Gerar acesso
                                        </button>
                                    ) : (
                                    <button
                                        onClick={() => handleSetPassword(member.email)}
                                        title="Definir Senha Manual"
                                        className={`transition-colors ${isActing === member.email ? 'text-slate-500 animate-spin' : 'text-indigo-400 hover:text-indigo-300'}`}
                                    >
                                        <Lock className="w-4 h-4" />
                                    </button>
                                    )}
                                    {member.userId && (
                                    <button
                                        onClick={() => handleResetPassword(member.email)}
                                        title="Enviar Link de Reset"
                                        className={`transition-colors ${isActing === member.email ? 'text-slate-500 animate-spin' : 'text-emerald-400 hover:text-emerald-300'}`}
                                    >
                                        <RefreshCw className="w-4 h-4" />
                                    </button>
                                    )}
                                    <button 
                                        onClick={() => handleToggleBlock(member)} 
                                        title={member.role === 'blocked' ? 'Desbloquear' : 'Bloquear'}
                                        className={`transition-colors ${member.role === 'blocked' ? 'text-amber-500 hover:text-amber-400' : 'text-slate-500 hover:text-red-400'}`}
                                    >
                                        {member.role === 'blocked' ? <CheckCircle className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                                    </button>
                                    <button onClick={() => openEditModal(member)} className="text-sky-400 hover:text-sky-300"><EditIcon /></button>
                                    <button onClick={() => handleDelete(member.id)} className="text-red-400 hover:text-red-300"><TrashIcon /></button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {teamMembers.length === 0 && <p className="text-center py-8 text-slate-400">Nenhum membro da equipe cadastrado.</p>}
        </div>

        {isModalOpen && (
            <Modal isOpen={isModalOpen} onClose={closeModal} title={editingMember ? "Editar Membro" : "Adicionar Membro"}>
                <TeamMemberForm onSave={handleSave} onCancel={closeModal} initialData={editingMember} />
            </Modal>
        )}

        {/* Modal "Gerar acesso" — link p/ copiar + mandar pro membro por WhatsApp/email */}
        {grantInfo && (
            <Modal isOpen={!!grantInfo} onClose={() => { setGrantInfo(null); setCopied(false); }} title="🔐 Link de acesso gerado">
                <div className="space-y-3">
                    <p className="text-sm text-slate-300">
                        {grantInfo.reused ? 'Já havia um convite pendente — ' : 'Pronto! '}
                        Mande este link para <b>{grantInfo.memberName}</b>. Ao abrir e fazer login (ou se cadastrar), ele entra direto no app com a função dele e amarra ao membro existente — sem cadastro duplicado.
                    </p>
                    <div className="flex gap-2 items-center">
                        <input readOnly value={grantInfo.url}
                            className="flex-1 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white" />
                        <button onClick={copyGrantLink}
                            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg px-3 py-2 text-sm font-bold">
                            {copied ? <><Check className="w-4 h-4" /> Copiado</> : <><Copy className="w-4 h-4" /> Copiar</>}
                        </button>
                    </div>
                    <p className="text-[11px] text-slate-500">
                        O link também foi enviado por e-mail (se configurado). Válido por 7 dias.
                    </p>
                </div>
            </Modal>
        )}
    </Card>
    );
};

export default TeamManager;
