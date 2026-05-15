import * as React from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { useProfilePermissions, DEFAULT_PERMISSIONS } from '../contexts/PermissionsContext';
import { ShieldCheck, Eye, EyeOff, Save, RotateCcw } from 'lucide-react';
import { motion } from 'framer-motion';

const ALL_TABS = [
    'Dashboard', 'Agentes IA', 'Calculadora', 'Visitas', 'Engajamento', 'Recursos', 
    'Equipes', 'Financeiro', 'Treinamento', 'Ferramentas', 'Permissões', 'Configurações', 'Ajuda'
];

const ROLES = ['Admin', 'Líder', 'Apoiador', 'Colaborador', 'Pesquisador', 'Candidato'];

const PermissionsPage: React.FC = () => {
    const { permissions, updatePermissions, isLoading } = useProfilePermissions();
    const [localPermissions, setLocalPermissions] = React.useState(DEFAULT_PERMISSIONS);
    const [isSaving, setIsSaving] = React.useState(false);

    React.useEffect(() => {
        if (permissions) {
            setLocalPermissions(permissions);
        }
    }, [permissions]);

    const toggleTab = (role: string, tab: string) => {
        setLocalPermissions(prev => {
            const roleTabs = prev[role] || [];
            const newTabs = roleTabs.includes(tab)
                ? roleTabs.filter(t => t !== tab)
                : [...roleTabs, tab];
            
            return { ...prev, [role]: newTabs };
        });
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await updatePermissions(localPermissions);
            alert('Permissões atualizadas com sucesso!');
        } catch (error) {
            console.error(error);
            alert('Erro ao salvar permissões.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        if (confirm('Deseja restaurar as permissões padrão da plataforma?')) {
            setLocalPermissions(DEFAULT_PERMISSIONS);
        }
    };

    if (isLoading) return <div className="p-8 text-center">Carregando permissões...</div>;

    return (
        <div className="space-y-6">
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                        <ShieldCheck className="text-emerald-400 w-8 h-8" />
                        Gestão de Permissões por Perfil
                    </h1>
                    <p className="text-slate-400 mt-2">Personalize quais módulos cada perfil de usuário poderá visualizar e acessar.</p>
                </div>
                <div className="flex gap-3">
                    <Button variant="ghost" onClick={handleReset} className="text-slate-400 hover:text-white">
                        <RotateCcw className="w-4 h-4 mr-2" /> Restaurar Padrão
                    </Button>
                    <Button variant="primary" onClick={handleSave} disabled={isSaving} className="bg-emerald-600 hover:bg-emerald-500 border-none shadow-lg">
                        <Save className="w-4 h-4 mr-2" /> {isSaving ? 'Salvando...' : 'Salvar Configurações'}
                    </Button>
                </div>
            </header>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {ROLES.map((role) => (
                    <motion.div
                        key={role}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                    >
                        <Card className="bg-slate-800/50 border-slate-700/50 h-full overflow-hidden">
                            <div className="bg-slate-800 p-4 border-b border-slate-700 flex justify-between items-center">
                                <h2 className="text-lg font-bold text-slate-200">{role}</h2>
                                <span className="text-xs bg-slate-700 text-slate-400 px-2 py-1 rounded">
                                    {localPermissions[role]?.length || 0} módulos ativos
                                </span>
                            </div>
                            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {ALL_TABS.map((tab) => {
                                    const isActive = localPermissions[role]?.includes(tab);
                                    // Bloquear a própria página de permissões para quem não é Admin para evitar lockout
                                    const isLocked = tab === 'Permissões' && role !== 'Admin';
                                    
                                    return (
                                        <button
                                            key={tab}
                                            disabled={isLocked}
                                            onClick={() => toggleTab(role, tab)}
                                            className={`
                                                flex items-center justify-between p-2 rounded-lg text-xs transition-all
                                                ${isActive 
                                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' 
                                                    : 'bg-slate-900/50 text-slate-500 border border-slate-800'
                                                }
                                                ${isLocked ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}
                                            `}
                                        >
                                            <span className="truncate mr-2">{tab}</span>
                                            {isActive ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </Card>
                    </motion.div>
                ))}
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex gap-4 items-start">
                <ShieldCheck className="text-amber-400 w-6 h-6 shrink-0 mt-1" />
                <div className="text-sm text-amber-200/80">
                    <p className="font-bold text-amber-400 mb-1">Nota sobre Segurança:</p>
                    <p>Remover a visibilidade de um módulo não apaga os dados, apenas oculta o acesso no menu. Administradores do sistema sempre terão acesso aos dados brutos via exportação, independente das permissões de aba.</p>
                </div>
            </div>
        </div>
    );
};

export default PermissionsPage;
