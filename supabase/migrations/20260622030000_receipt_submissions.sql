-- Fila de comprovantes: qualquer membro da campanha envia a foto/PDF do
-- comprovante "na hora" (evita perder). O OCR (GPT-4o visão) pré-preenche os
-- campos; o financeiro/admin revisa e aprova → vira receita/despesa oficial.
CREATE TABLE IF NOT EXISTS receipt_submissions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"        text        NOT NULL,
  kind                text        NOT NULL,                       -- income | expense
  "imageUrl"          text        NOT NULL,                       -- data URL (imagem/PDF) base64
  status              text        NOT NULL DEFAULT 'pending',     -- pending | approved | rejected
  "ocrStatus"         text        NOT NULL DEFAULT 'pending',     -- pending | processing | done | error
  "ocrData"           jsonb,
  note                text,
  "submittedByUserId" text,
  "submittedByName"   text,
  "reviewedByUserId"  text,
  "reviewedAt"        timestamptz,
  "rejectionReason"   text,
  "linkedTable"       text,                                       -- incomes | expenses
  "linkedId"          uuid,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipt_subs_campaign_status
  ON receipt_submissions ("campaignId", status, "createdAt" DESC);

ALTER TABLE receipt_submissions ENABLE ROW LEVEL SECURITY;

-- Defesa em profundidade (o backend usa service_role): membros da campanha leem
-- os comprovantes da própria campanha; service_role faz tudo.
DROP POLICY IF EXISTS "receipt_subs_select_campaign" ON receipt_submissions;
CREATE POLICY "receipt_subs_select_campaign" ON receipt_submissions
  FOR SELECT USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());
DROP POLICY IF EXISTS "receipt_subs_service" ON receipt_submissions;
CREATE POLICY "receipt_subs_service" ON receipt_submissions
  FOR ALL USING (auth.role() = 'service_role');

-- Sem isto o PostgREST devolve 404 nas tabelas/colunas novas.
NOTIFY pgrst, 'reload schema';
