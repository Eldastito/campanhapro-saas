import Tabs from '../components/Tabs';
import TeamManager from '../components/resources/TeamManager';
import LocationsManager from '../components/resources/LocationsManager';
import TeamResourcesManager from '../components/resources/TeamResourcesManager';
import { UsersGroupIcon, MapPinIcon, ArchiveBoxIcon } from '../components/icons';

const ResourcesPage = () => {
    const tabs = ['Equipes', 'Localidades', 'Materiais'];
    const iconMap = {
        Equipes:     <UsersGroupIcon className="h-5 w-5" />,
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
                <TeamManager />
                <LocationsManager />
                <TeamResourcesManager />
            </Tabs>
        </div>
    );
};

export default ResourcesPage;
