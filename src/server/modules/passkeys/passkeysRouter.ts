/**
 * Endpoints de Passkeys — Estratégia B (login passwordless com backend próprio).
 *
 * Por que existe: o WebAuthn do Supabase Auth é só MFA/step-up (exige sessão +
 * factorId). Para "entrar só com biometria" na tela inicial, o backend verifica
 * a asserção WebAuthn (SimpleWebAuthn) e, só então, emite uma sessão Supabase
 * via admin.generateLink('magiclink') → o cliente troca o token por sessão com
 * verifyOtp. A senha continua intacta como caminho paralelo.
 *
 * Rotas (montadas em /api/v1/passkeys):
 *   POST /register/options   (AUTH)    opções de cadastro p/ o usuário logado
 *   POST /register/verify    (AUTH)    grava a credencial após o navegador assinar
 *   POST /login/options      (PÚBLICA) desafio de login (discoverable credentials)
 *   POST /login/verify       (PÚBLICA) verifica a asserção e emite token de sessão
 *
 * Tudo gated por PASSKEY_B_ENABLED: desligado → 404 (rota dormente, zero efeito).
 * As tabelas (user_passkey_credentials, webauthn_challenges) têm RLS sem policies
 * → só o service_role (este backend) enxerga.
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildRegistrationOptions,
  checkRegistration,
  buildAuthenticationOptions,
  checkAuthentication,
  toBase64url,
  fromBase64url,
  getRpConfig,
} from './webauthn';

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 min — desafio é de uso único e curto.

function enabled(): boolean {
  return process.env.PASSKEY_B_ENABLED === 'true';
}

/** Extrai o challenge (base64url) de dentro do clientDataJSON da resposta. */
function challengeFromResponse(resp: unknown): string | null {
  try {
    const cdj = (resp as { response?: { clientDataJSON?: string } })?.response?.clientDataJSON;
    if (!cdj) return null;
    const json = JSON.parse(Buffer.from(cdj, 'base64url').toString('utf8')) as { challenge?: string };
    return json.challenge ?? null;
  } catch {
    return null;
  }
}

