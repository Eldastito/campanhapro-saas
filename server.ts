import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import fs from 'fs';
import fsPromises from 'fs/promises';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import { createAuthMiddleware } from './src/middleware/authMiddleware';
import { getConversionFunnelStats, getTerritorialAlerts } from './src/services/intelligenceService';
import { getLeaderConversionStats } from './src/services/engagementService';
import { createIntelligenceRouter } from './src/server/modules/intelligence/intelligenceRouter';
import { createPaperclipRouter } from './src/server/modules/paperclip/paperclipRouter';
import { createChannelsRouter } from './src/server/modules/channels/channelsRouter';
import { createWebhookRouter } from './src/server/modules/channels/webhookRouter';
import { createWhatsappRouter } from './src/server/modules/whatsapp/whatsappRouter';
import { createEvolutionWebhookRouter } from './src/server/modules/whatsapp/evolutionWebhookRouter';
import {
  createShortLinksAdminRouter,
  createShortLinksPublicRouter,
} from './src/server/modules/shortLinks/shortLinksRouter';
import { createSupremeAdminRouter } from './src/server/modules/supremeAdmin/supremeAdminRouter';
import { createPublicFormsRouter } from './src/server/modules/publicForms/publicFormsRouter';
import { requireSupremeAdmin } from './src/server/middleware/requireSupremeAdmin';
import { setWebhook, isEvolutionConfigured } from './src/server/modules/integrations/evolutionApiClient';
import { createRagRouter } from './src/server/modules/rag/ragRouter';
import { createScenariosRouter } from './src/server/modules/scenarios/scenariosRouter';
import { createObservabilityRouter } from './src/server/modules/observability/observabilityRouter';
import { requestTracer } from './src/server/modules/observability/requestTracer';
import {
  expensiveLimiter, messagingLimiter, mutationLimiter, webhookLimiter,
} from './src/server/middleware/perCampaignRateLimit';
import { createBillingRouter } from './src/server/modules/billing/billingRouter';
import { createPlanStatusRouter } from './src/server/modules/billing/planStatusRouter';
import { createCallCenterRouter } from './src/server/modules/callcenter/callCenterRouter';
import { createCallCenterPublicRouter } from './src/server/modules/callcenter/callCenterPublicRouter';
import { createPaymentWebhookRouter } from './src/server/modules/billing/paymentWebhookRouter';
import { createOnboardingRouter } from './src/server/modules/onboarding/onboardingRouter';
import { startLifecycleSweeper } from './src/server/modules/billing/subscriptionLifecycle';
import { createTeamInvitesRouter, createTeamInvitesPublicRouter } from './src/server/modules/team/teamInvitesRouter';
import { createTeamGoalsRouter } from './src/server/modules/team/teamGoalsRouter';
import { createGoalsRouter } from './src/server/modules/goals/goalsRouter';
import { createRoutinesRouter } from './src/server/modules/routines/routinesRouter';
import { createBudgetRouter } from './src/server/modules/budget/budgetRouter';
import { createMeetingsRouter } from './src/server/modules/meetings/meetingsRouter';
import { createIntelRouter } from './src/server/modules/intel/intelRouter';
import { createFraudGuardsRouter } from './src/server/modules/fraudGuards/fraudGuardsRouter';
import { createSocialRouter } from './src/server/modules/social/socialRouter';
import { createWhatsappRoutingRouter } from './src/server/modules/whatsappRouting/whatsappRoutingRouter';
import { createPlaybookRouter } from './src/server/modules/playbook/playbookRouter';
import { createPartyRouter } from './src/server/modules/party/partyRouter';
import { createPartyPublicRouter } from './src/server/modules/party/partyPublicRouter';
import { createContentRouter } from './src/server/modules/content/contentRouter';
import { requireAiBudget, requireFeature } from './src/server/middleware/featureGate';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { callAgent, BudgetExceededError } from './src/lib/aiCallAgent';
import { runManager } from './src/lib/managerAgent';
import { startProactiveMonitor } from './src/lib/proactiveMonitor';
import { startDailyBriefing } from './src/lib/dailyBriefing';
import { startRoutinesWorker } from './src/server/modules/routines/routinesWorker';
import { retrieveContext, ingestArtifact } from './src/server/modules/rag/knowledgeIngest';
import { toolsForAgent } from './src/lib/agentRegistry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuração centralizada
// SUPREME_ADMIN_EMAIL available via process.env.SUPREME_ADMIN_EMAIL when needed
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'];
const GEMINI_MODEL_NAME = "gemini-1.5-flash"; 

let supabaseAdmin: any = null;

const adminUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (adminUrl && adminKey) {
  supabaseAdmin = createClient(adminUrl, adminKey);
  console.log("[Supabase Admin] Inicializado com sucesso.");
} else {
  console.warn("[Supabase Admin] Falha ao inicializar: URL ou Service Role Key ausentes.");
}

const requireAuth = createAuthMiddleware(supabaseAdmin);

