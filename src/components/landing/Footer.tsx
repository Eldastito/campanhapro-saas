import * as React from 'react';

const Footer: React.FC = () => {
    return (
        <footer className="py-10 px-4 container mx-auto border-t border-slate-700">
            <div className="grid md:grid-cols-3 gap-8 text-sm text-slate-400">
                <div>
                    <h3 className="font-bold text-slate-200 mb-2">Campanha Pró</h3>
                    <p>Rua Bento Gonçalves 279</p>
                    <p>Engenho de Dentro, Rio de Janeiro - RJ</p>
                    <p>Brasil</p>
                </div>
                <div>
                    <h3 className="font-bold text-slate-200 mb-2">Contato</h3>
                    <p><a href="mailto:atendimento@campanhapro.com.br" className="hover:text-white">atendimento@campanhapro.com.br</a></p>
                    <p><a href="https://wa.me/5521999947477" target="_blank" rel="noopener noreferrer" className="hover:text-white">WhatsApp: (21) 99994-7477</a></p>
                    <p><a href="https://www.campanhapro.tesseractauto.com.br" target="_blank" rel="noopener noreferrer" className="hover:text-white">www.campanhapro.tesseractauto.com.br</a></p>
                </div>
                <div className="bg-slate-700/50 p-4 rounded-lg">
                    <h3 className="font-bold text-slate-200 mb-2">Garantia de Crescimento</h3>
                    <p>Damos o suporte necessário para sua vitória. Se não identificar ganho de performance em 15 dias, auxiliamos na reestruturação da sua estratégia digital.</p>
                </div>
            </div>
            <div className="text-center text-xs text-slate-500 mt-10">
                <p>&copy; {new Date().getFullYear()} Campanha Pró. Todos os direitos reservados a ExamePad. | v1.0.3</p>
            </div>
        </footer>
    );
};

export default Footer;
