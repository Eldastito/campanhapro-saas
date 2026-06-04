-- =============================================
-- PARTE 24: Encurtador interno de URLs por campanha
--
-- Permite ao Admin criar links curtos (slug → target_url) que ficam
-- públicos em /l/:slug. Suporta expiração opcional, conta cliques
-- atomicamente, e mantém o escopo por campanha.
--
-- Execute no SQL Editor do Supabase.
-- =============================================

CREATE TABLE IF NOT EXISTS short_links (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9_-]{2,60}$'),
    target_url TEXT NOT NULL CHECK (length(target_url) BETWEEN 1 AND 2048),
    title TEXT,
    -- UUID matches users.campaignId / campaigns.id in production
    "campaignId" UUID,
    "createdBy" UUID REFERENCES users(id) ON DELETE SET NULL,
    clicks INTEGER NOT NULL DEFAULT 0,
    "lastClickAt" TIMESTAMPTZ,
    "expiresAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_short_links_campaign ON short_links("campaignId");
-- Partial index: only rows that actually expire benefit from the lookup,
-- and the table can grow without bloating this index with NULLs.
CREATE INDEX IF NOT EXISTS idx_short_links_expires
    ON short_links("expiresAt")
    WHERE "expiresAt" IS NOT NULL;

-- =====================================================================
-- RLS — Admin/Suporte da própria campanha podem CRUD; público lê via
-- service_role no servidor (a rota /l/:slug usa admin client, não JWT).
-- =====================================================================
ALTER TABLE short_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Campaign admins can manage short links" ON short_links;
CREATE POLICY "Campaign admins can manage short links" ON short_links
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = auth.uid()
              AND u.type IN ('Admin', 'Suporte')
              AND (
                  u."campaignId" = short_links."campaignId"
                  OR u."isSupremeAdmin" = TRUE
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = auth.uid()
              AND u.type IN ('Admin', 'Suporte')
              AND (
                  u."campaignId" = short_links."campaignId"
                  OR u."isSupremeAdmin" = TRUE
              )
        )
    );

DROP POLICY IF EXISTS "Service role bypass short links" ON short_links;
CREATE POLICY "Service role bypass short links" ON short_links
    FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- =====================================================================
-- Função atômica para incrementar cliques. A rota /l/:slug dispara isso
-- fire-and-forget para não bloquear o redirect 301.
-- =====================================================================
CREATE OR REPLACE FUNCTION increment_short_link_click(p_slug TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE short_links
    SET clicks      = clicks + 1,
        "lastClickAt" = NOW()
    WHERE slug = lower(p_slug);
END;
$$;

REVOKE ALL ON FUNCTION increment_short_link_click(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_short_link_click(TEXT) TO service_role, authenticated;

-- =====================================================================
-- Trigger pra manter updatedAt sincronizado em UPDATEs
-- =====================================================================
CREATE OR REPLACE FUNCTION touch_short_links_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS short_links_set_updated_at ON short_links;
CREATE TRIGGER short_links_set_updated_at
    BEFORE UPDATE ON short_links
    FOR EACH ROW
    EXECUTE FUNCTION touch_short_links_updated_at();
