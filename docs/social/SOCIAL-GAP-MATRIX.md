# SOCIAL GAP MATRIX (F0 → F1+)

> Entrada: `docs/social/SOCIAL-AS-IS.md` (auditoria do commit `a0ac2ec`).
> Saída: matriz **AS-IS × TO-BE × GAP × dependências × risco × migração** para cada
> capability exigida pelo PRD. Serve de base para dimensionar cada PR e priorizar
> a sequência de fatias.
>
> Convenção de risco: 🟢 baixo · 🟡 médio · 🔴 alto (efeito colateral em produção,
> exige feature flag + rollback claro).
> Convenção de migração: **aditivo** (não quebra código atual) · **ADR** (precisa
> decisão explícita antes) · **greenfield** (nada a preservar).

---

## 0. Bugs bloqueantes achados na auditoria (entram em PR 1)

Antes de F1 seguir, três coisas precisam ser resolvidas ou cobertas por ADR
explícito porque contaminam qualquer fatia futura:

| # | Problema | Onde | Correção proposta | Risco |
|---|---|---|---|---|
| B1 | `social_metrics_daily`, `social_watchlist`, `social_sync_log` — usadas em código, sem migration | `src/lib/socialSyncRunner.ts:132`, `socialRouter.ts:76,333`, `routinesWorker.ts:277` | Escrever migration aditiva reproduzindo o schema atual da produção (introspectar via MCP Supabase antes) | 🟡 se schema real divergir do que o código escreve, dá pra corrigir antes do PR 2 |
| B2 | `agent_runs` — usada em 6 lugares, sem migration, snake_case em prod (avisado em CLAUDE.md), mas `supabase-schema.sql:260` traz `ai_usage` em camelCase | `src/lib/aiCallAgent.ts:486,515,558`, `server.ts:1161` | Migration formal com **snake_case explícito**, sem alterar chamadas existentes; documentar exceção | 🟡 |
| B3 | `POST /api/v1/content/:id/publish` não checa `status='approved'` — viola §70 antes mesmo do Publisher | `src/server/modules/content/contentRouter.ts:454` | Enforce `status='approved'` + feature flag para o fluxo legado por 1 release | 🔴 mudança de comportamento observável — precisa flag |
| B4 | Compliance gate cosmético (nenhuma regra emite `error`) | `contentRouter.ts:51-82,377-381` | Ao menos 1 regra `severity='error'` (ex.: menção a rival com CNPJ) — decidir com produto | 🟡 |
| B5 | `contentRouter.ts:20` bypassa `tenantCampaignId()` | `contentRouter.ts:20` | Trocar para `tenantCampaignId(req)`, alinhando com `paperclipRouter.ts:26` | 🟢 |

**Recomendação:** B1 + B2 entram no PR 1 (Contracts+Capabilities) porque
qualquer novo provider vai bater neles. B3 + B4 + B5 podem virar PR 1½
independente, ANTES do PR 5 (Facebook) — não pode chegar em Publisher (§68)
com esses buracos abertos.

---

## 1. Fase F1 — Social Core (Contracts + Capabilities)

Referência: PRD §10–§16.

