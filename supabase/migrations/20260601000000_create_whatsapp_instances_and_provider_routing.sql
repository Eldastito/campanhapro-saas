-- ============================================================
-- whatsapp_instances: per-campaign Evolution API instances
-- (one row = one connected WhatsApp number)
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" text NOT NULL,
  "instanceName" text NOT NULL UNIQUE,
  "displayName" text NOT NULL,
  "phoneNumber" text,
  status text NOT NULL DEFAULT 'pending',
  "apiKey" text,
  "lastQRCode" text,
  "lastConnectedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_campaign ON whatsapp_instances("campaignId");
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_status ON whatsapp_instances("campaignId", status);

ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_instances_select_own" ON whatsapp_instances;
CREATE POLICY "whatsapp_instances_select_own" ON whatsapp_instances
  FOR SELECT TO authenticated
  USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());

DROP POLICY IF EXISTS "whatsapp_instances_insert_own" ON whatsapp_instances;
CREATE POLICY "whatsapp_instances_insert_own" ON whatsapp_instances
  FOR INSERT TO authenticated
  WITH CHECK ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());

DROP POLICY IF EXISTS "whatsapp_instances_update_own" ON whatsapp_instances;
CREATE POLICY "whatsapp_instances_update_own" ON whatsapp_instances
  FOR UPDATE TO authenticated
  USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());

DROP POLICY IF EXISTS "whatsapp_instances_delete_own" ON whatsapp_instances;
CREATE POLICY "whatsapp_instances_delete_own" ON whatsapp_instances
  FOR DELETE TO authenticated
  USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());

-- ============================================================
-- Provider routing columns on conversations and messages.
-- 'meta' = Meta Cloud API, 'evolution' = self-hosted Evolution API.
-- Existing rows default to 'meta' since that's all we had before.
-- ============================================================
ALTER TABLE channel_conversations
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS "whatsappInstanceId" uuid REFERENCES whatsapp_instances(id) ON DELETE SET NULL;

ALTER TABLE channel_messages
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS "whatsappInstanceId" uuid REFERENCES whatsapp_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_channel_conversations_instance ON channel_conversations("whatsappInstanceId");
CREATE INDEX IF NOT EXISTS idx_channel_messages_instance ON channel_messages("whatsappInstanceId");

-- ============================================================
-- Plan feature: 'whatsapp_omnichannel' for Pro and Enterprise.
-- ============================================================
UPDATE plans
   SET features = (
     SELECT array_agg(DISTINCT f)
     FROM unnest(features || ARRAY['whatsapp_omnichannel']::text[]) AS f
   )
 WHERE id IN ('pro','enterprise')
   AND NOT ('whatsapp_omnichannel' = ANY(features));
