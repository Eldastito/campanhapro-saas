import { createClient } from 'jsr:@supabase/supabase-js@2';
import { GoogleGenAI } from 'npm:@google/genai';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const geminiKey = Deno.env.get('GEMINI_API_KEY')!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ============================================================
// EDGE FUNCTION: auto-pipeline
// Acionada via webhook quando um street_report é inserido
// OU via cron job diário (chamada sem body)
// ============================================================

Deno.serve(async (req: Request) => {
  try {
    // Apenas aceita POST
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await req.json().catch(() => ({}));
    
    // Detectar modo de acionamento
    const triggerType: string = body.type || 'manual'; // 'webhook' | 'cron' | 'manual'
    const record = body.record || null; // dados do novo street_report (se webhook)

    console.log(`[auto-pipeline] Acionado via: ${triggerType}`);

    // === MODO WEBHOOK: novo street_report negativo chegou ===
    if (triggerType === 'INSERT' && record) {
      const { campaignId, clima, bairro, reclamacao } = record;

      // Filtrar: só aciona pipeline para reportes NEGATIVOS
      if (clima !== 'Negativo') {
        return new Response(JSON.stringify({ 
          skipped: true, 
          reason: 'Reporte não é negativo, pipeline não acionada' 
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      console.log(`[auto-pipeline] Reporte negativo detectado no bairro: ${bairro}`);
      
      // Verificar se já rodamos pipeline para esta campanha nas últimas 2h
      // (evitar spam de pipelines por múltiplos reports simultâneos)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: recentOutput } = await supabase
        .from('agent_outputs')
        .select('id, createdAt')
        .eq('campaignId', campaignId)
        .gte('createdAt', twoHoursAgo)
        .limit(1);

      if (recentOutput && recentOutput.length > 0) {
        console.log('[auto-pipeline] Pipeline já rodou recentemente para esta campanha. Pulando.');
        return new Response(JSON.stringify({ 
          skipped: true, 
          reason: 'Pipeline já executada recentemente (cooldown de 2h)' 
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Montar contexto específico do gatilho
      const triggerContext = `
🚨 GATILHO AUTOMÁTICO: Reporte Negativo Recebido
- Bairro: ${bairro}
- Clima: ${clima}
- Reclamação: ${reclamacao || 'Não especificada'}

Analise URGENTEMENTE este reporte e gere plano de contingência.`;

      await runPipeline(campaignId, triggerContext);

      return new Response(JSON.stringify({ 
        success: true,
        message: `Pipeline acionada para campanha ${campaignId} por reporte negativo em ${bairro}`
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // === MODO CRON: análise diária de todas as campanhas ativas ===
    if (triggerType === 'cron' || triggerType === 'manual') {
      const targetCampaignId = body.campaignId || null;

      let campaignIds: string[] = [];

      if (targetCampaignId) {
        campaignIds = [targetCampaignId];
      } else {
        // Buscar campanhas ativas (que tiveram atividade nas últimas 24h)
        const yesterdayTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: activeCampaigns } = await supabase
          .from('street_reports')
          .select('campaignId')
          .gte('createdAt', yesterdayTime);

        if (activeCampaigns) {
          campaignIds = [...new Set(activeCampaigns.map((r: any) => r.campaignId))];
        }
      }

      console.log(`[auto-pipeline] Cron/Manual: processando ${campaignIds.length} campanhas`);

      for (const campaignId of campaignIds) {
        const context = `
📊 ANÁLISE DIÁRIA AUTOMÁTICA (${new Date().toLocaleDateString('pt-BR')})
Execute uma análise completa dos dados acumulados nas últimas 24 horas e gere o briefing diário de estratégia.`;
        
        await runPipeline(campaignId, context);
      }

      return new Response(JSON.stringify({ 
        success: true,
        message: `Pipeline diária executada para ${campaignIds.length} campanhas`
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Tipo de gatilho não reconhecido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[auto-pipeline] Erro:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// ============================================================
// LÓGICA DA PIPELINE (equivalente ao runFullPipeline do front)
// ============================================================
async function runPipeline(campaignId: string, triggerContext: string) {
  const ai = new GoogleGenAI({ apiKey: geminiKey });
  
  // 1. Buscar dados reais da campanha
  const [{ data: recentReports }, { data: recentPesquisas }] = await Promise.all([
    supabase.from('street_reports').select('*').eq('campaignId', campaignId)
      .order('createdAt', { ascending: false }).limit(15),
    supabase.from('pesquisas').select('*').eq('campaignId', campaignId)
      .order('createdAt', { ascending: false }).limit(20)
  ]);

  // 2. Montar contexto de dados reais
  let dataContext = '\n\n[DADOS REAIS DA CAMPANHA]\n';
  
  if (recentPesquisas && recentPesquisas.length > 0) {
    const rejeicoes = recentPesquisas.map((p: any) => p.fatorRejeicao).filter(Boolean);
    const dores = recentPesquisas.map((p: any) => p.dorImediata).filter(Boolean);
    const topRejeicao = modeOf(rejeicoes) || 'N/A';
    const topDor = modeOf(dores) || 'N/A';
    dataContext += `--- Pesquisa Eleitoral (${recentPesquisas.length} entrevistas) ---\n`;
    dataContext += `- Dor predominante: ${topDor}\n`;
    dataContext += `- Principal fator de rejeição: ${topRejeicao}\n`;
  }

  if (recentReports && recentReports.length > 0) {
    dataContext += `--- Últimos Reportes de Rua ---\n`;
    recentReports.forEach((r: any) => {
      dataContext += `- ${r.bairro} | ${r.clima} | ${r.reclamacao || 'Sem reclamação'}\n`;
    });
  }

  const fullPrompt = `${triggerContext}\n${dataContext}`;

  // 3. Executar agentes sequencialmente
  const model = 'gemini-2.0-flash';

  const strategistResult = await callAgent(ai, model, STRATEGIST_PROMPT, fullPrompt, campaignId);
  const growthResult = await callAgent(ai, model, GROWTH_PROMPT, 
    `${fullPrompt}\nDIRETRIZ DO ESTRATEGISTA:\n${strategistResult}`, campaignId);
  const fieldResult = await callAgent(ai, model, FIELD_PROMPT,
    `${fullPrompt}\nDIRETRIZ DO ESTRATEGISTA:\n${strategistResult}`, campaignId);
  const socialResult = await callAgent(ai, model, SOCIAL_PROMPT,
    `${fullPrompt}\nDIRETRIZ DO ESTRATEGISTA:\n${strategistResult}`, campaignId);

  // 4. Salvar resultado no banco
  const { error: saveError } = await supabase.from('agent_outputs').insert({
    campaignId: campaignId,
    agentType: 'auto-pipeline',
    input: { triggerContext, dataContext },
    output: { strategist: strategistResult, growth: growthResult, field: fieldResult, social: socialResult },
    createdBy: 'auto-pipeline-edge-function',
    createdAt: new Date().toISOString()
  });

  if (saveError) {
    console.error('[auto-pipeline] Erro ao salvar resultado:', saveError);
  } else {
    console.log(`[auto-pipeline] Pipeline concluída e salva para campanha: ${campaignId}`);
  }

  // 5. Executar tool calls automáticas (sinalizar bairros, criar tickets)
  await processToolCalls(ai, model, strategistResult, fieldResult, campaignId);
}

// ============================================================
// TOOL CALLS: processar ações automáticas dos agentes
// ============================================================
async function processToolCalls(ai: any, model: string, strategistText: string, fieldText: string, campaignId: string) {
  // Detectar menções a bairros problemáticos no texto do estrategista
  const negativoMatch = strategistText.match(/bairr[ao]s?\s+(?:hostil|negativo|crítico|urgente|risco|atenção)[:\s]+([^\.]+)/gi);
  if (negativoMatch) {
    for (const match of negativoMatch.slice(0, 3)) {
      const bairroMatch = match.match(/([A-Z][a-záéíóúãõâêîôûç\s]+)/g);
      if (bairroMatch && bairroMatch[0]) {
        await supabase.from('neighborhood_flags').insert({
          campaignId: campaignId,
          bairro: bairroMatch[0].trim(),
          status: 'Hostil',
          motivo: `Detectado automaticamente pela pipeline de IA em ${new Date().toLocaleDateString('pt-BR')}`,
          createdBy: 'auto-pipeline',
          createdAt: new Date().toISOString()
        });
      }
    }
  }

  // Detectar tickets urgentes no texto do comandante de campo
  const urgentMatch = fieldText.match(/(?:urgente|emergencial|imediato)[:\s]+([^\.]+)/gi);
  if (urgentMatch) {
    for (const match of urgentMatch.slice(0, 2)) {
      await supabase.from('field_tickets').insert({
        campaignId: campaignId,
        bairro: 'Verificar relatório completo',
        instrucao: match.substring(0, 200),
        prioridade: 'Alta',
        status: 'aberto',
        createdBy: 'auto-pipeline',
        createdAt: new Date().toISOString()
      });
    }
  }
}

// ============================================================
// HELPERS
// ============================================================
async function callAgent(ai: any, model: string, systemPrompt: string, userPrompt: string, campaignId: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model,
      contents: userPrompt,
      config: { systemInstruction: systemPrompt }
    });
    return response.text || '';
  } catch (err: any) {
    console.error('[auto-pipeline] Erro no agente:', err.message);
    return `[Erro ao processar este agente: ${err.message}]`;
  }
}

function modeOf(arr: string[]): string | null {
  if (!arr || arr.length === 0) return null;
  return arr.sort((a, b) =>
    arr.filter(v => v === a).length - arr.filter(v => v === b).length
  ).pop() || null;
}

// ============================================================
// SYSTEM PROMPTS (versão compacta para Edge Function)
// ============================================================
const STRATEGIST_PROMPT = `Você é o Diretor de Operações Políticas de uma campanha eleitoral. 
Analise os dados reais fornecidos e gere um plano estratégico conciso com: 
1) Avaliação do cenário (máx 2 parágrafos)
2) 3 diretrizes prioritárias da semana
3) Bairros que precisam de atenção urgente (identifique-os claramente como "hostil" ou "crítico")`;

const GROWTH_PROMPT = `Você é um Engenheiro de Growth especializado em marketing político. 
Com base nos dados de campo e na diretriz do Estrategista, crie:
1) Segmentação dos eleitores indecisos por bairro/dor
2) Régua de comunicação prioritária (canal + mensagem-chave)
3) 1 ação de conversão para executar esta semana`;

const FIELD_PROMPT = `Você é o Coordenador de Campo de uma campanha eleitoral.
Com base nos dados e diretrizes, forneça:
1) Mapa de prioridade de bairros (Alta/Média/Baixa)
2) Roteiro de panfletagem para os próximos 3 dias  
3) Ações urgentes ou emergenciais (identifique claramente como "urgente:")`;

const SOCIAL_PROMPT = `Você é um Social Media Creator político especializado em conteúdo viral.
Com base nas dores reais dos eleitores, crie:
1) 2 roteiros de Reels de 15s (focados nas dores do bairro mais crítico)
2) 1 legenda para post de Instagram
3) 1 mensagem curta para grupo de WhatsApp`;
