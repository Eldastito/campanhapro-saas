-- =============================================
-- PARTE 30: Rastreador manual de Notas Fiscais (NFS-e) — F4
--
-- Tabela nf_invoices + função supreme_nf_summary(). Permite registrar
-- manualmente as NFS-e emitidas (na Nota Carioca/pelo contador) enquanto não
-- há emissor automático integrado. Quando houver certificado A1 + cadastro
-- municipal RJ + emissor (NFe.io/Focus/eNotas), os campos provider/
-- providerInvoiceId/pdfUrl são preenchidos automaticamente pela integração.
--
-- Execute no SQL Editor do Supabase. Idempotente.
-- =============================================

CREATE TABLE IF NOT EXISTS nf_invoices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    "campaignId" TEXT,
    "subscriptionId" UUID,
    number TEXT,
    "amountCents" BIGINT NOT NULL CHECK ("amountCents" >= 0),
    "issCents" BIGINT DEFAULT 0,
    "customerName" TEXT,
    "customerDoc" TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'emitida' CHECK (status IN ('rascunho','emitida','cancelada','substituida')),
    "issuedAt" DATE NOT NULL DEFAULT CURRENT_DATE,
    "pdfUrl" TEXT,
    provider TEXT,
    "providerInvoiceId" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nf_invoices_issued ON nf_invoices("issuedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_nf_invoices_campaign ON nf_invoices("campaignId");

ALTER TABLE nf_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages nf invoices" ON nf_invoices;
CREATE POLICY "service role manages nf invoices" ON nf_invoices
    FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE OR REPLACE FUNCTION supreme_nf_summary()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT jsonb_build_object(
    'totalEmitidasCents', coalesce(sum("amountCents") FILTER (WHERE status='emitida'),0),
    'mesAtualCents', coalesce(sum("amountCents") FILTER (WHERE status='emitida' AND date_trunc('month',"issuedAt")=date_trunc('month',CURRENT_DATE)),0),
    'count', count(*) FILTER (WHERE status='emitida'),
    'canceladas', count(*) FILTER (WHERE status='cancelada'),
    'items', (
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x."issuedAt" DESC),'[]'::jsonb)
      FROM (
        SELECT n.id, n.number, n."amountCents", n."customerName", n."customerDoc",
               n.description, n.status, n."issuedAt", n.provider, n."pdfUrl",
               (SELECT name FROM users u WHERE u."campaignId"::text = n."campaignId" AND u.type='Admin' LIMIT 1) AS campaign_name
        FROM nf_invoices n ORDER BY n."issuedAt" DESC LIMIT 200
      ) x
    )
  ) FROM nf_invoices;
$$;
REVOKE ALL ON FUNCTION supreme_nf_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supreme_nf_summary() TO service_role;
