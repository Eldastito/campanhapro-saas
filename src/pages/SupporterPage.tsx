import * as React from 'react';
import Header from '../components/Header';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import { useVisits } from '../contexts/VisitsContext';
import { useSettings } from '../contexts/SettingsContext';
import { getTodayString } from '../utils/helpers';
import { Visit } from '../types/visits';
import VisitForm from '../components/visits/VisitForm';
import EngagementForm from '../components/engagement/EngagementForm';
import VisitsTable from '../components/visits/VisitsTable';
import StreetReportForm from '../components/street/StreetReportForm';
import ShareLocationButton from '../components/team/ShareLocationButton';
import { useVisitModal } from '../hooks/useVisitModal';

const SupporterPage: React.FC = () => {
    const { user } = useAuth();
    const { visits, addVisit, updateVisit, deleteVisit, addEngagementAction } = useVisits();
    const { headerLogo } = useSettings();
    const { isModalOpen, editingVisit, openAddModal, openEditModal, closeModal, checkVisitLimit } = useVisitModal();
    const [isEngagementModalOpen, setIsEngagementModalOpen] = React.useState(false);
    const [filterInteresse, setFilterInteresse] = React.useState('');
    const [filterEngajamento, setFilterEngajamento] = React.useState('');

    const myVisits = React.useMemo(() => {
        if (!user || user.type === 'Admin') return [];
        let filtered = visits.filter(v => v.apoiador === user.name);
        if (filterInteresse) filtered = filtered.filter(v => v.interesse?.toLowerCase().includes(filterInteresse.toLowerCase()));
        if (filterEngajamento) filtered = filtered.filter(v => v.nivelEngajamento === filterEngajamento);
        return filtered;
    }, [visits, user, filterInteresse, filterEngajamento]);

    const visitsToday = React.useMemo(() => {
        const today = getTodayString();
        return myVisits.filter(v => v.data === today && v.realizada === 'nao');
    }, [myVisits]);

    const handleSaveVisit = async (visitData: Omit<Visit, 'id'> | Visit) => {
        const dataWithSupporter = { ...visitData, apoiador: user?.name || '' };
        if ('id' in dataWithSupporter) {
            await updateVisit(dataWithSupporter);
        } else {
            if (!checkVisitLimit()) return;
            await addVisit(dataWithSupporter);
        }
        closeModal();
    };
    
    const handleDeleteVisit = async (id: string | number) => {
        await deleteVisit(id);
    };

    const handleSaveEngagement = async (engagementData: any) => {
        const dataWithSupporter = { ...engagementData, apoiador: user?.name || '' };
        await addEngagementAction(dataWithSupporter);
        setIsEngagementModalOpen(false);
    };

    if (!user) return null;

    return (
        <div className="min-h-screen bg-slate-800 text-slate-50 font-sans">
            <Header logoUrl={headerLogo} />
            <main className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
                <h2 className="text-2xl font-bold text-slate-200">Olá, {user.name}!</h2>
                
                <Card>
                    <h3 className="text-lg font-bold text-slate-300 mb-4">Ações Rápidas</h3>
                    <div className="flex flex-wrap gap-4">
                        <Button onClick={openAddModal}>Registrar Nova Visita</Button>
                        <Button onClick={() => setIsEngagementModalOpen(true)} variant="secondary">Registrar Ação Rápida</Button>
                    </div>
                </Card>

                <ShareLocationButton />

                <StreetReportForm />

                <Card>
                    <h3 className="text-lg font-bold text-slate-300 mb-4">Minhas Visitas de Hoje ({visitsToday.length})</h3>
                     {visitsToday.length > 0 ? (
                        <ul className="space-y-2">
                           {visitsToday.map(v => (
                               <li key={v.id} className="bg-slate-700/50 p-3 rounded-md">
                                   <p className="font-semibold">{v.resp}</p>
                                   <p className="text-sm text-slate-400">{v.bairro}</p>
                               </li>
                           ))}
                        </ul>
                    ) : (
                        <p className="text-slate-400">Nenhuma visita pendente para hoje. Bom trabalho!</p>
                    )}
                </Card>

                <Card>
                    <h3 className="text-lg font-bold text-slate-300 mb-4">Todas as Minhas Visitas</h3>
                    <div className="flex flex-wrap gap-4 mb-4">
                        <Input label="Filtrar por Interesse" value={filterInteresse} onChange={(e) => setFilterInteresse(e.target.value)} />
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-1">Filtrar por Engajamento</label>
                            <select value={filterEngajamento} onChange={(e) => setFilterEngajamento(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                                <option value="">Todos</option>
                                <option value="baixo">Baixo</option>
                                <option value="medio">Médio</option>
                                <option value="alto">Alto</option>
                            </select>
                        </div>
                    </div>
                    <VisitsTable visits={myVisits} onEdit={openEditModal} onDelete={handleDeleteVisit} />
                </Card>
            </main>
            
            {isModalOpen && (
                <Modal isOpen={isModalOpen} onClose={closeModal} title={editingVisit ? "Editar Visita" : "Adicionar Visita"}>
                    <VisitForm onSave={handleSaveVisit} onCancel={closeModal} initialData={editingVisit} />
                </Modal>
            )}

            {isEngagementModalOpen && (
                <Modal isOpen={isEngagementModalOpen} onClose={() => setIsEngagementModalOpen(false)} title="Registrar Ação de Engajamento">
                    <EngagementForm 
                        onSave={handleSaveEngagement} 
                        onCancel={() => setIsEngagementModalOpen(false)} 
                        initialData={{ data: getTodayString(), apoiador: user.name, tipo: 'Abordagem Rápida' }}
                    />
                </Modal>
            )}
        </div>
    );
};

export default SupporterPage;
