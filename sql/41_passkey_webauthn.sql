-- Passkeys (WebAuthn) — Estratégia B (login passwordless com backend próprio).
-- Credenciais e desafios são geridos pelo backend via service_role; a RLS fica
-- HABILITADA sem policies → nenhum cliente (anon/authenticated) acessa direto,
-- só o service_role (que ignora RLS) no servidor.
--
-- NÃO aplicar em produção até validar o domínio/rp_id e o fluxo em homologação.

create table if not exists public.user_passkey_credentials (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  credential_id text not null unique,           -- base64url do credential ID
  public_key   text not null,                   -- base64url da chave pública (COSE)
  counter      bigint not null default 0,
  transports   text[],
  device_name  text,
  backed_up    boolean,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists idx_passkey_cred_user   on public.user_passkey_credentials(user_id);
create index if not exists idx_passkey_cred_credid on public.user_passkey_credentials(credential_id);
alter table public.user_passkey_credentials enable row level security;

create table if not exists public.webauthn_challenges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  purpose    text not null,                      -- 'register' | 'login'
  challenge  text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_webauthn_chal_challenge on public.webauthn_challenges(challenge);
alter table public.webauthn_challenges enable row level security;

-- Sem isso o PostgREST devolve 404 nas tabelas novas.
notify pgrst, 'reload schema';
