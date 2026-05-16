-- Phase 12: Team invitations

CREATE TABLE IF NOT EXISTS team_invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL,                  -- references UserRole enum (validated server-side)
  /** URL-safe random token; 32 bytes of entropy. */
  token         TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by    UUID,                            -- users(id) of the Admin who created the invite
  invited_by_name TEXT,                          -- denormalised for the email/landing page
  expires_at    TIMESTAMPTZ NOT NULL,
  accepted_at   TIMESTAMPTZ,
  accepted_by   UUID,                            -- users(id) who consumed the invite
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE team_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_invites_campaign_isolation"
  ON team_invites FOR SELECT
  USING (campaign_id IN (SELECT campaign_id FROM users WHERE id = auth.uid()));

-- One pending invite per (campaign, email) — blocks spam re-invites and
-- avoids race conditions when the same email is invited twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_invites_pending_campaign_email
  ON team_invites (campaign_id, email)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_team_invites_campaign_status
  ON team_invites (campaign_id, status, created_at DESC);
