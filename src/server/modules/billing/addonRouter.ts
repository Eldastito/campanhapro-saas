/**
 * Add-on Router — venda avulsa de módulos (Cenários/Inteligência).
 *
 * Cada add-on contratado vira UMA assinatura Asaas independente (a API do
 * Asaas não tem subscription items como o Stripe; cada valor recorrente
 * pede uma assinatura própria). A linha em `module_subscriptions` é o lado
 * COBRANÇA; o acesso (`tenant_module_entitlements`) só é liberado quando o
 * webhook do Asaas confirma o pagamento (paymentWebhookRouter).
 *
 * Gate de produto: requer plano pago ativo (Essencial+). Cenários/Inteligência
 * consomem dados de CRM/visitas que só existem nos planos pagantes.
 */
import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActiveSubscription } from './billingService';
import { getPaymentGateway } from './paymentGateway';
import { audit, actorFromRequest } from '../observability/auditLogger';
import { MODULES, moduleByKey } from '../../../lib/modules';

const ADDON_KEYS = new Set(MODULES.filter((m) => m.sellable && (m.key === 'cenarios' || m.key === 'inteligencia' || m.key === 'legal_shield')).map((m) => m.key));

export function createAddonRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // GET /api/v1/billing/addons — lista os add-ons do tenant + status
  router.get('/', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('module_subscriptions')
      .select('id, "moduleKey", status, "amountCents", "currentPeriodEnd", "createdAt"')
      .eq('tenantId', campaignId)
      .order('createdAt', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    res.json({ addons: data ?? [] });
  });

  // POST /api/v1/billing/addons/:moduleKey/checkout
  router.post('/:moduleKey/checkout', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const moduleKey = req.params.moduleKey;
    if (!ADDON_KEYS.has(moduleKey)) return res.status(404).json({ error: 'addon_not_sellable' });
    const moduleDef = moduleByKey(moduleKey);
    if (!moduleDef) return res.status(404).json({ error: 'module_not_found' });

    // Gate de produto: tem que ter plano pago ativo.
    const planSub = await getActiveSubscription(supabase, campaignId);
    if (!planSub || planSub.planId === 'free') {
      return res.status(402).json({ error: 'requires_paid_plan', detail: 'Add-ons exigem plano Essencial ou superior.' });
    }

    // Já tem o módulo via plano (Total carrega scenarios/intelligence)? Bloqueia
    // a cobrança duplicada — o módulo já está incluso.
    if (planSub.planId === 'enterprise') {
      return res.status(409).json({ error: 'already_included', detail: 'Seu plano Total já inclui este módulo.' });
    }

    // Já existe assinatura viva? Bloqueia double-charge.
    const { data: existing } = await supabase
      .from('module_subscriptions')
      .select('id, status')
      .eq('tenantId', campaignId)
      .eq('moduleKey', moduleKey)
      .in('status', ['pending_payment', 'active', 'past_due'])
      .maybeSingle();
    if (existing) {
      return res.status(409).json({ error: 'already_subscribed', subscriptionId: existing.id, status: existing.status });
    }

    // Preço autoritativo: lê do banco, não confia no client.
    const { data: priceRow } = await supabase
      .from('module_prices')
      .select('"monthlyCents"')
      .eq('moduleKey', moduleKey)
      .eq('active', true)
      .maybeSingle();
    if (!priceRow) return res.status(404).json({ error: 'pricing_not_found' });
    const amountCents = priceRow.monthlyCents;

    const { name, email, cpfCnpj, phone, method } = req.body as {
      name?: string; email?: string; cpfCnpj?: string; phone?: string;
      method?: 'pix' | 'credit_card' | 'debit_card' | 'boleto' | 'undefined';
    };

    try {
      const gateway = getPaymentGateway();

      // Modo stub/dev: ativa direto e escreve entitlement sem rodar Asaas.
      if (gateway.providerName === 'stub') {
        const insert = await supabase.from('module_subscriptions').insert({
          tenantId: campaignId, tenantKind: 'campaign', moduleKey,
          status: 'active', amountCents, paymentProvider: 'stub',
        }).select('*').single();
        if (insert.data) {
          await supabase.from('tenant_module_entitlements').upsert({
            tenantId: campaignId, tenantKind: 'campaign', moduleKey,
            status: 'active', source: 'addon:stub',
          }, { onConflict: 'tenantId,moduleKey' });
        }
        return res.json({ subscription: insert.data, checkoutUrl: null, provider: 'stub' });
      }

      // Real (Asaas): valida dados mínimos.
      if (!name || !email) return res.status(400).json({ error: 'name e email obrigatórios' });
      const cpf = (cpfCnpj || '').replace(/\D/g, '');
      if (gateway.providerName === 'asaas' && !cpf) {
        return res.status(400).json({ error: 'cpf_obrigatorio' });
      }

      // Reusa o customer Asaas da assinatura de plano (mesma pessoa pagando).
      let providerCustomerId: string | undefined;
      const { data: planRow } = await supabase
        .from('subscriptions').select('"asaasCustomerId"')
        .eq('id', planSub.id).maybeSingle();
      providerCustomerId = planRow?.asaasCustomerId ?? undefined;

      if (!providerCustomerId) {
        const customer = await gateway.createCustomer({ campaignId, name, email, cpfCnpj: cpf, phone });
        providerCustomerId = customer.providerCustomerId;
      }

      const subResult = await gateway.createSubscription({
        campaignId,
        providerCustomerId,
        planId: `addon:${moduleKey}`, // vai pro externalReference do Asaas
        amountCents,
        cycle: 'monthly',
        description: `CampanhaPro — Add-on ${moduleDef.name}`,
        allowedMethods: method ? [method] : ['undefined'],
      });

      const insert = await supabase.from('module_subscriptions').insert({
        tenantId: campaignId, tenantKind: 'campaign', moduleKey,
        status: 'pending_payment', amountCents,
        paymentProvider: 'asaas',
        asaasCustomerId: providerCustomerId,
        asaasSubscriptionId: subResult.providerSubscriptionId,
      }).select('*').single();

      await audit(supabase, {
        ...actorFromRequest(req),
        action: 'billing.addon.checkout',
        resourceType: 'module_subscription',
        resourceId: insert.data?.id,
        severity: 'info',
        metadata: { moduleKey, amountCents, provider: 'asaas', asaasSubscriptionId: subResult.providerSubscriptionId },
      });

      return res.json({
        subscription: insert.data,
        checkoutUrl: subResult.checkoutUrl,
        pixQrCode: subResult.pixQrCode,
        pixCopyPaste: subResult.pixCopyPaste,
        provider: 'asaas',
      });
    } catch (err: any) {
      console.error('[billing/addon] checkout failed:', err);
      return res.status(400).json({ error: err.message });
    }
  });

  // POST /api/v1/billing/addons/:moduleKey/cancel
  router.post('/:moduleKey/cancel', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const moduleKey = req.params.moduleKey;
    const { data: row } = await supabase
      .from('module_subscriptions')
      .select('id, "asaasSubscriptionId", status')
      .eq('tenantId', campaignId)
      .eq('moduleKey', moduleKey)
      .in('status', ['pending_payment', 'active', 'past_due'])
      .maybeSingle();
    if (!row) return res.status(404).json({ error: 'no_active_subscription' });

    if (row.asaasSubscriptionId) {
      try {
        const gateway = getPaymentGateway();
        await gateway.cancelSubscription({ providerSubscriptionId: row.asaasSubscriptionId });
      } catch (err: any) {
        console.warn('[billing/addon] gateway cancel failed:', err.message);
        // Segue mesmo assim — operador pode cancelar manual no Asaas.
      }
    }

    await supabase
      .from('module_subscriptions')
      .update({ status: 'canceled', updatedAt: new Date().toISOString() })
      .eq('id', row.id);

    // Revoga o entitlement na hora — preserva direito até o fim do período
    // só se o produto decidir isso depois. Hoje cancela = perde acesso já.
    await supabase
      .from('tenant_module_entitlements')
      .update({ status: 'revoked', updatedAt: new Date().toISOString() })
      .eq('tenantId', campaignId)
      .eq('moduleKey', moduleKey)
      .like('source', 'addon:%');

    await audit(supabase, {
      ...actorFromRequest(req),
      action: 'billing.addon.cancel',
      resourceType: 'module_subscription',
      resourceId: row.id,
      severity: 'warn',
      metadata: { moduleKey },
    });

    res.json({ ok: true });
  });

  return router;
}
