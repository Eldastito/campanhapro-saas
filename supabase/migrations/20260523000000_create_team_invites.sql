-- Phase 12: Team invitations

CREATE TABLE IF NOT EXISTS team_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"    UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL,                  -- references UserRole enum (validated server-side)
  /** URL-safe random token; 32 bytes of entropy. */
  token           TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  "invitedBy"     UUID,                            -- users(id) of the Admin who created the invite
  "invitedByName" TEXT,                            -- denormalised for the email/landing page
  "expiresAt"     TIMESTAMPTZ NOT NULL,
  "acceptedAt"    TIMESTAMPTZ,
  "acceptedBy"    UUID,                            -- users(id) who consumed the invite
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE team_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_invites_campaign_isolation"
  ON team_invites FOR SELECT
  USING ("campaignId" IN (SELECT "campaignId" FROM users WHERE id = auth.uid()));

-- One pending invite per (campaign, email) — blocks spam re-invites and
-- avoids race conditions when the same email is invited twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_invites_pending_campaign_email
  ON team_invites ("campaignId", email)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_team_invites_campaign_status
  ON team_invites ("campaignId", status, "createdAt" DESC);
