---
name: ship
description: Roda typecheck do servidor + build de produção, commita no padrão CampanhaPro e dá push pra main (Coolify auto-deploya em ~2min). Use quando o trabalho está pronto pra subir.
---

# /ship — Deploy CampanhaPro SaaS

Execute na ordem abaixo. **Pare em qualquer falha** — nunca "siga ignorando".

## 1. Server typecheck (gate duro)

```bash
npx tsc --noEmit -p tsconfig.server.json
```

`exit != 0` → mostre o erro e pergunte ao usuário como prosseguir. NÃO tente contornar.

## 2. Build de produção (gate duro)

```bash
npx vite build
```

`exit != 0` → bloqueia. Avisos `TS6133` (unused vars/imports) em arquivos **pré-existentes** são conhecidos e NÃO bloqueiam — o build segue até `✓ built in Xs` mesmo assim.

## 3. Commit

- Se não houver mudanças staged nem unstaged: pular pro push.
- Caso contrário: faça `git add` **somente dos arquivos do trabalho atual**. NUNCA `git add .` nem `-A` — pode pegar `.env` ou artefatos.
- Mensagem em **Conventional Commits**, em português:
  - **Título** ≤ 70 chars: `feat(módulo): ...`, `fix(módulo): ...`, `docs: ...`, `refactor(módulo): ...`.
  - **Corpo** explica o **PORQUÊ** (incidente, constraint, motivação) — não o que o diff já diz. Se for fix de bug em produção, cite a evidência (linha de log, tabela inspecionada).
  - **Rodapé:** `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Passe a mensagem via HEREDOC pra preservar formatação:
  ```bash
  git commit -m "$(cat <<'EOF'
  feat(escopo): título curto

  Por que essa mudança existe. Citar o bug/incidente se aplicável.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## 4. Push

```bash
git push origin main
```

Avise: **"Deploy disparado (`<hash>`) — Coolify reinicia em ~2 min."**

## 5. Smoke pós-deploy (condicional)

Só se a mudança tocou **WhatsApp, IA, webhook, callcenter ou auth**:

- **NÃO** rode a app localmente — não temos staging.
- Espere o usuário testar.
- Se ele relatar problema, inspecione direto via MCP `mcp__8db72b43-4a70-42b7-aba2-c8d321559a17__execute_sql` (project_id: `clfivmzwjydtmqobzxzb`). Tabelas onde a verdade mora:
  - `channel_messages` (mensagens trafegadas)
  - `webhook_events` (entrada do Evolution)
  - `agent_runs` (chamadas de IA + erro)
  - `active_campaign_targets` (telemarketing ativo)

## Anti-padrões (NÃO faça)

- ❌ `npm start` / `npm run dev` localmente — não usamos esse caminho.
- ❌ Ignorar erro do server tsc "porque é só um warning".
- ❌ `git add .` ou `git add -A` sem revisar — pode vazar segredo.
- ❌ `git commit --amend` em commit já pushed.
- ❌ Usar o MCP `mcp__supabase__*` — aponta pro banco antigo `jvmtcsxoxgzepslxqtdy` (descomissionado).
- ❌ `--no-verify` ou skip de hooks.
