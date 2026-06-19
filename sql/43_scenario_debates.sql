-- Debates de Cenário por IA (estilo MiroFish): simulação multi-agente onde
-- personas geradas por IA debatem um cenário e a opinião evolui por turnos.
-- Persistimos personas + transcript + relatório pra aparecer no Histórico e
-- permitir reabrir/continuar. Acesso só pelo backend (service_role), igual às
-- outras tabelas de Cenários (RLS on, sem policy).

create table if not exists public.scenario_debates (
  id          uuid primary key default gen_random_uuid(),
  "campaignId" uuid not null,
  label       text,
  scenario    text not null,           -- a "semente" (acontecimento) em texto
  agents      jsonb not null default '[]'::jsonb,  -- [{id,label,type,persona,...}]
  transcript  jsonb not null default '[]'::jsonb,  -- [{turn, agents:[{id,utterance,opinion}]}]
  report      text,                     -- relatório final do agente relator
  turns       integer not null default 0,
  "createdAt" timestamptz not null default now()
);
create index if not exists idx_scenario_debates_campaign
  on public.scenario_debates("campaignId", "createdAt" desc);
alter table public.scenario_debates enable row level security;

notify pgrst, 'reload schema';
