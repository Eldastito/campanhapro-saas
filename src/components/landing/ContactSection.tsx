import * as React from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';

const ContactSection: React.FC = () => {
    return (
        <section id="contact" className="py-20 px-4 bg-slate-900 border-t border-slate-700">
            <Card className="max-w-4xl mx-auto p-8 md:p-12 text-center bg-slate-800 border-slate-700">
                <h2 className="text-3xl md:text-4xl font-bold text-slate-50 mb-6">Pronto para assumir a liderança da sua campanha?</h2>
                <p className="text-xl text-slate-300 mb-8 max-w-2xl mx-auto">
                    Nossa equipe está pronta para demonstrar como nossa tecnologia pode transformar a gestão da sua campanha eleitoral. Fale conosco para uma apresentação personalizada.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <Button 
                        variant="primary" 
                        className="bg-[#4ac7f0] hover:bg-[#3fb0d5] text-slate-900 font-bold px-8 py-3 text-lg"
                        onClick={() => window.location.href = 'mailto:contato@campanhapro.com.br?subject=Interesse%20em%20Apresentação%20Campanha%20Pró'}
                    >
                        Entrar em contato
                    </Button>
                    <a 
                        href="https://wa.me/5521999947477" 
                        target="_blank" 
                        className="inline-flex items-center justify-center px-8 py-3 rounded-lg text-lg font-bold bg-green-600 hover:bg-green-700 text-white transition-colors"
                    >
                        Falar pelo WhatsApp
                    </a>
                </div>
            </Card>
        </section>
    );
};

export default ContactSection;
