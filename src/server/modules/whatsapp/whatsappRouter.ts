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
  findInstanceIdByName,
  reconnectInstance,
} from '../integrations/evolutionApiClient';
import { audit, actorFromRequest } from '../observability/auditLogger';
import { checkWhatsAppQuota } from '../billing/quotaEnforcer';

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
          instanceId: evo.instanceId ?? null,   // UUID do GO — necessário p/ deletar depois
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

  // POST /instances/manual — registra uma instância CRIADA À MÃO no painel do
  // Evolution GO (esquema do exaforgeStudio: 1 instância manual por celular —
  // mais confiável que a criação automática). Verifica o status, re-registra o
  // webhook e salva. Body: { instanceName, apiKey?, displayName? }
  router.post('/instances/manual', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });
      if (!isEvolutionConfigured()) return res.status(503).json({ error: 'evolution_api_not_configured' });

      const { instanceName, apiKey, displayName } = req.body as { instanceName?: string; apiKey?: string; displayName?: string };
      const name = (instanceName || '').trim();
      if (!name) return res.status(400).json({ error: 'instanceName obrigatório (o nome criado no painel do Evolution)' });

      const token = (apiKey || '').trim() || process.env.EVOLUTION_GLOBAL_API_KEY || '';
      if (!token) return res.status(400).json({ error: 'apiKey obrigatória (ou configure EVOLUTION_GLOBAL_API_KEY)' });

      // RESPONDE RÁPIDO: salva primeiro, descobre status em background. Assim
      // o frontend nunca trava esperando o Evolution responder.
      const { data: existing } = await supabaseAdmin.from('whatsapp_instances')
        .select('id').eq('campaignId', cid).eq('instanceName', name).maybeSingle();
      let row;
      const baseFields = {
        apiKey: token,
        status: 'pending' as const,
        displayName: (displayName || name).trim(),
      };
      if (existing?.id) {
        const { data, error } = await supabaseAdmin.from('whatsapp_instances')
          .update({ apiKey: baseFields.apiKey })
          .eq('id', existing.id)
          .select('id, campaignId, instanceName, displayName, phoneNumber, status, createdAt').single();
        if (error) throw error; row = data;
      } else {
        const { data, error } = await supabaseAdmin.from('whatsapp_instances')
          .insert({ campaignId: cid, instanceName: name, ...baseFields })
          .select('id, campaignId, instanceName, displayName, phoneNumber, status, createdAt').single();
        if (error) throw error; row = data;
      }

      // Auditoria síncrona (leve).
      audit(supabaseAdmin, {
        ...actorFromRequest(req), action: 'whatsapp.instance_registered_manual',
        resourceType: 'whatsapp_instance', resourceId: row.id, severity: 'info',
        metadata: { instanceName: name },
      }).catch(() => {});

      // Background: descobre status real + UUID + registra webhook. Nada disso
      // trava a resposta — o frontend já recebeu o "ok" e pode chamar
      // /instances/:id/qrcode pra acompanhar.
      void (async () => {
        try {
          const status = await Promise.race([
            getStatus(name, token),
            new Promise<'pending'>((r) => setTimeout(() => r('pending'), 8000)),
          ]);
          const instanceId = await Promise.race([
            findInstanceIdByName(name),
            new Promise<null>((r) => setTimeout(() => r(null), 8000)),
          ]);
          await supabaseAdmin.from('whatsapp_instances').update({
            status, ...(instanceId ? { instanceId } : {}),
          }).eq('id', row.id);
          // Registra o webhook (best-effort, com seu próprio timeout interno).
          await setWebhook(name, token).catch((e: any) =>
            console.warn('[WhatsApp] manual: setWebhook falhou (siga):', e?.message));
        } catch (e: any) {
          console.warn('[WhatsApp] manual bg:', e?.message);
        }
      })();

      // Mensagem útil pro usuário com base no estado atual da row.
      return res.status(201).json({
        instance: row,
        status: 'pending',
        message: 'Instância registrada. Verificando conexão no Evolution em background.',
      });
    } catch (err: any) {
      console.error('[WhatsApp] manual register:', err);
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
        .select('id, instanceName, apiKey, status, lastQRCode')
        .eq('id', req.params.id)
        .eq('campaignId', cid)
        .maybeSingle();

      if (!inst) return res.status(404).json({ error: 'instance_not_found' });
      if (!inst.apiKey) return res.status(409).json({ error: 'instance_not_provisioned' });

      // Modo POLL (?poll=1): NÃO reconecta — só devolve o QR que o webhook já
      // entregou (lastQRCode). Usado pelo frontend a cada 3s sem re-armar a sessão.
      if (req.query.poll === '1') {
        const { data: fresh } = await supabaseAdmin
          .from('whatsapp_instances').select('lastQRCode, status').eq('id', inst.id).maybeSingle();
        const q = (fresh as any)?.lastQRCode ?? null;
        return res.json({ qrCode: q, status: (fresh as any)?.status === 'connected' ? 'connected' : (q ? 'qrcode' : 'pending') });
      }

      let result: { qrCode: string | null; status: any };
      try {
        result = await getQRCode(inst.instanceName, inst.apiKey);
      } catch (qrErr: any) {
        // Token órfão: a instância sumiu do servidor Evolution (rebuild/reset/
        // rotação de chave) mas continua no nosso banco → 401/404. Auto-cura:
        // reprovisiona no servidor com um token novo e devolve um QR válido.
        if (/_(401|404)\b|_(401|404):/.test(qrErr?.message || '')) {
          console.warn('[WhatsApp] QR 401/404 — reprovisionando instância órfã', inst.id);
          const newName = `${slugify(inst.instanceName)}_r${Date.now().toString(36)}`;
          const evo = await createInstance(newName);
          await supabaseAdmin.from('whatsapp_instances').update({
            instanceName: newName,
            apiKey: evo.apiKey,
            instanceId: evo.instanceId,
            status: 'qrcode',
            lastQRCode: evo.qrCode ?? null,
            updatedAt: new Date().toISOString(),
          }).eq('id', inst.id);
          await audit(supabaseAdmin, {
            ...actorFromRequest(req),
            action: 'whatsapp.instance.reprovisioned',
            severity: 'warn',
            metadata: { instanceId: inst.id, oldName: inst.instanceName, newName },
          });
          return res.json({ qrCode: evo.qrCode ?? null, status: 'qrcode', reprovisioned: true });
        }
        throw qrErr;
      }

      // Fallback: se o connect não devolveu o QR inline, o webhook (evento QRCODE)
      // pode tê-lo entregue no lastQRCode — relê fresco antes de responder.
      let qr = result.qrCode;
      if (!qr) {
        const { data: fresh } = await supabaseAdmin
          .from('whatsapp_instances').select('lastQRCode').eq('id', inst.id).maybeSingle();
        qr = (fresh as any)?.lastQRCode ?? null;
      }

      await supabaseAdmin
        .from('whatsapp_instances')
        .update({ lastQRCode: qr ?? inst.lastQRCode ?? null, status: 'qrcode', updatedAt: new Date().toISOString() })
        .eq('id', inst.id);

      // qrCode pode vir null aqui (QR ainda chegando via webhook) — o frontend
      // faz poll (?poll=1) e pega assim que o webhook preencher.
      return res.json({ qrCode: qr, status: 'qrcode' });
    } catch (err: any) {
      console.error('[WhatsApp] qrcode:', err);
      const msg = err?.message || 'erro';
      // GLOBAL key inválida ou servidor fora → mensagem acionável (sem loop).
      if (/_(401|403)\b|_(401|403):/.test(msg)) {
        return res.status(502).json({ error: 'evolution_auth_failed', detail: 'O servidor WhatsApp recusou a autenticação. Verifique EVOLUTION_GLOBAL_API_KEY no servidor.' });
      }
      return res.status(500).json({ error: msg });
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

      // Auto-recuperação: se a instância ESTAVA conectada e o GO agora reporta
      // desconectado, tenta reabrir o socket sem re-escanear (best-effort).
      if (inst.status === 'connected' && remoteStatus === 'disconnected' && inst.apiKey) {
        void reconnectInstance(inst.apiKey);
      }

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

      // ENFORCEMENT: cota diária de WhatsApp do plano (100/dia no Grátis, ilimitado no Pro).
      const quota = await checkWhatsAppQuota(supabaseAdmin, cid, eligible.length);
      if (!quota.ok) {
        return res.status(429).json({
          error: 'quota_exceeded',
          feature: 'whatsapp_blast',
          used: quota.used, limit: quota.limit,
          remaining: Math.max(0, (quota.limit || 0) - (quota.used || 0)),
          attempted: eligible.length,
          resetAt: quota.resetAt, planTier: quota.planTier,
          upgradeMessage: quota.upgradeMessage,
        });
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

      // Soft-delete PRIMEIRO: o número some da lista na hora, mesmo se o servidor
      // Evolution estiver lento/fora (antes, a chamada de delete podia travar a
      // requisição e o número nunca era removido).
      await supabaseAdmin
        .from('whatsapp_instances')
        .update({ status: 'deleted', apiKey: null, lastQRCode: null, updatedAt: new Date().toISOString() })
        .eq('id', inst.id);

      // Limpeza no servidor Evolution em BACKGROUND (best-effort, não bloqueia a
      // resposta nem o sumiço do número da lista). Se não temos o UUID salvo,
      // descobrimos pelo nome (rota Admin) — senão o GO não remove a instância.
      if (inst.apiKey) {
        void (async () => {
          let iid: string | null = inst.instanceId ?? null;
          if (!iid) iid = await findInstanceIdByName(inst.instanceName).catch(() => null);
          await deleteInstance(inst.instanceName, inst.apiKey, iid || undefined)
            .catch((e) => console.warn('[WhatsApp] delete server cleanup falhou:', e?.message));
        })();
      }

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
