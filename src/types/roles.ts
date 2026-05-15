// Central source of truth for all user roles and profile types in the platform.
// Any new role must be added here first, then propagated to related types/permissions.

export const USER_ROLES = [
  'Admin',
  'Coordenador',
  'Candidato',
  'Líder',
  'Apoiador',
  'Colaborador',
  'Pesquisador',
  'Suporte',
  'Manutenção',
  'blocked',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const TEAM_MEMBER_ROLES = [
  'Coordenador',
  'Líder',
  'Apoiador',
  'Colaborador',
  'Pesquisador',
  'blocked',
] as const;

export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

// Roles that have full administrative access within a campaign
export const ADMIN_ROLES: UserRole[] = ['Admin', 'Coordenador'];

// Roles that can be assigned to field team members
export const FIELD_ROLES: UserRole[] = ['Líder', 'Apoiador', 'Colaborador', 'Pesquisador'];

// Roles that receive dedicated pages instead of CampaignWebApp
export const DEDICATED_PAGE_ROLES: UserRole[] = ['Candidato', 'Suporte', 'Manutenção', 'blocked'];