| Item | AS-IS | TO-BE | GAP | Dependências | Risco | Migração |
|---|---|---|---|---|---|---|
| Union `SocialProvider` | `type SyncProvider = 'x' \| 'linkedin' \| 'kwai'` em `socialSyncRunner.ts:20` — IG/FB/YT/TT fora | 7 valores (§10) | falta ig/fb/yt/tt/kwai unificado | — | 🟢 | aditivo (novo tipo em `src/server/modules/social/contracts/`) |
| `SocialProviderAdapter` | inexistente | interface do §11 | greenfield | union acima | 🟢 | aditivo |
| `SocialCapabilities` + estados (`supported`, `permission_required`, …) | inexistente | §12–§13 | greenfield | adapter | 🟢 | aditivo |
| `SocialCredentialService` (encrypt/refresh/revoke) | tokens em plaintext em `social_tokens.access_token` (`sql/07_social_integration.sql:2`) | tokens **encrypted at rest**, `getPlain()` só server-side | migration + envelope de criptografia (KMS/env key), backfill | ADR sobre esquema (AES-GCM + `key_version`) | 🔴 credenciais em produção — precisa migration com dupla escrita e switch, sem downtime | ADR + aditivo com `access_token_encrypted`/`refresh_token_encrypted`; drop plaintext depois de N releases |
| `social_connections` (nova) | `social_tokens` cobre só Meta family | `social_connections` (§15) por `campaign_id, provider, external_account_id` | expandir/renomear | crypto + validação tenant | 🔴 renomear tabela quebra `sql/07_social_integration.sql` policy — preferir **manter `social_tokens` e ADD colunas** | ADR: renomear vs expandir — recomendo **expandir** com `providerAccountId`, `handle`, `scopes` jsonb, `status`, `granted_at`, `revoked_at`, `metadata` jsonb; keep old policy |
| Isolamento (`WHERE campaignId=?`) | validado por `tenantCampaignId()` (`tenantScope.ts:19`), mas `contentRouter.ts:20` bypassa (B5) | 100% dos routers usando `tenantCampaignId()` | corrigir 1 arquivo + adicionar teste de regressão | B5 acima | 🟢 | aditivo |
| Capability registry por provider | inexistente | tabela ou constante versionada | mapear cada provider para o `SocialCapabilities` real hoje (Free tier X vs pago, etc.) | leitura de docs Meta/X/LI/YT/TT/Kwai | 🟡 quotas mudam — versionar | aditivo (arquivo `providerCapabilities.ts`) |

**Definition of Done F1:** interface publicada, adapters atuais (X/LI/Kwai) implementam a interface sem mudança de comportamento externo, testes contratuais rodando, migrations B1+B2 aplicadas em staging, endpoint `/api/social/capabilities` retorna a matriz por provider.

---

## 2. Fase F2 — Migração dos providers existentes (X, LinkedIn, Kwai, Instagram)

Referência: §17–§22.

| Provider | AS-IS resumido | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| **X** | maduro (`socialSyncX.ts`, `socialSyncRunner.ts:35`) | `XAdapter implements SocialProviderAdapter` | wrapper preservando 100% do fluxo | 🟢 (mais fácil) | aditivo — mesmo runner chama adapter |
| **LinkedIn** | maduro (`socialSyncLinkedIn.ts`) | `LinkedInAdapter`, `posts` retorna `[]` explícito com `capabilityLevel=limited` | wrapper + preservar `null` (nunca `0`, §20) | 🟢 | aditivo |
| **Kwai** | scraping (`socialSyncKwai.ts`) | `KwaiAdapter` `capabilityLevel=limited` (§21) | wrapper; documentar "unsupported→null" | 🟡 scraping quebra sem aviso — precisa `unknown` state + fallback | aditivo |
| **Instagram** | fora do runner: `instagramGraphClient.ts`, `socialRouter.ts:325-455` (Business Discovery, Pulso, own-comments, watchlist) | `InstagramMetaAdapter` que preserva **Pulso dos Bairros, watchlist, own-comments** intactos | maior GAP: **integrar ao runner unificado sem regressão** | 🔴 se quebrar Pulso ou own-comments, cliente vê | ADR: **NÃO** reescrever — envolver `instagramGraphClient` num adapter; endpoints `/instagram/pulse`, `/watchlist`, `/instagram/own-comments` continuam existindo, adapter só oferece as capabilities equivalentes ao lado |

**Teste de regressão obrigatório (§22):** todos os testes `tests/**` existentes verdes + fixtures de payload real (sanitizado) por provider. Adicionar `tests/social/*.test.ts` novos com contract tests do §11.

---

## 3. Fase F3 — Facebook

