import * as React from 'react';

const ValueProposition: React.FC = () => {
    return (
        <section className="py-20 px-4 bg-slate-800">
            <div className="container mx-auto text-center">
                <h2 className="text-3xl font-bold mb-4">Deixe as Planilhas no Passado. Centralize sua Estratégia.</h2>
                <p className="text-lg text-slate-400 max-w-3xl mx-auto mb-12">
                    Campanha Pró é a plataforma de inteligência de campo que transforma a desorganização, o "achismo" e a perda de dados em uma máquina de conquistar votos.
                </p>
                <div className="grid md:grid-cols-3 gap-8 text-left">
                    <div className="bg-slate-900 p-6 rounded-lg transition-transform duration-300 hover:-translate-y-2">
                        <h3 className="text-xl font-semibold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-[#4ac7f0] to-[#1abc9c]">O que ele entrega?</h3>
                        <p className="text-slate-300">
                            <strong className="text-white">Clareza Total</strong> para saber exatamente quantas visitas faltam para bater a meta. <strong className="text-white">Controle Absoluto</strong> para monitorar o desempenho da equipe em tempo real, e <strong className="text-white">Eficiência Máxima</strong> para otimizar o tempo do candidato e dos apoiadores.
                        </p>
                    </div>
                    <div className="bg-slate-900 p-6 rounded-lg transition-transform duration-300 hover:-translate-y-2">
                        <h3 className="text-xl font-semibold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-[#4ac7f0] to-[#1abc9c]">O que ele evita?</h3>
                        <p className="text-slate-300">
                            O caos de <strong className="text-white">dados perdidos</strong> em planilhas e WhatsApp, o trabalho sem rumo com <strong className="text-white">metas inatingíveis</strong>, e o <strong className="text-white">desperdício de recursos</strong> e tempo da equipe em ações pouco eficazes.
                        </p>
                    </div>
                    <div className="bg-slate-900 p-6 rounded-lg transition-transform duration-300 hover:-translate-y-2">
                        <h3 className="text-xl font-semibold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-[#4ac7f0] to-[#1abc9c]">Quanto valor ele gera?</h3>
                        <p className="text-slate-300">
                            Uma campanha organizada <strong className="text-white">economia tempo e dinheiro</strong>, mas, acima de tudo, <strong className="text-white">maximiza o impacto de cada ação</strong>. É o investimento que se paga em votos, garantindo que o esforço se converta na vitória.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ValueProposition;
