-- Correção de governança. A migration 20260621020000 setou isSupremeAdmin=TRUE
-- nas DUAS contas pra "preservar o comportamento" da função antiga — mas aquela
-- função concedia supreme ao examepad@ por engano (e-mail hardcoded). O seed e o
-- frontend sempre trataram examepad@ como Admin de CAMPANHA, não gestor de
-- plataforma. Aqui revertemos: só eldastito@ é supreme admin.
UPDATE users SET "isSupremeAdmin" = FALSE WHERE email = 'examepad@gmail.com';
