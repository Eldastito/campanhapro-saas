-- =============================================
-- PARTE 20: Reorganização de Perfis
-- Adiciona perfil 'Coordenador' às constraints de tipo
-- IDEMPOTENTE — pode rodar múltiplas vezes
-- =============================================

-- 1. Atualizar constraint da tabela users
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_type_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_type_check
  CHECK (
    type IN (
      'Admin',
      'Coordenador',
      'Candidato',
      'Líder',
      'Apoiador',
      'Colaborador',
      'Pesquisador',
      'Suporte',
      'Manutenção',
      'blocked'
    )
  );

-- 2. Atualizar constraint da tabela team_members
ALTER TABLE public.team_members
  DROP CONSTRAINT IF EXISTS team_members_role_check;

ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_role_check
  CHECK (
    role IN (
      'Coordenador',
      'Líder',
      'Apoiador',
      'Colaborador',
      'Pesquisador',
      'blocked'
    )
  );

-- 3. Comentário pra histórico
COMMENT ON CONSTRAINT users_type_check ON public.users IS
  'Adicionado Coordenador em 2026-05 (PRD reorganização perfis)';
