# SOCIAL AS-IS — Auditoria (F0)

> Estado atual do módulo social no `main` (commit `a0ac2ec`). Só o que **realmente
> está no código versionado** conta. Toda linha marcada "Existe" tem `file:line`.
> Este documento é entrada obrigatória para `SOCIAL-GAP-MATRIX.md` e é o gate
> para autorizar F1 (Contracts + Capabilities). Nenhuma feature deve ser
> implementada até que ele seja lido e aceito.

Auditores: 4 exploradores paralelos (providers, schema, intelligence, publisher).
Escopo intencionalmente conciso — leitura completa dos arquivos citados é o próximo passo antes de cada PR.

---

## 1. Panorama executivo

**Onde estamos**

- **Um só provider maduro end-to-end:** X (Twitter) — OAuth PKCE, refresh, snapshot,
  sync agendado, RAG. LinkedIn é o segundo (mas `sharePosts` sempre retorna `[]`).
- **Instagram** roda por caminho paralelo (`instagramGraphClient` + Business
  Discovery + Pulso dos Bairros + own comments), fora do `runSocialSync`.
- **Kwai** é scraping frágil (og-tags + regex do HTML) — mantém-se como
  `capabilityLevel = limited`.
- **Facebook** = paste manual de token + Ad Library de leitura, sem sync.
- **YouTube e TikTok** = ausentes. TikTok tem apenas stub simulado (`server.ts:396-398`).
- **Não existe `SocialProviderAdapter` unificado.** O que há é
  `type SyncProvider = 'x' | 'linkedin' | 'kwai'` em `src/lib/socialSyncRunner.ts:20`
  — Instagram/Meta ficam fora do runner.
- **Publisher social real = zero.** Studio gera e agenda; ninguém posta em rede
  social. WhatsApp é a única exceção (Evolution API).

**Bugs estruturais achados durante a auditoria** (F0-blockers, precisam entrar no PR 1):

1. `social_metrics_daily`, `social_watchlist`, `social_sync_log` — **usadas em código sem migration versionada**. Rodando por criação manual em prod. Bloqueia reprovisionamento.
2. `agent_runs` — mesma situação (usada em 6 arquivos, sem CREATE TABLE em `sql/*` ou `supabase/migrations/*`). CLAUDE.md avisa que a versão em prod usa snake_case, contrariando o `supabase-schema.sql:260` (que traz `ai_usage` legada em camelCase).
3. `POST /api/v1/content/:id/publish` (`src/server/modules/content/contentRouter.ts:454`) **não checa `status='approved'`** antes de marcar como publicado — a "aprovação humana" documentada no fluxo é opcional na prática.
4. Compliance gate cosmético: `checkCompliance` só rejeita `severity==='error'` (`contentRouter.ts:377`), mas nenhuma regra emite `error` (todas são `warn`, `contentRouter.ts:51-82`).
5. Scheduler de `content_posts.scheduledAt` é vaporware: nenhum worker consulta essa tabela. Índice `content_posts_scheduled` fica órfão.
6. `contentRouter.ts:20` usa `campaignIdOf(req)` direto em vez de `tenantCampaignId()` — inconsistência com `paperclipRouter`/`whatsappRouter`, quebra impersonação de supreme admin.

---

## 2. Matriz de capabilities por provider

Legenda: ✅ Existe · 🟡 Parcial · ❌ Ausente.
Referências apontam para arquivos versionados na `main`.

### 2.1 Instagram (Meta Graph — IG Business Discovery + own media)

| Capability | Status | Referência |
|---|---|---|
| OAuth (connect flow) | ❌ | só paste manual de token — `src/components/resources/SocialConnectionsHub.tsx:136,144` |
| Token refresh | ❌ | — |
| Profile read | 🟡 | `resolveInstagram()` + `/me/accounts` — `src/server/modules/integrations/instagramGraphClient.ts:74,104` |
| Posts read (próprio) | ✅ | `fetchOwnMediaWithComments` — `instagramGraphClient.ts:161` |
| Own comments read | ✅ | mesmo endpoint com `comments{text,username…}` — `instagramGraphClient.ts:167` |
| Third-party comments read | ❌ | Meta não libera texto de terceiros; só contagem via Business Discovery — `instagramGraphClient.ts:6-15,124` |
| Metrics read | 🟡 | contagens (like/comments/followers) via Business Discovery + own media |
| Webhook | ❌ | webhook Meta existe mas só WhatsApp — `src/server/modules/channels/webhookRouter.ts:49,109-119,150` |
| Background sync | ❌ | `tickSocialSync` só toca x/linkedin/kwai — `src/server/modules/routines/routinesWorker.ts:201,216` |
| RAG indexing | ✅ | Pulso dos Bairros usa `ingestArtifact(source='agent:bairro-pulse')` — `src/server/modules/social/socialRouter.ts:414` |
| Publishing | ❌ | não implementado |

