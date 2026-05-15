# Arquitetura CampanhaPro

Este documento define as leis fundamentais do desenvolvimento deste ecossistema.

## 1. Convenção de nomenclatura

| Camada | Padrão | Exemplos |
|---|---|---|
| **Banco de dados** (colunas, tabelas, funções, policies) | `snake_case` | `campaign_id`, `created_at`, `voter_journey`, `get_user_campaign_id()` |
| **Código TypeScript/React** (variáveis, props, chaves de objetos JS) | `camelCase` | `campaignId`, `createdAt`, `voterJourney` |
| **JSON em rotas REST** | `camelCase` na request/response do front; o tradutor abaixo cuida da conversão | — |

A ponte é o **Proxy do `supabase` client** em `src/lib/supabaseClient.ts`, que intercepta `.from()`, `.eq()`, `.insert()`, `.select()`, etc., e traduz automaticamente:
- Chaves do payload e nomes de colunas em filtros: `camelCase → snake_case` antes de mandar pro PostgREST.
- Chaves da resposta: `snake_case → camelCase` antes de devolver pro código.

**Atenção**: o Proxy só atua via `import { supabase } from '...supabaseClient'`. O `supabaseAdmin` (server.ts, com `SERVICE_ROLE_KEY`) e o `rawSupabase` exportado **não têm tradução** — neles use `snake_case` literal nas queries.

## 2. Fluxo de Dados (War Room)
Qualquer insight gerado por um agente deve ser publicado na tabela `war_room_intelligence` para que outros agentes possam reagir em tempo real.

## 3. Compliance IA
Todo conteúdo gerado por IA deve ser sinalizado na resposta final e logado na tabela `ai_compliance_logs` para auditoria.

## 4. Deploy e CI/CD
*   **Aplicação (Vite/Node)**: Deploy automático via Easypanel ao push na `main`.
*   **Edge Functions**: Deploy automático via GitHub Actions (ver `.github/workflows`).
