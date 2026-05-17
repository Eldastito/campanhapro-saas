-- Add Kanban stage + priority to channel_conversations
ALTER TABLE channel_conversations
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'novo_lead'
    CHECK (stage IN ('novo_lead', 'em_atendimento', 'proposta', 'fechado')),
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'media'
    CHECK (priority IN ('alta', 'media', 'baixa'));

CREATE INDEX IF NOT EXISTS idx_conv_campaign_stage
  ON channel_conversations ("campaignId", stage);

-- Add status to agenda_events
ALTER TABLE agenda_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'confirmado', 'aguardando_ok', 'concluido', 'cancelado'));
