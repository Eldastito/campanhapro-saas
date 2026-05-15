import * as React from 'react';

const faqData = [
    {
      question: "Meus dados estão seguros?",
      answer: "Sim. A segurança dos seus dados é nossa prioridade. Seus dados de campanha são isolados e acessíveis apenas pela sua equipe. (Nota: Para um produto real, um backend seguro com banco de dados é essencial).",
    },
    {
      question: "Preciso instalar algum programa no meu computador?",
      answer: "Não. O Campanha Pró é um web app, o que significa que você e sua equipe podem acessá-lo de qualquer navegador moderno (Chrome, Firefox, Safari) em computadores, tablets ou celulares, sem necessidade de instalação.",
    },
    {
      question: "O sistema funciona bem no celular?",
      answer: "Sim. A plataforma foi desenhada para ser responsiva, permitindo que as equipes de campo atualizem informações sobre as visitas diretamente do celular, de forma rápida e prática.",
    },
    {
      question: "Se eu decidir cancelar, posso levar meus dados comigo?",
      answer: "Com certeza. Você pode exportar todos os seus dados de visitas e cenários para formatos abertos (CSV) a qualquer momento, garantindo que você sempre tenha o controle total das suas informações.",
    },
    {
      question: "O que acontece se eu precisar de mais usuários do que o meu plano oferece?",
      answer: "Você pode fazer o upgrade do seu plano a qualquer momento, de forma simples e rápida. Sua campanha cresce, e o Campanha Pró cresce com você.",
    },
];

const FaqSection: React.FC = () => {
    return (
        <section id="faq" className="py-20 px-4 bg-slate-900">
            <div className="container mx-auto max-w-4xl">
                <h2 className="text-3xl font-bold text-center mb-12">Perguntas Frequentes</h2>
                <div className="space-y-4">
                    {faqData.map((item, index) => (
                        <div key={index} className="bg-slate-800 p-6 rounded-lg transition-all duration-300 hover:bg-slate-700/50 hover:scale-[1.01]">
                            <h3 className="font-semibold text-lg text-slate-100 mb-2">{item.question}</h3>
                            <p className="text-slate-400">{item.answer}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default FaqSection;
