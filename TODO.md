# Backlog de Implementação

## Entregue

### ✅ Aba de Reunião de Planejamento — Gravação + Ata + IA
**Entregue:** maio/2026 (PR #23)

- `MediaRecorder` + chunked upload
- Whisper para transcrição (`POST /api/v1/meetings/:id/transcribe`, limite 25MB)
- Análise via agente `manager`: resumo + lista de ações sugeridas (`POST /:id/analyze`)
- Ações aprovadas viram `agent_tasks` via `enqueueTask`
- Tabela `meeting_records` com RLS por `campaign_profiles`
- Feature guard: `requireFeature(supabase, 'meetings')`

### ✅ Disparos WhatsApp — CRM CSV import + mass-send
**Entregue:** maio/2026 (PR #24)

- Importação CSV de contatos para CRM
- Disparo sequencial via Evolution API (mesma infra do Omnichannel multi-número)
- Rate limiting: respeitar delays + cap diário por número
- Tabela `whatsapp_blasts` com RLS por `campaign_profiles`
- Feature guard: `requireFeature(supabase, 'whatsapp_omnichannel')`
- Verifica `consent_records.consentType = 'electoral_marketing'` antes de enviar

### ✅ Estúdio de Conteúdo — Posts gerados por IA
**Entregue:** maio/2026 (PR #24)

- Geração de posts para IG / TikTok / WhatsApp / Facebook / X
- Tabela `content_posts` com RLS por `campaign_profiles`
- Compliance checker (warnings advisórios)
- Feature guard: `requireFeature(supabase, 'content_studio')` + `requireAiBudget`

---

## Na fila

_(vazio — definir próxima prioridade)_

---

## Adiado (requer infraestrutura específica)

_(nenhum item adiado no momento)_
