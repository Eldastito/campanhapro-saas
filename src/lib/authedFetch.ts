/**
 * Wraps fetch() with the user's Supabase session token, sent as Bearer in
 * the Authorization header. Use this for every call to /api/v1/* — the
 * backend's requireAuth middleware rejects requests without it.
 *
 * Falls back to a plain fetch if no session exists (e.g. public endpoints
 * like /api/v1/team/invites/token/:token, which gracefully accept anon).
 */
import { supabase } from './supabaseClient';

export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (session?.access_token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers });
}
