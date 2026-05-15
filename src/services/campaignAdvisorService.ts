import { AdvisorTip } from '../types/campaign';
import { generateContent } from './geminiService';

/**
 * Gera dicas reais usando o Gemini diretamente no frontend.
 */
export const generateCampaignTips = async (campaignData: any): Promise<AdvisorTip[]> => {
    try {
        const prompt = `Analise os seguintes dados de campanha eleitoral e forneça 3 dicas estratégicas curtas e acionáveis: ${JSON.stringify(campaignData)}`;
        const text = await generateContent(prompt);

        if (!text) {
            throw new Error('Falha ao gerar dicas da IA');
        }
        
        // Converte o texto da IA em um formato amigável para o componente
        return [
            {
                type: 'sparkles',
                title: 'Sugestão da IA',
                message: text || 'Continue monitorando seus KPIs para ajustar a estratégia.',
            }
        ];
    } catch (error) {
        console.error("Erro ao chamar a IA:", error);
        return [
            {
                type: 'error',
                title: 'Erro na IA',
                message: 'Não foi possível obter insights no momento. Tente novamente mais tarde.',
            },
        ];
    }
};
