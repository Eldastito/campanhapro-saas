/**
 * Testes do PR 1½ do PRD Social Intelligence — fixes B3, B4, B5 do F0 audit
 * (docs/social/SOCIAL-GAP-MATRIX.md §0):
 *
 *   B3 — POST /:id/publish agora exige status ∈ {approved, scheduled}
 *   B4 — checkCompliance emite severity='error' para casos mecânicos
 *   B5 — contentRouter usa tenantCampaignId (padrão), não campaignIdOf
 *
 * Não uso o AI provider real — os endpoints /generate e /generate-image
 * ficam fora, cobertos por outros testes de mock quando esse caminho for
 * exercitado. Aqui foco no state machine de content_posts.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';
import { createContentRouter } from '../src/server/modules/content/contentRouter';

const CAMP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OTHER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

interface FakeUser {
  id: string;
  campaignId?: string;
  userType?: string;
  isSupremeAdmin?: boolean;
}

function buildApp(user: FakeUser, supabase: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).user = user; next(); });
  app.use('/api/v1/content', createContentRouter(supabase));
  return app;
}

async function req(app: express.Express, method: string, path: string, body?: any) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.status, body: parsed });
      } catch (err) { reject(err); } finally { server.close(); }
    });
  });
}

const owner: FakeUser = { id: 'u1', campaignId: CAMP, userType: 'Admin' };

function seed(status: string, extras: Record<string, any> = {}) {
  return createMockSupabase({
    content_posts: [{
      id: 'post-1',
      campaignId: CAMP,
      channel: 'instagram',
      postType: 'post',
      status,
      finalText: extras.finalText ?? 'Vote em mim, número 12345!',
      generatedText: null,
      complianceFlags: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...extras,
    }],
  });
}

describe('contentRouter — B3 publish enforcement', () => {
  test('rejeita publish quando status=draft', async () => {
    const supabase = seed('draft');
    const res = await req(buildApp(owner, supabase), 'POST', '/api/v1/content/post-1/publish');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'requires_approval');
    assert.equal(res.body.currentStatus, 'draft');
    // Post NÃO virou published no banco.
    const stored = (supabase as any)._store.get('content_posts')[0];
    assert.equal(stored.status, 'draft');
    assert.equal(stored.publishedAt, undefined);
  });

  test('aceita publish quando status=approved', async () => {
    const supabase = seed('approved');
    const res = await req(buildApp(owner, supabase), 'POST', '/api/v1/content/post-1/publish');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const stored = (supabase as any)._store.get('content_posts')[0];
    assert.equal(stored.status, 'published');
    assert.ok(stored.publishedAt, 'publishedAt setado');
  });

  test('aceita publish quando status=scheduled', async () => {
    const supabase = seed('scheduled');
    const res = await req(buildApp(owner, supabase), 'POST', '/api/v1/content/post-1/publish');
    assert.equal(res.status, 200);
    const stored = (supabase as any)._store.get('content_posts')[0];
    assert.equal(stored.status, 'published');
  });

  test('idempotente: publish sobre status=published devolve ok sem sobrescrever', async () => {
    const supabase = seed('published', { publishedAt: '2026-01-01T00:00:00.000Z' });
    const res = await req(buildApp(owner, supabase), 'POST', '/api/v1/content/post-1/publish');
    assert.equal(res.status, 200);
    assert.equal(res.body.alreadyPublished, true);
    const stored = (supabase as any)._store.get('content_posts')[0];
    assert.equal(stored.publishedAt, '2026-01-01T00:00:00.000Z', 'publishedAt não foi sobrescrito');
  });

  test('publish em post inexistente devolve 404 (não vaza existência de outras campanhas)', async () => {
    const supabase = createMockSupabase({
      content_posts: [{ id: 'other-post', campaignId: OTHER, status: 'approved' }],
    });
    const res = await req(buildApp(owner, supabase), 'POST', '/api/v1/content/other-post/publish');
    assert.equal(res.status, 404);
    // Post da OUTRA campanha continua intocado.
    const stored = (supabase as any)._store.get('content_posts')[0];
    assert.equal(stored.status, 'approved');
  });

  test('publish reroda compliance e bloqueia se surgiu severity=error após approve', async () => {
    // Post foi aprovado, mas alguém editou pra texto vazio depois.
    const supabase = seed('approved', { finalText: '   ' });
    const res = await req(buildApp(owner, supabase), 'POST', '/api/v1/content/post-1/publish');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'blocked_by_compliance');
    assert.ok(Array.isArray(res.body.flags));
    assert.ok(res.body.flags.some((f: any) => f.rule === 'empty_text' && f.severity === 'error'));
  });
});

describe('contentRouter — B4 severity=error mecânico', () => {
  test('approve bloqueia texto vazio (severity=error)', async () => {
    const supabase = seed('draft', { finalText: '' });
    const res = await req(buildApp(owner, supabase), 'POST', '/api/v1/content/post-1/approve');
    assert.equal(res.status, 400);
    assert.ok(res.body.flags.some((f: any) => f.rule === 'empty_text' && f.severity === 'error'));
  });

  test('approve bloqueia texto > 50k chars (severity=error)', async () => {
    const huge = 'a'.repeat(50_001);
    const supabase = seed('draft', { finalText: huge });
    const res = await req(buildApp(owner, supabase), 'POST', '/api/v1/content/post-1/approve');
    assert.equal(res.status, 400);
    assert.ok(res.body.flags.some((f: any) => f.rule === 'oversize' && f.severity === 'error'));
  });

  test('approve não bloqueia por conteúdo eleitoral (fica em warn — decisão de produto)', async () => {
    const supabase = seed('draft', { finalText: 'Meu opositor é corrupto e ladrão' });
    const res = await req(buildApp(owner, supabase), 'POST', '/api/v1/content/post-1/approve');
    // Warn não bloqueia — a decisão de subir isso pra error cabe ao produto.
    assert.equal(res.status, 200);
    const stored = (supabase as any)._store.get('content_posts')[0];
    assert.equal(stored.status, 'approved');
    assert.ok(stored.complianceFlags.some((f: any) => f.severity === 'warn'));
  });
});

describe('contentRouter — B5 tenant scope', () => {
  test('usuário sem campanha (não-supreme) recebe 400', async () => {
    const supabase = seed('approved');
    const noCamp: FakeUser = { id: 'x', userType: 'Admin' }; // sem campaignId
    const res = await req(buildApp(noCamp, supabase), 'POST', '/api/v1/content/post-1/publish');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /campaignId/);
  });

  test('supreme admin sem campanha própria pode impersonar via ?campaignId=', async () => {
    // Padrão do tenantScope — supreme pode operar sobre outra campanha
    // desde que envie o override.
    const supabase = seed('approved');
    const supreme: FakeUser = { id: 'root', isSupremeAdmin: true };
    // GET /:id aceita query string pra impersonação.
    const res = await req(
      buildApp(supreme, supabase),
      'GET',
      `/api/v1/content/post-1?campaignId=${CAMP}`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.post.id, 'post-1');
  });

  test('IDOR: usuário da CAMP não consegue ler post de OUTRA campanha', async () => {
    const supabase = createMockSupabase({
      content_posts: [{
        id: 'secret-post', campaignId: OTHER, channel: 'instagram',
        status: 'draft', finalText: 'segredo', createdAt: '', updatedAt: '',
      }],
    });
    const res = await req(buildApp(owner, supabase), 'GET', '/api/v1/content/secret-post');
    assert.equal(res.status, 404); // não devolve o post, mesmo com id certo.
  });

  test('IDOR: query ?campaignId= não sobrescreve campanha do usuário logado', async () => {
    // O tenantScope garante: se req.user.campaignId existe, query é ignorada.
    const supabase = createMockSupabase({
      content_posts: [
        { id: 'own', campaignId: CAMP, channel: 'instagram', status: 'draft', finalText: 'meu', createdAt: '', updatedAt: '' },
        { id: 'theirs', campaignId: OTHER, channel: 'instagram', status: 'draft', finalText: 'deles', createdAt: '', updatedAt: '' },
      ],
    });
    // Tenta enganar mandando ?campaignId=OTHER na URL.
    const res = await req(buildApp(owner, supabase), 'GET', `/api/v1/content?campaignId=${OTHER}`);
    assert.equal(res.status, 200);
    const ids = res.body.posts.map((p: any) => p.id);
    assert.deepEqual(ids, ['own'], 'só devolveu posts da própria campanha');
  });
});
