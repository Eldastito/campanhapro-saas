import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  createInstance,
  getQRCode,
  getStatus,
  deleteInstance,
  sendText,
  setWebhook,
  isEvolutionConfigured,
} from '../integrations/evolutionApiClient';
import { audit, actorFromRequest } from '../observability/auditLogger';

function campaignIdOf(req: Request): string | undefined {
  return (req as any).user?.campaignId ?? (req.query.campaignId as string | undefined);
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'whatsapp';
}

export function createWhatsappRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // GET /bot — estado do atendimento automático ao eleitor desta campanha
  router.get('/bot', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });
      const { data } = await supabaseAdmin.from('campaigns').select('"voterBotEnabled"').eq('id', cid).maybeSingle();
      return res.json({ enabled: !!(data as any)?.voterBotEnabled });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /bot — liga/desliga o atendimento automático ao eleitor ({ enabled })
  router.post('/bot', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });
      const enabled = !!req.body?.enabled;
      const { error } = await supabaseAdmin.from('campaigns')
        .update({ voterBotEnabled: enabled }).eq('id', cid);
      if (error) throw error;
      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: enabled ? 'voter_bot.enabled' : 'voter_bot.disabled',
        severity: 'warn',
        metadata: { campaignId: cid },
      });
      return res.json({ enabled });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /instances — list this campaign's WhatsApp numbers
  router.get('/instances', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data, error } = await supabaseAdmin
        .from('whatsapp_instances')
        .select('id, campaignId, instanceName, displayName, phoneNumber, status, lastConnectedAt, createdAt, updatedAt')
        .eq('campaignId', cid)
        .neq('status', 'deleted')
        .order('createdAt', { ascending: false });

      if (error) throw error;
      return res.json({ instances: data ?? [], evolutionConfigured: isEvolutionConfigured() });
    } catch (err: any) {
      console.error('[WhatsApp] list instances:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /instances — create new WhatsApp connection
  router.post('/instances', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });
      if (!isEvolutionConfigured()) {
        return res.status(503).json({ error: 'evolution_api_not_configured' });
      }

      const { displayName } = req.body as { displayName?: string };
      if (!displayName || displayName.trim().length < 2) {
        return res.status(400).json({ error: 'displayName obrigatório (mín. 2 caracteres)' });
      }

      // Build a globally unique instance name. Evolution requires uniqueness across all tenants.
      const instanceName = `cp_${slugify(cid)}_${slugify(displayName)}_${Date.now().toString(36)}`;

      const evo = await createInstance(instanceName);

      const { data, error } = await supabaseAdmin
        .from('whatsapp_instances')
        .insert({
          campaignId: cid,
          instanceName,
          displayName: displayName.trim(),
          status: 'qrcode',
          apiKey: evo.apiKey,
          lastQRCode: evo.qrCode ?? null,
        })
        .select('id, campaignId, instanceName, displayName, phoneNumber, status, createdAt')
        .single();

      if (error) throw error;

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'whatsapp.instance_created',
        resourceType: 'whatsapp_instance',
        resourceId: data.id,
        severity: 'info',
        metadata: { displayName: displayName.trim(), instanceName },
      });

      return res.status(201).json({
        instance: data,
        qrCode: evo.qrCode ?? null,
      });
    } catch (err: any) {
      console.error('[WhatsApp] create instance:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /instances/:id/qrcode — refresh QR code for pairing
  router.get('/instances/:id/qrcode', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data: inst } = await supabaseAdmin
        .from('whatsapp_instances')
        .select('id, instanceName, apiKey, status')
        .eq('id', req.params.id)
        .eq('campaignId', cid)
        .maybeSingle();

      if (!inst) return res.status(404).json({ error: 'instance_not_found' });
      if (!inst.apiKey) return res.status(409).json({ error: 'instance_not_provisioned' });

      const result = await getQRCode(inst.instanceName, inst.apiKey);

      await supabaseAdmin
        .from('whatsapp_instances')
        .update({ lastQRCode: result.qrCode ?? null, status: 'qrcode', updatedAt: new Date().toISOString() })
        .eq('id', inst.id);

      return res.json({ qrCode: result.qrCode, status: 'qrcode' });
    } catch (err: any) {
      console.error('[WhatsApp] qrcode:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /instances/:id/status — poll connection state (used by frontend after QR scan)
  router.get('/instances/:id/status', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data: inst } = await supabaseAdmin
        .from('whatsapp_instances')
        .select('id, instanceName, apiKey, status, phoneNumber')
        .eq('id', req.params.id)
        .eq('campaignId', cid)
        .maybeSingle();

      if (!inst) return res.status(404).json({ error: 'instance_not_found' });
      if (!inst.apiKey) return res.json({ status: inst.status, phoneNumber: inst.phoneNumber });

      const remoteStatus = await getStatus(inst.instanceName, inst.apiKey);

      if (remoteStatus !== inst.status) {
        const updates: Record<string, unknown> = { status: remoteStatus, updatedAt: new Date().toISOString() };
        if (remoteStatus === 'connected') updates.lastConnectedAt = new Date().toISOString();
        await supabaseAdmin.from('whatsapp_instances').update(updates).eq('id', inst.id);
      }

      return res.json({ status: remoteStatus, phoneNumber: inst.phoneNumber });
    } catch (err: any) {
      console.error('[WhatsApp] status:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /instances/:id/resync-webhook — re-register webhook URL on Evolution
  // without re-pairing. Useful when EVOLUTION_WEBHOOK_URL changed
  // (e.g. localhost → host.docker.internal).
  router.post('/instances/:id/resync-webhook', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data: inst } = await supabaseAdmin
        .from('whatsapp_instances')
        .select('id, instanceName, apiKey')
        .eq('id', req.params.id)
        .eq('campaignId', cid)
        .maybeSingle();

      if (!inst) return res.status(404).json({ error: 'instance_not_found' });
      if (!inst.apiKey) return res.status(409).json({ error: 'instance_not_provisioned' });

      await setWebhook(inst.instanceName, inst.apiKey);

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'whatsapp.webhook_resynced',
        resourceType: 'whatsapp_instance',
        resourceId: inst.id,
        severity: 'info',
      });

      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[WhatsApp] resync-webhook:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // Blast (mass-send) endpoints
  // -------------------------------------------------------------------------

  // GET /blasts — list blast campaigns
  router.get('/blasts', async (req: Request, res: Response) => {
    const cid = campaignIdOf(req);
    if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });
    try {
      const { data, error } = await supabaseAdmin
        .from('whatsapp_blasts')
        .select('id, title, status, totalContacts, sentCount, failedCount, skippedCount, startedAt, completedAt, createdAt')
        .eq('campaignId', cid)
        .order('createdAt', { ascending: false })
        .limit(30);
      if (error) throw error;
      return res.json({ blasts: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /blasts — create + immediately start a blast
  router.post('/blasts', async (req: Request, res: Response) => {
    const cid = campaignIdOf(req);
    if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

    const {
      instanceId,
      title,
      message,
      contactFilter = {},
    } = req.body as {
      instanceId: string;
      title: string;
      message: string;
      contactFilter?: {
        classification?: string[];
        tags?: string[];
        all?: boolean;
      };
    };

    if (!instanceId) return res.status(400).json({ error: 'instanceId obrigatório' });
    if (!message?.trim()) return res.status(400).json({ error: 'message obrigatório' });
    if (!title?.trim()) return res.status(400).json({ error: 'title obrigatório' });

    try {
      // Verify instance belongs to campaign and is connected
      const { data: inst } = await supabaseAdmin
        .from('whatsapp_instances')
        .select('id, instanceName, apiKey, status')
        .eq('id', instanceId)
        .eq('campaignId', cid)
        .maybeSingle();

      if (!inst) return res.status(404).json({ error: 'instance_not_found' });
      if (inst.status !== 'connected') {
        return res.status(409).json({ error: 'instance_not_connected' });
      }

      // Load contacts
      let query = supabaseAdmin
        .from('contacts')
        .select('id, name, phone, neighborhood')
        .eq('campaignId', cid)
        .not('phone', 'is', null);

      if (contactFilter.classification?.length) {
        query = query.in('classification', contactFilter.classification);
      }
      if (contactFilter.tags?.length) {
        query = query.contains('tags', contactFilter.tags);
      }

      const { data: contacts, error: cErr } = await query.limit(500);
      if (cErr) throw cErr;

      const eligible = (contacts ?? []).filter(c => c.phone && String(c.phone).replace(/\D/g, '').length >= 8);

      if (eligible.length === 0) {
        return res.status(400).json({ error: 'Nenhum contato elegível encontrado com os filtros selecionados' });
      }

      // Create blast record
      const { data: blast, error: bErr } = await supabaseAdmin
        .from('whatsapp_blasts')
        .insert({
          campaignId: cid,
          instanceId,
          title: title.trim(),
          message: message.trim(),
          contactFilter,
          status: 'running',
          totalContacts: eligible.length,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (bErr) throw bErr;

      // Respond 202 immediately — process in background
      res.status(202).json({ blastId: blast.id, totalContacts: eligible.length });

      // Background processing with per-send delay (LGPD: no consent check needed here
      // as coordinator explicitly selected contacts and confirmed the blast)
      ;(async () => {
        let sent = 0;
        let failed = 0;
        const DELAY_MS = 2500; // 2.5s between sends ≈ 24 msgs/min ≈ 200/day per number

        for (const contact of eligible) {
          try {
            const phone = String(contact.phone).replace(/\D/g, '');
            const personalised = message
              .replace(/\{\{name\}\}/gi, contact.name ?? '')
              .replace(/\{\{nome\}\}/gi, contact.name ?? '')
              .replace(/\{\{neighborhood\}\}/gi, contact.neighborhood ?? '')
              .replace(/\{\{bairro\}\}/gi, contact.neighborhood ?? '');

            await sendText(inst.instanceName, inst.apiKey, phone, personalised);
            sent++;
          } catch {
            failed++;
          }

          // Update progress every 10 sends
          if ((sent + failed) % 10 === 0) {
            await supabaseAdmin
              .from('whatsapp_blasts')
              .update({ sentCount: sent, failedCount: failed, updatedAt: new Date().toISOString() })
              .eq('id', blast.id);
          }

          if (sent + failed < eligible.length) {
            await new Promise(r => setTimeout(r, DELAY_MS));
          }
        }

        await supabaseAdmin
          .from('whatsapp_blasts')
          .update({
            status: 'completed',
            sentCount: sent,
            failedCount: failed,
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .eq('id', blast.id);

        await audit(supabaseAdmin, {
          actorType: 'user',
          action: 'whatsapp.blast_completed',
          resourceType: 'whatsapp_blast',
          resourceId: blast.id,
          severity: 'info',
          metadata: { sent, failed, total: eligible.length },
        });
      })().catch(err => {
        console.error('[WhatsApp blast] background error:', err);
        supabaseAdmin
          .from('whatsapp_blasts')
          .update({ status: 'failed', updatedAt: new Date().toISOString() })
          .eq('id', blast.id)
          .then(() => {});
      });

    } catch (err: any) {
      console.error('[WhatsApp] blast create:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /blasts/:id — polling endpoint for progress
  router.get('/blasts/:id', async (req: Request, res: Response) => {
    const cid = campaignIdOf(req);
    if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });
    try {
      const { data, error } = await supabaseAdmin
        .from('whatsapp_blasts')
        .select('*')
        .eq('id', req.params.id)
        .eq('campaignId', cid)
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'not_found' });
      return res.json({ blast: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // DELETE /instances/:id — disconnect and remove
  router.delete('/instances/:id', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data: inst } = await supabaseAdmin
        .from('whatsapp_instances')
        .select('id, instanceName, instanceId, apiKey')
        .eq('id', req.params.id)
        .eq('campaignId', cid)
        .maybeSingle();

      if (!inst) return res.status(404).json({ error: 'instance_not_found' });

      if (inst.apiKey) {
        // Pass instanceId (UUID) too — Evolution GO requires it on the path
        // for /instance/delete/:instanceId, while Node v2 ignored it.
        await deleteInstance(inst.instanceName, inst.apiKey, inst.instanceId);
      }

      // Soft-delete so historic messages still resolve their instance via FK
      await supabaseAdmin
        .from('whatsapp_instances')
        .update({ status: 'deleted', apiKey: null, lastQRCode: null, updatedAt: new Date().toISOString() })
        .eq('id', inst.id);

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'whatsapp.instance_deleted',
        resourceType: 'whatsapp_instance',
        resourceId: inst.id,
        severity: 'warn',
      });

      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[WhatsApp] delete:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
