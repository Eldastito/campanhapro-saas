/**
 * Endpoints de status do plano da campanha — usados pelo frontend para:
 *   - Mostrar cadeados nos botões pagos.
 *   - Renderizar contadores ("12/100 disparos hoje").
 *   - Disparar o trial 24h de IA quando bate 300 leads.
 *   - Banner de upgrade contextual.
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

const TRIAL_HOURS = 24;
const TRIAL_LEAD_THRESHOLD = 300;

export function createPlanStatusRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // GET /api/v1/plan/status — devolve plano atual, cotas usadas/limites e trial.
  router.get('/status', async (req: Request, res: Response) => {
    const cid = (req as any).user?.campaignId;
    if (!cid) return res.status(400).json({ error: 'sem_campanha' });

    const { data: cfg } = await supabase.from('campaign_configs')
      .select('"planTier", features, limits, "aiTrialUntil", "aiTrialUsed", "aiTrialStartedAt"')
      .eq('id', cid).maybeSingle();
    if (!cfg) return res.status(404).json({ error: 'sem_config' });

    // Contagens de uso
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const [waToday, formsActive, leads] = await Promise.all([
      supabase.from('blast_recipients').select('id', { count: 'exact', head: true })
        .eq('campaignId', cid).gte('createdAt', start.toISOString()),
      supabase.from('forms').select('id', { count: 'exact', head: true })
        .eq('campaignId', cid).or('status.eq.active,active.eq.true'),
      supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('campaignId', cid),
    ]);

    const trialUntil = (cfg as any).aiTrialUntil ? new Date((cfg as any).aiTrialUntil).getTime() : 0;
    const trialActive = trialUntil > Date.now();
    const trialEligible = !trialUntil && (leads.count || 0) >= TRIAL_LEAD_THRESHOLD;

    return res.json({
      planTier: (cfg as any).planTier,
      features: (cfg as any).features || [],
      limits: (cfg as any).limits || {},
      usage: {
        whatsappToday: waToday.count || 0,
        formsActive: formsActive.count || 0,
        leads: leads.count || 0,
      },
      trial: {
        active: trialActive,
        used: (cfg as any).aiTrialUsed || 0,
        until: (cfg as any).aiTrialUntil,
        startedAt: (cfg as any).aiTrialStartedAt,
        eligible: trialEligible,
        leadsThreshold: TRIAL_LEAD_THRESHOLD,
        leadsCount: leads.count || 0,
      },
    });
  });

  // POST /api/v1/plan/activate-ai-trial — coordenador clica para iniciar o trial 24h.
  // Pré-requisitos: plano grátis, ≥ 300 leads, trial nunca usado.
  // (regra "até 30 dias antes da eleição" entra como guarda quando tivermos a data
  // da eleição em campaign_configs — anotado como follow-up #98.)
  router.post('/activate-ai-trial', async (req: Request, res: Response) => {
    const cid = (req as any).user?.campaignId;
    if (!cid) return res.status(400).json({ error: 'sem_campanha' });

    const { data: cfg } = await supabase.from('campaign_configs')
      .select('"planTier", "aiTrialUntil", "aiTrialStartedAt"').eq('id', cid).maybeSingle();
    if (!cfg) return res.status(404).json({ error: 'sem_config' });
    if ((cfg as any).planTier !== 'gratis') {
      return res.status(409).json({ error: 'plano_pago', message: 'Pagantes já têm IA liberada.' });
    }
    if ((cfg as any).aiTrialStartedAt) {
      return res.status(409).json({ error: 'trial_ja_usado', message: 'Você já usou seu trial de IA.' });
    }
    const { count: leads } = await supabase.from('contacts')
      .select('id', { count: 'exact', head: true }).eq('campaignId', cid);
    if ((leads || 0) < TRIAL_LEAD_THRESHOLD) {
      return res.status(409).json({
        error: 'leads_insuficientes',
        message: `Cadastre ${TRIAL_LEAD_THRESHOLD} eleitores para liberar o trial. Você tem ${leads || 0}.`,
        leads: leads || 0, threshold: TRIAL_LEAD_THRESHOLD,
      });
    }
    const now = new Date();
    const until = new Date(now.getTime() + TRIAL_HOURS * 60 * 60 * 1000);
    await supabase.from('campaign_configs').update({
      aiTrialStartedAt: now.toISOString(),
      aiTrialUntil: until.toISOString(),
      aiTrialUsed: 0,
    }).eq('id', cid);

    return res.json({ ok: true, until: until.toISOString(), hours: TRIAL_HOURS });
  });

  return router;
}
