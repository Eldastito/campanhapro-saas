import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  createInstance,
  getQRCode,
  getStatus,
  deleteInstance,
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
      const cid = campaignIdOf(req) ?? req.body.campaignId;
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

  // DELETE /instances/:id — disconnect and remove
  router.delete('/instances/:id', async (req: Request, res: Response) => {
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

      if (inst.apiKey) {
        await deleteInstance(inst.instanceName, inst.apiKey);
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
