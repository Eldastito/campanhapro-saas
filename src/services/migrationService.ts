import { supabase } from '../lib/supabaseClient';
import { LOCAL_STORAGE_KEYS } from '../constants';

export interface MigrationSummary {
  visits: number;
  team: number;
  financial: number;
  settings: number;
}

/**
 * Service to migrate data from LocalStorage to Supabase
 */
export const migrateLocalToSupabase = async (campaignId: string): Promise<MigrationSummary> => {
  const summary: MigrationSummary = {
    visits: 0,
    team: 0,
    financial: 0,
    settings: 0
  };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuário não autenticado");

  // 1. Migrate Visits
  const localVisits = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEYS.VISITS) || '[]');
  if (localVisits.length > 0) {
    const visits = localVisits.map((visit: any) => ({
        ...visit,
        campaignId,
        createdBy: user.id,
        migrated: true,
        updatedAt: new Date().toISOString()
    }));
    await supabase.from('visits').upsert(visits);
    summary.visits = visits.length;
  }

  // 2. Migrate Engagement Actions
  const localEngagement = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEYS.ENGAGEMENT_ACTIONS) || '[]');
  if (localEngagement.length > 0) {
    const engagements = localEngagement.map((action: any) => ({
        ...action,
        campaignId,
        createdBy: user.id,
        migrated: true,
        updatedAt: new Date().toISOString()
    }));
    await supabase.from('engagement_actions').upsert(engagements);
  }

  // 3. Migrate Team Members
  const localTeam = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEYS.TEAM_MEMBERS) || '[]');
  if (localTeam.length > 0) {
    const team = localTeam.map((member: any) => ({
        ...member,
        campaignId,
        addedBy: user.id,
        migrated: true,
        updatedAt: new Date().toISOString()
    }));
    await supabase.from('team_members').upsert(team);
    summary.team = team.length;
  }

  // 4. Migrate Financial (Incomes/Expenses)
  const localIncomes = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEYS.INCOMES) || '[]');
  const localExpenses = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEYS.EXPENSES) || '[]');
  
  if (localIncomes.length > 0) {
    await supabase.from('incomes').upsert(localIncomes.map((item: any) => ({ ...item, campaignId, migrated: true })));
    summary.financial += localIncomes.length;
  }
  
  if (localExpenses.length > 0) {
    await supabase.from('expenses').upsert(localExpenses.map((item: any) => ({ ...item, campaignId, migrated: true })));
    summary.financial += localExpenses.length;
  }

  // 5. Migrate Campaign Settings
  const campaignDetails = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEYS.CAMPAIGN_DETAILS) || '{}');
  if (Object.keys(campaignDetails).length > 0) {
    await supabase.from('settings').upsert({
      campaignId,
      key: 'config',
      value: campaignDetails,
      updatedAt: new Date().toISOString(),
      migrated: true
    }, { onConflict: 'campaignId,key' });
    summary.settings++;
  }
  
  return summary;
};

/**
 * Checks if there is any data to migrate
 */
export const hasDataToMigrate = (): boolean => {
  const keysToCheck = [
    LOCAL_STORAGE_KEYS.VISITS,
    LOCAL_STORAGE_KEYS.TEAM_MEMBERS,
    LOCAL_STORAGE_KEYS.INCOMES,
    LOCAL_STORAGE_KEYS.EXPENSES,
    LOCAL_STORAGE_KEYS.CAMPAIGN_DETAILS
  ];

  for (const key of keysToCheck) {
    const data = localStorage.getItem(key);
    if (data && data !== '[]' && data !== '{}') {
      return true;
    }
  }
  return false;
};
