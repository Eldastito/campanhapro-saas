# Procedimento de Rotação de Chaves — CampanhaPro

> **Quando rotacionar**: agora (deploy inicial), a cada 90 dias em produção,
> imediatamente após qualquer suspeita de vazamento (commit acidental, ex-funcionário,
> log indevidamente exposto), ou conforme exigência regulatória (LGPD).

> **Risco crítico**: o `SUPABASE_SERVICE_ROLE_KEY` ignora RLS. Vazamento = comprometimento
> total. Rotacione com prioridade máxima.

## Inventário de chaves

| Chave | Onde vive | Bypass RLS? | Impacto se vazar |
|-------|-----------|-------------|------------------|
| `SUPABASE_SERVICE_ROLE_KEY` | server | **SIM** | Total — leitura/escrita cross-tenant |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | server + frontend | Não (RLS aplica) | Limitado pelas policies |
| `INTERNAL_SERVICE_KEY` | server | N/A | Pode invocar rotas service-to-service |
| `META_APP_SECRET` | server | N/A | Forjar webhooks WhatsApp |
| `META_ACCESS_TOKEN` | server | N/A | Enviar mensagens em nome da página |
| `META_WEBHOOK_VERIFY_TOKEN` | server | N/A | Reconfigurar webhook URL |
| `OPENAI_API_KEY` | server | N/A | Custos de IA, leitura de embeddings |
| `GEMINI_API_KEY` | server | N/A | Custos de IA |
| `ANTHROPIC_API_KEY` | server | N/A | Custos de IA |
| `TIKTOK_CLIENT_SECRET` | server | N/A | OAuth TikTok |
| `CAMPANHAPRO_CENARIOS_URL` | server | N/A | Endpoint interno (não é segredo) |

⚠️ **NUNCA** prefixe chaves de IA com `VITE_` — isso as expõe no bundle do frontend.
Apenas `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` podem ser públicas (anon key é projetada para o navegador, RLS protege).

---

## Procedimento padrão (zero downtime)

### 1. Supabase Service Role Key

1. Acesse Supabase Dashboard → Project Settings → API → **Reset service role key**
2. **Antes de revogar** a antiga: configure a nova em todas as instâncias do servidor
3. Reinicie todos os processos de servidor que usam `SUPABASE_SERVICE_ROLE_KEY`
4. Verifique no console: `[Supabase Admin] Inicializado com sucesso`
5. Hit `GET /api/v1/observability/health` — deve retornar `db: true`
6. Apenas então revogue a chave antiga no dashboard

### 2. Supabase Anon Key

Procedimento idêntico, mas é necessário rebuild do frontend para propagar a nova
`VITE_SUPABASE_ANON_KEY`. Faça deploy coordenado do bundle e do servidor.

### 3. Meta App Secret

1. Meta App Dashboard → Settings → Basic → **Show App Secret** → Refresh
2. Atualize `META_APP_SECRET` no servidor e **reinicie** (não há graça period)
3. Imediatamente após o restart, qualquer webhook entregue com a antiga assinatura
   será rejeitado com 403 e gerará evento `webhook.meta.signature_invalid` (severity:critical)
4. Verifique no painel Conformidade → Webhooks que novos eventos chegam com `signature_valid: true`

### 4. Meta Access Token (Page Token)

Tokens de longa duração da Meta expiram em 60 dias. Para rotacionar:

1. Meta Graph API Explorer → gere novo Long-Lived User Token
2. Troque por Long-Lived Page Access Token via:
   `GET /me/accounts?access_token={LL_USER_TOKEN}`
3. Atualize `META_ACCESS_TOKEN` no servidor e reinicie
4. Teste enviando uma mensagem template via `/api/v1/channels/send`

### 5. Meta Webhook Verify Token

1. Gere novo `META_WEBHOOK_VERIFY_TOKEN` (string aleatória ≥ 32 chars):
   `openssl rand -hex 32`
2. Atualize no servidor primeiro, reinicie
3. Meta App Dashboard → WhatsApp → Configuration → Edit Verify Token
4. Meta fará GET no webhook com o novo token; deve retornar 200 com o challenge

### 6. OpenAI / Anthropic / Gemini API Keys

1. No dashboard do provedor, gere nova chave
2. Atualize `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` no servidor
3. Reinicie
4. Imediatamente revogue a chave antiga (não há janela de coexistência necessária —
   o servidor sempre usa a env var atual)
5. Teste o fluxo: dispatch um agent task (Paperclip) que use IA

### 7. INTERNAL_SERVICE_KEY

Token compartilhado entre CampanhaPro ↔ CampanhaProCenarios ↔ Paperclip:

1. Gere: `openssl rand -hex 48`
2. Atualize **simultaneamente** em todos os três serviços
3. Reinicie todos os três
4. Verifique no painel Conformidade → Visão Geral: `Internal Service Auth: Operacional`

---

## Checklist de auditoria pós-rotação

Após **toda** rotação, execute esta verificação:

- [ ] `GET /api/v1/observability/health` retorna 200
- [ ] Painel **Conformidade → Visão Geral** lista todas integrações como `Operacional`
- [ ] Painel **Conformidade → Webhooks** mostra evento recente com `signature_valid: true`
- [ ] Nenhum evento de severidade `critical` na última hora em **Conformidade → Auditoria**
- [ ] CI pipeline (.github/workflows/ci.yml) passou no commit que registrou a rotação
- [ ] Audit log entry criado: `INSERT INTO audit_logs (action, severity, metadata) VALUES ('keys.rotated', 'info', '{"keys": [...]}')`
- [ ] Chaves antigas **revogadas** nos dashboards dos provedores

## Em caso de comprometimento confirmado

1. **Pare tudo**: revogue imediatamente a chave comprometida no dashboard do provedor
2. **Rotacione** a chave seguindo o procedimento acima
3. **Audite**: consulte `audit_logs` para o período em que a chave esteve comprometida
   (filtre por `action ILIKE 'message.send%'`, `action ILIKE 'dossier%'`, etc.)
4. **Notifique** a ANPD em até 72h se houver acesso a dados pessoais (LGPD Art. 48)
5. **Documente** em incidente registrado para auditoria futura

## Não permitido

- Comitar `.env` ou qualquer segredo no Git (use `.env.example` como template)
- Usar a mesma chave em dev + prod
- Compartilhar chaves por canais não-criptografados (Slack DM, email)
- Pular o checklist pós-rotação porque "está com pressa"
- Manter chaves antigas "para garantir" — revogue sempre que rotacionar
