-- WhatsApp blast campaigns: mass-send via Evolution API with rate limiting
CREATE TABLE IF NOT EXISTS whatsapp_blasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" text NOT NULL,
  "instanceId" uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE RESTRICT,
  title text NOT NULL,
  message text NOT NULL,        -- template with {{name}}, {{neighborhood}} variables
  "contactFilter" jsonb NOT NULL DEFAULT '{}', -- { classification?, tags?, all: true }
  status text NOT NULL DEFAULT 'pending',   -- pending | running | completed | failed | cancelled
  "totalContacts" int NOT NULL DEFAULT 0,
  "sentCount" int NOT NULL DEFAULT 0,
  "failedCount" int NOT NULL DEFAULT 0,
  "skippedCount" int NOT NULL DEFAULT 0,   -- no consent
  "startedAt" timestamptz,
  "completedAt" timestamptz,
  "agentTaskId" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_blasts_campaign
  ON whatsapp_blasts ("campaignId", "createdAt" DESC);

ALTER TABLE whatsapp_blasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_members_blasts" ON whatsapp_blasts
  FOR ALL USING (
    "campaignId" IN (
      SELECT cp."campaignId" FROM campaign_profiles cp WHERE cp."userId" = auth.uid()
    )
  );

CREATE POLICY "supreme_admin_blasts" ON whatsapp_blasts
  FOR ALL USING (
    auth.jwt() ->> 'email' = current_setting('app.supreme_admin_email', true)
  );
