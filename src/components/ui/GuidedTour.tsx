import * as React from 'react';
import DOMPurify from 'dompurify';
import Modal from './Modal';
import Button from './Button';
import { 
    RocketLaunchIcon, CalculatorIcon, UsersGroupIcon, MapPinIcon,
    ClipboardListIcon, BarChartIcon
} from '../icons';

interface GuidedTourProps {
  isOpen: boolean;
  onClose: () => void;
}

const tourSteps = [
    {
        icon: <RocketLaunchIcon className="h-12 w-12 text-sky-400" />,
        title: "Bem-vindo(a) ao Campanha Pró!",
        content: "Vamos fazer um tour rápido para você conhecer os primeiros passos e começar sua campanha com o pé direito. São apenas algumas etapas para entender o fluxo principal."
    },
    {
        icon: <CalculatorIcon className="h-12 w-12 text-sky-400" />,
        title: "Passo 1: A Meta (Calculadora)",
        content: "Tudo começa com um objetivo. Vá para a aba **Calculadora** para definir sua meta de votos. O sistema irá calcular automaticamente quantas visitas sua equipe precisa fazer por dia para atingir esse número. Este é o cérebro da sua estratégia!"
    },
    {
        icon: <div className="flex items-center gap-4"><UsersGroupIcon className="h-12 w-12 text-sky-400" /><MapPinIcon className="h-12 w-12 text-sky-400" /></div>,
        title: "Passo 2: A Base (Recursos)",
        content: "Agora, vá para a aba **Recursos**. Cadastre os membros da sua **Equipe** (com email e senha para login deles) e as **Localidades** (bairros) onde sua campanha atuará. Manter isso atualizado é a base para todo o resto."
    },
    {
        icon: <ClipboardListIcon className="h-12 w-12 text-sky-400" />,
        title: "Passo 3: A Execução (Visitas)",
        content: "Na aba **Visitas**, você e sua equipe registrarão cada casa visitada. É aqui que o trabalho de campo se transforma em dados valiosos. É o coração da sua operação."
    },
    {
        icon: <BarChartIcon className="h-12 w-12 text-sky-400" />,
        title: "Passo 4: A Visão (Dashboard)",
        content: "Finalmente, o **Dashboard** unirá tudo. Ele mostrará seu progresso em tempo real, o desempenho da equipe e se a meta diária está sendo batida. É seu painel de controle para a vitória!"
    },
    {
        icon: <RocketLaunchIcon className="h-12 w-12 text-green-400" />,
        title: "Pronto para Começar!",
        content: "Agora você conhece o fluxo essencial. Siga estes passos e organize uma campanha de sucesso. Boa sorte!"
    }
];

const GuidedTour: React.FC<GuidedTourProps> = ({ isOpen, onClose }) => {
    const [currentStep, setCurrentStep] = React.useState(0);

    const handleNext = () => {
        if (currentStep < tourSteps.length - 1) {
            setCurrentStep(currentStep + 1);
        } else {
            onClose();
        }
    };

    const handlePrev = () => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
        }
    };

    const step = tourSteps[currentStep];

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={step.title}>
            <div className="flex flex-col items-center text-center p-4">
                <div className="mb-6">{step.icon}</div>
                <p className="text-slate-300 mb-8" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(step.content) }}></p>

                {/* Progress Indicator */}
                <div className="flex justify-center gap-2 mb-8">
                    {tourSteps.map((_, index) => (
                        <div key={index} className={`w-2 h-2 rounded-full ${index === currentStep ? 'bg-sky-400' : 'bg-slate-600'}`}></div>
                    ))}
                </div>

                {/* Navigation Buttons */}
                <div className="flex justify-between w-full">
                    {currentStep > 0 ? (
                        <Button variant="secondary" onClick={handlePrev}>Anterior</Button>
                    ) : <div />}
                    
                    {currentStep < tourSteps.length - 1 ? (
                        <Button onClick={handleNext}>Próximo</Button>
                    ) : (
                        <Button onClick={onClose}>Concluir Tour!</Button>
                    )}
                </div>
            </div>
             <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-white text-sm">Pular Tour</button>
        </Modal>
    );
};

export default GuidedTour;
