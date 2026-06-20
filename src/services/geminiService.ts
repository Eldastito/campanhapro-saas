/**
 * Client-side service for Gemini API using backend proxy.
 */
import { authedFetch } from '../lib/authedFetch';

export const generateContent = async (prompt: string, campaignId?: string, userId?: string): Promise<string> => {
    try {
        // authedFetch anexa o Bearer da sessão. Sem isso, /api/gemini/chat (requireAuth)
        // respondia 401 e a função retornava "" — gerador de mensagens e dicas de
        // campanha ficavam quebrados.
        const response = await authedFetch('/api/gemini/chat', {
            method: 'POST',
            body: JSON.stringify({ prompt, campaignId, userId }),
        });
        
        if (!response.ok) {
            throw new Error('Falha ao comunicar com o servidor');
        }

        const data = await response.json();
        return data.text || "";
    } catch (error) {
        console.error("Erro ao gerar conteúdo com Gemini:", error);
        return "";
    }
};

export const getElectorResponse = async (message: string, candidateInfo: any): Promise<string> => {
    try {
        const prompt = `
            Você é o assistente virtual oficial do candidato ${candidateInfo.nomeUrna || candidateInfo.nomeCompleto}.
            Seu objetivo é responder dúvidas de eleitores de forma educada, propositiva e clara.
            
            Informações do Candidato:
            - Nome: ${candidateInfo.nomeUrna || candidateInfo.nomeCompleto}
            - Partido: ${candidateInfo.partido || 'Não informado'}
            - Número: ${candidateInfo.numero || 'Não informado'}
            - Cidade: ${candidateInfo.cidade || 'Não informada'}
            
            Diretrizes:
            1. Se não souber uma proposta específica, diga que o candidato está ouvindo a população e peça para o eleitor deixar uma sugestão.
            2. Nunca ataque adversários.
            3. Foque em soluções e esperança.
            4. Sempre mencione o número do candidato ao final de conversas importantes.
            
            Mensagem do Eleitor: "${message}"
        `;

        const response = await fetch('/api/public/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
        });
        
        if (!response.ok) {
            throw new Error('Falha ao comunicar com o servidor');
        }

        const data = await response.json();
        return data.text || "Desculpe, não consegui processar sua solicitação.";
    } catch (error) {
        console.error("Erro ao chamar Gemini:", error);
        return "Desculpe, estou passando por uma manutenção rápida. Por favor, tente novamente em instantes!";
    }
};
