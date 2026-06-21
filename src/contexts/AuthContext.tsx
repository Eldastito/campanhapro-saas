import * as React from 'react';
import { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { AuthenticatedUser, Plan } from '../types/user';
import { ensureCampaignConfig } from '../utils/planUtils';

// Governança: NADA de admin/plano por e-mail hardcoded. Supreme admin, tipo e
// plano vêm 100% do banco (users.isSupremeAdmin / type / plan). Contas novas
// passam pelo onboarding (/welcome) como qualquer uma.

interface AuthContextType {
  user: AuthenticatedUser | null;
  login: (email: string, pass: string) => Promise<void>;
  register: (name: string, email: string, pass: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => void;
  isLoading: boolean;
  isInitializing: boolean;
  userType: AuthenticatedUser['type'] | null;
  sendPasswordReset: (email: string) => Promise<void>;
  /** Senha OK (aal1) mas falta o 2º fator (TOTP). A UI mostra o desafio e o
   *  usuário fica "não logado" até completar — gate de enforcement do 2FA. */
  mfaPending: boolean;
}

const AuthContext = React.createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children?: React.ReactNode }) => {
  const [user, setUser] = React.useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [isInitializing, setIsInitializing] = React.useState<boolean>(true);
  const [mfaPending, setMfaPending] = React.useState<boolean>(false);
  // Último uid já hidratado — evita re-buscar/re-renderizar em TOKEN_REFRESHED/foco.
  const loadedUidRef = React.useRef<string | null>(null);

  const fetchOrCreateUser = React.useCallback(async (session: any) => {
    let { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (userError && userError.code === 'PGRST116') {
      // Sem linha em users → conta nova. Devolve placeholder (sem campaign_id) pro
      // router mandar pro /welcome, onde o backend (onboarding/bootstrap) cria
      // campanha + assinatura. Sem auto-bootstrap por e-mail (governança).
      return {
        id: session.user.id,
        email: session.user.email,
        name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Novo Usuário',
        type: null,
        plan: null,
        role: 'active',
        campaign_id: null,
        is_supreme_admin: false,
      };
    } else if (userError) {
      return null;
    } else {
      const resolvedCampaignId = userData?.campaignId;
      if (resolvedCampaignId && userData?.plan) {
        // Garante que usuários existentes também tenham campaign_configs
        try {
          await ensureCampaignConfig(supabase, resolvedCampaignId, userData.plan as Plan);
        } catch (err) {
          console.warn('Falha ao verificar campaign_configs:', err);
        }
      }
    }
    return userData;
  }, []);

  React.useEffect(() => {
    // Timeout de segurança: garante que isInitializing sempre resolve,
    // mesmo se onAuthStateChange falhar silenciosamente.
    const safetyTimeout = setTimeout(() => setIsInitializing(false), 2000);

    // IMPORTANTE: o callback do onAuthStateChange NÃO pode ser async nem dar
    // `await` em chamadas Supabase aqui dentro — o GoTrue segura um lock durante
    // o callback e a chamada ao banco fica esperando o mesmo lock → DEADLOCK
    // (trava o cliente; toda requisição via getSession congela; só F5 destrava).
    // Solução: callback síncrono + diferir a busca do usuário com setTimeout(0).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      clearTimeout(safetyTimeout);
      const uid = session?.user?.id || null;

      if (!uid || !session) { loadedUidRef.current = null; setUser(null); setIsInitializing(false); return; }
      // Mesmo usuário já carregado (TOKEN_REFRESHED, foco na aba, INITIAL_SESSION
      // repetido) → não re-busca nem re-renderiza (evitava limpar formulários).
      if (uid === loadedUidRef.current) { setIsInitializing(false); return; }

      setTimeout(async () => {
        try {
          // 2FA: se a sessão fez senha (aal1) mas exige 2º fator (aal2), NÃO
          // consideramos logado — segura em mfaPending até o TOTP. Sem isso o
          // router redirecionaria pro /app pulando o desafio. Leitura local do
          // token (sem rede), seguro fora do callback síncrono do GoTrue.
          try {
            const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
            if (aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal2') {
              setMfaPending(true);
              setUser(null);
              setIsInitializing(false);
              return; // não seta loadedUidRef → re-avalia após o verify (aal2)
            }
          } catch { /* sem MFA → fluxo normal */ }
          setMfaPending(false);

          const userData = await fetchOrCreateUser(session);
          if (userData) {
            const dbCampaignId = userData.campaignId;
            const dbAssignedLeaderId = userData.assignedLeaderId;
            // Supreme admin, tipo e plano vêm SÓ do banco — sem override por e-mail.
            const isSupremeAdmin = !!(userData.isSupremeAdmin);
            loadedUidRef.current = uid;
            setUser({
              ...userData,
              uid: session.user.id,
              isSupremeAdmin,
              type: userData.type,
              plan: userData.plan,
              campaignId: dbCampaignId,
              assignedLeaderId: dbAssignedLeaderId,
            } as AuthenticatedUser);
          }
        } catch (err) {
          console.error("Erro na inicialização do Auth:", err);
        } finally {
          setIsInitializing(false);
        }
      }, 0);
    });

    const handleMessage = async (event: MessageEvent) => {
      try {
        if (event.data?.type === 'SUPABASE_OAUTH_CODE' || event.data?.type === 'SUPABASE_OAUTH_TOKENS') {
          if (event.source) {
            (event.source as Window).postMessage({ type: 'OAUTH_ACK' }, '*');
          }

          if (event.data.type === 'SUPABASE_OAUTH_CODE') {
            setIsLoading(true);
            const { error } = await supabase.auth.exchangeCodeForSession(event.data.code);
            if (error) throw error;
          } else if (event.data.type === 'SUPABASE_OAUTH_TOKENS') {
            setIsLoading(true);
            const { error } = await supabase.auth.setSession({
              access_token: event.data.access_token,
              refresh_token: event.data.refresh_token
            });
            if (error) throw error;
          }
        }
      } catch (err: any) {
        console.error("Erro na sincronização OAuth:", err);
      } finally {
        setIsLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('supabase_oauth_channel');
      bc.onmessage = handleMessage;
    } catch (e) {
      console.warn("BroadcastChannel não suportado.");
    }

    return () => {
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
      window.removeEventListener('message', handleMessage);
      if (bc) bc.close();
    };
  }, [fetchOrCreateUser]);

  // Registra evento de acesso na auditoria (best-effort, nunca quebra o fluxo).
  const logAccessEvent = async (event: 'login' | 'logout') => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      await fetch('/api/v1/access-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ event }),
      });
    } catch { /* ignore — auditoria não pode atrapalhar login/logout */ }
  };

  const login = async (email: string, pass: string) => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      logAccessEvent('login'); // não-bloqueante
    } catch (error: any) {
      console.error("Erro no login:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (name: string, email: string, pass: string) => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password: pass,
        options: { data: { name } }
      });
      if (error) throw error;
    } catch (error: any) {
      console.error("Erro no registro:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          skipBrowserRedirect: true,
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
      if (data?.url) {
        const authWindow = window.open(data.url, 'oauth_popup', 'width=600,height=700');
        if (!authWindow) throw new Error("Popup bloqueado.");
      }
    } catch (error: any) {
      console.error("Erro no login Google:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await logAccessEvent('logout'); // registra ANTES de invalidar o token
      await supabase.auth.signOut();
      window.location.reload();
    } catch (error) {
      console.error("Erro ao fazer logout:", error);
    }
  };

  const sendPasswordReset = async (email: string) => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
    } catch (error: any) {
      console.error("Erro recuperação senha:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const value = {
    user, login, register, loginWithGoogle, logout, sendPasswordReset,
    isLoading, isInitializing, userType: user?.type || null, mfaPending,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
