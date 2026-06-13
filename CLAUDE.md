# CampanhaPro SaaS

Política curta: só anote aqui o que **já mordeu a gente** neste repo. Conselho genérico não entra — vira ruído no contexto.

## Module System

This is an ESM project (`"type": "module"` in `package.json`) — always use `import` / `export` syntax, never CommonJS `require()` or `module.exports`. Verify any generated or sub-agent code does not introduce `require()` calls before declaring done.

## Database (Supabase)

- **Projeto ativo:** `clfivmzwjydtmqobzxzb`. Acessar SEMPRE pelo MCP `mcp__8db72b43-4a70-42b7-aba2-c8d321559a17__*` (passe `project_id: "clfivmzwjydtmqobzxzb"`).
- **NÃO use `mcp__supabase__*`** — aponta para o banco antigo (`jvmtcsxoxgzepslxqtdy`) que foi descomissionado. Já tropeçamos aqui antes.
- **Colunas em camelCase com aspas duplas.** Ex.: `"campaignId"`, `"createdAt"`, `"voterBotEnabled"`. SQL sem aspas em camelCase falha.
- **Tabelas que NÃO seguem o padrão:** `ai_usage`/`agent_runs` usam snake_case nas colunas (`created_at`, `campaign_id`). Se uma query der erro de coluna inexistente, descubra com `information_schema.columns` antes de chutar.
- **Após DDL** (CREATE TABLE/ALTER), inclua `NOTIFY pgrst, 'reload schema';` no fim da migration — sem isso o PostgREST devolve 404 nas colunas novas.
- **Funções SQL existentes** que o backend chama: `get_user_campaign_id_text()`, `is_supreme_admin()`, `get_president_party_id()`. Use nas policies RLS de novas tabelas.

## Realtime

- **Use Broadcast, não `postgres_changes`.** A maioria dos clientes precisa de eventos em tabelas com RLS, e `postgres_changes` respeita RLS → não dispara para o cliente anônimo. Backend faz `POST ${SUPABASE_URL}/realtime/v1/api/broadcast` com a service key; cliente assina `supabase.channel('<topic>').on('broadcast', ...)`.
- **DataProvider já existe no `CampaignWebApp`** — NÃO aninhe outro. Duas inscrições no mesmo canal crasham com `cannot add postgres_changes after subscribe()`.

## Plano / cotas (`campaign_configs.limits`)

- **`-1` = ilimitado** (convenção do projeto). Já causou bug: o quotaEnforcer lia `0 >= -1` como cota esgotada e bloqueava 100% das chamadas. Qualquer comparação de cota precisa de `if (limit < 0 || limit >= 999999) return ok;` antes do `>=`.

## WhatsApp / Evolution GO

- O **Evolution GO (whatsmeow)** difere do Evolution v2 (Node). Pontos que já quebraram:
  - **Metadados em `data.Info`** (PascalCase: `Sender`/`Chat`/`IsFromMe`/`PushName`), não em `data.Key`.
  - **`sendText`/`getStatus`/`setWebhook`** usam o **token da instância** primeiro; a `EVOLUTION_GLOBAL_API_KEY` é fallback (o helper `callWithKeys` faz isso).
  - Webhook do GO não aceita headers customizados — secret vai como `?secret=` na URL.

## Deploy & Build

- **Deploy = `git push origin main`.** Coolify reinicia a app sozinho em ~2 min (webhook GitHub→Coolify). Não há staging.
- **Build:** `npx vite build` (esbuild — tolera unused-var). Erros pré-existentes de `TS6133` no `tsc --noEmit -p tsconfig.json` são conhecidos e NÃO bloqueiam o build de produção; ignorar.
- **Server typecheck:** `npx tsc --noEmit -p tsconfig.server.json` — esse SIM tem que ficar limpo. Rodar antes de commit em mudanças no servidor.
- **Testes:** `npm test` (node `--test` nativo sobre `tests/**/*.test.ts`, ~100 testes — billing, isolation, onboarding, asaas, monteCarlo, lifecycle). Tem que terminar com exit 0. Se um teste for bit-rot (passa em prod mas mock dessincronizado), marcar `test.skip` com TODO claro e abrir tarefa de revisão.
- **Pronto pra ship:** `npm test` exit 0 + server tsc verde + `vite build` exit 0. O skill `/ship` orquestra esses três.

## Conventions

- **Comentários em português** quando explicam *por que* a regra existe (incidente, constraint legal, edge case do GO etc.). Identificadores e logs em inglês.
- **Não criar arquivos `.md` novos** salvo quando o usuário pedir. Idem screenshots/storyboards — só sob demanda.
- **Mudanças de assinatura / remoção de símbolo:** antes de aplicar, faça grep de TODOS os call sites (incluindo SQL, JSON e config quando fizer sentido) e **mostre a lista no chat** para o usuário ver com os olhos. Só depois mude. Vale também pra renomear endpoints (frontend chama por string).
