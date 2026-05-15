-- Phase 3: Omnichannel — conversations & messages

CREATE TABLE IF NOT EXISTS channel_conversations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"        text        NOT NULL,
  channel             text        NOT NULL CHECK (channel IN ('whatsapp','instagram')),
  "contactId"         uuid        REFERENCES contacts(id) ON DELETE SET NULL,
  "externalId"        text        NOT NULL,
  "lastMessageAt"     timestamptz,
  "lastInboundAt"     timestamptz,
  "assignedUserId"    uuid,
  "isOpen"            boolean     NOT NULL DEFAULT true,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("campaignId", channel, "externalId")
);

CREATE INDEX IF NOT EXISTS idx_conv_campaign_last ON channel_conversations ("campaignId", "lastMessageAt" DESC);

CREATE TABLE IF NOT EXISTS channel_messages (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversationId"    uuid        NOT NULL REFERENCES channel_conversations(id) ON DELETE CASCADE,
  "campaignId"        text        NOT NULL,
  direction           text        NOT NULL CHECK (direction IN ('inbound','outbound')),
  channel             text        NOT NULL,
  "providerMessageId" text,
  body                text        NOT NULL,
  "sentByUserId"      uuid,
  "createdAt"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msg_convo_created ON channel_messages ("conversationId", "createdAt");

-- Mapping table: phone_number_id (from Meta) → campaignId
CREATE TABLE IF NOT EXISTS channel_phone_mappings (
  "phoneNumberId"     text        PRIMARY KEY,
  "campaignId"        text        NOT NULL,
  "displayPhone"      text,
  "createdAt"         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE channel_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_phone_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Campaign members read conversations"
  ON channel_conversations FOR SELECT
  USING ("campaignId" IN (SELECT campaign_id::text FROM users WHERE id = auth.uid()));

CREATE POLICY "Campaign members read messages"
  ON channel_messages FOR SELECT
  USING ("campaignId" IN (SELECT campaign_id::text FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role bypass conversations"
  ON channel_conversations FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role bypass messages"
  ON channel_messages FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role bypass mappings"
  ON channel_phone_mappings FOR ALL
  USING (auth.role() = 'service_role');