Extras já em produção: **Pulso dos Bairros** (`socialRouter.ts:370-423`), **Watchlist** (`socialRouter.ts:333-365`), `/instagram/own-comments` (`socialRouter.ts:427-455`).

### 2.2 Facebook (via Meta)

| Capability | Status | Referência |
|---|---|---|
| OAuth | ❌ | paste manual — `SocialConnectionsHub.tsx:117,144` |
| Token refresh | ❌ | — |
| Profile read | 🟡 | `/me/accounts` via `autoResolveIgUserId` — `instagramGraphClient.ts:108` |
| Posts read | ❌ | sem client dedicado a Page Feed |
| Comments (próprio/terceiros) | ❌ | — |
| Metrics read | ❌ | — |
| Webhook | ❌ | — |
| Background sync | ❌ | — |
| RAG indexing | ❌ | — |
| Publishing | ❌ | — |
| Ad Library (competitive) | ✅ | `src/server/modules/intel/metaAdLibrary.ts:43` (via `intelRouter`) |

### 2.3 YouTube

Todas as capabilities: ❌ **ausente**. Aparece só em prompts (`intelRouter.ts:126,137`, `agentInstructions.ts:72`). Sem client, sem env var, sem UI.

### 2.4 TikTok

| Capability | Status | Referência |
|---|---|---|
| OAuth | 🟡 stub | `/api/auth/tiktok/url` devolve mock — `server.ts:396-398`. Env-check em `src/server/modules/compliance/complianceService.ts:125` (`TIKTOK_CLIENT_KEY`) |
| Resto | ❌ | card na UI (`SocialConnectionsHub.tsx:243,567`), sem backend real |

### 2.5 X (Twitter) — provider mais maduro

| Capability | Status | Referência |
|---|---|---|
| OAuth (PKCE) | ✅ | `src/lib/socialSyncX.ts:50,59,86`; router `src/server/modules/social/socialRouter.ts:103-110,160-166` |
| Token refresh | ✅ | `refreshXToken` — `socialSyncX.ts:103`; acionado em `src/lib/socialSyncRunner.ts:58-69` |
| Profile read | ✅ | `/users/me` — `socialSyncX.ts:129` |
| Posts read | 🟡 | tenta `/users/:id/tweets`; falha silenciosa em Free tier — `socialSyncX.ts:138-155` |
| Own comments read | ❌ | — |
| Third-party comments read | ❌ | — |
| Metrics read | ✅ | `public_metrics` + `non_public_metrics.impression_count` |
| Webhook | ❌ | — |
| Background sync | ✅ | `tickSocialSync` — `routinesWorker.ts:216,257-260` |
| RAG indexing | ✅ | `ingestArtifact(source='social:x')` — `socialSyncRunner.ts:135-144` |
| Publishing | ❌ | — |

### 2.6 LinkedIn

| Capability | Status | Referência |
|---|---|---|
| OAuth | ✅ | `src/lib/socialSyncLinkedIn.ts:47,77`; router `socialRouter.ts:111-114,168-172` |
| Token refresh | ✅ | `refreshLinkedInToken` — `socialSyncLinkedIn.ts:92`; usado em `socialSyncRunner.ts:88-99` |
| Profile read | ✅ | `/userinfo` OIDC — `socialSyncLinkedIn.ts:121` |
| Posts read | 🟡 | `sharePosts` sempre `[]` — `socialSyncLinkedIn.ts:149` (comentário: "cota baixa") |
| Comments | ❌ | — |
| Metrics read | 🟡 | só `networkSizes` de followers das orgs admin — `socialSyncLinkedIn.ts:138-143` |
| Webhook | ❌ | — |
| Background sync | ✅ | `tickSocialSync` — `routinesWorker.ts:216` |
| RAG indexing | ✅ | `source='social:linkedin'` |
| Publishing | ❌ | — |

### 2.7 Kwai

