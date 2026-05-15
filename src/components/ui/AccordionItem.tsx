import * as React from 'react';
import { ChevronDownIcon } from '../icons';

interface AccordionItemProps {
    title: string;
    children?: React.ReactNode;
    initialOpen?: boolean;
}

const AccordionItem = ({ title, children, initialOpen = false }: AccordionItemProps) => {
    const [isOpen, setIsOpen] = React.useState(initialOpen);
    return (
        <div className="bg-slate-700/50 rounded-lg">
            <button 
                onClick={() => setIsOpen(!isOpen)} 
                className="w-full flex justify-between items-center p-4 font-semibold text-left transition-colors duration-200 hover:bg-slate-600/50"
            >
                <span className="text-lg">{title}</span>
                <ChevronDownIcon className={`w-5 h-5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && <div className="p-4 border-t border-slate-600">{children}</div>}
        </div>
    );
}

export default AccordionItem;