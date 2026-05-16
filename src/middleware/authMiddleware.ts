/**
 * Middleware de Autenticação JWT para endpoints sensíveis.
 * Valida o token Bearer via supabaseAdmin.auth.getUser()
 * e injeta req.user com dados do usuário autenticado.
 */
import { Request, Response, NextFunction } from 'express';

// Extensão do tipo Request do Express para incluir o usuário autenticado
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role?: string;
        campaignId?: string | null;
        userType?: string | null;
        isSupremeAdmin?: boolean;
      };
    }
  }
}

/**
 * Cria o middleware de autenticação JWT usando o cliente Supabase Admin.
 * O supabaseAdmin deve ser inicializado com a SUPABASE_SERVICE_ROLE_KEY.
 */
export function createAuthMiddleware(supabaseAdmin: any) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 1. Verificar se supabaseAdmin está disponível
      if (!supabaseAdmin) {
        console.error('[Auth Middleware] supabaseAdmin não inicializado.');
        return res.status(503).json({ error: 'Serviço de autenticação indisponível.' });
      }

      // 2. Extrair token do header Authorization
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de autenticação ausente.' });
      }

      const token = authHeader.substring(7); // Remove "Bearer "

      // 3. Validar token via Supabase Auth
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

      if (error || !user) {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
      }

      // 4. Enrich with profile data from `users` table (campaign_id, type, is_supreme_admin).
      // Missing row is OK during onboarding — frontend bootstraps it on first auth.
      let campaignId: string | null = null;
      let userType: string | null = null;
      let isSupremeAdmin = false;
      try {
        const { data: profile } = await supabaseAdmin
          .from('users')
          .select('campaign_id, type, is_supreme_admin')
          .eq('id', user.id)
          .maybeSingle();
        if (profile) {
          campaignId = profile.campaign_id ?? null;
          userType = profile.type ?? null;
          isSupremeAdmin = !!profile.is_supreme_admin;
        }
      } catch (err: any) {
        console.warn('[Auth Middleware] Falha ao carregar perfil:', err.message);
      }

      // 5. Injetar dados do usuário no request
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        campaignId,
        userType,
        isSupremeAdmin,
      };

      next();
    } catch (err: any) {
      console.error('[Auth Middleware] Erro inesperado:', err.message);
      return res.status(500).json({ error: 'Erro interno na autenticação.' });
    }
  };
}