| Capability | Status | Referência |
|---|---|---|
| OAuth | n/a | Kwai não tem API pública; conexão por handle — `socialRouter.ts:199-229` |
| Profile read | 🟡 | scraping de og-tags/JSON-LD — `src/lib/socialSyncKwai.ts:57-108` |
| Posts read | 🟡 | contagem de vídeos por regex — `socialSyncKwai.ts:96` |
| Comments | ❌ | — |
| Metrics read | 🟡 | followers/following por regex do HTML |
| Webhook | ❌ | — |
| Background sync | ✅ | `tickSocialSync` — `routinesWorker.ts:216` |
| RAG indexing | ✅ | `source='social:kwai'` |
| Publishing | ❌ | — |

### 2.8 Superfície frontend + endpoints REST

- **Hub único de conexões:** `src/components/resources/SocialConnectionsHub.tsx` (598 linhas) — cards para whatsapp/instagram/facebook/tiktok/x/linkedin/kwai, três modos: `manual`, `oauth`, `kwai` (handle).
- **Callback OAuth:** `src/pages/SocialOAuthCallbackPage.tsx` → montado em `src/routes.tsx:85` como `/oauth/:provider/callback`.
- **Pulso dos Bairros (UI):** `src/components/scenarios/BairroPulse.tsx` (205 linhas).
- **Stub legado:** `server.ts:390-425` (`/api/auth/tiktok/url`, `/api/auth/callback/simulate`, `/api/agents/publish-social` — este último "Simulação de processamento de rede social" em `server.ts:782`).

**Endpoints REST** (montados em `server.ts:312` como `/api/v1/social`, todos em `socialRouter.ts`):

```
GET  /status                              :59
GET  /metrics/:provider                   :71
POST /connect/:provider/start             :87
POST /connect/:provider/callback          :130
POST /connect/kwai                        :199
DEL  /connect/:provider                   :232
POST /sync/:provider                      :245
POST /analyze                             :267
GET  /history                             :294
GET  /last-change                         :309
GET  /instagram/status                    :325
GET  /watchlist                           :333
POST /watchlist                           :343
DEL  /watchlist/:id                       :358
POST /instagram/pulse                     :370
GET  /instagram/own-comments              :427
POST /cleanup-expired-state               :458
```

Webhooks: `src/server/modules/channels/webhookRouter.ts` — só `GET/POST /meta` (WhatsApp inbound). Canal IG está no tipo (`webhookRouter.ts:150`) mas sem handler.

### 2.9 Clients de baixo nível

- `src/lib/socialSyncRunner.ts` (278 linhas) — orquestrador único (x/linkedin/kwai) + `detectSignificantChange` (:167).
- `src/lib/socialSyncX.ts` (168) · `src/lib/socialSyncLinkedIn.ts` (167) · `src/lib/socialSyncKwai.ts` (111).
- `src/server/modules/integrations/instagramGraphClient.ts` (184) — Meta Graph (IG Business Discovery + own media).
- `src/server/modules/intel/metaAdLibrary.ts` (84) — Ad Library.
- `src/server/modules/integrations/channelsClient.ts` (110) — WA Cloud API send (não é social read).

---

## 3. Schema de banco relevante ao PRD

Legenda naming: **cc** = camelCase quoted (padrão CampanhaPro) · **sn** = snake_case (exceção).
RLS: **on** (policies ativas) · **off** · **svc** (só service_role).

### 3.1 Credenciais / OAuth / roteamento de canais

| Tabela | Colunas-chave | Uso atual | Naming | RLS | Ref |
|---|---|---|---|---|---|
| `social_tokens` | `"campaignId"`, `provider`, `access_token`, `refresh_token`, `expires_at`, `settings` jsonb, UNIQUE(`"campaignId"`,`provider`) | Único armazém OAuth. Só cobre Meta family. Sem `page_id`, `handle`, `scopes`, `granted_at`, `providerAccountId`, `revokedAt`. | **misto** | on (Admin) | `sql/07_social_integration.sql:2` |
| `whatsapp_instances` | `"campaignId"`, `"instanceName"`, `"displayName"`, `"phoneNumber"`, `status`, `"apiKey"`, `"lastConnectedAt"` | Evolution self-host, um por número. | cc | on | `supabase/migrations/20260601000000_create_whatsapp_instances_and_provider_routing.sql:5` |
| `channel_phone_mappings` | `"phoneNumberId"` PK, `"campaignId"`, `"displayPhone"` | Rota Meta Cloud → campanha. | cc | svc | `supabase/migrations/20260516000000_create_channels.sql:35` |
| *(ausente)* `campaign_channels` | — | Só conceito no PRD. Não existe. | — | — | — |