// --- CATÁLOGO DE SKILLS (AGENT TOOLS) ---
const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "create_backup",
      description: "Cria um snapshot de segurança de todos os dados da campanha.",
      parameters: { type: "object", properties: { reason: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_dalle_image",
      description: "Gera uma imagem real usando DALL-E 3 baseada em um prompt artístico.",
      parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] }
    }
  },
  {
    type: "function",
    function: {
      name: "open_social_media_studio",
      description: "Prepara a interface de publicação para as redes sociais.",
      parameters: { type: "object", properties: { content: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "publish_war_room_insight",
      description: "Publica um insight crítico no feed da Sala de Guerra para visualização no Dashboard.",
      parameters: { 
        type: "object", 
        properties: { 
          category: { type: "string", enum: ["Nicho", "Crise", "Oportunidade", "Logística"] },
          priority: { type: "string", enum: ["Baixa", "Media", "Alta", "CRÍTICO"] },
          insight_text: { type: "string" },
          neighborhood: { type: "string" }
        },
        required: ["category", "priority", "insight_text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "flag_fraudulent_data",
      description: "Sinaliza um registro (eleitor ou reporte) como suspeito de fraude para auditoria.",
      parameters: { 
        type: "object", 
        properties: { 
          entity_type: { type: "string", enum: ["voter", "street_report"] },
          entity_id: { type: "string" },
          risk_level: { type: "string", enum: ["Médio", "Alto", "CRÍTICO"] },
          reason: { type: "string" }
        },
        required: ["entity_type", "entity_id", "risk_level", "reason"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_conversion_funnel",
      description: "Retorna as estatísticas atuais do funil de conversão (quantos eleitores em cada estágio da jornada).",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "analyze_territorial_gap",
      description: "Analisa os bairros com maior diferença entre visitas realizadas e potencial de votos (Gaps Territoriais).",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_competitive_intel",
      description: "Retorna os dossiês de Inteligência Competitiva dos adversários já pesquisados (resumo, pontos fracos, ameaças para nós, recomendações). Use SEMPRE que precisar basear estratégia, conteúdo ou resposta a eleitor em dados reais do oponente — em vez de achismo.",
      parameters: { type: "object", properties: { nome: { type: "string", description: "opcional: filtra por nome do adversário" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "get_team_activity",
      description: "Retorna o desempenho das lideranças/equipe: total de contatos, conversões e taxa por líder. Use para identificar quem está produzindo e quem está parado.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "search_campaign_memory",
      description: "Busca na memória de longo prazo da campanha (dossiês, reuniões, análises anteriores indexadas) por um assunto específico. Use para recuperar contexto antes de decidir.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
    }
  }
];

const cleanJSON = (text: string) => text.replace(/```json/g, '').replace(/```/g, '').trim();

// supabaseAdmin (service role) NÃO usa o Proxy do supabaseClient — então
// retorna chaves snake_case do banco. O frontend espera camelCase.
// Esta helper converte recursivamente snake_case -> camelCase nas respostas.
const snakeToCamelKey = (key: string) =>
  key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const toCamel = (value: any): any => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(toCamel);
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  const out: any = {};
  for (const k of Object.keys(value)) out[snakeToCamelKey(k)] = toCamel(value[k]);
  return out;
};

// callChatGPT foi removido — substituido por callAgent() em src/lib/aiCallAgent.ts
// que tem provider chain (OpenAI → Anthropic → Gemini), retry, budget cap e log.

const callGeminiREST = async (prompt: string) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada.");

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL_NAME });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return {
      text: () => response.text(),
      response: { text: () => response.text() }
    };
  } catch (error: any) {
    console.error("[Gemini] Erro na chamada:", error.message);
    throw error;
  }
};

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const port = Number(process.env.PORT) || 3001;
  console.log(`[System] Inicializando CampanhaPro v1.0.3...`);
  console.log(`[Env] Modo: ${process.env.NODE_ENV || 'development'}`);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
  app.use(express.json({
    limit: '8mb', // comporta fotos comprimidas (comprovação do Partido) sem estourar 100kb
    verify: (req: any, _res, buf) => { req.rawBody = buf; },
  }));

  // Structured request tracing — assigns trace_id, logs request lines
  app.use(requestTracer());

  // Middleware de diagnóstico de versão
  app.use((_req, res, next) => {
      res.setHeader('X-App-Version', '1.0.3');
      next();
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  // --- Intelligence v1 (Snapshot → CampanhaProCenarios) ---
  if (supabaseAdmin) {
    app.use('/api/v1/intelligence', requireAuth, mutationLimiter, requireFeature(supabaseAdmin, 'intelligence'), createIntelligenceRouter(supabaseAdmin));
    app.use('/api/v1/paperclip', requireAuth, expensiveLimiter, requireFeature(supabaseAdmin, 'paperclip'), requireAiBudget(supabaseAdmin), createPaperclipRouter(supabaseAdmin));
    app.use('/api/v1/channels', requireAuth, messagingLimiter, requireFeature(supabaseAdmin, 'whatsapp_omnichannel'), createChannelsRouter(supabaseAdmin));
    app.use('/api/v1/whatsapp', requireAuth, mutationLimiter, requireFeature(supabaseAdmin, 'whatsapp_omnichannel'), createWhatsappRouter(supabaseAdmin));
    app.use('/api/v1/rag', requireAuth, expensiveLimiter, requireFeature(supabaseAdmin, 'rag'), requireAiBudget(supabaseAdmin), createRagRouter(supabaseAdmin));
    app.use('/api/v1/billing', requireAuth, mutationLimiter, createBillingRouter(supabaseAdmin));
    app.use('/api/v1/plan', requireAuth, createPlanStatusRouter(supabaseAdmin));
    app.use('/api/v1/onboarding', requireAuth, mutationLimiter, createOnboardingRouter(supabaseAdmin));
    app.use('/api/v1/team', requireAuth, mutationLimiter, createTeamInvitesRouter(supabaseAdmin));
    app.use('/api/v1/team', requireAuth, mutationLimiter, createTeamGoalsRouter(supabaseAdmin));
    // Token-based routes: GET is public so the email-link landing page can render
    // before login; POST /accept is authed via per-route check inside the router.
    app.use('/api/v1/team', mutationLimiter, (req, res, next) => {
      if (req.method === 'GET') return next();   // /invites/token/:token public
      return requireAuth(req, res, next);        // /invites/token/:token/accept auth
    }, createTeamInvitesPublicRouter(supabaseAdmin));
    // Webhooks must NOT use requireAuth — they're authenticated via X-Hub-Signature-256
    app.use('/api/v1/scenarios', requireAuth, expensiveLimiter, requireFeature(supabaseAdmin, 'scenarios'), createScenariosRouter(supabaseAdmin));
    app.use('/api/v1/goals', requireAuth, mutationLimiter, requireFeature(supabaseAdmin, 'goals'), createGoalsRouter(supabaseAdmin));
    app.use('/api/v1/routines', requireAuth, mutationLimiter, requireFeature(supabaseAdmin, 'routines'), createRoutinesRouter(supabaseAdmin));
    app.use('/api/v1/budget', requireAuth, expensiveLimiter, requireFeature(supabaseAdmin, 'budget_ceo'), createBudgetRouter(supabaseAdmin, requireAiBudget(supabaseAdmin)));
    app.use('/api/v1/meetings', requireAuth, expensiveLimiter, requireFeature(supabaseAdmin, 'meetings'), createMeetingsRouter(supabaseAdmin));
    app.use('/api/v1/intel', requireAuth, expensiveLimiter, requireFeature(supabaseAdmin, 'intelligence'), requireAiBudget(supabaseAdmin), createIntelRouter(supabaseAdmin));
    app.use('/api/v1/fraud-guards', requireAuth, mutationLimiter, createFraudGuardsRouter(supabaseAdmin));
    app.use('/api/v1/social', requireAuth, mutationLimiter, createSocialRouter(supabaseAdmin));
    app.use('/api/v1/whatsapp-routing', requireAuth, mutationLimiter, createWhatsappRoutingRouter(supabaseAdmin));
    app.use('/api/v1/playbook', requireAuth, mutationLimiter, requireFeature(supabaseAdmin, 'intelligence'), createPlaybookRouter(supabaseAdmin));
    app.use('/api/v1/party', requireAuth, mutationLimiter, createPartyRouter(supabaseAdmin));
    app.use('/api/public/party', webhookLimiter, createPartyPublicRouter(supabaseAdmin));
    app.use('/api/v1/callcenter', requireAuth, mutationLimiter, requireFeature(supabaseAdmin, 'call_center'), createCallCenterRouter(supabaseAdmin));
    app.use('/api/public/callcenter', webhookLimiter, createCallCenterPublicRouter(supabaseAdmin));
    app.use('/api/v1/content', requireAuth, expensiveLimiter, requireFeature(supabaseAdmin, 'content_studio'), requireAiBudget(supabaseAdmin), createContentRouter(supabaseAdmin));
    // Observability: split — /health is public, /compliance|/audit|/webhooks require auth
    const obsRouter = createObservabilityRouter(supabaseAdmin);
    app.use('/api/v1/observability', (req, res, next) => {
      if (req.path === '/health') return next();
      return requireAuth(req, res, next);
    }, obsRouter);
    app.use('/webhooks', webhookLimiter, createWebhookRouter(supabaseAdmin));
    // Evolution API webhooks (per-instance routing via :instanceName URL segment)
    app.use('/api/webhooks', webhookLimiter, createEvolutionWebhookRouter(supabaseAdmin));
    // Payment provider webhooks (Asaas / Stripe / Pagar.me) — token-validated by gateway
    app.use('/webhooks/payments', webhookLimiter, createPaymentWebhookRouter(supabaseAdmin));
    // Short links — admin CRUD (auth) + public /l/:slug redirect (no auth).
    // The public router uses webhookLimiter because the rate profile is the
    // same: unauthenticated, hot path, must respond fast.
    app.use('/api/v1/short-links', requireAuth, mutationLimiter, createShortLinksAdminRouter(supabaseAdmin));
    app.use('/l', webhookLimiter, createShortLinksPublicRouter(supabaseAdmin));
    // Public lead-capture forms (F5b) — sem auth, mediado por service_role.
    app.use('/api/public/forms', webhookLimiter, createPublicFormsRouter(supabaseAdmin));
    // Supreme Admin (SaaS operator) — every route gated by requireSupremeAdmin.
    app.use('/api/v1/supreme', requireAuth, mutationLimiter, requireSupremeAdmin(), createSupremeAdminRouter(supabaseAdmin));

    // Access logging — any authenticated user reports login/logout so the
    // Supreme audit feed captures access events ("logs de acesso"). Best-effort,
    // never blocks the auth flow.
    app.post('/api/v1/access-event', requireAuth, async (req, res) => {
      try {
        const event = req.body?.event === 'logout' ? 'logout' : 'login';
        await supabaseAdmin.from('audit_logs').insert({
          campaignId: req.user?.campaignId ?? null,
          actorId: req.user?.id ?? null,
          actorType: 'user',
          action: `auth.${event}`,
          ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
          userAgent: req.get?.('user-agent') ?? null,
          severity: 'info',
          metadata: { email: req.user?.email ?? null, userType: req.user?.userType ?? null },
        });
        return res.json({ ok: true });
      } catch {
        return res.json({ ok: false }); // never surface as an error to the client
      }
    });
  }

  // --- OAuth Social (Simulação) ---
  app.get('/api/auth/meta/url', async (req, res) => {
    const { campaignId } = req.query;
    res.json({ url: `${req.protocol}://${req.get('host')}/api/auth/callback/simulate?campaignId=${campaignId}&provider=meta` });
  });

  app.get('/api/auth/tiktok/url', async (req, res) => {
    const { campaignId } = req.query;
    res.json({ url: `${req.protocol}://${req.get('host')}/api/auth/callback/simulate?campaignId=${campaignId}&provider=tiktok` });
  });

  app.get('/api/auth/callback/simulate', async (req, res) => {
    const { campaignId, provider } = req.query;
    
    if (supabaseAdmin && campaignId) {
        await supabaseAdmin.from('social_tokens').upsert({
            campaignId,
            provider,
            token: 'SIMULATED_TOKEN_' + Math.random().toString(36).substring(7),
            updatedAt: new Date().toISOString()
        }, { onConflict: 'campaignId,provider' });
    }

    res.send(`
      <html>
        <body style="background: #0f172a; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; text-align: center; padding: 20px;">
          <div style="background: #1e293b; padding: 40px; rounded-radius: 20px; border: 1px solid #334155; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
            <div style="color: #22c55e; font-size: 48px; margin-bottom: 20px;">✓</div>
            <h2 style="margin: 0 0 10px 0;">Conexão Bem Sucedida!</h2>
            <p style="color: #94a3b8; font-size: 14px;">A conta do ${String(provider).toUpperCase()} foi vinculada com sucesso.</p>
            <p style="color: #64748b; font-size: 12px; margin-top: 20px;">Esta janela fechará automaticamente...</p>
          </div>
          <script>
            setTimeout(() => {
              if (window.opener) {
                window.opener.postMessage({ type: '${provider === 'tiktok' ? 'TIKTOK' : 'META'}_AUTH_SUCCESS' }, '*');
              }
              window.close();
            }, 2500);
          </script>
        </body>
      </html>
    `);
  });

  // --- Endpoints de IA e Agentes ---

  app.post('/api/agents/chat', requireAuth, async (req, res) => {
    try {
      const { prompt, systemInstruction, campaignId, userId, agentId } = req.body;
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      if (supabaseAdmin && agentId) {
          await supabaseAdmin.from('agent_chat_history').insert({
              campaignId, agentId, role: 'user', content: prompt
          });
      }

      // RAG: recupera a memória da campanha (dossiês, reuniões, análises anteriores)
      // e injeta como CONTEXTO. Faz os agentes deixarem de responder "no vácuo".
      // retrieveContext é best-effort (timeout interno 8s, nunca lança).
      let effectivePrompt = prompt;
      if (supabaseAdmin && campaignId && prompt) {
          const memoria = await retrieveContext(supabaseAdmin, campaignId, prompt, 5);
          if (memoria) {
              effectivePrompt =
                  `CONTEXTO DA CAMPANHA (memória de dossiês/análises/reuniões anteriores — ` +
                  `use o que for relevante para esta resposta; NÃO invente nada além disto):\n${memoria}\n\n---\n\n${prompt}`;
          }
      }

      // Chamada principal via helper (provider chain + retry + budget + log)
      const aiResponse = await callAgent(supabaseAdmin, agentId || 'chat', effectivePrompt, {
          campaignId,
          userId,
          systemInstruction,
          // Cada agente só enxerga as ferramentas pertinentes à sua função (registry).
          tools: toolsForAgent(AGENT_TOOLS, agentId),
          // Antifraude (#121): NÃO persiste resposta do Auditor no RAG. Senão
          // a próxima execução recupera o que ele escreveu como "memória ancorada"
          // e reforça a acusação sem nova evidência (loop alucinatório).
          noRagPersist: agentId === 'fraud',
      });
      let textResult = aiResponse.text;

      // Executar tools que o modelo chamou.
      const toolResults: { tool_call_id: string; output: any }[] = [];

      // Rate-limit antifraude (#121): impede que o LLM crie 50 alertas falsos
      // numa só resposta. Limite por tool, por chamada.
      const FRAUD_FLAG_LIMIT_PER_CALL = 5;
      let fraudFlagCount = 0;

      for (const tool of aiResponse.toolCalls || []) {
          const args = JSON.parse(tool.function.arguments || '{}');
          let toolOutput: any = { success: true };

          if (tool.function.name === 'publish_war_room_insight') {
              if (supabaseAdmin) {
                  await supabaseAdmin.from('war_room_intelligence').insert({
                      campaignId,
                      sourceAgent: agentId,
                      category: args.category,
                      priority: args.priority,
                      insightText: args.insight_text,
                      metadata: { neighborhood: args.neighborhood },
                  });
              }
              toolOutput = { success: true, message: 'Insight publicado na Sala de Guerra.' };
          } else if (tool.function.name === 'get_conversion_funnel') {
              const stats = await getConversionFunnelStats(campaignId);
              if (supabaseAdmin) {
                  await supabaseAdmin.from('war_room_intelligence').insert({
                      campaignId,
                      sourceAgent: agentId,
                      category: 'Oportunidade',
                      priority: 'Media',
                      insightText: `Análise de Funil solicitada: ${stats.map(s => `${s.stage}: ${s.count}`).join(', ')}`,
                  });
              }
              toolOutput = { funnel: stats };
          } else if (tool.function.name === 'analyze_territorial_gap') {
              const alerts = await getTerritorialAlerts(campaignId);
              if (supabaseAdmin) {
                  for (const alert of alerts.slice(0, 3)) {
                      await supabaseAdmin.from('war_room_intelligence').insert({
                          campaignId,
                          sourceAgent: agentId,
                          category: 'Logística',
                          priority: alert.risk_level === 'Critical' ? 'CRÍTICO' : 'Alta',
                          insightText: `GAP TERRITORIAL em ${alert.neighborhood}: ${alert.gap_percentage.toFixed(1)}% de defasagem.`,
                          metadata: { neighborhood: alert.neighborhood, risk: alert.risk_level },
                      });
                  }
              }
              toolOutput = { territorial_alerts: alerts };
          } else if (tool.function.name === 'flag_fraudulent_data') {
              // SALVAGUARDAS ANTIFRAUDE (#121):
              // 1) Rate-limit por chamada (LLM não pode flag 50 em uma resposta).
              // 2) Validar que entity_id EXISTE no banco antes de criar alerta —
              //    impede UUID inventado pelo LLM virar registro "PENDENTE".
              // 3) Marca como 'ai_unverified' + requer aprovação humana antes
              //    de aparecer no painel como confirmado.
              if (fraudFlagCount >= FRAUD_FLAG_LIMIT_PER_CALL) {
                  toolOutput = { success: false, message: `Limite de ${FRAUD_FLAG_LIMIT_PER_CALL} flags por análise atingido.` };
              } else if (!supabaseAdmin) {
                  toolOutput = { success: false, message: 'DB indisponível.' };
              } else {
                  // Valida entity_id existe na tabela correspondente
                  const entityType = String(args.entity_type || '').toLowerCase();
                  const entityId = String(args.entity_id || '');
                  const allowedTables: Record<string, string> = {
                      voters: 'voters', voter: 'voters',
                      contacts: 'contacts', contact: 'contacts',
                      street_reports: 'street_reports', report: 'street_reports',
                      visits: 'visits', visit: 'visits',
                  };
                  const targetTable = allowedTables[entityType];
                  let entityExists = false;
                  if (targetTable && entityId) {
                      try {
                          const { data: found } = await supabaseAdmin
                              .from(targetTable).select('id').eq('id', entityId).maybeSingle();
                          entityExists = !!found;
                      } catch { entityExists = false; }
                  }
                  if (!entityExists) {
                      console.warn(`[fraud-guard] LLM tentou flag entity_id inexistente: ${entityType}/${entityId} — IGNORADO`);
                      toolOutput = {
                          success: false,
                          message: `Registro ${entityType}/${entityId} não existe no banco. Alerta NÃO criado.`,
                      };
                  } else {
                      await supabaseAdmin.from('fraud_audit_logs').insert({
                          campaignId,
                          entityType: entityType,
                          entityId: entityId,
                          detectedBy: agentId,
                          riskLevel: args.risk_level,
                          description: String(args.reason || '').slice(0, 1000),
                          metadata: {
                              source: 'ai_unverified',
                              requires_human_confirmation: true,
                              original_args: args,
                          },
                      });
                      fraudFlagCount++;
                      toolOutput = { success: true, message: `Registro ${entityType}/${entityId} sinalizado como ${args.risk_level} — aguarda confirmação humana.` };
                  }
              }
          } else if (tool.function.name === 'get_competitive_intel') {
              if (supabaseAdmin) {
                  const { data } = await supabaseAdmin.from('competitor_intel')
                      .select('name, cargo, dossier').eq('campaignId', campaignId)
                      .order('createdAt', { ascending: false }).limit(10);
                  const filtro = String(args.nome || '').toLowerCase();
                  const items = (data || [])
                      .filter((r: any) => !filtro || String(r.name || '').toLowerCase().includes(filtro))
                      .map((r: any) => ({
                          nome: r.name, cargo: r.cargo,
                          resumo: r.dossier?.resumo,
                          pontosFracos: r.dossier?.pontosFracos,
                          ameacasParaNos: r.dossier?.ameacasParaNos,
                          recomendacoes: r.dossier?.recomendacoes,
                      }));
                  toolOutput = { adversarios: items, total: items.length };
              } else {
                  toolOutput = { adversarios: [], total: 0 };
              }
          } else if (tool.function.name === 'get_team_activity') {
              try {
                  const stats = await getLeaderConversionStats(campaignId);
                  toolOutput = { equipe: stats };
              } catch (e: any) {
                  toolOutput = { equipe: [], error: e?.message };
              }
          } else if (tool.function.name === 'search_campaign_memory') {
              const mem = supabaseAdmin ? await retrieveContext(supabaseAdmin, campaignId, String(args.query || ''), 6) : '';
              toolOutput = { memoria: mem || 'Nada relevante encontrado na memória.' };
          } else if (tool.function.name === 'create_backup') {
              // Stub: backup real é disparado no service do front. Aqui só registra a intenção.
              toolOutput = { success: true, message: 'Pedido de backup registrado. Execute via UI de Backup.', reason: args.reason };
          } else if (tool.function.name === 'generate_dalle_image') {
              // Direciona o user a chamar /api/agents/generate-image — não geramos imagem dentro de chat (ciclo seria muito longo).
              toolOutput = { success: false, message: 'Use o Produtor Criativo na UI pra gerar imagens. Tool não-executável neste contexto.' };
          } else {
              toolOutput = { success: false, message: `Tool '${tool.function.name}' não suportada.` };
          }

          toolResults.push({ tool_call_id: tool.id, output: toolOutput });
      }

      // Follow-up: alimenta resultados das tools de volta na IA pra texto final.
      if (toolResults.length > 0) {
          try {
              const followupPrompt = `${prompt}\n\n[RESULTADO DAS FERRAMENTAS EXECUTADAS]\n${toolResults.map(tr => `- ${tr.tool_call_id}: ${JSON.stringify(tr.output)}`).join('\n')}\n\nGere a resposta final consolidando o resultado das ferramentas.`;
              const followup = await callAgent(supabaseAdmin, agentId || 'chat', followupPrompt, {
                  campaignId, userId, systemInstruction,
              });
              if (followup.text) textResult = followup.text;
          } catch (followupErr: any) {
              console.error('[Agent Chat] Erro no follow-up:', followupErr.message);
          }
      }

      if (supabaseAdmin && agentId) {
          await supabaseAdmin.from('agent_chat_history').insert({
              campaignId, agentId, role: 'agent', content: textResult,
              metadata: { tool_calls: aiResponse.toolCalls, run_id: aiResponse.runId, provider: aiResponse.provider, model: aiResponse.model }
          });

          await supabaseAdmin.from('ai_compliance_logs').insert({
              campaignId,
              agentId,
              actionType: 'chat_generation',
              inputSummary: prompt.substring(0, 200),
              outputSummary: textResult.substring(0, 200),
              aiDisclosureRequired: true,
              humanApproved: false,
              createdBy: userId
          });

          // RAG: indexa respostas substantivas na memória da campanha (best-effort).
          // Assim o conhecimento de um agente fica disponível para os outros depois.
          if (textResult && textResult.length > 400) {
              void ingestArtifact(supabaseAdmin, {
                  campaignId,
                  source: `agent:${agentId}`,
                  title: `${agentId} — ${String(prompt).slice(0, 60)}`,
                  text: textResult,
                  metadata: { agentId, runId: aiResponse.runId },
              });
          }
      }

      res.json({ text: textResult, tool_calls: aiResponse.toolCalls, run_id: aiResponse.runId, provider: aiResponse.provider });
    } catch (error: any) {
      if (error instanceof BudgetExceededError) {
          return res.status(429).json({ error: error.message, code: 'BUDGET_EXCEEDED' });
      }
      console.error("[Agent Chat] Erro:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Endpoints Gemini (Usados pelo geminiService.ts) ---
  app.post('/api/gemini/chat', requireAuth, async (req, res) => {
    try {
      const { prompt } = req.body;
      const aiResponse = await callGeminiREST(prompt);
      res.json({ text: aiResponse.text() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/public/chat', async (req, res) => {
    try {
      const { prompt } = req.body;
      // Endpoint público usa Gemini (mais econômico/rápido para eleitores)
      const aiResponse = await callGeminiREST(prompt);
      res.json({ text: aiResponse.text() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/agents/history/:agentId', requireAuth, async (req, res) => {
    const { agentId } = req.params;
    const { campaignId } = req.query;
    const { data } = await supabaseAdmin.from('agent_chat_history')
      .select('*').eq('campaignId', campaignId).eq('agentId', agentId)
      .order('createdAt', { ascending: true }).limit(50);
    res.json({ history: toCamel(data || []) });
  });

  app.post('/api/agents/generate-image', requireAuth, async (req, res) => {
    try {
      const { prompt, campaignId, agentId } = req.body;
      const ptPrompt = `ESTRITAMENTE EM PORTUGUÊS DO BRASIL: Qualquer texto na imagem deve ser em português brasileiro. Tema: ${prompt}.`;
      const response = await axios.post('https://api.openai.com/v1/images/generations', {
        model: "dall-e-3", prompt: ptPrompt, n: 1, size: "1024x1792"
      }, { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` } });

      const imageUrl = response.data.data[0].url;
      await supabaseAdmin.from('agent_chat_history').insert({
          campaignId, agentId, role: 'agent', content: `![ATIVO](${imageUrl})`, metadata: { type: 'image' }
      });
      res.json({ imageUrl });
    } catch (error) { res.status(500).json({ error: 'Erro DALL-E' }); }
  });

  // --- Dashboard Feed ---
  app.get('/api/war-room/feed', requireAuth, async (req, res) => {
    const campaignId = (req.query.campaign_id ?? req.query.campaignId) as string | undefined;
    const { data } = await supabaseAdmin.from('war_room_intelligence')
      .select('*').eq('campaignId', campaignId).order('createdAt', { ascending: false }).limit(10);
    res.json({ insights: toCamel(data || []) });
  });

  // --- Auditoria de Fraude ---
  app.get('/api/fraud/logs', requireAuth, async (req, res) => {
    const campaignId = (req.query.campaign_id ?? req.query.campaignId) as string | undefined;
    const { data } = await supabaseAdmin.from('fraud_audit_logs')
      .select('*').eq('campaignId', campaignId).order('createdAt', { ascending: false });
    res.json({ logs: toCamel(data || []) });
  });

  app.post('/api/agents/publish-social', requireAuth, async (req, res) => {
    try {
      const { campaign_id: campaignIdBody, platforms, content, agent_id: agentIdBody, ai_disclosure_required } = req.body;
      const userId = req.user?.id;

      // 1. Validar se o usuário pertence à campanha e tem permissão (Admin ou Líder)
      if (supabaseAdmin) {
        const { data: userCampaign, error: campaignError } = await supabaseAdmin
          .from('users')
          .select('"campaignId", type')
          .eq('id', userId)
          .single();

        if (campaignError || !userCampaign || userCampaign.campaignId !== campaignIdBody) {
          return res.status(403).json({ error: "Acesso negado: Usuário não pertence a esta campanha." });
        }

        const allowedTypes = ['Admin', 'Líder', 'Candidato'];
        if (!allowedTypes.includes(userCampaign.type)) {
          return res.status(403).json({ error: "Permissão insuficiente para publicar em redes sociais." });
        }

        // 2. Registrar log de compliance
        await supabaseAdmin.from('ai_compliance_logs').insert({
          campaignId: campaignIdBody,
          agentId: agentIdBody || 'manual_publish',
          actionType: 'social_publication',
          inputSummary: content.substring(0, 200),
          outputSummary: `Publicado em: ${platforms.join(', ')}`,
          aiDisclosureRequired: ai_disclosure_required || true,
          humanApproved: true,
          riskLevel: 'baixo',
          createdBy: userId
        });
      }

      console.log(`[SOCIAL PUBLISH] Campanha ${campaignIdBody} postando por usuário ${userId} em: ${platforms.join(', ')}`);
      
      // Simulação de processamento de rede social
      await new Promise(r => setTimeout(r, 1500));
      
      res.json({ 
        success: true, 
        message: `Conteúdo publicado com sucesso em ${platforms.length} rede(s).`,
        platforms: platforms
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- API Externa v1 (Ingestão de Dados) ---
  app.post('/api/agents/advisor', requireAuth, async (req, res) => {
    try {
      const { campaignDataPrompt, campaignId, userId } = req.body;
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      const aiResponse = await callAgent(supabaseAdmin, 'advisor', campaignDataPrompt, {
          campaignId, userId,
          systemInstruction: "Você é um consultor político sênior. Forneça exatamente 3 dicas práticas baseadas nos dados fornecidos. Responda ESTRITAMENTE em formato JSON: { \"tips\": [{ \"title\": \"...\", \"message\": \"...\", \"type\": \"info\"|\"warning\"|\"success\" }] }",
      });

      try {
        const cleanData = JSON.parse(cleanJSON(aiResponse.text));
        res.json(cleanData);
      } catch (parseError) {
        // IA não retornou JSON válido — devolve fallback usando o próprio texto.
        res.json({
          tips: [
            { title: "Análise Estratégica", message: aiResponse.text.substring(0, 200) + "...", type: "info" },
            { title: "Dica de Campo", message: "Continue monitorando os bairros com maior rejeição para ações rápidas.", type: "warning" },
            { title: "Foco Digital", message: "Gere novos conteúdos baseados nas dores captadas hoje.", type: "success" }
          ]
        });
      }
    } catch (error: any) {
      if (error instanceof BudgetExceededError) {
          return res.status(429).json({ error: error.message, code: 'BUDGET_EXCEEDED' });
      }
      console.error("[Advisor] Erro:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Pipeline Automática (Analisar Agora) ---
  app.post('/api/agents/pipeline', requireAuth, async (req, res) => {
    try {
      const { campaignDataPrompt, campaignId, userId } = req.body;
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });
      console.log("[Pipeline] Iniciando análise profunda para campanha:", campaignId);

      const aiResponse = await callAgent(
        supabaseAdmin, 'pipeline',
        `Analise estes dados e gere uma estratégia completa. Você DEVE separar cada seção com o marcador '#' seguido do nome do agente (ex: # Estrategista, # Growth, # Social, # Field, # Creative):\n\n${campaignDataPrompt}`,
        { campaignId, userId }
      );
      const text = aiResponse.text;

      if (!text || text.length < 50) {
          throw new Error("Resposta da IA muito curta ou vazia.");
      }

      const parts = text.split('#');
      const findPart = (keywords: string[]) => {
          const part = parts.find(p => keywords.some(k => p.toLowerCase().includes(k.toLowerCase())));
          return part ? part.split('\n').slice(1).join('\n').trim() : '';
      };

      const result = {
        strategist: findPart(['Estrategista', 'Strategist']) || (parts[1] || text),
        growth: findPart(['Growth', 'Hacker']),
        social: findPart(['Social', 'Media']),
        field: findPart(['Field', 'Campo', 'Comandante']),
        creativeText: findPart(['Creative', 'Criativo', 'Produtor']),
      };

      if (supabaseAdmin) {
          const { error } = await supabaseAdmin.from('agent_outputs').insert({
            campaignId,
            agentType: 'war-room-pipeline',
            outputType: 'pipeline_result',
            content: text,
            metadata: { input: { description: 'Full automated analysis' }, output: result, run_id: aiResponse.runId },
          });
          if (error) console.error("[Pipeline] Erro ao salvar:", error);
      }

      res.json(result);
    } catch (error: any) {
      if (error instanceof BudgetExceededError) {
          return res.status(429).json({ error: error.message, code: 'BUDGET_EXCEEDED' });
      }
      console.error("[Pipeline] Erro crítico:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Secretário de Agenda: multi-turn com validação de 5 campos obrigatórios ---
  app.post('/api/agents/secretary', requireAuth, async (req, res) => {
    try {
      const { campaignId, command, context } = req.body;
      // context (opcional): { extracted?: {...}, pendingEvent?: {...}, awaitingFields?: string[] }
      const userId = req.user?.id;
      if (!campaignId || !command || typeof command !== 'string' || command.trim().length < 1) {
        return res.status(400).json({ error: 'campaignId e command obrigatórios' });
      }

      const SECRETARY_INSTR = (await import('./src/lib/agentInstructions.js')).SECRETARY_AGENT_INSTRUCTION;
      const nowIso = new Date().toISOString();

      // Monta prompt incorporando contexto multi-turn (se houver).
      let promptWithContext = `AGORA: ${nowIso}\nFUSO: America/Sao_Paulo\n\n`;
      if (context?.pendingEvent) {
        promptWithContext += `EVENTO PENDENTE (aguardando confirmação):\n${JSON.stringify(context.pendingEvent, null, 2)}\n\nRESPOSTA DO USUÁRIO:\n"${command.trim()}"`;
      } else if (context?.extracted) {
        promptWithContext += `DADOS JÁ EXTRAÍDOS (turno anterior):\n${JSON.stringify(context.extracted, null, 2)}\n\nCAMPOS QUE FALTAVAM: ${(context.awaitingFields || []).join(', ')}\n\nNOVA INFORMAÇÃO DO USUÁRIO:\n"${command.trim()}"`;
      } else {
        promptWithContext += `COMANDO DO USUÁRIO:\n"${command.trim()}"`;
      }

      const aiResponse = await callAgent(supabaseAdmin, 'secretary', promptWithContext, {
        campaignId, userId, systemInstruction: SECRETARY_INSTR,
      });

      // Parser tolerante
      let cleaned = aiResponse.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const firstBrace = cleaned.indexOf('{');
      const lastBrace  = cleaned.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) cleaned = cleaned.slice(firstBrace, lastBrace + 1);

      let parsed: any = {};
      try { parsed = JSON.parse(cleaned); } catch (e) {
        return res.status(500).json({ error: 'Secretário retornou JSON inválido', raw: aiResponse.text.slice(0, 300) });
      }

      // SÓ persiste em confirm_save (o usuário deu OK explícito).
      let executed = false;
      if (parsed.action === 'confirm_save' && parsed.event?.title && (parsed.event?.starts_at || parsed.event?.startsAt)) {
        const ev = parsed.event;
        // Validação dura: garante 5 campos obrigatórios mesmo se a IA escapulir.
        const required = ['title', 'starts_at', 'location', 'with_whom', 'priority'];
        const missing = required.filter(k => !ev[k] || String(ev[k]).trim() === '');
        if (missing.length > 0) {
          parsed.action = 'need_more_info';
          parsed.extracted = ev;
          parsed.missing_fields = missing;
          parsed.speech_response = `Faltam ainda: ${missing.join(', ')}. Pode me passar?`;
        } else {
          const validPrios = ['critica','alta','media','baixa'];
          const prio = validPrios.includes(ev.priority) ? ev.priority : 'media';
          const { error: insErr } = await supabaseAdmin.from('agenda_events').insert({
            campaignId,
            title: String(ev.title).slice(0, 200),
            startsAt: ev.starts_at || ev.startsAt,
            endsAt: ev.ends_at || ev.endsAt || null,
            location: String(ev.location).slice(0, 200),
            withWhom: String(ev.with_whom || ev.withWhom).slice(0, 200),
            priority: prio,
            category: ev.category || 'outro',
            description: ev.description || null,
            reminderMinutesBefore: typeof ev.reminder_minutes_before === 'number' ? ev.reminder_minutes_before : 30,
            createdBy: userId,
          });
          if (!insErr) executed = true;
          else { parsed.action = 'error'; parsed.error = insErr.message; }
        }
      }

      res.json({
        ...parsed,
        executed,
        cost_cents_usd: aiResponse.costCentsUsd,
        provider: aiResponse.provider,
      });
    } catch (error: any) {
      if (error instanceof BudgetExceededError) {
        return res.status(429).json({ error: error.message, code: 'BUDGET_EXCEEDED' });
      }
      console.error('[Secretary] Erro:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Classificação IA de eleitores (Indeciso → Apoiador → Multiplicador) ---
  app.post('/api/ai/classify-contacts', requireAuth, async (req, res) => {
    try {
      const campaignId = req.body.campaignId;
      const userId = req.user?.id;
      const limit = Math.min(Number(req.body.limit) || 30, 100);
      if (!campaignId || !supabaseAdmin) return res.status(400).json({ error: 'campaignId obrigatório' });

      // Pega contatos ainda não classificados (ou classificados há mais de 14 dias).
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data: contacts, error: contactsErr } = await supabaseAdmin
        .from('contacts')
        .select('id, name, phone, neighborhood, classification, tags, "aiNotes", source, "supportLevel", "supportClassifiedAt"')
        .eq('campaignId', campaignId)
        .or(`supportLevel.eq.desconhecido,supportClassifiedAt.lt.${cutoff}`)
        .order('createdAt', { ascending: false })
        .limit(limit);
      if (contactsErr) throw contactsErr;
      if (!contacts || contacts.length === 0) {
        return res.json({ classified: 0, message: 'Sem contatos pra classificar agora.' });
      }

      // Monta prompt em batch — mais barato que 1 chamada por contato.
      const lines = contacts.map((c: any, i: number) =>
        `${i+1}. id=${c.id} | nome=${c.name} | bairro=${c.neighborhood||'?'} | classif_legado=${c.classification||'?'} | tags=${(c.tags||[]).join(',')||'?'} | notas=${(c.aiNotes||'').slice(0,80)||'?'} | origem=${c.source||'?'}`
      ).join('\n');

      const systemPrompt = `Você é o Classificador de Eleitores. Sua tarefa: classificar cada contato E sugerir a PRÓXIMA AÇÃO que mais converte voto.

NÍVEIS:
- 'rejeitador': demonstra rejeição clara ao candidato/causa
- 'indeciso': sem sinal claro de apoio nem rejeição
- 'simpatizante': sinais leves de apoio (ex: tags positivas, classificação legado "Apoiador")
- 'apoiador': apoio declarado consistente
- 'multiplicador': apoiador que ATIVAMENTE traz outros (tags "lider de bairro", origem "Indicação")
- 'desconhecido': dados insuficientes pra classificar com >50% de confiança

REGRA DE OURO DA AÇÃO (next_action): seja CONCRETO e CURTO (≤140 chars), com VERBO no início.
Princípios pra cada nível:
- multiplicador: maximizar alcance — "Convidar pra evento e pedir 3 indicações no bairro X"
- apoiador: fortalecer engajamento — "Mandar conteúdo aprofundado sobre pauta Y" / "Mobilizar pra mutirão"
- simpatizante: converter pra apoio — "Visita pessoal focada em [pauta que mais combina]"
- indeciso: ESCUTAR antes de empurrar — "Visita aberta: ouvir queixas do bairro, evitar discurso"
- rejeitador: NÃO gastar recursos — "Não incluir em blast; revisar em 30 dias se mudar contexto"
- desconhecido: COLETAR — "Mandar formulário curto antes de qualquer abordagem"

Atribua support_score (0-100) = sua CONFIANÇA na classificação.

Retorne ESTRITAMENTE um JSON array, um objeto por contato, na ordem da entrada:
[{ "id": "uuid", "support_level": "indeciso", "support_score": 60, "reasoning": "frase curta", "next_action": "Visita pessoal focada em Saúde, evitar discurso" }, ...]`;

      const aiResponse = await callAgent(supabaseAdmin, 'crm', `Classifique estes ${contacts.length} contatos:\n\n${lines}\n\nLembre: JSON array puro, sem markdown.`, {
        campaignId, userId, systemInstruction: systemPrompt,
      });

      // Parser tolerante (IA às vezes envolve em ```json)
      let cleaned = aiResponse.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const firstBracket = cleaned.indexOf('[');
      const lastBracket = cleaned.lastIndexOf(']');
      if (firstBracket >= 0 && lastBracket > firstBracket) cleaned = cleaned.slice(firstBracket, lastBracket + 1);

      let parsed: any[] = [];
      try { parsed = JSON.parse(cleaned); } catch (e: any) {
        return res.status(500).json({ error: 'IA retornou JSON inválido', raw: aiResponse.text.slice(0, 500) });
      }

      const validLevels = new Set(['desconhecido','rejeitador','indeciso','simpatizante','apoiador','multiplicador']);
      let classified = 0;
      const now = new Date().toISOString();
      for (const item of parsed) {
        if (!item?.id || !validLevels.has(item.support_level)) continue;
        const nextAction = (item.next_action || '').toString().trim().slice(0, 140) || null;
        const { error: upErr } = await supabaseAdmin.from('contacts').update({
          supportLevel: item.support_level,
          supportScore: typeof item.support_score === 'number' ? Math.max(0, Math.min(100, item.support_score)) : null,
          supportReasoning: (item.reasoning || '').slice(0, 500),
          supportClassifiedAt: now,
          supportClassifiedBy: 'ai_crm_agent',
          nextAction,
          nextActionAt: nextAction ? now : null,
        }).eq('id', item.id).eq('campaignId', campaignId);
        if (!upErr) classified++;
      }

      // Custo / provider / run_id NÃO são retornados pro cliente (regra #111:
      // só Supreme vê isso; ficam só em agent_runs/ai_usage pra auditoria).
      res.json({
        classified,
        total: contacts.length,
      });
    } catch (error: any) {
      if (error instanceof BudgetExceededError) {
        return res.status(429).json({ error: error.message, code: 'BUDGET_EXCEEDED' });
      }
      console.error('[Classify] Erro:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Manager Agent (orquestrador) com SSE streaming ---
  app.post('/api/agents/manager', requireAuth, async (req, res) => {
    const { campaignId, intent } = req.body;
    const userId = req.user?.id;
    if (!campaignId || !intent || typeof intent !== 'string' || intent.trim().length < 5) {
      return res.status(400).json({ error: 'campaignId e intent (>=5 chars) obrigatórios' });
    }

    // Server-Sent Events: cada evento do Manager vira uma linha "data: ...\n\n"
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const send = (event: string, payload: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    // Heartbeat a cada 15s pra evitar proxies fecharem conexão.
    const heartbeat = setInterval(() => res.write(`: keepalive\n\n`), 15_000);

    try {
      const result = await runManager({
        supabaseAdmin,
        campaignId,
        userId,
        intent,
        onEvent: (e) => send(e.type, { ...e.data, ts: e.timestamp }),
      });
      send('done', result);
    } catch (err: any) {
      const code = err instanceof BudgetExceededError ? 'BUDGET_EXCEEDED' : 'ERROR';
      send('error', { error: err?.message || String(err), code });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });

  // GET histórico de execuções do Manager
  app.get('/api/agents/manager/runs', requireAuth, async (req, res) => {
    try {
      const campaignId = (req.query.campaign_id ?? req.query.campaignId) as string | undefined;
      if (!campaignId || !supabaseAdmin) return res.status(400).json({ error: 'campaignId obrigatório' });
      const { data } = await supabaseAdmin.from('manager_runs')
          .select('id, intent, "finalSummary", "totalCostCentsUsd", iterations, status, "startedAt", "finishedAt"')
          .eq('campaignId', campaignId)
          .order('startedAt', { ascending: false })
          .limit(20);
      res.json({ runs: data || [] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- AI Health (uso e custo do mês para o dashboard "Manager") ---
  app.get('/api/ai/health', requireAuth, async (req, res) => {
    try {
      const campaignId = (req.query.campaign_id ?? req.query.campaignId) as string | undefined;
      if (!campaignId || !supabaseAdmin) return res.status(400).json({ error: 'campaignId obrigatório' });
      const startOfMonth = new Date(); startOfMonth.setUTCDate(1); startOfMonth.setUTCHours(0,0,0,0);
      const { data: runs } = await supabaseAdmin.from('agent_runs')
          .select('"agentId", provider, model, status, "costCentsUsd", "latencyMs", "createdAt"')
          .eq('campaignId', campaignId)
          .gte('createdAt', startOfMonth.toISOString())
          .order('createdAt', { ascending: false })
          .limit(2000);
      const list = runs || [];
      const totalCents = list.reduce((s: number, r: any) => s + (r.costCentsUsd || 0), 0);
      const errors = list.filter((r: any) => r.status !== 'ok').length;
      const byAgent: Record<string, { runs: number; cost_cents: number }> = {};
      for (const r of list) {
          const a = (r as any).agentId || 'unknown';
          if (!byAgent[a]) byAgent[a] = { runs: 0, cost_cents: 0 };
          byAgent[a].runs += 1;
          byAgent[a].cost_cents += (r as any).costCentsUsd || 0;
      }
      res.json({
        month_total_cents_usd: totalCents,
        month_total_brl: Number((totalCents / 100 * Number(process.env.BRL_PER_USD || 5.50)).toFixed(2)),
        cap_brl: 100,
        runs_count: list.length,
        errors_count: errors,
        by_agent: byAgent,
        recent: list.slice(0, 20),
      });
    } catch (error: any) {
      console.error('[AI Health] Erro:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Ordens de Produção (Passagem de Bola) ---
  app.post('/api/agents/production-order', requireAuth, async (req, res) => {
    try {
      const { campaignId, originAgent, targetAgent, content } = req.body;
      const { data, error } = await supabaseAdmin.from('production_orders').insert({
        campaignId,
        originAgent,
        targetAgent,
        content: typeof content === 'string' ? content : JSON.stringify(content ?? ''),
        status: 'pending'
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/agents/production-orders', requireAuth, async (req, res) => {
    try {
      const { campaignId, targetAgent } = req.query;
      const { data } = await supabaseAdmin.from('production_orders')
        .select('*').eq('campaignId', campaignId).eq('targetAgent', targetAgent).eq('status', 'pending');
      res.json({ orders: toCamel(data || []) });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // --- Gerar/Rotacionar API Key da campanha (Admin/Líder/Candidato) ---
  app.post('/api/campaigns/:id/api-key', requireAuth, async (req, res) => {
    try {
      const campaignId = req.params.id;
      const userId = req.user?.id;
      if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase admin indisponível.' });

      const { data: userRow, error: userErr } = await supabaseAdmin
        .from('users').select('"campaignId", type, "isSupremeAdmin"').eq('id', userId).single();
      if (userErr || !userRow) return res.status(403).json({ error: 'Usuário não encontrado.' });

      const allowed = userRow.isSupremeAdmin || (
        userRow.campaignId === campaignId && ['Admin', 'Líder', 'Candidato'].includes(userRow.type)
      );
      if (!allowed) return res.status(403).json({ error: 'Permissão insuficiente para gerar chave da campanha.' });

      const newKey = `cp_${crypto.randomBytes(24).toString('base64url')}`;
      const { error: updErr } = await supabaseAdmin
        .from('campaigns').update({ apiKey: newKey, updatedAt: new Date().toISOString() }).eq('id', campaignId);
      if (updErr) throw updErr;

      res.json({ apiKey: newKey, campaignId });
    } catch (error: any) {
      console.error('[API Key] Erro ao gerar:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // --- API EXTERNA V1 (Integração com Apps Terceiros) ---
  const validateApiKey = async (req: any, res: any, next: any) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'X-API-KEY ausente' });
    
    // Busca campanha pela API KEY
    const { data: campaign, error } = await supabaseAdmin
      .from('campaigns')
      .select('id')
      .eq('apiKey', apiKey)
      .single();

    if (error || !campaign) return res.status(403).json({ error: 'API KEY inválida' });
    req.campaignId = campaign.id;
    next();
  };

  app.post('/api/external/v1/voters', validateApiKey, async (req: any, res) => {
    try {
      const { name, phone, email, neighborhood, city, observations, birthDate, gps } = req.body;
      const { data, error } = await supabaseAdmin.from('contacts').insert({
        campaignId: req.campaignId,
        name,
        phone,
        email,
        neighborhood,
        city,
        aiNotes: observations,
        birthDate,
        gpsCoords: gps,
      }).select().single();
      if (error) throw error;
      res.status(201).json({ message: 'Eleitor importado com sucesso', id: data.id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/external/v1/visits', validateApiKey, async (req: any, res) => {
    try {
      const { contactId, notes } = req.body;
      const { data, error } = await supabaseAdmin.from('visits').insert({
        campaignId: req.campaignId,
        leaderId: contactId,
        observacoesQualitativas: notes,
        createdAt: new Date().toISOString()
      }).select().single();
      if (error) throw error;
      res.status(201).json({ message: 'Atendimento/Visita registrada via API', id: data.id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // Vite / Static Assets
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server: httpServer } }, appType: 'custom' });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith('/api') || url.includes('.')) return next();
      let template = await fsPromises.readFile(path.resolve(__dirname, 'index.html'), 'utf-8');
      template = await vite.transformIndexHtml(url, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
        console.log(`[Production] Servindo arquivos estáticos de: ${distPath}`);
        app.use(express.static(distPath));
        app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
    } else {
        console.error(`[CRÍTICO] Pasta de build não encontrada: ${distPath}`);
    }
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Servidor rodando em todas as interfaces na porta ${port}`);
    startProactiveMonitor(supabaseAdmin);
    startDailyBriefing(supabaseAdmin);
    startRoutinesWorker(supabaseAdmin);
    if (supabaseAdmin) startLifecycleSweeper(supabaseAdmin);
    // Re-register webhooks for all connected WhatsApp instances so the
    // correct EVOLUTION_WEBHOOK_URL is always active (self-healing).
    if (supabaseAdmin && isEvolutionConfigured()) {
      void (async () => {
        try {
          const { data } = await supabaseAdmin
            .from('whatsapp_instances')
            .select('instanceName, apiKey')
            .eq('status', 'connected')
            .not('apiKey', 'is', null);
          const rows = (data ?? []) as Array<{ instanceName: string; apiKey: string }>;
          if (!rows.length) return;
          const results = await Promise.allSettled(
            rows.map((inst) => setWebhook(inst.instanceName, inst.apiKey)),
          );
          const ok = results.filter((r) => r.status === 'fulfilled').length;
          const fail = results.filter((r) => r.status === 'rejected').length;
          console.log(`[Evolution] Webhook resync: ${ok} ok, ${fail} falhas`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('[Evolution] Webhook resync failed:', message);
        }
      })();
    }
  });
}

startServer();