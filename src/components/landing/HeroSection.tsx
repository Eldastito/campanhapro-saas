import * as React from 'react';
import Button from '../ui/Button';

import { Link } from 'react-router-dom';

const HeroSection: React.FC = () => {
    return (
        <section className="text-center pt-24 pb-12 px-4 bg-slate-900">
            <h1 className="text-4xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[#4ac7f0] to-[#1abc9c] leading-tight mb-6">
                Transforme Dados em Votos.<br />Estratégia em Vitória.
            </h1>
            <p className="mt-4 text-lg md:text-xl text-slate-300 max-w-3xl mx-auto leading-relaxed">
                A plataforma inteligente para organizar sua campanha, otimizar o trabalho de campo e conquistar cada voto com precisão digital.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
                <Link to="/register">
                    <Button className="text-lg px-8 py-4 h-auto">
                        Crie sua Conta e Comece a Organizar
                    </Button>
                </Link>
                <Link to="/chat">
                    <Button variant="secondary" className="text-lg px-8 py-4 h-auto border-sky-500/30 text-sky-400">
                        Falar com o Candidato (IA)
                    </Button>
                </Link>
            </div>

            {/* Vídeo Comercial */}
            <div className="mt-12 max-w-5xl mx-auto w-full">
                <div className="relative aspect-video rounded-lg overflow-hidden">
                    <iframe
                        src="/comercial/index.html"
                        title="Vídeo Comercial Campanha Pró"
                        loading="lazy"
                        allow="autoplay; fullscreen"
                        className="absolute inset-0 w-full h-full border-0"
                    />
                </div>
            </div>
        </section>
    );
};

export default HeroSection;
