import { useAuth } from '../contexts/AuthContext';
import { useVisits } from '../contexts/VisitsContext';
import { useCalculator } from '../contexts/CalculatorContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { AlertTriangleIcon, CheckCircleIcon } from '../components/icons';
import { calculateDaysRemaining } from '../utils/helpers';
import { UserCheck } from 'lucide-react'; // Using lucide-react instead of missing UserIcon

const CandidateDashboard = () => {
    const { user, logout } = useAuth();
    const { visits, engagementActions } = useVisits();
    const { calcState } = useCalculator();

    const daysRemaining = calculateDaysRemaining(calcState.eleicao);

    // Métricas
    const totalVisits = visits.length;
    const completedVisits = visits.filter(v => v.realizada === 'sim').length;
    
    // Intenção de Voto Mock (usaremos os labels pra simular por hora ou contar 'engagement')
    const votosConfirmados = visits.reduce((acc, v) => v.realizada === 'sim' ? acc + v.votos : acc, 0);

    return (
        <div className="min-h-screen bg-slate-900 text-slate-200">
            <header className="bg-slate-800 p-4 shadow-md flex justify-between items-center border-b border-slate-700">
                <div>
                    <h1 className="text-xl font-bold flex items-center gap-2">
                        <UserCheck className="w-6 h-6 text-indigo-400" />
                        Visão Executiva do Candidato
                    </h1>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-slate-400 text-sm">Logado como <strong className="text-slate-200">{user?.name}</strong></span>
                    <Button variant="ghost" onClick={logout}>Sair da Conta</Button>
                </div>
            </header>

            <main className="max-w-7xl mx-auto p-6 space-y-6">
                
                {/* Highlights Row */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card className="border-l-4 border-indigo-500 bg-slate-800 p-4">
                        <p className="text-sm text-slate-400">Dias até a Eleição</p>
                        <p className="text-3xl font-black text-indigo-400">{daysRemaining}</p>
                    </Card>
                    <Card className="border-l-4 border-emerald-500 bg-slate-800 p-4">
                        <p className="text-sm text-slate-400">Votos Estimados Confirmados</p>
                        <p className="text-3xl font-black text-emerald-400">{votosConfirmados}</p>
                    </Card>
                    <Card className="border-l-4 border-sky-500 bg-slate-800 p-4">
                        <p className="text-sm text-slate-400">Pautas Pessoais em Campo</p>
                        <p className="text-3xl font-black text-sky-400">{totalVisits}</p>
                    </Card>
                    <Card className="border-l-4 border-amber-500 bg-slate-800 p-4">
                        <p className="text-sm text-slate-400">Ações de Engajamento</p>
                        <p className="text-3xl font-black text-amber-400">{engagementActions.length}</p>
                    </Card>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Alertas Críticos do Campo */}
                    <Card className="bg-slate-800">
                        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <AlertTriangleIcon className="w-5 h-5 text-red-500" />
                            Feed de Alertas em Tempo Real
                        </h2>
                        <div className="space-y-3">
                            {engagementActions.length > 0 ? engagementActions.slice(0, 5).map((action, i) => (
                                <div key={i} className="bg-slate-700/50 p-3 rounded border border-slate-600/50">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="text-sm font-semibold">{action.tipo}</span>
                                        <span className="text-xs text-slate-400">{new Date(action.data).toLocaleDateString()}</span>
                                    </div>
                                    <p className="text-sm text-slate-300">Baseado no contato por: {action.apoiador}</p>
                                </div>
                            )) : (
                                <p className="text-sm text-slate-400">Nenhum alerta recente da equipe.</p>
                            )}
                        </div>
                    </Card>

                    {/* Progressão de Visitas */}
                    <Card className="bg-slate-800">
                        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <CheckCircleIcon className="w-5 h-5 text-emerald-500" />
                            Visitas Realizadas vs Expectativa
                        </h2>
                        <div className="flex flex-col gap-4">
                            <div>
                                <p className="text-sm font-medium mb-1">Desempenho Geral ({completedVisits}/{totalVisits})</p>
                                <div className="w-full bg-slate-700 rounded-full h-3">
                                    <div className="bg-emerald-500 h-3 rounded-full" style={{ width: `${totalVisits > 0 ? (completedVisits / totalVisits) * 100 : 0}%` }}></div>
                                </div>
                            </div>
                            <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
                                <p className="text-sm text-indigo-200">
                                   Seu dashboard está mapeado para monitorar sua própria evolução junto aos eleitores consolidados. Verifique relatórios semanais com o seu Comandante de Campo / Diretor de Campanha para detalhes aprofundados.
                                </p>
                            </div>
                        </div>
                    </Card>
                </div>

            </main>
        </div>
    );
};

export default CandidateDashboard;
