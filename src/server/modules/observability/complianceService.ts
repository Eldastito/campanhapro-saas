import type { SupabaseClient } from '@supabase/supabase-js';

export interface ComplianceSummary {
  campaignId: string;
  consents: { total: number; granted: number; revoked: number; expired: number };
  outboundMessages: {
    total24h: number;
    blockedNoConsent: number;
  };
  pendingApprovals: {
    dossiers: number;
    agentTasks: number;
  };
  webhooks: {
    last24hReceived: number;
    signatureFailures24h: number;
    lastReceivedAt: string | null;
  };
  audit: {
    total24h: number;
    critical24h: number;
    error24h: number;
  };
  generatedAt: string;
}

const ONE_DAY_AGO = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

/** Aggregate compliance metrics for a campaign — read-only. */
export async function buildComplianceSummary(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<ComplianceSummary> {
  const since = ONE_DAY_AGO();

  // Run independent queries in parallel
  const [
    consentsTotal,
    consentsGranted,
    consentsRevoked,
    consentsExpired,
    outboundTotal,
    outboundBlocked,
    pendingDossiers,
    pendingTasks,
    webhooksReceived,
    webhooksFailed,
    webhookLast,
    auditTotal,
    auditCritical,
    auditError,
  ] = await Promise.all([
    countRows(supabase, 'consent_records', q => q.eq('campaign_id', campaignId)),
    countRows(supabase, 'consent_records', q => q.eq('campaign_id', campaignId).eq('status', 'granted')),
    countRows(supabase, 'consent_records', q => q.eq('campaign_id', campaignId).eq('status', 'revoked')),
    countRows(supabase, 'consent_records', q => q.eq('campaign_id', campaignId).eq('status', 'expired')),
    countRows(supabase, 'channel_messages', q => q.eq('campaign_id', campaignId).eq('direction', 'outbound').gte('created_at', since)),
    countRows(supabase, 'audit_logs', q => q.eq('campaign_id', campaignId).eq('action', 'message.send.blocked').gte('created_at', since)),
    countRows(supabase, 'dossiers', q => q.eq('campaign_id', campaignId).eq('status', 'pending_approval')),
    countRows(supabase, 'agent_tasks', q => q.eq('campaign_id', campaignId).eq('status', 'awaiting_approval')),
    countRows(supabase, 'webhook_events', q => q.eq('campaign_id', campaignId).gte('received_at', since)),
    countRows(supabase, 'webhook_events', q => q.eq('campaign_id', campaignId).eq('signature_valid', false).gte('received_at', since)),
    fetchLastWebhook(supabase, campaignId),
    countRows(supabase, 'audit_logs', q => q.eq('campaign_id', campaignId).gte('created_at', since)),
    countRows(supabase, 'audit_logs', q => q.eq('campaign_id', campaignId).eq('severity', 'critical').gte('created_at', since)),
    countRows(supabase, 'audit_logs', q => q.eq('campaign_id', campaignId).eq('severity', 'error').gte('created_at', since)),
  ]);

  return {
    campaignId,
    consents: { total: consentsTotal, granted: consentsGranted, revoked: consentsRevoked, expired: consentsExpired },
    outboundMessages: { total24h: outboundTotal, blockedNoConsent: outboundBlocked },
    pendingApprovals: { dossiers: pendingDossiers, agentTasks: pendingTasks },
    webhooks: { last24hReceived: webhooksReceived, signatureFailures24h: webhooksFailed, lastReceivedAt: webhookLast },
    audit: { total24h: auditTotal, critical24h: auditCritical, error24h: auditError },
    generatedAt: new Date().toISOString(),
  };
}

async function countRows(
  supabase: SupabaseClient,
  table: string,
  filter: (q: any) => any,
): Promise<number> {
  try {
    const query = filter(supabase.from(table).select('*', { count: 'exact', head: true }));
    const { count, error } = await query;
    if (error) {
      // Table may not exist yet (e.g. consent_records) — degrade silently
      return 0;
    }
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function fetchLastWebhook(supabase: SupabaseClient, campaignId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('webhook_events')
      .select('received_at')
      .eq('campaign_id', campaignId)
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.received_at ?? null;
  } catch {
    return null;
  }
}

export interface IntegrationHealth {
  name: string;
  configured: boolean;
  status: 'ok' | 'unconfigured' | 'degraded' | 'down';
  detail?: string;
}

export function buildIntegrationHealth(): IntegrationHealth[] {
  const meta = !!(process.env.META_APP_SECRET && process.env.META_ACCESS_TOKEN && process.env.WA_PHONE_NUMBER_ID);
  const openai = !!process.env.OPENAI_API_KEY;
  const cenarios = !!process.env.CAMPANHAPRO_CENARIOS_URL;
  const paperclip = !!process.env.PAPERCLIP_URL;
  const tiktok = !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
  const supabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const internalKey = !!process.env.INTERNAL_SERVICE_KEY;

  return [
    { name: 'Supabase', configured: supabase, status: supabase ? 'ok' : 'down', detail: supabase ? undefined : 'SUPABASE_URL/SERVICE_ROLE_KEY ausente' },
    { name: 'Meta WhatsApp Cloud', configured: meta, status: meta ? 'ok' : 'unconfigured' },
    { name: 'OpenAI (RAG/embeddings)', configured: openai, status: openai ? 'ok' : 'unconfigured' },
    { name: 'CampanhaProCenarios', configured: cenarios, status: cenarios ? 'ok' : 'unconfigured', detail: cenarios ? undefined : 'modo stub ativo' },
    { name: 'Paperclip Agent Engine', configured: paperclip, status: paperclip ? 'ok' : 'unconfigured', detail: paperclip ? undefined : 'modo local stub' },
    { name: 'TikTok', configured: tiktok, status: tiktok ? 'ok' : 'unconfigured' },
    { name: 'Internal Service Auth', configured: internalKey, status: internalKey ? 'ok' : 'degraded', detail: internalKey ? undefined : 'INTERNAL_SERVICE_KEY ausente — service-to-service auth desabilitado' },
  ];
}
