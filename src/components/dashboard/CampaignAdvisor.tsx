import * as React from 'react';
import Modal from '../ui/Modal';
import { AdvisorTip, AdvisorTipType } from '../../types/campaign';
import { CheckCircleIcon, InfoIcon, SparklesIcon } from '../icons';
import Button from '../ui/Button';

interface CampaignAdvisorProps {
  isOpen: boolean;
  onClose: () => void;
  tips: AdvisorTip[];
  isLoading: boolean;
  title: string;
}

const tipConfig: Record<AdvisorTipType, { icon: React.ReactNode; color: string }> = {
    success: {
        icon: <CheckCircleIcon />,
        color: 'border-green-500',
    },
    warning: {
        icon: <InfoIcon />,
        color: 'border-yellow-500',
    },
    info: {
        icon: <SparklesIcon />,
        color: 'border-sky-500',
    },
    sparkles: {
        icon: <SparklesIcon />,
        color: 'border-purple-500',
    },
    error: {
        icon: <InfoIcon />,
        color: 'border-red-500',
    }
}

const CampaignAdvisor = ({ isOpen, onClose, tips, isLoading, title }: CampaignAdvisorProps) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
        {isLoading ? (
            <div className="flex flex-col items-center justify-center h-48">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-sky-400"></div>
                <p className="mt-4 text-slate-300">Analisando dados da campanha...</p>
            </div>
        ) : (
            <div className="space-y-4">
               {tips.map((tip, index) => (
                   <div key={index} className={`bg-slate-700/50 p-4 rounded-lg border-l-4 ${tipConfig[tip.type].color}`}>
                       <div className="flex items-center gap-3 mb-2">
                           <span className="text-slate-200">{tipConfig[tip.type].icon}</span>
                           <h4 className="font-bold text-lg text-slate-200">{tip.title}</h4>
                       </div>
                       <p className="text-slate-300 text-sm">{tip.message}</p>
                   </div>
               ))}
               <div className="flex justify-end pt-4">
                <Button onClick={onClose}>Entendido</Button>
               </div>
            </div>
        )}
    </Modal>
  );
};

export default CampaignAdvisor;