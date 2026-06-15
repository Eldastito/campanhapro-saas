import * as React from 'react';
import { useVisits } from '../contexts/VisitsContext';
import { Visit } from '../types/visits';
import { useVisitsManager } from '../hooks/useVisitsManager';
import { useVisitModal } from '../hooks/useVisitModal';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import VisitForm from '../components/visits/VisitForm';
import VisitsTable from '../components/visits/VisitsTable';
import VisitsLeaderRanking from '../components/visits/VisitsLeaderRanking';
import { usePermissions } from '../hooks/usePermissions';
import { ClipboardListIcon, CalendarIcon } from '../components/icons';
import { useAuth } from '../contexts/AuthContext';
import { updateVoterJourney } from '../services/voterJourneyService';

const VisitsPage = () => {
    const { user } = useAuth();
    const { visits, addVisit, updateVisit, deleteVisit } = useVisits();
    const permissions = usePermissions();
    const { sortedVisits, searchTerm, setSearchTerm } = useVisitsManager(visits);
    const { isModalOpen, editingVisit, openAddModal, openEditModal, closeModal, checkVisitLimit } = useVisitModal();
    const [activeTab, setActiveTab] = React.useState<'realizadas' | 'agenda'>('realizadas');

    const handleSave = async (visitData: Omit<Visit, 'id'> | Visit) => {
        try {
            if ('id' in visitData && visitData.id) {
                await updateVisit(visitData as Visit);
            } else {
                if (!checkVisitLimit()) return;
                await addVisit(visitData);
            }
            alert('Visita salva com sucesso!');
            
            // Atualizar jornada do eleitor
            if (visitData.voterId && user?.campaignId) {
                await updateVoterJourney(visitData.voterId, user.campaignId);
            }

            closeModal();
        } catch (error) {
            // Error handled by context
        }
    };

    const handleDelete = async (id: string | number) => {
        await deleteVisit(id);
    };

    const realizadas = sortedVisits.filter(v => v.realizada === 'sim');
    const agenda = sortedVisits.filter(v => v.realizada === 'nao');
    
    return (
        <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-4">
                 <div className="flex-grow">
                    <h2 className="text-2xl font-bold text-slate-200">Gestão de Visitas</h2>
                    {permissions.visitLimit !== null && (
                        <p className="text-sm text-slate-400">
                            {visits.length} / {permissions.visitLimit} visitas registradas.
                        </p>
                    )}
                 </div>
                 <Button onClick={openAddModal}>Agendar / Adicionar Visita</Button>
            </div>

            {/* Ranking de líderes (#135) */}
            <VisitsLeaderRanking />

            <div className="flex gap-4 border-b border-slate-700">
                <button 
                    onClick={() => setActiveTab('realizadas')}
                    className={`pb-2 px-1 flex items-center gap-2 transition-colors ${activeTab === 'realizadas' ? 'text-[#4ac7f0] border-b-2 border-[#4ac7f0]' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    <ClipboardListIcon className="w-5 h-5" />
                    Realizadas ({realizadas.length})
                </button>
                <button 
                    onClick={() => setActiveTab('agenda')}
                    className={`pb-2 px-1 flex items-center gap-2 transition-colors ${activeTab === 'agenda' ? 'text-[#4ac7f0] border-b-2 border-[#4ac7f0]' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    <CalendarIcon className="w-5 h-5" />
                    Agenda / Pendentes ({agenda.length})
                </button>
            </div>
            
            <Card>
                <div className="mb-4">
                    <Input
                        label="Buscar por responsável, bairro ou apoiador..."
                        id="search"
                        type="text"
                        placeholder="Digite para buscar..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <VisitsTable
                    visits={activeTab === 'realizadas' ? realizadas : agenda}
                    onEdit={openEditModal}
                    onDelete={handleDelete}
                />
            </Card>

            {isModalOpen && (
                <Modal 
                    isOpen={isModalOpen} 
                    onClose={closeModal} 
                    title={editingVisit ? "Editar Registro" : "Agendar Nova Visita"}
                >
                    <VisitForm
                        onSave={handleSave}
                        onCancel={closeModal}
                        initialData={editingVisit}
                    />
                </Modal>
            )}
        </div>
    );
};

export default VisitsPage;