### 3.2 Ingestão social

| Tabela | Colunas-chave | Uso atual | Naming | RLS | Ref |
|---|---|---|---|---|---|
| `social_metrics_daily` | `"campaignId","provider","snapshotDate"` implícito | ⚠️ **NÃO EXISTE CREATE TABLE**. Código faz upsert (`src/lib/socialSyncRunner.ts:132`, `socialRouter.ts:76`). Vive apenas em prod, criada manualmente. | (implícito cc) | ? | fantasma — usar em `socialSyncRunner.ts:132` |
| `channel_conversations` | `"campaignId"`, `channel` (whatsapp\|instagram), `"contactId"`, `"externalId"`, `"lastMessageAt"`, `"isOpen"` | DM/comment privado. CHECK só aceita whatsapp/instagram. | cc | on | `supabase/migrations/20260516000000_create_channels.sql:3` |
| `channel_messages` | `"conversationId"`, `direction`, `channel`, `"providerMessageId"`, `body` | Corpo das mensagens. Sem métricas. | cc | on | `supabase/migrations/20260516000000_create_channels.sql:20` |
| *(ausente)* `social_posts`, `social_comments`, `social_snapshots` | — | Não existem. Único registro de post orgânico é `content_posts` (que é de publicação). | — | — | — |
| *(ausente)* `social_watchlist`, `social_sync_log` | — | ⚠️ **usadas em código** (`socialRouter.ts:333-365`, `routinesWorker.ts:277`), sem migration versionada. | — | ? | fantasmas |

### 3.3 Inteligência (IA / RAG / runs / anomaly)

| Tabela | Colunas-chave | Uso atual | Naming | RLS | Ref |
|---|---|---|---|---|---|
| `knowledge_chunks` | `"campaignId"`, `source`, `content`, `metadata` jsonb, `embedding` vector(1536) + IVFFlat + RPC `match_knowledge_chunks` | RAG store único. PRD pode reusar com `metadata.provider='social:instagram'`. Estendida por `20260621000000_extend_knowledge_chunks_legal_base.sql`. | cc | on | `supabase/migrations/20260516000002_create_knowledge_chunks.sql:5` |
| `agent_runs` | `campaign_id`, `user_id`, `manager_run_id`, `agent_id`, `provider`, `model`, `action`, `prompt_excerpt`, `tokens_in`, `tokens_out`, `cost_cents_usd`, `status`, `error` | ⚠️ **usada em 6 lugares** (`src/lib/aiCallAgent.ts:486,515,558`, `server.ts:1161`, …), **sem migration**. Fonte-verdade de custo (`sql/25_supreme_platform_metrics.sql:118` diz "ai_usage é legada"). | **sn** — CLAUDE.md avisa | ? | fantasma |
| `ai_usage` | `"campaignId"`, `"userId"`, `model`, `"promptTokens"`, `"responseTokens"`, `"totalTokens"`, `"estimatedCost"`, `endpoint`, `timestamp` | Legada, fica vazia. Camelcase no schema, mas CLAUDE.md avisa que prod pode ter snake — divergência. | cc (schema) / sn (prod?) | on | `supabase-schema.sql:260`; duplicata `sql/02_tabelas_config_e_auxiliares.sql:110` |
| `agent_tasks` | `"campaignId"`, `type`, `payload`, `"requiresApproval"`, `status`, `"providerTaskId"`, `"costCents"`, `"approvedByUserId"`, +Kanban | Fila Paperclip com approval gate. Reusável para jobs de ingestão social. | cc | on | `supabase/migrations/20260516000003_create_agent_tasks.sql:3` + `20260525000001_expand_agent_tasks.sql:3` |
| `agent_routines` + `routine_triggers` + `routine_runs` | orquestração cron/webhook/manual | Base pronta para Pulso Diário. | cc | on | `supabase/migrations/20260525000002_create_agent_routines.sql:3,40,73` |
| *(ausente)* `anomaly_events`, `signal_events`, `pulso_reports`, `alerts` | — | PRD terá que criar. | — | — | — |

### 3.4 Publicação / content

