-- PR 6 (backend) — Pareceres do módulo Blindagem Jurídico-Contábil.
--
-- legal_opinions: saída do pipeline (Contábil → Jurídico). Por campanha.
-- legal_opinion_citations: fontes da base curada citadas em cada parecer
-- (proveniência — de onde veio cada afirmação).

CREATE TABLE IF NOT EXISTS legal_opinions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"       text        NOT NULL,
  kind               text        NOT NULL DEFAULT 'combined', -- accounting | legal | combined
  "subjectType"      text        NOT NULL,  -- transaction | expense | donation | contract | free_query | accounts_rendering
  "subjectId"        text,
  title              text        NOT NULL,
  "accountingText"   text,
  "legalText"        text,
  "riskLevel"        text,       -- baixo | médio | alto | crítico
  status             text        NOT NULL DEFAULT 'final', -- draft | final | archived
  "electionYear"     int,
  provider           text,
  "modelUsed"        text,
  "costCentsUsd"     int         NOT NULL DEFAULT 0,
  disclaimer         text,
  "createdByUserId"  text,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_opinions_campaign ON legal_opinions ("campaignId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_legal_opinions_risk     ON legal_opinions ("campaignId", "riskLevel");

CREATE TABLE IF NOT EXISTS legal_opinion_citations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "opinionId"   uuid        NOT NULL REFERENCES legal_opinions(id) ON DELETE CASCADE,
  "campaignId"  text        NOT NULL,
  "chunkId"     uuid,
  source        text,
  "sourceOrg"   text,
  "sourceUrl"   text,
  "electionYear" int,
  excerpt       text,
  similarity    float,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_citations_opinion ON legal_opinion_citations ("opinionId");

-- RLS: leitura/escrita do próprio tenant (+ supreme admin); service_role bypass.
ALTER TABLE legal_opinions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_opinion_citations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "legal_opinions_select_own" ON legal_opinions;
CREATE POLICY "legal_opinions_select_own" ON legal_opinions
  FOR SELECT USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());
DROP POLICY IF EXISTS "legal_opinions_service_role" ON legal_opinions;
CREATE POLICY "legal_opinions_service_role" ON legal_opinions
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "legal_citations_select_own" ON legal_opinion_citations;
CREATE POLICY "legal_citations_select_own" ON legal_opinion_citations
  FOR SELECT USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());
DROP POLICY IF EXISTS "legal_citations_service_role" ON legal_opinion_citations;
CREATE POLICY "legal_citations_service_role" ON legal_opinion_citations
  FOR ALL USING (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
