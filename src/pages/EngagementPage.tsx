import * as React from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { useVisits } from '../contexts/VisitsContext';
import { EngagementAction } from '../types/engagement';
import EngagementForm from '../components/engagement/EngagementForm';
import EngagementsTable from '../components/engagement/EngagementsTable';
import EngagementFollowupPanel from '../components/engagement/EngagementFollowupPanel';

const emptyAction: Omit<EngagementAction, 'id'> = {
    data: new Date().toISOString().split('T')[0],
    apoiador: '',
    tipo: 'Abordagem Rápida',
};

const EngagementPage = () => {
    const { engagementActions, addEngagementAction } = useVisits();
    const [isModalOpen, setIsModalOpen] = React.useState(false);

    const handleSave = async (actionData: Omit<EngagementAction, 'id'>) => {
        try {
            await addEngagementAction(actionData);
            alert('Ação registrada com sucesso!');
            setIsModalOpen(false);
        } catch (error) {
            // Error handled by context
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-200">Ações de Campo (em massa)</h2>
                    <p className="text-xs text-slate-400 mt-1">
                        Panfletagem, distribuição de material e eventos. Para cadastro nominal de eleitores, use <b>CRM</b>.
                    </p>
                </div>
                <Button onClick={() => setIsModalOpen(true)}>Registrar Nova Ação</Button>
            </div>

            {/* Follow-up de pessoas identificadas (#135) */}
            <EngagementFollowupPanel />

            <Card>
                <EngagementsTable actions={engagementActions} />
            </Card>
            
            {isModalOpen && (
                <Modal 
                    isOpen={isModalOpen} 
                    onClose={() => setIsModalOpen(false)} 
                    title="Registrar Ação de Engajamento"
                >
                    <EngagementForm 
                        onSave={handleSave}
                        onCancel={() => setIsModalOpen(false)}
                        initialData={emptyAction}
                    />
                </Modal>
            )}
        </div>
    );
};

export default EngagementPage;