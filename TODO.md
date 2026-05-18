# Backlog de Implementação

## Na fila

### Aba de Reunião de Planejamento — Gravação + Ata + IA
**Solicitado:** maio/2026
**Prioridade:** Alta

Casos de uso:
1. Coordenador abre a aba antes da reunião → IA gera automaticamente os temas a discutir com base nos dados da campanha (metas, despesas, pendências, cronograma eleitoral)
2. Durante a reunião: microfone no browser grava o áudio em tempo real
3. Ao finalizar: áudio é transcrito → ata gerada automaticamente
4. IA analisa a ata + contexto da campanha e produz:
   - Resumo executivo da reunião
   - Lista de ações sugeridas (assignee, prazo, bucket relacionado)
   - Alertas / pontos de atenção

Fluxo de telas:
- **Pré-reunião**: card "Pauta Sugerida pela IA" com tópicos gerados a partir do DB (metas atrasadas, orçamento alocado vs gasto, próximos eventos, alertas do CEO)
- **Durante reunião**: botão Gravar (MediaRecorder API) + cronômetro; indicador visual de gravação ativa
- **Pós-reunião**: ata em texto editável → botão "Gerar Resumo & Ações" → card com resumo + checklist de ações sugeridas (podem ser aprovadas e virar `agent_tasks`)

Implementação técnica:
- Frontend: `MediaRecorder` API (browser nativo, sem extensão) → chunks de áudio enviados ao backend
- Backend: `POST /api/v1/meetings/transcribe` → chama Whisper (OpenAI) ou equivalente para transcrição
- Backend: `POST /api/v1/meetings/analyze` → agente 'manager' recebe ata + contexto da campanha (budget summary, goals, expenses) e retorna `{ summary, actions[] }`
- Ações aprovadas viram registros em `agent_tasks` (tipo `meeting-action`) via `enqueueTask`
- Atas e gravações armazenadas em tabela `meeting_records` (campaignId, date, transcript, summary, actions jsonb)
- Feature guard: `requireFeature(supabase, 'meetings')` — adicionar ao plano Pro+

Considerações técnicas:
- `MediaRecorder` gera WebM/Opus — compatível com Whisper diretamente
- Chunked upload para evitar timeout em reuniões longas (>30 min)
- Transcrição pode ser assíncrona (Paperclip task `meeting-transcription`)
- LGPD: avisar participantes sobre gravação; armazenar apenas com consentimento explícito do operador

Tabela nova necessária: `meeting_records`
```sql
CREATE TABLE meeting_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" text NOT NULL,
  title text,
  "scheduledAt" timestamptz,
  "recordedAt" timestamptz,
  duration int, -- segundos
  transcript text,
  summary text,
  actions jsonb, -- array de { title, assignee, dueDate, bucket }
  status text DEFAULT 'draft', -- draft | transcribed | analyzed
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now()
);
```

---

## Adiado (requer infraestrutura específica)

### Automação WhatsApp Web — disparo sequencial para base eleitoral
**Solicitado:** maio/2026

Casos de uso:
1. **CRM**: quando a IA gera mensagem para cada contato, disparar automaticamente via WhatsApp
2. **Colinha Digital**: mesma lógica — mensagem personalizada por eleitor

Fluxo desejado:
- Abrir WhatsApp Web (sessão do usuário autenticada)
- Selecionar contato pelo número
- Colar e enviar a mensagem
- Pular para o próximo contato
- Loop até o último eleitor cadastrado na base da campanha

Implementação possível:
- Extensão de browser (Chrome/Edge) que automatiza o WhatsApp Web DOM
- OU: rotina Paperclip que dispara para serviço headless (Puppeteer/Playwright) no servidor
- Os dois casos se resolvem com a mesma rotina genérica:
  `routine: "whatsapp-mass-send"` com parâmetros `(contactsQuery, messageTemplate)`

Considerações de risco:
- WhatsApp Web bloqueia automação detectada → respeitar delays (60-120s entre msgs)
- LGPD: confirmar `consent_records.consentType = 'electoral_marketing'` antes de cada envio
- Cap diário por número (evitar ban): ~200 msgs/dia/número
