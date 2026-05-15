import * as React from 'react';
import { CalculatorState } from '../../types/calculator';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { SaveIcon } from '../icons';

interface CalculatorFormProps {
  calcState: CalculatorState;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSetElection: () => void;
  onSaveScenario: () => void;
}

const CalculatorForm = ({ calcState, onChange, onSetElection, onSaveScenario }: CalculatorFormProps) => {
  return (
    <Card className="md:col-span-1 space-y-4">
        <h3 className="font-bold text-lg text-slate-300">Parâmetros</h3>
        <Input label="Meta de Votos" type="number" name="meta" value={calcState.meta} onChange={onChange} />
        <Input label="Data da Eleição" type="date" name="eleicao" value={calcState.eleicao} onChange={onChange} />
        <Button variant="secondary" onClick={onSetElection} className="w-full text-sm">Definir 1º turno do próximo ano</Button>
        <Input label="Dias de Visita/Semana" type="number" name="ds" value={calcState.ds} onChange={onChange} />
        <Input label="Capacidade de Visitas/Dia" type="number"name="cap" value={calcState.cap} onChange={onChange} />
        <Input label="Votos/Família (Base)" type="number" name="vpf" value={calcState.vpf} onChange={onChange} />
        <Input label="Buffer % (Não comparecimento, etc.)" type="number" name="buff" value={calcState.buff} onChange={onChange} />
        <Button onClick={onSaveScenario} className="w-full"><SaveIcon />Salvar Cenário Atual</Button>
    </Card>
  );
};

export default CalculatorForm;