| Tabela | Colunas-chave | Uso atual | Naming | RLS | Ref |
|---|---|---|---|---|---|
| `content_posts` | `"campaignId"`, `channel`, `"postType"`, `tone`, `topic`, `brief`, `"generatedText"`, `"finalText"`, `hashtags`, `"imageUrl"`, `"complianceFlags"`, `status` (draft/approved/scheduled/published/archived), `"scheduledAt"`, `"publishedAt"`, `"approvedBy"` | Studio: drafts + schedule + approval. Não há tabela de jobs de publicação separada. | cc | on | `supabase/migrations/20260604000000_create_content_posts.sql:2` |
| `content_briefs` | legado, superseded | — | cc | — | `supabase-schema.sql:224` |
| `whatsapp_blasts` | `"campaignId"`, `"instanceId"`, `title`, `message`, `"contactFilter"`, `status`, contadores, `"agentTaskId"` | Blast por Evolution. Único publisher real do repo. | cc | on | `supabase/migrations/20260603000000_create_whatsapp_blasts.sql:2` |
| *(ausente)* `publish_jobs`, `content_schedule` | — | Sem worker consumindo `scheduledAt`. | — | — | — |

### 3.5 Audit / sync logs / webhooks

| Tabela | Colunas-chave | Uso atual | Naming | RLS | Ref |
|---|---|---|---|---|---|
| `audit_logs` | `"campaignId"` uuid, `"actorId"`, `"actorType"`, `action`, `"resourceType"`, `"resourceId"`, `"traceId"`, `severity`, `metadata` | Reusável para eventos social. | cc | on (select) / insert bloqueado | `supabase/migrations/20260518000000_create_audit_logs.sql:3` |
| `webhook_events` | `source` (meta/tiktok/…), `"eventType"`, `"signatureValid"`, `"campaignId"`, `"payloadHash"` UNIQUE (idempotência) | Já modelada para Meta/TikTok webhooks — pronta para reuso. | cc | on | `supabase/migrations/20260518000000_create_audit_logs.sql:45` |
| `campaign_sync_logs` | `"campaignId"` UNIQUE (1 linha) | Não serve multi-provider — precisa por `provider`. | cc | on | `supabase/migrations/20260515000000_create_campaign_sync_logs.sql:4` |

---

## 4. Intelligence Engine (o que EXISTE)

### 4.1 Sync scheduler
- `setInterval(TICK_MS=60_000)` em `src/server/modules/routines/routinesWorker.ts:358`, iniciado em `server.ts:1325` (`startRoutinesWorker`).
- Multi-instance protegido só por UPDATE condicional (`routinesWorker.ts:63-71`, `246-252`) — sem BullMQ, sem pg_cron.
- `tickSocialSync` gated a **04h–05h BR** (`routinesWorker.ts:200,218-219`).

### 4.2 Sync runner
- `runSocialSync(supabase, campaignId, provider)` em `src/lib/socialSyncRunner.ts:35-147`.
- Cobre `x | linkedin | kwai`. Instagram usa caminho paralelo (`socialRouter.ts:325-455`).

### 4.3 Snapshots + RAG
- Renderização textual em `socialSyncRunner.ts:233-278` (`renderXSnapshotForRag`, etc.), enviados via `ingestArtifact` em `socialSyncRunner.ts:135-144`.
- **Namespace = string em `source`**: `social:x`, `social:linkedin`, `social:kwai`, `agent:bairro-pulse`, `intel:adversary`, `strategy:battle_plan`, `tse:divulgacand:...`, `legal:*`.
- Sem coluna `namespace`/`source_type`/`entity_type`; RPC `match_knowledge_chunks` filtra apenas por `campaignId` (`20260516000002_create_knowledge_chunks.sql:58`).

### 4.4 Módulos RAG (1 linha cada)
- `ragRouter.ts` (394) — API HTTP `/ingest`, `/search`, `/documents` sobre `knowledge_chunks`.
- `embeddings.ts` (55) — wrapper OpenAI `text-embedding-3-small`.
- `vectorStore.ts` (70) — RPC `match_knowledge_chunks`.
- `knowledgeIngest.ts` (94) — `ingestArtifact()` + `retrieveContext()` com tag FONTE/MEMÓRIA-ANCORADA/NÃO-ANCORADA (§109 do PRD já parcialmente atendido no RAG).
- `legalKnowledge.ts` (174), `legalBaseAdmin.ts` (193), `legalBaseRouter.ts` (141), `legalShieldRouter.ts` (139), `complianceReview.ts` (188), `pdfExtract.ts` (28).

