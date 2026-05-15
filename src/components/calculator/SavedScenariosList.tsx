import { Scenario } from '../../types/calculator';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { StarIcon } from '../icons';

interface SavedScenariosListProps {
  scenarios: Scenario[];
  idealScenarioId: string | number | null;
  onSetIdeal: (id: string | number) => void;
  onDelete: (id: string | number) => void;
}

const SavedScenariosList = ({ scenarios, idealScenarioId, onSetIdeal, onDelete }: SavedScenariosListProps) => {
  
  const handleDelete = (id: string | number) => {
    onDelete(id);
  };

  return (
    <Card>
      <h3 className="font-bold text-lg text-slate-300 mb-4">Cenários Salvos</h3>
      <div className="space-y-3">
        {scenarios.map(s => (
            <div key={s.id} className={`p-3 rounded-lg flex flex-wrap items-center justify-between gap-4 transition-all ${idealScenarioId === s.id ? 'bg-sky-800/50 ring-2 ring-[#4ac7f0]' : 'bg-slate-700'}`}>
                <div>
                    <p className="font-bold">{s.name}</p>
                    <p className="text-xs text-slate-400">
                        Meta: {s.meta} | Votos/Fam: {s.vpf} | Dias/Sem: {s.ds} | Cap/Dia: {s.cap} | Buffer: {s.buff}%
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant={idealScenarioId === s.id ? 'primary' : 'secondary'} onClick={() => onSetIdeal(s.id)} className="text-xs"><StarIcon/>{idealScenarioId === s.id ? 'Ideal' : 'Definir Ideal'}</Button>
                    <Button variant="danger" onClick={() => handleDelete(s.id)} className="text-xs">Excluir</Button>
                </div>
            </div>
        ))}
      </div>
    </Card>
  );
};

export default SavedScenariosList;