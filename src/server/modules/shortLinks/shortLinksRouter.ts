/**
 * Short-link service — admin CRUD + public redirect.
 *
 * Mounted in server.ts as:
 *   app.use('/api/v1/short-links', requireAuth, mutationLimiter, createShortLinksAdminRouter(supabaseAdmin))
 *   app.use('/l', webhookLimiter, createShortLinksPublicRouter(supabaseAdmin))
 *
 * Admin endpoints (auth required):
 *   POST   /                    create a short link
 *   GET    /                    list links for the current campaign
 *   PATCH  /:id                 update target_url / title / expiresAt
 *   DELETE /:id                 delete
 *
 * Public endpoint (no auth):
 *   GET    /:slug               302 redirect to target_url + atomic click counter
 *
 * Authorization: the underlying RLS policy only lets type='Admin'/'Suporte'
 * write rows for their campaign (or any campaign if isSupremeAdmin). The
 * router does an explicit check upfront to return a clean 403 instead of
 * letting the DB rejection bubble up as a generic 500.
 */
import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { tenantCampaignId } from '../../lib/tenantScope';

// ---------- helpers ----------

function campaignIdOf(req: Request): string | undefined {
  return tenantCampaignId(req);
}

function userOf(req: Request): { id?: string; type?: string; isSupremeAdmin?: boolean } {
  return (req as any).user ?? {};
}

function isAdminOrSupport(req: Request): boolean {
  const u = userOf(req);
  if (u.isSupremeAdmin) return true;
  return u.type === 'Admin' || u.type === 'Suporte';
}

