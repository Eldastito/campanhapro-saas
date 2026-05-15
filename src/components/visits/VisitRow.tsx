import * as React from 'react';
import { Visit } from '../../types/visits';
import { useVisits } from '../../contexts/VisitsContext';
import Switch from '../ui/Switch';
import Button from '../ui/Button';
import { ChevronDownIcon, TrashIcon, EditIcon } from '../icons';

interface VisitRowProps {
  visit: Visit;
  onEdit: (visit: Visit) => void;
  onDelete: (id: string | number) => void;
}

const VisitRow = ({ visit, onEdit, onDelete }: VisitRowProps) => {
  const { updateVisit } = useVisits();
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [isEditingVote, setIsEditingVote] = React.useState(false);
  const [voteValue, setVoteValue] = React.useState(visit.votos);

  const handleStatusChange = async (newStatus: boolean) => {
    const updatedVisit: Visit = { ...visit, realizada: newStatus ? 'sim' : 'nao' };
    try {
        await updateVisit(updatedVisit);
    } catch (error) {
        console.error("Failed to update visit status", error);
        alert("Falha ao atualizar status.");
    }
  };

  const handleVoteSave = async () => {
    if (voteValue === visit.votos) {
      setIsEditingVote(false);
      return;
    }
    const updatedVisit = { ...visit, votos: voteValue };
    try {
      await updateVisit(updatedVisit);
    } catch (error) {
      console.error("Failed to update votes", error);
      alert("Falha ao atualizar votos.");
    } finally {
      setIsEditingVote(false);
    }
  };

  const handleVoteKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleVoteSave();
    else if (e.key === 'Escape') setIsEditingVote(false);
  };
  
  return (
    <React.Fragment>
      <tr className="bg-slate-800 border-b border-slate-700 hover:bg-slate-700/50">
          <td className="px-4 py-3">{visit.data}</td>
          <td className="px-4 py-3 font-medium">{visit.resp}</td>
          <td className="px-4 py-3">
            <span className="block">{visit.bairro}</span>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">{visit.municipio}</span>
          </td>
          <td className="px-4 py-3">{visit.apoiador}</td>
          <td className="px-4 py-3 text-center font-bold text-[#4ac7f0]">
          {isEditingVote ? (
              <input
                  type="number"
                  value={voteValue}
                  onChange={(e) => setVoteValue(Number(e.target.value))}
                  onBlur={handleVoteSave}
                  onKeyDown={handleVoteKeyDown}
                  autoFocus
                  className="w-16 bg-slate-600 text-center rounded-md"
              />
          ) : (
              <span onClick={() => setIsEditingVote(true)} className="cursor-pointer p-1">
                  {visit.votos}
              </span>
          )}
          </td>
          <td className="px-4 py-3">
              <div className="flex justify-center">
                  <Switch
                      id={`status-${visit.id}`}
                      checked={visit.realizada === 'sim'}
                      onChange={handleStatusChange}
                  />
              </div>
          </td>
          <td className="px-4 py-3 text-right">
             <button onClick={() => setIsExpanded(prev => !prev)} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                 <ChevronDownIcon />
             </button>
          </td>
      </tr>
      {isExpanded && (
          <tr className="bg-slate-800/50">
              <td colSpan={7} className="p-4">
                  <div className="bg-slate-700 p-4 rounded-lg space-y-3">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                          <div><strong className="block text-slate-400">Telefone:</strong> {visit.tel || 'N/A'}</div>
                          <div><strong className="block text-slate-400">Nascimento:</strong> {visit.nasc || 'N/A'}</div>
                          <div><strong className="block text-slate-400">Eleitores:</strong> {visit.eleitores}</div>
                          <div><strong className="block text-slate-400">Participantes:</strong> {visit.participantes}</div>
                          <div><strong className="block text-slate-400">Tem Pet:</strong> {visit.pet} ({visit.tipo_pet || 'N/A'})</div>
                          <div><strong className="block text-slate-400">Crianças:</strong> {visit.criancas || 'N/A'}</div>
                      </div>
                      <div>
                          <strong className="block text-slate-400 text-xs">Solicitações:</strong>
                          <p className="text-sm">{visit.solicit || 'Nenhuma'}</p>
                      </div>
                      <div className="flex justify-end gap-2 pt-2 border-t border-slate-600/50">
                          <Button variant="secondary" onClick={() => onEdit(visit)} className="text-xs"><EditIcon/> Editar Completo</Button>
                          <Button variant="danger" onClick={() => onDelete(visit.id)} className="text-xs"><TrashIcon/> Excluir Visita</Button>
                      </div>
                  </div>
              </td>
          </tr>
      )}
    </React.Fragment>
  );
};

export default VisitRow;