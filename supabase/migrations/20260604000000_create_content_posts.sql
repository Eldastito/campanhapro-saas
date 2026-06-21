-- Content Studio: AI-generated posts for IG / TikTok / WhatsApp / Facebook
CREATE TABLE IF NOT EXISTS content_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" text NOT NULL,
  channel text NOT NULL,              -- instagram | tiktok | whatsapp | facebook | twitter | generic
  "postType" text NOT NULL DEFAULT 'post', -- post | story | reel | blast | thread
  tone text,                          -- formal | neutro | popular | jovem | combativo
  topic text,                         -- short topic / brief title
  brief text,                         -- full user brief sent to AI
  "generatedText" text,               -- AI output (editable)
  "finalText" text,                   -- final approved text (after edits)
  hashtags text[],                    -- suggested hashtags
  "imageUrl" text,                    -- uploaded cover image (manual for v1)
  "complianceFlags" jsonb,            -- [{ rule, severity, message }]
  status text NOT NULL DEFAULT 'draft', -- draft | approved | scheduled | published | archived
  "scheduledAt" timestamptz,
  "publishedAt" timestamptz,
  "createdBy" uuid,
  "approvedBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_posts_campaign_status
  ON content_posts ("campaignId", status, "createdAt" DESC);

CREATE INDEX IF NOT EXISTS content_posts_scheduled
  ON content_posts ("scheduledAt")
  WHERE status = 'scheduled';

ALTER TABLE content_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_posts_select_own" ON content_posts
  FOR SELECT USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());

CREATE POLICY "content_posts_insert_own" ON content_posts
  FOR INSERT WITH CHECK ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());

CREATE POLICY "content_posts_update_own" ON content_posts
  FOR UPDATE USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());

CREATE POLICY "content_posts_delete_own" ON content_posts
  FOR DELETE USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());

CREATE POLICY "content_posts_service_role" ON content_posts
  FOR ALL USING (auth.role() = 'service_role');

-- Add content_studio feature to Estratégico and Total plans.
-- Casamos por id (estável) em vez de nome: os planos foram renomeados de
-- Pro/Enterprise → Estratégico/Total e o WHERE por nome ficaria órfão num reset.
UPDATE plans
SET features = array_append(features, 'content_studio')
WHERE id IN ('pro', 'enterprise')
  AND NOT ('content_studio' = ANY(features));

-- Backfill active subscriptions
UPDATE subscriptions s
SET features = array_append(s.features, 'content_studio')
FROM plans p
WHERE s."planId" = p.id
  AND s.status = 'active'
  AND p.id IN ('pro', 'enterprise')
  AND NOT ('content_studio' = ANY(s.features));