### 4.5 Classificação IA (topic/sentiment)
- **Não existe pipeline dedicado.** Classificações inline nos handlers, sem etapa determinística prévia:
  - `socialRouter.ts:403-412` — `callAgent('competitive_intel', ...)` para "temas quentes por bairro".
  - `socialRouter.ts:439-448` — mesmo padrão para comentários próprios (sentimento, temas, urgentes).
- Único classificador determinístico é `src/lib/whatsappClassifier.ts` (Gemini Flash + fallback keyword) — não usado em social.

### 4.6 Anomaly / trend / spike
- `detectSignificantChange()` em `socialSyncRunner.ts:167-229`.
- Thresholds: `FOLLOWER_DELTA=20%`, `ENGAGEMENT_DELTA=50%`, `VIRAL_MULTIPLIER=5x` (post >5× média + >50 interações).
- **Compara apenas hoje vs ontem** — sem baseline por weekday, sem z-score, sem janela móvel.
- **Estado `insufficient_history` não existe** — se `yesterday` é null, bloco é pulado silenciosamente (`socialSyncRunner.ts:194,201`).
- Consumido em `routinesWorker.ts:268-291` — dispara `fireOrchestration` como intent textual.

### 4.7 Cross-network correlation
**Ausente.** `detectSignificantChange` itera provider isoladamente. Nenhum grep encontrou correlação do MESMO tema entre X + LinkedIn + Instagram.

### 4.8 Signals / alerts
- **Sem sistema formal com severity.**
- O que existe:
  - Sinais viram intent textual pra `fireOrchestration` (`routinesWorker.ts:282-289`), persistidos em `social_sync_log.lastChangeDetected` (JSON).
  - `fraudGuardsRouter.ts` — alertas com estado `confirmed/false_positive`.
  - `partyRouter.ts:829` — alertas com `priority: alta|media|baixa`.
  - Ferramenta IA `publish_war_room_insight` (`src/lib/agentRegistry.ts:30`).

### 4.9 Pulso dos Bairros
- Backend: `POST /api/v1/social/instagram/pulse` — `socialRouter.ts:370-423`.
- Front: `src/components/scenarios/BairroPulse.tsx` (205 linhas).
- Escopo: só Instagram, on-demand, one-shot (não agendado no worker).

---

## 5. Studio, Publisher, Aprovação

### 5.1 Studio
- **Existe:** `src/pages/ContentStudioPage.tsx` (UI) + `src/server/modules/content/contentRouter.ts:108` (API), montado em `/api/v1/content` (`server.ts:341`), protegido por `requireAuth + requireFeature('content_studio') + requireAiBudget`.
- Providers cobertos (só texto/legenda, não postagem): `instagram | tiktok | whatsapp | facebook | twitter | generic` (`contentRouter.ts:27`). `CHANNEL_GUIDANCE` em `contentRouter.ts:33-40`.
- IA gera pautas/legendas via `POST /generate` (`contentRouter.ts:141`); imagem via `POST /generate-image` (`:198`, Gemini nano-banana + fallback OpenAI).

### 5.2 Content pipeline
- **Fluxo formal:** `draft → approved → scheduled → published → archived` (comentário em `contentRouter.ts:1-13`).
- Estados vivem em `content_posts` (§ 3.4). **Não há estado intermediário `pending_review`.** Aprovação salta direto de `draft → approved`.

### 5.3 Publisher (crítico)
- **Backend NÃO posta em rede social.** `POST /:id/publish` (`contentRouter.ts:454-482`) só marca `status='published'` — comentário `contentRouter.ts:11`: "v1 does not auto-post".
- **Grep por `SocialPublisher|publishQueue|postToInstagram|publishToInstagram` = zero resultados.**
- **WhatsApp SIM** tem publisher real: `src/server/modules/channels/channelsRouter.ts:80` (`POST /send`) + `src/server/modules/whatsapp/whatsappRouter.ts` (Evolution). É o único canal com postagem programática.
- Adaptação por rede: só na geração de texto. Aspect ratio/duração não são tratados.

