# Dashboard Data Map (Campanha Pró)

Este documento mapeia os componentes do Dashboard para suas respectivas tabelas no banco de dados e APIs externas.

## 1. KPIs Principais (`KpiGrid.tsx`)
- **Tabela Origem:** `visits` (Contexto: `VisitsContext`) e `engagement_actions`.
- **Lógica:** Processado pelo hook `useDashboardMetrics.ts`.
- **Indicadores:**
  - **Visitas Realizadas / Pendentes:** Filtra `visits` por `realizada = 'sim'` ou `'nao'`.
  - **Votos Comprometidos:** Soma do campo `votos` na tabela `visits`.
  - **Média de Votos:** `votos / realizadas`.
  - **Apoiadores Ativos:** Apoiadores únicos (campo `apoiador` em `visits`) nos últimos 7 dias.
  - **Total de Abordagens:** Contagem em `engagement_actions` onde `tipo = 'Abordagem Rápida'`.
  - **Materiais Distribuídos:** Soma de `material_distribuido` em `engagement_actions`.

## 2. Cenário Atual e Calculadora
- **Tabela Origem:** `scenarios` e `campaign_configs` (estado salvo no `CalculatorContext`).
- **Mapeamento:** O status é derivado da média de votos (`avgVotos`) cruzada com os cenários simulados.

## 3. Consultor de IA (`CampaignAdvisor.tsx`)
- **API Externa:** Supabase Edge Functions / Node.js Backend (`server.ts`).
- **Modelo:** Gemini (Google).
- **Mapeamento de Erro:** Em caso de indisponibilidade ou ausência da `GEMINI_API_KEY`, o frontend exibirá a mensagem padrão offline.

## 4. Sala de Guerra (`WarRoomFeed.tsx`)
- **Tabela Origem:** `war_room_intelligence`.
- **Comportamento:** Escuta inserções em tempo real via `supabase.channel('war-room-realtime')`.

## 5. Pesquisas (`PesquisaChart.tsx`)
- **Tabela Origem:** `pesquisas`.
- **Lógica:** Carrega os últimos 100 registros e exibe a evolução temporal por data.

## 6. Colinha Digital (`DigitalColinha.tsx`)
- **Tabela Origem:** `settings` (`campaignDetails`).
- **Mapeamento:** Permite exportação PNG ou via `navigator.share`. Não manipula tabela de visitas, é uma ferramenta de engajamento passivo.

## Considerações de Segurança (RLS)
Todas as tabelas possuem Row Level Security ativado, validando a integridade da leitura pela checagem de `"campaignId" = auth.uid()` ou pelo vínculo na tabela `users`.