Referência: §23–§25.

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| OAuth Meta (compartilhado IG+FB) | paste manual (`SocialConnectionsHub.tsx:117,144`) | Meta OAuth real (App ID + secret, Login for Business, scopes `pages_show_list`, `pages_read_engagement`) | greenfield na UI + backend, mas backend Graph client já existe (`instagramGraphClient.ts`) | 🔴 conta de app Meta precisa de review; scopes exigem verificação | ADR sobre app review; feature flag `social_facebook_enabled` |
| Page profile/posts/comments/reactions/shares | `metaAdLibrary` só lê ADS de outros; `instagramGraphClient` não cobre Page Feed | `FacebookMetaAdapter` reutilizando cliente Meta | novos endpoints Graph API `/{page-id}/feed`, `/{post-id}/comments`, `/{page-id}/insights` | 🟡 quotas Meta Graph 200 chamadas/hora/token — precisa `SocialRateLimitService` (§83) | aditivo (client novo `facebookPageClient.ts` no mesmo módulo `integrations/`) |
| Webhook Facebook | canal IG já reservado no tipo em `webhookRouter.ts:150`; Meta webhook infra existe (só WA hoje) | assinatura + verify_token + processamento | ampliar handler de `/meta` para page events + `feed_change` | 🟡 payload Meta é grande; idempotência por `webhook_events.payloadHash` já modelada | aditivo |
| Sync jobs (`syncProfile/Posts/Comments/Metrics`) | inexistente | 4 jobs no runner unificado | integrar ao `runSocialSync` (que precisa aceitar FB) | 🟢 | aditivo |

---

## 4. Fase F4+F5 — YouTube

Referência: §26–§30.

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| Tudo | ausente (menção em prompts apenas) | 4 componentes (`YouTubeOAuthService`, `YouTubeDataClient`, `YouTubeAnalyticsClient`, `YouTubeAdapter`) | greenfield | 🟡 OAuth Google + escopo `yt-analytics.readonly` requer projeto GCP + verificação | greenfield |
| Analytics API | ausente | watch time, retention, subscribers gained, demographics agregados | greenfield; respeitar disponibilidade real (§30) | 🟡 v2 API tem limites diários por projeto | greenfield |
| Comments (própria) | ausente | próprio pipeline de classify (§29) | greenfield | 🟢 | greenfield |

---

## 5. Fase F5 — TikTok

Referência: §31–§32.

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| OAuth | stub simulado em `server.ts:396-398` + env `TIKTOK_CLIENT_KEY` (`complianceService.ts:125`) | Login Kit real + escopo `user.info.basic`, `video.list` | greenfield backend | 🔴 TikTok exige app review + business account; capabilities publishing bloqueadas até approval | greenfield; feature flag |
| Videos/metrics | ausente | métricas oficialmente disponíveis (§32) | greenfield | 🟡 sem scraping | greenfield |
| **Nunca scraping (§32)** | ok, nada assim hoje | ok | — | — | — |

---

## 6. Fase F6 — Ingestion Engine (dedup, normalização, persistência)

Referência: §33–§37.

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| `SocialIngestionService` | inexistente — código chama `upsert` direto em `social_metrics_daily` (`socialSyncRunner.ts:132`) | serviço único: validação → normalização → dedup → persist → enqueue classify | greenfield | 🟡 refatorar sem quebrar sync atual | aditivo (nova camada por trás do runner) |
| Idempotência por `(campaign_id, provider, external_event_id)` | inexistente para social — só `webhook_events.payloadHash` (`20260518000000_create_audit_logs.sql:45`) | UNIQUE constraint em `social_events` (ou equivalente) | novo índice/tabela | 🟢 | aditivo |
| `social_posts`, `social_comments`, `social_snapshots` | ausentes (só `content_posts` que é publicação) | tabelas normalizadas com `provider, externalId, publishedAt, metrics jsonb, provenance jsonb` (§35–§37) | migration nova | 🟡 volume — pensar retenção (§92) desde o dia 1 | aditivo com camelCase quoted |
| `NormalizedSocialPost` / `Comment` types | inexistente | tipos TS do §35/§36 | greenfield | 🟢 | aditivo |
| `SocialProvenance` obrigatória | inexistente | §37 (owned/public/listening_provider, `dataAvailability`) | greenfield | 🟢 | aditivo (jsonb) |

