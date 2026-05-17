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
      campaignId: entry.campaignId ?? null,
      actorId: entry.actorId ?? null,
      actorType: entry.actorType ?? 'user',
      action: entry.action,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      traceId: entry.traceId ?? null,
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
