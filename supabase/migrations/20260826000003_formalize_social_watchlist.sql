-- Formaliza `social_watchlist` (Pulso dos Bairros). Descoberta como GHOST
-- TABLE no F0 audit.
--
-- Usada por `src/server/modules/social/socialRouter.ts`:
--   :333 GET   /watchlist
--   :343 POST  /watchlist   (upsert onConflict "campaignId,username")
--   :358 DEL   /watchlist/:id
--   :376 SELECT em /instagram/pulse
--   :385 UPDATE lastSnapshot após businessDiscovery
--
-- Username segue o padrão do IG (regex em socialRouter.ts:350):
-- ^[A-Za-z0-9._]{1,30}$

CREATE TABLE IF NOT EXISTS social_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" TEXT NOT NULL,
  username TEXT NOT NULL,
  label TEXT NULL,
  bairro TEXT NULL,
  "lastSnapshot" JSONB NULL,           -- {at, followers, topPostComments} — vem de businessDiscovery
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("campaignId", username),
  CONSTRAINT social_watchlist_username_format
    CHECK (username ~ '^[A-Za-z0-9._]{1,30}$')
);

CREATE INDEX IF NOT EXISTS social_watchlist_campaign_idx
  ON social_watchlist ("campaignId", "createdAt");

ALTER TABLE social_watchlist ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_watchlist_read_own' AND tablename = 'social_watchlist') THEN
    CREATE POLICY social_watchlist_read_own ON social_watchlist
      FOR SELECT
      USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_watchlist_write_own' AND tablename = 'social_watchlist') THEN
    CREATE POLICY social_watchlist_write_own ON social_watchlist
      FOR ALL
      USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin())
      WITH CHECK ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_watchlist_service_all' AND tablename = 'social_watchlist') THEN
    CREATE POLICY social_watchlist_service_all ON social_watchlist
      FOR ALL
      TO service_role
      USING (TRUE)
      WITH CHECK (TRUE);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
