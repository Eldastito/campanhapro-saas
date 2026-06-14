/**
 * Config + auditoria do roteador 2-IAs WhatsApp (#125).
 *
 * Endpoints:
 *  - GET  /api/v1/whatsapp-routing/config   → lê configs da campanha
 *  - PUT  /api/v1/whatsapp-routing/config   → atualiza (admin only)
 *  - GET  /api/v1/whatsapp-routing/log      → últimas decisões (admin only)
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

function isAdmin(req: Request): boolean {
  // CUIDADO: o authMiddleware injeta `userType` (não `type`). Errar isso fazia
  // TODOS os usuários receberem admin_required, inclusive o dono da campanha.
  const t = (req as any).user?.userType;
  return t === 'Admin' || t === 'Coordenador' || t === 'Líder' || t === 'Candidato' || (req as any).user?.isSupremeAdmin === true;
}

export function createWhatsappRoutingRouter(supabase: SupabaseClient): Router {
  const router = Router();

  router.get('/config', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    const { data, error } = await supabase
      .from('campaign_configs')
      .select(
        'whatsappRoutingEnabled, voterAgentName, voterAgentTopics, ' +
        'orchestratorWakeWord, orchestratorAuthorizedPhones, ' +
        'zapflowWakeWord, zapflowForwardUrl, zapflowForwardSecret',
      )
      .eq('id', campaignId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    const r = (data || {}) as any;
    return res.json({
      enabled: !!r.whatsappRoutingEnabled,
      voterAgentName: r.voterAgentName ?? 'Aurora',
      voterAgentTopics: Array.isArray(r.voterAgentTopics) ? r.voterAgentTopics : [],
      orchestratorWakeWord: r.orchestratorWakeWord ?? null,
      orchestratorAuthorizedPhones: Array.isArray(r.orchestratorAuthorizedPhones)
        ? r.orchestratorAuthorizedPhones : [],
      zapflowWakeWord: r.zapflowWakeWord ?? 'Zapp',
      zapflowForwardUrl: r.zapflowForwardUrl ?? null,
      // Segredo: só devolve se está setado (sem expor o valor)
      zapflowForwardSecretSet: !!r.zapflowForwardSecret,
    });
  });

  router.put('/config', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

    const b = req.body || {};
    const update: Record<string, any> = { updatedAt: new Date().toISOString() };
    if (typeof b.enabled === 'boolean') update.whatsappRoutingEnabled = b.enabled;
    if (typeof b.voterAgentName === 'string') update.voterAgentName = b.voterAgentName.slice(0, 40).trim() || 'Aurora';
    if (Array.isArray(b.voterAgentTopics)) {
      update.voterAgentTopics = b.voterAgentTopics
        .filter((x: any) => typeof x === 'string')
        .map((x: string) => x.trim().toLowerCase()).slice(0, 20);
    }
    if (typeof b.orchestratorWakeWord === 'string') {
      update.orchestratorWakeWord = b.orchestratorWakeWord.trim().slice(0, 40) || null;
    } else if (b.orchestratorWakeWord === null) update.orchestratorWakeWord = null;
    if (Array.isArray(b.orchestratorAuthorizedPhones)) {
      update.orchestratorAuthorizedPhones = b.orchestratorAuthorizedPhones
        .filter((x: any) => typeof x === 'string')
        .map((x: string) => x.replace(/\D+/g, ''))
        .filter((x: string) => x.length >= 10 && x.length <= 15);
    }
    if (typeof b.zapflowWakeWord === 'string') {
      update.zapflowWakeWord = b.zapflowWakeWord.trim().slice(0, 40) || 'Zapp';
    }
    if (typeof b.zapflowForwardUrl === 'string') {
      const url = b.zapflowForwardUrl.trim();
      if (url && !/^https?:\/\//.test(url)) return res.status(400).json({ error: 'invalid_url' });
      update.zapflowForwardUrl = url || null;
    }
    // Só atualiza secret se enviado (não-vazio) — string vazia mantém o atual
    if (typeof b.zapflowForwardSecret === 'string' && b.zapflowForwardSecret.trim()) {
      update.zapflowForwardSecret = b.zapflowForwardSecret.trim();
    } else if (b.zapflowForwardSecret === null) {
      update.zapflowForwardSecret = null;
    }

    const { error } = await supabase.from('campaign_configs')
      .update(update).eq('id', campaignId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  router.get('/log', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });
    const { data, error } = await supabase
      .from('whatsapp_routing_log')
      .select('id, "remoteJid", message, decision, classification, "latencyMs", "createdAt"')
      .eq('campaignId', campaignId)
      .order('createdAt', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ entries: data || [] });
  });

  return router;
}
