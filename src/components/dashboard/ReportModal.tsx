import * as React from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { BarChartIcon, UsersGroupIcon, CurrencyDollarIcon, ClipboardListIcon } from '../icons';

interface ReportOption {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  category: string;
}

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerateReport: (reportId: string) => void;
}

const reportOptions: ReportOption[] = [
  {
    id: 'general-performance',
    title: 'Desempenho Geral da Campanha',
    description: 'Visão completa com KPIs, progresso diário e status em relação à meta ideal.',
    icon: <BarChartIcon className="h-6 w-6 text-sky-400" />,
    category: 'Estratégico'
  },
  {
    id: 'team-productivity',
    title: 'Produtividade da Equipe',
    description: 'Ranking de apoiadores, média de votos por visita e engajamento por líder.',
    icon: <UsersGroupIcon className="h-6 w-6 text-teal-400" />,
    category: 'Gestão'
  },
  {
    id: 'geographic-analysis',
    title: 'Análise Geográfica (Bairros)',
    description: 'Penetração da campanha por bairro e identificação de áreas carentes de atenção.',
    icon: <ClipboardListIcon className="h-6 w-6 text-purple-400" />,
    category: 'Estratégico'
  },
  {
    id: 'financial-summary',
    title: 'Resumo Financeiro',
    description: 'Balanço de receitas e despesas, fluxo de caixa e principais centros de custo.',
    icon: <CurrencyDollarIcon className="h-6 w-6 text-green-400" />,
    category: 'Financeiro'
  }
];

const ReportModal = ({ isOpen, onClose, onGenerateReport }: ReportModalProps) => {
  const handlePrint = (reportId: string) => {
    onGenerateReport(reportId);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Central de Relatórios">
      <div className="space-y-4">
        <p className="text-slate-400 text-sm mb-6">
          Selecione o tipo de relatório que deseja gerar. Os relatórios são formatados para impressão e PDF, servindo como balizadores para a coordenação.
        </p>
        
        <div className="grid grid-cols-1 gap-4">
          {reportOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => handlePrint(option.id)}
              className="flex items-start gap-4 p-4 rounded-xl border border-slate-700 bg-slate-800/50 hover:bg-slate-700/50 hover:border-sky-500/50 transition-all text-left group"
            >
              <div className="p-3 rounded-lg bg-slate-800 border border-slate-700 group-hover:border-sky-500/30 transition-colors">
                {option.icon}
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-center mb-1">
                  <h4 className="font-bold text-slate-200">{option.title}</h4>
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-700 text-slate-400 font-semibold">
                    {option.category}
                  </span>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">
                  {option.description}
                </p>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-end pt-6 gap-3">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </Modal>
  );
};

export default ReportModal;
