# Backlog de Implementação

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