export function createPasskeysRouter(supabase: SupabaseClient): Router {
  const router = Router();
  const admin = (supabase as any).auth.admin;

  // Guarda de flag para todas as rotas — rota dormente quando desligada.
  router.use((_req, res, next) => {
    if (!enabled()) return res.status(404).json({ error: 'passkey_disabled' });
    try {
      getRpConfig(); // valida WEBAUTHN_RP_ID/ORIGIN cedo (erro claro vs. 500 cru)
    } catch {
      return res.status(503).json({ error: 'passkey_not_configured' });
    }
    next();
  });

  // ---- CADASTRO (usuário já logado) ----------------------------------------

  router.post('/register/options', async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: 'unauthorized' });
    try {
      const { data: creds } = await supabase
        .from('user_passkey_credentials')
        .select('credential_id, transports')
        .eq('user_id', user.id)
        .is('revoked_at', null);
      const existing = (creds ?? []).map((c: any) => ({
        credentialId: c.credential_id,
        transports: c.transports ?? undefined,
      }));
      const options = await buildRegistrationOptions({
        userId: user.id,
        userName: user.email ?? user.id,
        userDisplayName: user.email ?? undefined,
        existing,
      });
      await supabase.from('webauthn_challenges').insert({
        user_id: user.id,
        purpose: 'register',
        challenge: options.challenge,
        expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
      });
      return res.json(options);
    } catch (e: any) {
      return res.status(500).json({ error: 'register_options_failed', detail: String(e?.message ?? e) });
    }
  });

  router.post('/register/verify', async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: 'unauthorized' });
    const { response, deviceName } = req.body ?? {};
    if (!response) return res.status(400).json({ error: 'missing_response' });
    try {
      // Pega o desafio de registro mais recente, válido e não usado, do usuário.
      const { data: chal } = await supabase
        .from('webauthn_challenges')
        .select('id, challenge, expires_at, used_at')
        .eq('user_id', user.id)
        .eq('purpose', 'register')
        .is('used_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!chal || new Date((chal as any).expires_at) < new Date()) {
        return res.status(400).json({ error: 'challenge_expired' });
      }
      const verification = await checkRegistration({
        response,
        expectedChallenge: (chal as any).challenge,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({ error: 'verification_failed' });
      }
      const { credential, credentialBackedUp } = verification.registrationInfo;
      await supabase.from('webauthn_challenges').update({ used_at: new Date().toISOString() }).eq('id', (chal as any).id);
      const { error: insErr } = await supabase.from('user_passkey_credentials').insert({
        user_id: user.id,
        credential_id: credential.id,
        public_key: toBase64url(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? null,
        device_name: typeof deviceName === 'string' ? deviceName.slice(0, 120) : null,
        backed_up: credentialBackedUp ?? null,
      });
      if (insErr) {
        // unique violation = credencial já cadastrada
        if ((insErr as any).code === '23505') return res.status(409).json({ error: 'already_registered' });
        throw insErr;
      }
      return res.json({ verified: true });
    } catch (e: any) {
      return res.status(500).json({ error: 'register_verify_failed', detail: String(e?.message ?? e) });
    }
  });

  // ---- GESTÃO (usuário logado): listar e revogar ---------------------------

  router.get('/list', async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: 'unauthorized' });
    try {
      const { data } = await supabase
        .from('user_passkey_credentials')
        .select('id, device_name, created_at, last_used_at, revoked_at')
        .eq('user_id', user.id)
        .is('revoked_at', null)
        .order('created_at', { ascending: false });
      return res.json({ credentials: data ?? [] });
    } catch (e: any) {
      return res.status(500).json({ error: 'list_failed', detail: String(e?.message ?? e) });
    }
  });

  router.post('/revoke', async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: 'unauthorized' });
    const { id } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'missing_id' });
    try {
      // Só revoga credencial do próprio usuário (eq user_id) — nunca de terceiros.
      const { error } = await supabase
        .from('user_passkey_credentials')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
      return res.json({ revoked: true });
    } catch (e: any) {
      return res.status(500).json({ error: 'revoke_failed', detail: String(e?.message ?? e) });
    }
  });

  // ---- LOGIN (público, passwordless) ---------------------------------------

  router.post('/login/options', async (_req: Request, res: Response) => {
    try {
      // Discoverable credentials: sem allowCredentials, o autenticador oferece
      // as passkeys que ele tem para este RP. O usuário é descoberto na verify.
      const options = await buildAuthenticationOptions();
      await supabase.from('webauthn_challenges').insert({
        user_id: null,
        purpose: 'login',
        challenge: options.challenge,
        expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
      });
      return res.json(options);
    } catch (e: any) {
      return res.status(500).json({ error: 'login_options_failed', detail: String(e?.message ?? e) });
    }
  });

  router.post('/login/verify', async (req: Request, res: Response) => {
    const { response } = req.body ?? {};
    if (!response?.id) return res.status(400).json({ error: 'missing_response' });
    try {
      // O challenge volta dentro do clientDataJSON — casamos com a linha emitida.
      const challenge = challengeFromResponse(response);
      if (!challenge) return res.status(400).json({ error: 'invalid_response' });
      const { data: chal } = await supabase
        .from('webauthn_challenges')
        .select('id, expires_at, used_at')
        .eq('purpose', 'login')
        .eq('challenge', challenge)
        .is('used_at', null)
        .maybeSingle();
      if (!chal || new Date((chal as any).expires_at) < new Date()) {
        return res.status(400).json({ error: 'challenge_expired' });
      }
      // Localiza a credencial pelo ID que o navegador devolveu.
      const { data: cred } = await supabase
        .from('user_passkey_credentials')
        .select('id, user_id, credential_id, public_key, counter, transports, revoked_at')
        .eq('credential_id', response.id)
        .maybeSingle();
      if (!cred || (cred as any).revoked_at) {
        return res.status(401).json({ error: 'credential_not_found' });
      }
      const verification = await checkAuthentication({
        response,
        expectedChallenge: challenge,
        credential: {
          id: (cred as any).credential_id,
          publicKey: fromBase64url((cred as any).public_key),
          counter: Number((cred as any).counter ?? 0),
          transports: (cred as any).transports ?? undefined,
        },
      });
      if (!verification.verified) return res.status(401).json({ error: 'verification_failed' });

      // Desafio consumido + contador atualizado (anti-replay/clonagem).
      await supabase.from('webauthn_challenges').update({ used_at: new Date().toISOString() }).eq('id', (chal as any).id);
      await supabase.from('user_passkey_credentials').update({
        counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
      }).eq('id', (cred as any).id);

      // Descobre o e-mail do dono e emite o token de sessão (magiclink hashed).
      const { data: userData, error: userErr } = await admin.getUserById((cred as any).user_id);
      const email = userData?.user?.email;
      if (userErr || !email) return res.status(500).json({ error: 'user_lookup_failed' });

      const { data: link, error: linkErr } = await admin.generateLink({ type: 'magiclink', email });
      const tokenHash = link?.properties?.hashed_token;
      if (linkErr || !tokenHash) return res.status(500).json({ error: 'session_mint_failed' });

      // O cliente troca isto por uma sessão real: verifyOtp({ token_hash, type: 'magiclink' }).
      return res.json({ verified: true, email, token_hash: tokenHash, type: 'magiclink' });
    } catch (e: any) {
      return res.status(500).json({ error: 'login_verify_failed', detail: String(e?.message ?? e) });
    }
  });

  return router;
}
