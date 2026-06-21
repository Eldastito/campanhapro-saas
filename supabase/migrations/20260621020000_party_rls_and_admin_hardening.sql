-- Follow-up da revisão de segurança do módulo Partido.

-- ── 1) Uniformiza RLS das tabelas party que estavam com RLS ligado e 0 policies ──
-- Ficavam deny-all pra qualquer chave que não a service role. Funciona (o backend
-- usa service role), mas era inconsistente com party_checkins/committees/repasses.
-- Damos LEITURA escopada ao presidente do partido (ou supremo). A ESCRITA segue
-- só via service role (backend) de propósito: logs/auditoria ficam à prova de
-- adulteração pelo cliente — por isso SELECT, não ALL.
CREATE POLICY "party_recurring_repasses_pres_read" ON party_recurring_repasses
  FOR SELECT USING (("partyId" = get_president_party_id()) OR is_supreme_admin());

CREATE POLICY "party_valve_log_pres_read" ON party_valve_log
  FOR SELECT USING (("partyId" = get_president_party_id()) OR is_supreme_admin());

CREATE POLICY "party_ai_command_logs_pres_read" ON party_ai_command_logs
  FOR SELECT USING (("partyId" = get_president_party_id()) OR is_supreme_admin());

CREATE POLICY "party_wipe_audit_pres_read" ON party_wipe_audit
  FOR SELECT USING (("partyId" = get_president_party_id()) OR is_supreme_admin());

-- ── 2) Governança: remove os e-mails hardcoded de is_supreme_admin() ────────────
-- Tinha um "backdoor por string" (eldastito@/examepad@). Dropar o fallback sem
-- mais nada demoveria contas que dependiam só dele — examepad@ está hoje com a
-- flag FALSE. Então: primeiro garante a flag nas contas atuais (preserva o
-- comportamento), depois redefine a função pra decidir SÓ pela flag.
UPDATE users SET "isSupremeAdmin" = TRUE
  WHERE email IN ('eldastito@gmail.com', 'examepad@gmail.com');

CREATE OR REPLACE FUNCTION public.is_supreme_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
      AND "isSupremeAdmin" = TRUE
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
