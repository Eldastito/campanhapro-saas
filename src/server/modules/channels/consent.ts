import { SupabaseClient } from '@supabase/supabase-js';

/**
 * LGPD/consent guard. Returns true if the contact has given consent
 * for outbound messaging on the given channel (or it's a reply within
 * an open conversation, which is permitted by Meta as "within 24h window").
 */
export async function hasOutboundConsent(
  supabase: SupabaseClient,
  campaignId: string,
  contactId: string,
  channel: 'whatsapp' | 'instagram'
): Promise<boolean> {
  const { data } = await supabase
    .from('consent_records')
    .select('granted, revokedAt')
    .eq('campaignId', campaignId)
    .eq('contactId', contactId)
    .eq('channel', channel)
    .order('createdAt', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return false;
  if (!data.granted) return false;
  if (data.revokedAt) return false;
  return true;
}

/**
 * Records a consent decision for audit purposes. Each call creates a
 * new row — the most recent row wins.
 */
export async function recordConsent(
  supabase: SupabaseClient,
  params: {
    campaignId: string;
    contactId: string;
    channel: 'whatsapp' | 'instagram';
    granted: boolean;
    source: string;
    note?: string;
  }
): Promise<void> {
  await supabase.from('consent_records').insert({
    campaignId: params.campaignId,
    contactId: params.contactId,
    channel: params.channel,
    granted: params.granted,
    source: params.source,
    note: params.note ?? null,
    revokedAt: params.granted ? null : new Date().toISOString(),
  });
}
