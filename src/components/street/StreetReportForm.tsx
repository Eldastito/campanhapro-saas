import React, { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { MapPin, Smile, Meh, Frown, Send, Loader2 } from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';

const StreetReportForm: React.FC = () => {
    const { user } = useAuth();
    const [bairro, setBairro] = useState('');
    const [clima, setClima] = useState<'Positivo' | 'Neutro' | 'Negativo' | ''>('');
    const [reclamacao, setReclamacao] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!bairro || !clima) {
            setError('Por favor, preencha o bairro e o clima.');
            return;
        }

        setIsSubmitting(true);
        setError('');
        setSuccessMessage('');

        try {
            const { error: err } = await supabase.from('street_reports').insert({
                bairro,
                clima,
                reclamacao,
                createdBy: user?.id,
                createdAt: new Date().toISOString(),
                campaignId: user?.campaignId
            });
            
            if (err) throw err;
            
            setSuccessMessage('Reporte enviado com sucesso! Obrigado.');
            setBairro('');
            setClima('');
            setReclamacao('');
            
            // Clear success message after 3 seconds
            setTimeout(() => setSuccessMessage(''), 3000);
        } catch (err) {
            console.error('Erro ao enviar reporte:', err);
            setError('Ocorreu um erro ao enviar. Tente novamente.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Card>
            <div className="flex items-center gap-2 mb-4">
                <MapPin className="w-5 h-5 text-orange-500" />
                <h3 className="text-lg font-bold text-slate-200">Reporte de Rua</h3>
            </div>
            <p className="text-sm text-slate-400 mb-6">
                Envie informações em tempo real para o Comandante de Campo.
            </p>

            {error && <div className="bg-red-500/20 text-red-400 p-3 rounded-md mb-4 text-sm">{error}</div>}
            {successMessage && <div className="bg-green-500/20 text-green-400 p-3 rounded-md mb-4 text-sm">{successMessage}</div>}

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Bairro / Região atual</label>
                    <input
                        type="text"
                        value={bairro}
                        onChange={(e) => setBairro(e.target.value)}
                        placeholder="Ex: Centro, Zona Norte..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-slate-100 focus:outline-none focus:border-blue-500"
                        required
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Clima nas ruas (Sentimento)</label>
                    <div className="grid grid-cols-3 gap-2">
                        <button
                            type="button"
                            onClick={() => setClima('Positivo')}
                            className={`flex flex-col items-center justify-center p-3 rounded-md border transition-colors ${clima === 'Positivo' ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                        >
                            <Smile className="w-6 h-6 mb-1" />
                            <span className="text-xs font-medium">Positivo</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setClima('Neutro')}
                            className={`flex flex-col items-center justify-center p-3 rounded-md border transition-colors ${clima === 'Neutro' ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                        >
                            <Meh className="w-6 h-6 mb-1" />
                            <span className="text-xs font-medium">Neutro</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setClima('Negativo')}
                            className={`flex flex-col items-center justify-center p-3 rounded-md border transition-colors ${clima === 'Negativo' ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                        >
                            <Frown className="w-6 h-6 mb-1" />
                            <span className="text-xs font-medium">Negativo</span>
                        </button>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Principal reclamação ouvida (Opcional)</label>
                    <textarea
                        value={reclamacao}
                        onChange={(e) => setReclamacao(e.target.value)}
                        placeholder="Ex: Falta de asfalto na rua X..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-slate-100 focus:outline-none focus:border-blue-500 h-24 resize-none"
                    />
                </div>

                <Button type="submit" className="w-full flex items-center justify-center gap-2" disabled={isSubmitting}>
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {isSubmitting ? 'Enviando...' : 'Enviar Reporte'}
                </Button>
            </form>
        </Card>
    );
};

export default StreetReportForm;
