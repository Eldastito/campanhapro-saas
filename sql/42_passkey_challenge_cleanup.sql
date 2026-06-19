-- Limpeza dos desafios WebAuthn (Estratégia B).
-- webauthn_challenges acumula linhas de uso único (TTL 5min) — usadas ou expiradas
-- viram lixo. Um job pg_cron horário apaga o que já passou (com folga de 1h),
-- mantendo a tabela enxuta sem tocar no hot path de login/cadastro.

create extension if not exists pg_cron;

create or replace function public.cleanup_webauthn_challenges()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.webauthn_challenges
  where expires_at < now() - interval '1 hour';
$$;

-- cron.schedule é idempotente por jobname (re-rodar a migração só atualiza).
select cron.schedule(
  'cleanup-webauthn-challenges',
  '17 * * * *',
  $$select public.cleanup_webauthn_challenges();$$
);

notify pgrst, 'reload schema';