---

## 7. Fase F7 — Intelligence Engine

Referência: §38–§47, §49.

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| Determinístico → IA (§39) | IA-only inline nos handlers (`socialRouter.ts:403-412,439-448`) | pipeline com estágio determinístico primeiro | greenfield | 🟢 | aditivo |
| Topic classifier | inline IA sem taxonomia fixa | taxonomia §40 + custom | greenfield | 🟢 | aditivo |
| Sentiment | inline IA sem `confidence/model/version` | com metadados + rótulo "Sentimento estimado" (§41–§42) | greenfield | 🟢 | aditivo |
| Trend engine (24h/7d/30d, baseline por weekday) | `detectSignificantChange` só hoje-vs-ontem (`socialSyncRunner.ts:167-229`) | §43–§45 | ampliar sem apagar o atual (renomear em `LegacyDeltaDetector`) | 🟡 dupla contagem de sinais se ambos rodarem — feature flag decide qual dispara alerta | aditivo |
| `insufficient_history` (§45) | ausente | estado explícito | greenfield | 🟢 | aditivo |
| Anomalias (follower spike/drop, viral, negative sentiment) | 3 heurísticas em `detectSignificantChange` | 7 categorias (§44) | expandir | 🟡 | aditivo |
| Cross-network correlator (§46–§47) | ausente | um mesmo tema em 4 redes = 1 sinal | greenfield | 🟢 | aditivo |
| Severity (§49 info/opportunity/attention/risk/critical) | fragmentado (`fraudGuardsRouter` tem só confirmed/false_positive; `partyRouter:829` tem alta/media/baixa) | enum canônico + critérios explícitos para `critical` | greenfield | 🟡 IA marcando tudo como crise é o risco — precisa gate humano para `critical` | aditivo |

---

## 8. Fase F8 — Social Signals

Referência: §48–§49.

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| Barramento de signals | intent textual em `fireOrchestration` (`routinesWorker.ts:282-289`) + `social_sync_log.lastChangeDetected` (JSON) | tabela `social_signals` + emitter compartilhado | greenfield | 🟢 | aditivo — preservar `fireOrchestration` como consumer |
| Reutilizar sistema existente (§48) | `agent_tasks` com `requiresApproval` é o mais próximo | reusar `agent_tasks.type='social:signal'` como fila ou tabela dedicada | ADR: dedicada vs reutilizar | 🟡 se reusar, corremos risco de mistura semântica | ADR obrigatório antes de PR 13 |

---

## 9. Fase F9 — RAG social

Referência: §50–§52.

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| Reuso de `knowledge_chunks` | ok, já indexa `social:x/li/kwai/agent:bairro-pulse` | ok — sem novo RAG | — | 🟢 | — |
| Namespace estrutural (§52) | só string em `source` — RPC filtra apenas `campaignId` (`20260516000002_create_knowledge_chunks.sql:58`) | filtro por namespace na RPC + coluna dedicada ou índice em `source LIKE 'social:%'` | ADR: coluna nova vs GIN em `source` + índice B-tree em prefixo | 🟡 alterar RPC pode afetar buscas legais/TSE | ADR + aditivo (nova RPC `match_knowledge_chunks_ns(namespace text)`) |
| O que indexar (§51 vs "não cada like") | atualmente indexa 1 snapshot por sync (`socialSyncRunner.ts:135-144`) | manter — expandir para daily summary, top posts, crises, anomalias | expandir eventos que chamam `ingestArtifact` | 🟢 | aditivo |

---

## 10. Fase F10 — Pulso Digital

