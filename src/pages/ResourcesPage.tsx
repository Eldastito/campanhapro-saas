import Tabs from '../components/Tabs';
import TeamManager from '../components/resources/TeamManager';
import LocationsManager from '../components/resources/LocationsManager';
import TeamResourcesManager from '../components/resources/TeamResourcesManager';
import TeamGoalsManager from '../components/resources/TeamGoalsManager';
import TeamGamificationPanel from '../components/resources/TeamGamificationPanel';
import TeamROIPanel from '../components/resources/TeamROIPanel';
import { UsersGroupIcon, MapPinIcon, ArchiveBoxIcon } from '../components/icons';
import { Target } from 'lucide-react';

const ResourcesPage = () => {
    const tabs = ['Equipes', 'Metas', 'Localidades', 'Materiais'];
    const iconMap = {
        Equipes:     <UsersGroupIcon className="h-5 w-5" />,
        Metas:       <Target className="h-5 w-5" />,
        Localidades: <MapPinIcon className="h-5 w-5" />,
        Materiais:   <ArchiveBoxIcon className="h-5 w-5" />,
    };

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-slate-200">Recursos da Campanha</h2>
            <p className="text-slate-400">
                Gerencie os cadastros essenciais da sua campanha. Mantenha as informações da sua equipe e áreas de atuação sempre atualizadas.
            </p>
            <Tabs tabs={tabs} iconMap={iconMap} mode="state">
                <div className="space-y-6">
                    <TeamROIPanel />
                    <TeamGamificationPanel />
                    <TeamManager />
                </div>
                <TeamGoalsManager />
                <LocationsManager />
                <TeamResourcesManager />
            </Tabs>
        </div>
    );
};

export default ResourcesPage;