### 5.4 Aprovação humana
- **Não é enforced:** `POST /:id/publish` aceita qualquer status.
- Compliance gate cosmético: `checkCompliance` só rejeita `severity==='error'` (`contentRouter.ts:377-381`) — nenhuma regra emite `error` (todas são `warn`, `:51-82`).
- Aprovação obrigatória real existe no Paperclip queue (`paperclipRouter.ts:29-44`) — `requiresApproval=true` → `awaiting_approval` → `/approve` restrito a `MGMT_ROLES`.

### 5.5 Agendamento
- `POST /:id/schedule` grava `scheduledAt` ISO validado no futuro (`contentRouter.ts:412,420`).
- **Sem worker que efetive** — `routinesWorker` só varre `routine_triggers`, ninguém lê `content_posts.status='scheduled'`. Índice órfão.
- **Timezone da campanha** não é armazenado por post — `scheduledAt` é UTC puro.

### 5.6 Feature flags
- **Não existe tabela `feature_flags` nem `campaign_configs`** (grep = zero).
- Padrão real: `plans.features` (text array) + override por `subscriptions.features`. Enforcement: `src/server/middleware/featureGate.ts:27` `requireFeature('content_studio')`.
- Exemplo real: `20260604000000_create_content_posts.sql:51-63` adiciona `'content_studio'` aos planos `pro` e `enterprise`.
- **Não há flag per-tenant fora do plano** — rollout gradual precisa de tabela nova.

### 5.7 Observabilidade
- `/api/social/health` **ausente**. Só existe `/health` global em `src/server/modules/observability/observabilityRouter.ts:9` — checa `db` + `buildIntegrationHealth()` (`complianceService.ts:120`), lista envs (`Meta`, `OpenAI`, `TikTok`, `Paperclip`). Não olha sync jobs nem token expirado.
- Log: `console.log('[req]', ...)` em `src/server/modules/observability/requestTracer.ts:11`. Sem `pino/winston`. Sync jobs usam `console.error/warn`.
- Sem `prom-client`, sem métricas de queue depth.

### 5.8 Tenant isolation
- RLS em `content_posts`: 4 policies com `get_user_campaign_id_text() OR is_supreme_admin()` (`20260604000000_create_content_posts.sql:33-46`) + `service_role` bypass.
- Backend usa `tenantCampaignId(req)` (`src/server/lib/tenantScope.ts:19`, docstring documenta incidente IDOR anterior).
- **`contentRouter.ts:20` bypassa `tenantCampaignId()`** — usa `campaignIdOf(req)` direto. Inconsistente com `paperclipRouter.ts:26`, `whatsappRouter.ts:19`. Fecha impersonação de supreme admin.

---

## 6. Sinalizações consolidadas para o PRD

1. **`SocialProviderAdapter` não existe.** F1 (Contracts + Capabilities) precisa criar a abstração antes de qualquer migração de provider.
2. **Fantasmas de banco:** `social_metrics_daily`, `social_watchlist`, `social_sync_log`, `agent_runs` — usadas em código, sem migration versionada. **F1 deve formalizar** para permitir reprovisionar/testar.
3. **Anomaly = delta% hoje-vs-ontem.** PRD §44–45 exige baseline por weekday, z-score, `insufficient_history` — reconstrução do zero (mas o "significant change" pode virar um dos detectores do PRD §44 sem apagar).
4. **Zero cross-network correlation** (§46–47) — greenfield.
5. **Zero namespace estrutural no RAG** — extensão aditiva de `knowledge_chunks` (coluna `namespace`/`entity_type`) OU convenção obrigatória em `metadata.provider`, filtragem em RPC.
6. **Nenhum publisher social real** (§68–74) — greenfield. Studio→content_posts existe, falta job runner.
7. **Aprovação humana não enforced.** PRD §70 é violado hoje. Correção precisa fechar `POST /:id/publish` para exigir `status='approved'` **antes** de qualquer publisher novo entrar.
8. **Feature flag per-tenant** (§94) exige tabela nova — o único vetor atual é `plans.features`.
9. **Sem observabilidade por rede** (§86–87). Endpoint `/api/social/health` é premissa do PRD.
10. **Instagram está fora do runner unificado.** Migrar para `InstagramMetaAdapter` sem regressão é PR arriscada — precisa preservar Pulso dos Bairros, watchlist e own-comments.
11. **Scheduler é `setInterval` in-process de instância única.** Escalar para múltiplos providers com quotas independentes (§81, §83, §84) força repensar antes de F6.

---

*Documento gerado em F0 e será revisado antes de cada início de fatia.*