Referência: §53–§59.

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| Página única com header multi-rede | fragmentado: `BairroPulse.tsx` (só IG por bairro), `SocialConnectionsHub` (status de conexão), sem tela unificada de "o que está acontecendo agora" | página `/pulso-digital` conforme §53–§55 | novo route + reutiliza dados dos signals + agrega cross-network | 🟢 | aditivo (não substitui BairroPulse) |
| Drill-down evidências (§58) com proveniência | ausente | UI que mostra posts/comentários/fontes/datas | greenfield | 🟢 | aditivo |
| Botão "Criar conteúdo sobre isso" (§59) | ausente | link para Studio com contexto | greenfield | 🟢 | aditivo (POST no Studio com prefill) |
| Falsa precisão (§57) | risco: linguagem atual em análise IA pode virar % preciso | prompt guardrail + UI que sempre mostra "amostra disponível" | mudar prompts e componentes numéricos | 🟡 | aditivo (mudança de tom, testes de string) |

---

## 11. Fase F11 — External Listening Gateway

Referência: §60–§63.

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| `SocialListeningProvider` interface | inexistente | §60 | greenfield | 🟢 | aditivo |
| Implementações | inexistente | `NullListeningProvider` primeiro, depois POC Meltwater/Brandwatch/Sprout | greenfield | 🟡 custo de licença — só entra depois de decisão comercial | aditivo, atrás de flag `social_listening_enabled` |
| POC (§62) | — | matriz decidindo o fornecedor | processo comercial, não código | 🟢 (decisão fora do repo) | — |

---

## 12. Fase F12 — Studio integration

Referência: §64–§67.

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| `SocialContentBrief` (§65) | Studio recebe input livre (`contentRouter.ts:141`) | tipo estruturado, `sourceReferences` obrigatório | mudar contrato de `POST /generate` (aditivo: campo `brief` novo, opcional) | 🟢 | aditivo com opt-in |
| Conteúdo gerado a partir de insight | não há liga entre signals e Studio | link `social_signal_id → content_brief_id` (§76) | criar tabela `social_content_links` ou coluna em `content_posts` | 🟢 | aditivo |
| Microtargeting proibido (§67) | risco: prompts atuais poderiam ser puxados nesta direção | guardrails no prompt + validação semântica | ampliar `contentRouter.ts:11-13` (system prompt já é TSE-23610) | 🟡 requer curadoria | aditivo |

---

## 13. Fase F13 — Social Publisher

Referência: §68–§74.

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| `SocialPublishingService` | inexistente para social (`POST /:id/publish` só marca flag — `contentRouter.ts:454-482`) | serviço + estados §69 | greenfield | 🔴 postar em conta real do cliente | feature flag por-tenant obrigatória (que hoje não existe — depende §94) |
| Estados `pending_review/approved/scheduled/publishing/published/failed/cancelled` | 5 de 7 existem em `content_posts.status` (`20260604000000_create_content_posts.sql`) — falta `pending_review` e `publishing` | acrescentar 2 estados + tabela `publish_jobs` para retry/dead-letter | migration aditiva CHECK expandido | 🟡 policy `content_posts_status_check` precisa migration | aditivo (drop + recreate CHECK) |
| `requiresHumanApproval=true` (§70) | não enforced (B3) | enforced + auditoria | fechar B3 antes | 🔴 já flagged | ver B3 |
| `SocialContentComposer` (§72) por rede | ausente — Studio só varia texto | biblioteca por rede (aspect ratio, duração, hashtags) | greenfield | 🟡 | aditivo |
| Agendamento com timezone (§73) | `scheduledAt` UTC, sem worker (§ AS-IS 5.5) | novo `publishScheduler` worker + `timezone` por campanha (ou por post) | criar worker + coluna | 🟡 vaporware atual quebra expectativa; nada usa hoje, então OK | aditivo |
| Publication receipt (§74) | inexistente | `publish_receipts` com `external_post_id, permalink, request_id` | tabela nova | 🟢 | aditivo |

---

## 14. Fase F14 — Closed loop