/** Validates that a candidate slug fits our allowed shape. */
const SLUG_RE = /^[a-z0-9_-]{2,60}$/;
function normalizeSlug(raw: string): string | null {
  const s = String(raw || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
  return SLUG_RE.test(s) ? s : null;
}

/** Generates a 7-char base32-ish slug (~3.5 billion combos). */
function autoSlug(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/1/o/i/l for legibility
  const bytes = randomBytes(7);
  let out = '';
  for (let i = 0; i < 7; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * Crude URL guard — we don't want admins making the redirect target a
 * javascript: or data: URL since it would be served from our own origin.
 * Allow http/https only.
 */
function isAllowedTargetUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  if (url.length < 1 || url.length > 2048) return false;
  return /^https?:\/\//i.test(url);
}

// ---------- admin router ----------

export function createShortLinksAdminRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // POST / — create a short link
  router.post('/', async (req: Request, res: Response) => {
    try {
      if (!isAdminOrSupport(req)) {
        return res.status(403).json({ error: 'admin_only' });
      }
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId_required' });

      const { slug: rawSlug, target_url, title, expiresAt } = req.body ?? {};

      if (!isAllowedTargetUrl(target_url)) {
        return res.status(400).json({ error: 'invalid_target_url' });
      }

      // Slug: caller-supplied (validated) or auto-generated. Auto path retries
      // up to 5 times on UNIQUE violation (effectively never collides at our
      // table size, but cheap to be safe).
      let slug = rawSlug ? normalizeSlug(rawSlug) : null;
      if (rawSlug && !slug) {
        return res.status(400).json({
          error: 'invalid_slug',
          hint: '2-60 chars, lowercase letters/numbers/underscore/hyphen',
        });
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = slug ?? autoSlug();
        const { data, error } = await supabaseAdmin
          .from('short_links')
          .insert({
            slug: candidate,
            target_url,
            title: title ?? null,
            campaignId: cid,
            createdBy: userOf(req).id ?? null,
            expiresAt: expiresAt ?? null,
          })
          .select('id, slug, target_url, title, expiresAt, clicks, lastClickAt, createdAt, updatedAt')
          .single();

        if (!error) return res.status(201).json({ link: data });

        // Unique-violation on slug — only retry if the slug was auto-generated.
        if (error.code === '23505' && !slug) continue;

        if (error.code === '23505') {
          return res.status(409).json({ error: 'slug_in_use', slug: candidate });
        }
        console.error('[shortLinks] create error:', error);
        return res.status(500).json({ error: 'create_failed', detail: error.message });
      }
      // 5 collisions in a row — practically impossible at our table size.
      return res.status(500).json({ error: 'slug_generation_exhausted' });
    } catch (err: any) {
      console.error('[shortLinks] create exception:', err);
      return res.status(500).json({ error: err.message ?? 'create_failed' });
    }
  });

  // GET / — list current campaign's short links
  router.get('/', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId_required' });

      const { data, error } = await supabaseAdmin
        .from('short_links')
        .select('id, slug, target_url, title, expiresAt, clicks, lastClickAt, createdAt, updatedAt')
        .eq('campaignId', cid)
        .order('createdAt', { ascending: false })
        .limit(500);

      if (error) {
        console.error('[shortLinks] list error:', error);
        return res.status(500).json({ error: 'list_failed' });
      }
      return res.json({ links: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'list_failed' });
    }
  });

  // PATCH /:id — update target / title / expiresAt
  // Slug rename intentionally NOT supported — links already in circulation
  // would 404. Delete + create instead.
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      if (!isAdminOrSupport(req)) {
        return res.status(403).json({ error: 'admin_only' });
      }
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId_required' });

      const updates: Record<string, unknown> = {};
      if (req.body?.target_url !== undefined) {
        if (!isAllowedTargetUrl(req.body.target_url)) {
          return res.status(400).json({ error: 'invalid_target_url' });
        }
        updates.target_url = req.body.target_url;
      }
      if (req.body?.title !== undefined) updates.title = req.body.title ?? null;
      if (req.body?.expiresAt !== undefined) updates.expiresAt = req.body.expiresAt ?? null;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'no_fields_to_update' });
      }

      const { data, error } = await supabaseAdmin
        .from('short_links')
        .update(updates)
        .eq('id', req.params.id)
        .eq('campaignId', cid)
        .select('id, slug, target_url, title, expiresAt, clicks, lastClickAt, createdAt, updatedAt')
        .single();

      if (error) {
        if (error.code === 'PGRST116') return res.status(404).json({ error: 'not_found' });
        console.error('[shortLinks] update error:', error);
        return res.status(500).json({ error: 'update_failed' });
      }
      return res.json({ link: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'update_failed' });
    }
  });

  // DELETE /:id
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      if (!isAdminOrSupport(req)) {
        return res.status(403).json({ error: 'admin_only' });
      }
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId_required' });

      const { error } = await supabaseAdmin
        .from('short_links')
        .delete()
        .eq('id', req.params.id)
        .eq('campaignId', cid);

      if (error) {
        console.error('[shortLinks] delete error:', error);
        return res.status(500).json({ error: 'delete_failed' });
      }
      return res.status(204).end();
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'delete_failed' });
    }
  });

  return router;
}

// ---------- public redirect router ----------

export function createShortLinksPublicRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // GET /:slug — look up, check expiration, redirect 302, count click async
  router.get('/:slug', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug || '').toLowerCase();
      if (!SLUG_RE.test(slug)) {
        return res.status(404).type('text/plain').send('Link not found');
      }

      const { data } = await supabaseAdmin
        .from('short_links')
        .select('id, target_url, expiresAt')
        .eq('slug', slug)
        .maybeSingle();

      if (!data) {
        return res.status(404).type('text/plain').send('Link not found');
      }

      if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
        return res.status(410).type('text/plain').send('Link expired');
      }

      // Fire-and-forget click counter via RPC — never blocks the redirect.
      // We don't await the promise because (a) redirect latency matters and
      // (b) a metering failure shouldn't 500 the user-facing link.
      supabaseAdmin.rpc('increment_short_link_click', { p_slug: slug }).then(
        () => {},
        (err) => console.warn('[shortLinks] click counter rpc failed:', err?.message),
      );

      // 302 (not 301) so browsers don't cache the destination forever — admin
      // can change target_url later via PATCH and clicks pick up the new one.
      return res.redirect(302, data.target_url);
    } catch (err: any) {
      console.error('[shortLinks] redirect exception:', err);
      return res.status(500).type('text/plain').send('Internal error');
    }
  });

  return router;
}
