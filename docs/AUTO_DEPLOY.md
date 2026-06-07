# Auto-deploy (GitHub → Coolify)

Todo `git push` na branch `main` dispara um deploy automático no Coolify
via **Manual Git Webhook**.

- **Webhook (GitHub → Settings → Webhooks):**
  `https://coolify.tesseractauto.com.br/webhooks/source/github/events/manual`
  - Content type: `application/json`
  - Events: push
  - Secret: configurado no Coolify (App → Webhooks → GitHub Webhook Secret)

- **Conferir entregas:** GitHub → Settings → Webhooks → Recent Deliveries (deve dar 200).
- **Conferir deploy:** Coolify → aplicação → Deployments.

> Não é mais necessário clicar em "Redeploy" manualmente a cada commit.