Referência: §75–§79.

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| Correlação signal→content→publish | ausente | §76 (IDs correlacionados) | novas colunas em `content_posts`/`publish_receipts` OU tabela liga | 🟢 | aditivo |
| Performance windows (§77) | métrica só no snapshot diário (`social_metrics_daily`) | 1h/6h/24h/72h/7d por post publicado | novo job + tabela `publish_performance` | 🟡 quota Graph — vale poll ou webhook | aditivo |
| Comparação com baseline (§78) | ausente | por content type / provider / campanha | precisa histórico primeiro | 🟢 | aditivo |

---

## 15. Fase F15 — Background execution / rate limit / circuit breaker

Referência: §80–§85.

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| Jobs listados em §80 | 3 jobs (x/li/kwai `tickSocialSync`, `tickDailyBackup`, `tickManualRuns`) — todos in-process | 12 jobs com prioridades §81 | requer decisão: continuar `setInterval` ou introduzir BullMQ/pg_cron | 🔴 ADR ARQUITETURAL antes de qualquer coisa | ADR obrigatório antes de F15 |
| Webhook-first (§82) | só WhatsApp | signature, timestamp, idempotência já parcialmente cobertos por `webhook_events` | expandir para IG/FB/YT/TT | 🟡 | aditivo |
| `SocialRateLimitService` (§83) | inexistente | por-provider quota tracker | greenfield | 🟡 | aditivo |
| Retry + circuit breaker (§84–§85) | inexistente (só try/catch com console.error) | exponential backoff + jitter + healthy/degraded/open/recovering | greenfield | 🟡 | aditivo |

---

## 16. Fases F* transversais (Observabilidade, Segurança, LGPD)

Referência: §86–§93.

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| `/api/social/health` | ausente (`/health` só global) | por-provider com status | novo endpoint | 🟢 | aditivo |
| Métricas de sync (`sync_success/failure`, `queue_depth`, `last_successful_sync`) | ausente | dashboard admin | greenfield | 🟢 | aditivo |
| OAuth state + PKCE + encrypted creds | X/LI têm PKCE; Meta é plaintext manual | tudo criptografado (§14, §88) | ver F1 crypto | 🔴 já flagged | ADR + rollout com dupla escrita |
| Sanitized logs | `console.log('[req]', ...)` traceId ok (`requestTracer.ts:11`), mas sync jobs logam bruto | filtro de secrets em log | audit + wrapper | 🟢 | aditivo |
| RBAC | políticas por role (`Admin`, `MGMT_ROLES`) | manter, aplicar em novos endpoints | verificar cada PR | 🟢 | aditivo |
| Audit log de eventos sociais (§93) | `audit_logs` já tem schema (`20260518000000_create_audit_logs.sql:3`) | inserir eventos novos (connection_*, sync_*, content_*, publication_*) | usar tabela existente | 🟢 | aditivo |
| LGPD (§89–§92) | política implícita | doc `docs/social/PRIVACY.md` + retenção configurável | greenfield doc + config | 🟡 requer revisão jurídica | aditivo |
| Não inferir dados sensíveis (§91) | risco na saída IA | guardrails no prompt + revisão | curadoria de prompts | 🟡 | aditivo |
| Retenção (§92) | sem política | `raw → aggregate → purge` configurável por tabela | novo job + config | 🟢 | aditivo |

---

## 17. Feature flags e rollout (§94–§96)

| Item | AS-IS | TO-BE | GAP | Risco | Migração |
|---|---|---|---|---|---|
| Flag por-tenant | só `plans.features` (não per-tenant fora do plano) | tabela `feature_flags` OU `campaign_configs.social.*` | greenfield | 🟡 CLAUDE.md diz que "campaign_configs.limits" já existe — investigar antes de criar novo | ADR: reusar `campaign_configs` (se existir) vs tabela nova. **Recomendo reusar** para respeitar convenção `-1 = ilimitado` |
| Rollout gradual (§95) | inexistente formalmente | internal → test → limited → prod, com flag central | processo + flag store | 🟢 | aditivo |

