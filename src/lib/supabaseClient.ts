import { createClient } from '@supabase/supabase-js';

const isBrowser = typeof window !== 'undefined';

const supabaseUrl = (isBrowser ? import.meta.env.VITE_SUPABASE_URL : null) ||
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  '';

const supabaseAnonKey = (isBrowser ? import.meta.env.VITE_SUPABASE_ANON_KEY : null) ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Credenciais nao detectadas. Verifique VITE_SUPABASE_URL/ANON_KEY.');
}

// DB schema uses camelCase columns matching the TypeScript interfaces directly,
// so no translation wrapper is needed — front and back share the same field names.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'campanhapro-auth-token',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    // Disables navigator.locks to avoid NavigatorLockAcquireTimeoutError under React Strict Mode.
    lock: <R>(_name: string, _timeout: number, fn: () => Promise<R>): Promise<R> => fn(),
  }
});

// Backwards-compatible alias for code that imported `rawSupabase`.
export { supabase as rawSupabase };
