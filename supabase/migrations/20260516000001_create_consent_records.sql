-- Phase 3: LGPD consent audit trail

CREATE TABLE IF NOT EXISTS consent_records (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"    text        NOT NULL,
  "contactId"     uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel         text        NOT NULL CHECK (channel IN ('whatsapp','instagram','email','sms')),
  granted         boolean     NOT NULL,
  source          text        NOT NULL,
  note            text,
  "revokedAt"     timestamptz,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_contact_channel
  ON consent_records ("contactId", channel, "createdAt" DESC);

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Campaign members read consent"
  ON consent_records FOR SELECT
  USING ("campaignId" IN (SELECT "campaignId"::text FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role bypass consent"
  ON consent_records FOR ALL
  USING (auth.role() = 'service_role');
