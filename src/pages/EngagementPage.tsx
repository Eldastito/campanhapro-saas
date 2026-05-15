import * as React from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { useVisits } from '../contexts/VisitsContext';
import { EngagementAction } from '../types/engagement';
import EngagementForm from '../components/engagement/EngagementForm';
import EngagementsTable from '../components/engagement/EngagementsTable';

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
                <h2 className="text-2xl font-bold text-slate-200">Ações de Engajamento</h2>
                <Button onClick={() => setIsModalOpen(true)}>Registrar Nova Ação</Button>
            </div>
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