---

## 18. Testes (§97–§103)

| Item | AS-IS | TO-BE | GAP | Migração |
|---|---|---|---|---|
| Unit por adapter/normalizer/dedup/etc. | ~100 testes existentes (`tests/**/*.test.ts`), mas não cobrem social provider especificamente | cobertura por peça do §97 | novos `tests/social/*.test.ts` — mocks controlados | aditivo |
| Contract tests com fixtures reais sanitizadas | ausente | §98 | greenfield | aditivo |
| Integration tests OAuth/refresh/webhook/RAG/publish | ausente | §99 | greenfield | aditivo |
| Security tests (token leak, cross-tenant, forged webhook, replay) | ausente | §100 | greenfield | aditivo |
| Load tests (100k comments, 10k posts, 7 providers) | ausente | §101 | ambiente de perf | fora do repo |
| Failure tests (provider down / token expirado / null values) | ausente | §102–§103 | mocks | aditivo |

---

## 19. Ordem sugerida de PRs (revisada após F0)

O PRD sugere 21 PRs. A auditoria sugere reorganizar assim (justificativa por PR):

1. **PR 0 — Auditoria** (este). ✅
2. **PR 1 — Contracts + Capabilities + Migrations fantasma** — B1 + B2 + `SocialProvider`/`SocialCapabilities`. **Pré-requisito de tudo.**
3. **PR 1½ — Hardening do Content pipeline** — B3 + B4 + B5. Precede qualquer Publisher (§13 depende disto).
4. **PR 2 — CredentialService + criptografia de `social_tokens`.** ADR + dupla escrita. Não avançar F2 sem isto.
5. **PR 3 — X/LinkedIn/Kwai adapters** (wrappers).
6. **PR 4 — Instagram adapter** com preservação de Pulso dos Bairros + own-comments + watchlist. Alto risco → tests contract obrigatórios.
7. **PR 5 — Facebook** (OAuth Meta unificado + Page reads + webhook).
8. **PR 6–7 — YouTube.**
9. **PR 8 — TikTok.**
10. **PR 9 — Ingestion / dedup / normalized tables.**
11. **PR 10–11 — Topic + Sentiment + Trend + Anomaly + `insufficient_history`.**
12. **PR 12 — Cross-network correlator.**
13. **PR 13 — Signals + RAG namespace ADR.**
14. **PR 14–15 — Pulso Digital (backend + UI).**
15. **PR 16 — Listening gateway (Null first).**
16. **PR 17 — Studio integration (`SocialContentBrief`).**
17. **PR 18–19 — Publisher core + provider publishing** (com `requiresHumanApproval` enforced).
18. **PR 20 — Closed loop measurement.**
19. **PR 21 — Hardening: `/api/social/health`, rate limiter, circuit breaker, retention.**

**Nota:** três ADRs precisam de decisão explícita antes de continuar:
- **ADR-01:** `social_tokens` — expandir vs renomear para `social_connections` (recomendação: expandir).
- **ADR-02:** Scheduler — manter `setInterval` in-process ou introduzir BullMQ/pg_cron. Decide entre F6 e F15.
- **ADR-03:** RAG namespace — coluna dedicada vs convenção em `source` com filtro na RPC.

---

## 20. Definition of Done por PR (§111)

Toda fatia precisa entregar:

```
implementation
+ migration (aditiva, idempotente, backward-compatible §96)
+ tests (unit + contract quando aplicável)
+ documentation (atualiza este documento ou docs específico do §112)
+ CI green (`npm test` exit 0, `npx tsc --noEmit -p tsconfig.server.json` limpo, `npx vite build` verde)
+ manual smoke em staging
```

Sem merge em branch gigante. Sem tudo ligado ao mesmo tempo (§95).

---

*Última revisão: F0. Este documento é vivo — cada PR deve marcar sua linha aqui como "done" ou reclassificar risco/dependência.*
