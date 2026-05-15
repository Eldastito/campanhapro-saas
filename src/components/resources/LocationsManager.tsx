import * as React from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { useTeam } from '../../contexts/TeamContext';
import { useVisits } from '../../contexts/VisitsContext';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import Input from '../ui/Input';
import { TrashIcon } from '../icons';

const LocationsManager: React.FC = () => {
    const { user } = useAuth();
    const { locations, addLocation, deleteLocation, loadRioBairros } = useTeam();
    const { visits } = useVisits();
    const [newLocationName, setNewLocationName] = React.useState('');
    const [newMunicipality, setNewMunicipality] = React.useState('Rio de Janeiro');
    const [onlyActive, setOnlyActive] = React.useState(false);
    const [contactsByBairro, setContactsByBairro] = React.useState<Record<string, number>>({});

    // Conta eleitores cadastrados por bairro (uma vez por campanha).
    React.useEffect(() => {
        if (!user?.campaignId) return;
        let alive = true;
        (async () => {
            const { data, error } = await supabase
                .from('contacts')
                .select('neighborhood')
                .eq('campaignId', user.campaignId)
                .limit(10000);
            if (error || !alive) return;
            const counts: Record<string, number> = {};
            (data || []).forEach((c: any) => {
                const k = (c.neighborhood || '').trim();
                if (k) counts[k] = (counts[k] || 0) + 1;
            });
            setContactsByBairro(counts);
        })();
        return () => { alive = false; };
    }, [user?.campaignId]);

    // Conta visitas por bairro a partir do contexto.
    const visitsByBairro = React.useMemo(() => {
        const counts: Record<string, number> = {};
        visits.forEach(v => {
            const k = (v.bairro || '').trim();
            if (k) counts[k] = (counts[k] || 0) + 1;
        });
        return counts;
    }, [visits]);

    const filteredLocations = React.useMemo(() => {
        if (!onlyActive) return locations;
        return locations.filter(l => {
            const c = contactsByBairro[l.name] || 0;
            const v = visitsByBairro[l.name] || 0;
            return c + v > 0;
        });
    }, [locations, onlyActive, contactsByBairro, visitsByBairro]);

    const handleAddLocation = (e: React.FormEvent) => {
        e.preventDefault();
        if (newLocationName.trim() && newMunicipality.trim()) {
            addLocation({
                name: newLocationName.trim(),
                municipality: newMunicipality.trim()
            });
            setNewLocationName('');
        }
    }

    const handleDelete = (id: string | number) => {
        deleteLocation(id);
    }

    const handleLoadBairros = () => {
        loadRioBairros();
    }

    return (
        <Card>
            <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
                <div>
                    <h3 className="text-lg font-bold text-slate-300">Localidades de Atuação</h3>
                    <p className="text-xs text-slate-500 mt-1">
                        {locations.length} bairro(s) cadastrado(s)
                        {onlyActive && ` · ${filteredLocations.length} com atividade`}
                    </p>
                </div>
                <Button onClick={handleLoadBairros} variant="secondary">
                    Carregar Bairros do Estado do RJ
                </Button>
            </div>

            <form onSubmit={handleAddLocation} className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
                <Input
                    label="Município"
                    id="new-municipality"
                    value={newMunicipality}
                    onChange={(e) => setNewMunicipality(e.target.value)}
                    placeholder="Ex: Rio de Janeiro"
                />
                <Input
                    label="Bairro"
                    id="new-location"
                    value={newLocationName}
                    onChange={(e) => setNewLocationName(e.target.value)}
                    placeholder="Ex: Copacabana"
                />
                <Button type="submit" className="self-end h-[42px]">Adicionar</Button>
            </form>

            <label className="flex items-center gap-2 text-sm text-slate-300 mb-3 cursor-pointer">
                <input
                    type="checkbox"
                    checked={onlyActive}
                    onChange={e => setOnlyActive(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-700"
                />
                Mostrar apenas bairros com atividade (eleitores ou visitas)
            </label>

            <div className="max-h-96 overflow-y-auto pr-2">
                <ul className="space-y-2">
                    {filteredLocations.map(location => {
                        const c = contactsByBairro[location.name] || 0;
                        const v = visitsByBairro[location.name] || 0;
                        const isActive = c + v > 0;
                        return (
                            <li key={location.id} className="bg-slate-800 p-3 rounded-md flex justify-between items-center">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-slate-200 truncate">{location.name}</span>
                                        {isActive && <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" title="Bairro com atividade" />}
                                    </div>
                                    <span className="text-xs text-slate-400 block uppercase tracking-wider">{location.municipality}</span>
                                    <div className="text-[11px] text-slate-500 mt-1 flex gap-3">
                                        <span><b className="text-sky-400">{c}</b> eleitor{c !== 1 ? 'es' : ''}</span>
                                        <span><b className="text-emerald-400">{v}</b> visita{v !== 1 ? 's' : ''}</span>
                                    </div>
                                </div>
                                <button onClick={() => handleDelete(location.id)} className="text-red-400 hover:text-red-300 p-2 flex-shrink-0"><TrashIcon className="h-4 w-4" /></button>
                            </li>
                        );
                    })}
                </ul>
                {filteredLocations.length === 0 && (
                    <p className="text-center py-8 text-slate-400">
                        {onlyActive
                            ? 'Nenhum bairro com atividade ainda. Cadastre eleitores no CRM ou registre visitas para começar a aparecer aqui.'
                            : 'Nenhuma localidade cadastrada.'}
                    </p>
                )}
            </div>
        </Card>
    );
};

export default LocationsManager;
