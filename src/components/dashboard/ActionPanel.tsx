import Card from '../ui/Card';
import Button from '../ui/Button';
import { BirthdayIcon, CalendarIcon, InfoIcon, WhatsAppIcon } from '../icons';
import { Scenario } from '../../types/calculator';
import { Visit } from '../../types/visits';

interface ActionPanelProps {
  idealScenario: Scenario | null;
  aniversariantes: Visit[];
  visitasDeHoje: Visit[];
  onWhatsAppClick: (tel: string, name: string) => void;
}

const ActionPanel = ({ idealScenario, aniversariantes, visitasDeHoje, onWhatsAppClick }: ActionPanelProps) => (
  <Card className="no-print">
        <h3 className="font-bold text-lg text-slate-300 mb-4 flex items-center gap-2"><CalendarIcon /> Painel de Ações Rápidas</h3>
         {!idealScenario && (
            <div className="bg-yellow-500/10 text-yellow-300 p-3 rounded-lg flex items-center gap-3 mb-4">
                <InfoIcon />
                <span>Nenhum cenário ideal definido. Vá para a <strong>Calculadora</strong> para definir um e habilitar a meta diária.</span>
            </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                <h4 className="font-semibold text-slate-400 mb-2 flex items-center gap-2"><BirthdayIcon /> Aniversariantes do Dia</h4>
                {aniversariantes.length > 0 ? (
                    <ul className="space-y-2">
                        {aniversariantes.map(v => (
                            <li key={v.id} className="flex flex-wrap gap-2 justify-between items-center bg-slate-700/50 p-2 rounded-md">
                                <p className="font-medium">{v.resp}</p>
                                <Button onClick={() => onWhatsAppClick(v.tel, v.resp)} className="text-xs"><WhatsAppIcon /> Enviar</Button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-slate-500 italic">Nenhum aniversariante hoje.</p>
                )}
            </div>
             <div>
                <h4 className="font-semibold text-slate-400 mb-2 flex items-center gap-2"><CalendarIcon /> Visitas Agendadas para Hoje</h4>
                {visitasDeHoje.length > 0 ? (
                    <ul className="space-y-2">
                         {visitasDeHoje.map(v => (
                            <li key={v.id} className="bg-slate-700/50 p-2 rounded-md text-sm">
                                <p className="font-medium">{v.resp}</p>
                                <p className="text-xs text-slate-400">{v.bairro} (Apoiador: {v.apoiador})</p>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-slate-500 italic">Nenhuma visita pendente para hoje.</p>
                )}
            </div>
        </div>
    </Card>
);

export default ActionPanel;