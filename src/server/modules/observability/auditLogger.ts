import type { SupabaseClient } from '@supabase/supabase-js';

export type AuditSeverity = 'info' | 'warn' | 'error' | 'critical';
export type ActorType = 'user' | 'system' | 'webhook' | 'agent';

export interface AuditEntry {
  campaignId?: string | null;
  actorId?: string | null;
  actorType?: ActorType;
  action: string;
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  traceId?: string;
  severity?: AuditSeverity;
  metadata?: Record<string, unknown>;
}

/**
 * Writes an audit entry. Never throws — audit failures must never break the
 * primary action they are tracking. Logs to console as fallback.
 */
export async function audit(supabase: SupabaseClient, entry: AuditEntry): Promise<void> {
  try {
    const row = {
      campaign_id: entry.campaignId ?? null,
      actor_id: entry.actorId ?? null,
      actor_type: entry.actorType ?? 'user',
      action: entry.action,
      resource_type: entry.resourceType ?? null,
      resource_id: entry.resourceId ?? null,
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
      trace_id: entry.traceId ?? null,
      severity: entry.severity ?? 'info',
      metadata: entry.metadata ?? {},
    };
    const { error } = await supabase.from('audit_logs').insert(row);
    if (error) {
      console.error('[audit] write failed:', error.message, entry.action);
    }
  } catch (err: any) {
    console.error('[audit] unexpected error:', err?.message ?? err, entry.action);
  }
}

/**
 * Builds an actor descriptor from an Express request for convenient call sites.
 */
export function actorFromRequest(req: any): Pick<AuditEntry, 'actorId' | 'campaignId' | 'ipAddress' | 'userAgent' | 'traceId'> {
  return {
    actorId: req.user?.id ?? null,
    campaignId: req.user?.campaignId ?? null,
    ipAddress: req.ip ?? req.socket?.remoteAddress ?? undefined,
    userAgent: req.get?.('user-agent') ?? undefined,
    traceId: req.traceId,
  };
}
