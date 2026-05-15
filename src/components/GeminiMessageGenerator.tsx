import * as React from 'react';
import { generateContent } from '../services/geminiService';

/**
 * Um hook customizado para gerar conteúdo de texto usando a API Gemini diretamente no frontend.
 * Fornece estado para a resposta, status de carregamento e erros.
 */
export const useGeminiGenerator = () => {
    const [response, setResponse] = React.useState<string>('');
    const [isLoading, setIsLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    /**
     * Gera conteúdo com base em um prompt de texto.
     * @param prompt O prompt de texto a ser enviado para o Gemini.
     */
    const generate = async (prompt: string) => {
        setIsLoading(true);
        setError(null);
        setResponse('');

        try {
            const text = await generateContent(prompt);
            
            if (!text) {
                throw new Error("Falha ao gerar conteúdo.");
            }

            setResponse(text);

        } catch (err: any) {
            console.error("Erro ao chamar a API Gemini:", err);
            setError(err.message || "Falha ao gerar conteúdo.");
            setResponse('');
        } finally {
            setIsLoading(false);
        }
    };

    return { response, isLoading, error, generate };
};
