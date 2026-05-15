import * as React from 'react';
import { Visit } from '../../types/visits';
import VisitRow from './VisitRow';

interface VisitsTableProps {
  visits: Visit[];
  onEdit: (visit: Visit) => void;
  onDelete: (id: string | number) => void;
}

const VisitsTable = ({ visits, onEdit, onDelete }: VisitsTableProps) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left text-slate-300">
        <thead className="text-xs text-slate-400 uppercase bg-slate-700">
          <tr>
            <th className="px-4 py-3">Data</th>
            <th className="px-4 py-3">Responsável</th>
            <th className="px-4 py-3">Localidade (Bairro/Mun.)</th>
            <th className="px-4 py-3">Apoiador</th>
            <th className="px-4 py-3 text-center">Votos</th>
            <th className="px-4 py-3 text-center">Realizada</th>
            <th className="px-4 py-3 text-right">Detalhes</th>
          </tr>
        </thead>
        <tbody>
          {visits.map(visit => (
            <React.Fragment key={visit.id}>
              <VisitRow 
                visit={visit} 
                onEdit={onEdit}
                onDelete={onDelete} 
              />
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {visits.length === 0 && <p className="text-center py-8 text-slate-400">Nenhuma visita encontrada.</p>}
    </div>
  );
};

export default VisitsTable;