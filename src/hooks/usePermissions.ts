import * as React from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { Plan, Permissions } from '../types/user';

const defaultPermissions: Permissions = {
    visitLimit: 1000,
    canUseCollaborationTools: false,
    canExportData: false,
    canUseTeamPanels: false,
    canUseAIAdvisor: false,
    canCreateTeams: false,
};

export const usePermissions = (): Permissions => {
  const { user } = useAuth();
  const [campaignPlan, setCampaignPlan] = React.useState<Plan | null>(null);

  React.useEffect(() => {
    let isMounted = true;

    const fetchPlan = async () => {
      if (!user) {
        if (isMounted) setCampaignPlan(null);
        return;
      }

      if (user.type === 'Admin' && user.plan) {
         if (isMounted) setCampaignPlan(user.plan as Plan);
      } else if (user.campaignId) {
         // Buscar plano do admin desta campanha
         try {
           const { data: adminData } = await supabase
             .from('users')
             .select('plan')
             .eq('id', user.campaignId)
             .single();
             
           if (adminData && isMounted) {
             setCampaignPlan(adminData.plan as Plan);
           }
         } catch (error) {
           console.error("Erro ao buscar plano do Admin:", error);
         }
      }
    };

    fetchPlan();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const permissions = React.useMemo((): Permissions => {
    if (!campaignPlan) {
      return defaultPermissions;
    }

    switch (campaignPlan) {
      case Plan.ESSENCIAL:
        return {
          visitLimit: 1000,
          canUseCollaborationTools: false,
          canExportData: false,
          canUseTeamPanels: false,
          canUseAIAdvisor: false,
          canCreateTeams: false,
        };
      case Plan.ESTRATEGICO:
        return {
          visitLimit: 10000,
          canUseCollaborationTools: true,
          canExportData: true,
          canUseTeamPanels: false, 
          canUseAIAdvisor: true,
          canCreateTeams: true,
        };
      case Plan.TOTAL:
        return {
          visitLimit: null,
          canUseCollaborationTools: true,
          canExportData: true,
          canUseTeamPanels: true,
          canUseAIAdvisor: true,
          canCreateTeams: true,
        };
      default:
        return defaultPermissions;
    }
  }, [campaignPlan]);

  return permissions;
};
