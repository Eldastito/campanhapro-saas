/**
 * Snapshot autoritativo das capabilities de cada provider social suportado
 * pelo CampanhaPro.
 *
 * Este registry é a FONTE DE VERDADE consumida por:
 *   - `SocialProviderAdapter.getCapabilities()` (F1) — cada wrapper devolve
 *     a linha correspondente sem I/O.
 *   - `GET /api/v1/social/capabilities` (a criar em PR 2) — devolve a matriz
 *     ao frontend para renderizar corretamente o "Redes conectadas" (§104) e
 *     não pedir métricas que sabemos que não voltam.
 *   - Testes contratuais (`tests/socialContracts.test.ts`).
 *
 * REGRA IMPORTANTE: cada linha precisa refletir o que a auditoria F0
 * observou no repo HOJE (docs/social/SOCIAL-AS-IS.md §2). Quando um adapter
 * evoluir (ex.: implementar publish de imagem no IG), atualize aqui NO MESMO
 * PR que adiciona a capability — não deixe o registry mentir sobre o adapter.
 *
 * Distinção de estados (§13):
 *   - `unsupported`          → provider não oferece essa API pública
 *   - `provider_restricted`  → oferece mas trava por tier/comercial (ex.: X Free)
 *   - `permission_required`  → precisa reautorização OAuth
 *   - `not_configured`       → falta env/setup do lado da campanha
 *   - `unknown`              → ainda não testamos empiricamente
 */

import type { SocialProvider } from './contracts/socialProvider.js';
import type { SocialProviderCapabilitySnapshot } from './contracts/socialCapabilities.js';
import { SOCIAL_PROVIDERS } from './contracts/socialProvider.js';

export const SOCIAL_CAPABILITY_REGISTRY: Readonly<Record<SocialProvider, SocialProviderCapabilitySnapshot>> = Object.freeze({
  // ── Instagram (Meta Graph — IG Business Discovery + own media) ──────────
  // AS-IS §2.1: OAuth manual, Pulso dos Bairros + own comments + watchlist
  // funcionando; publish inexistente; sync fora do runner unificado.
  instagram: {
    adapterMaturity: 'beta',
    maturityNote: 'Business Discovery + own comments em produção; OAuth manual (paste token) — Login Meta real vai em PR 5. Fora do runSocialSync unificado.',
    capabilities: {
      profileRead: 'supported',
      postsRead: 'supported',
      ownCommentsRead: 'supported',
      thirdPartyCommentsRead: 'unsupported', // Meta só devolve contagem, não texto
      metricsRead: 'supported',
      audienceInsights: 'permission_required', // exige escopo instagram_manage_insights
      mentionsRead: 'unsupported',
      competitorDiscovery: 'supported',       // via Business Discovery
      publishText: 'unsupported',              // IG não aceita texto puro
      publishImage: 'permission_required',     // possível com Content Publishing API + review
      publishVideo: 'permission_required',
      schedule: 'unsupported',                 // sem nativo — nosso scheduler
      webhook: 'permission_required',          // Meta oferece; nosso handler está reservado (webhookRouter.ts:150) mas não implementado
    },
  },

  // ── Facebook (Meta Graph — Page Feed + Insights) ────────────────────────
  // PR 5: FacebookMetaAdapter implementa page feed + comments via
  // facebookPageClient. Meta OAuth unificado (long-lived exchange +
  // disconnect por provider) fica para PR futuro — refresh e disconnect
  // continuam not_configured até lá.
  facebook: {
    adapterMaturity: 'beta',
    maturityNote: 'Page profile + posts + comments funcionam via facebookPageClient. Meta OAuth unificado (fb_exchange_token, disconnect por-provider) entra em PR futuro. Ad Library de terceiros via intelRouter.',
    capabilities: {
      profileRead: 'supported',                // page profile via /me/accounts + /{pageId}
      postsRead: 'supported',                  // page feed com reactions/comments/shares summary
      ownCommentsRead: 'supported',            // texto completo dos comments (Page própria)
      thirdPartyCommentsRead: 'provider_restricted', // Business Discovery só devolve contagem
      metricsRead: 'permission_required',      // /insights precisa read_insights
      audienceInsights: 'permission_required',
      mentionsRead: 'unsupported',
      competitorDiscovery: 'supported',        // Ad Library via metaAdLibrary.ts
      publishText: 'not_configured',           // exige review + escopos publish_pages
      publishImage: 'not_configured',
      publishVideo: 'not_configured',
      schedule: 'not_configured',
      webhook: 'not_configured',               // handler existe pra WhatsApp, expandir em PR futuro
    },
  },

  // ── YouTube — PR 6: Data API v3 (channel + videos + comments) via
  // API key ou OAuth token. OAuth Google flow + Analytics API entram em PR
  // futuro. Cobre §26-§29 do PRD; §30 (Analytics — watch time, retention,
  // demografia) ainda não.
  youtube: {
    adapterMaturity: 'beta',
    maturityNote: 'Data API v3 via YOUTUBE_API_KEY (env) ou access_token do settings. OAuth Google flow (Login + refresh) + Analytics API (watch time, retention, demografia) entram em PR futuro.',
    capabilities: {
      profileRead: 'supported',                // channel snippet + statistics
      postsRead: 'supported',                  // uploads playlist + videos details
      ownCommentsRead: 'supported',            // commentThreads.list
      thirdPartyCommentsRead: 'supported',     // idem — public por default
      metricsRead: 'supported',                // view/like/comment counts básicos
      audienceInsights: 'permission_required', // Analytics API precisa yt-analytics.readonly
      mentionsRead: 'unsupported',
      competitorDiscovery: 'supported',        // channels.list + videos.list de terceiros
      publishText: 'unsupported',              // YT não tem "post de texto"
      publishImage: 'unsupported',
      publishVideo: 'not_configured',          // exige OAuth + youtube.upload scope
      schedule: 'not_configured',
      webhook: 'unsupported',                  // YT usa PubSubHubbub, fora do escopo
    },
  },

  // ── TikTok — AS-IS §2.4: stub simulado em server.ts:396. ────────────────
  tiktok: {
    adapterMaturity: 'not_implemented',
    maturityNote: 'Stub simulado (server.ts:396-398); env TIKTOK_CLIENT_KEY checada por complianceService. F5 (PR 8) traz Login Kit real. Nunca scraping (§32 do PRD).',
    capabilities: {
      profileRead: 'not_configured',
      postsRead: 'not_configured',
      ownCommentsRead: 'not_configured',
      thirdPartyCommentsRead: 'unsupported',
      metricsRead: 'not_configured',
      audienceInsights: 'not_configured',
      mentionsRead: 'unsupported',
      competitorDiscovery: 'unsupported',
      publishText: 'unsupported',
      publishImage: 'unsupported',
      publishVideo: 'not_configured',          // Content Posting API exige review
      schedule: 'not_configured',
      webhook: 'not_configured',
    },
  },

  // ── X (ex-Twitter) — AS-IS §2.5: adapter mais maduro. ───────────────────
  x: {
    adapterMaturity: 'production',
    maturityNote: 'OAuth PKCE + refresh + sync + RAG (socialSyncX.ts, socialSyncRunner.ts). Free tier trava /tweets.',
    capabilities: {
      profileRead: 'supported',
      postsRead: 'provider_restricted',        // Free tier bloqueia /users/:id/tweets
      ownCommentsRead: 'unsupported',          // API v2 não retorna replies como thread
      thirdPartyCommentsRead: 'unsupported',
      metricsRead: 'supported',                // public_metrics + non_public_metrics.impression_count
      audienceInsights: 'provider_restricted',
      mentionsRead: 'provider_restricted',     // /mentions só em tier pago
      competitorDiscovery: 'unsupported',
      publishText: 'unsupported',              // publish não implementado; adaptador teria que respeitar tier
      publishImage: 'unsupported',
      publishVideo: 'unsupported',
      schedule: 'unsupported',
      webhook: 'unsupported',                  // Account Activity API é Enterprise
    },
  },

  // ── LinkedIn — AS-IS §2.6: OAuth + refresh + org followers; posts vazio. ─
  linkedin: {
    adapterMaturity: 'beta',
    maturityNote: 'OAuth OIDC + refresh + org followers OK (socialSyncLinkedIn.ts). sharePosts sempre `[]` por cota — não é bug do nosso lado.',
    capabilities: {
      profileRead: 'supported',
      postsRead: 'provider_restricted',        // sharePosts.slice(0,3) mas API retorna vazio em cota atual
      ownCommentsRead: 'unsupported',
      thirdPartyCommentsRead: 'unsupported',
      metricsRead: 'supported',                // networkSizes só
      audienceInsights: 'provider_restricted', // exige Marketing Developer Platform
      mentionsRead: 'unsupported',
      competitorDiscovery: 'unsupported',
      publishText: 'unsupported',              // possível mas fora do escopo hoje
      publishImage: 'unsupported',
      publishVideo: 'unsupported',
      schedule: 'unsupported',
      webhook: 'unsupported',
    },
  },

  // ── Kwai — AS-IS §2.7: scraping (og-tags + regex). ──────────────────────
  kwai: {
    adapterMaturity: 'limited',
    maturityNote: 'Kwai não tem API pública. socialSyncKwai.ts faz scraping frágil; PRD (§21) manda manter capabilityLevel=limited e nunca aumentar cobertura via scraping não autorizado.',
    capabilities: {
      profileRead: 'supported',                // via og-tags do handle público
      postsRead: 'unsupported',                // só contagem de vídeos
      ownCommentsRead: 'unsupported',
      thirdPartyCommentsRead: 'unsupported',
      metricsRead: 'supported',                // followers/following via regex
      audienceInsights: 'unsupported',
      mentionsRead: 'unsupported',
      competitorDiscovery: 'unsupported',
      publishText: 'unsupported',
      publishImage: 'unsupported',
      publishVideo: 'unsupported',
      schedule: 'unsupported',
      webhook: 'unsupported',
    },
  },
});

/** Lookup safe — provider sempre no set porque o tipo garante. */
export function getCapabilities(provider: SocialProvider): SocialProviderCapabilitySnapshot {
  return SOCIAL_CAPABILITY_REGISTRY[provider];
}

/** Lista providers ordenados por maturidade (production → beta → limited → not_implemented).
 *  Útil para "Redes conectadas" (§104) — o header mostra as maduras primeiro. */
export function providersByMaturity(): SocialProvider[] {
  const order: Record<SocialProviderCapabilitySnapshot['adapterMaturity'], number> = {
    production: 0,
    beta: 1,
    limited: 2,
    not_implemented: 3,
  };
  return [...SOCIAL_PROVIDERS].sort(
    (a, b) => order[SOCIAL_CAPABILITY_REGISTRY[a].adapterMaturity] - order[SOCIAL_CAPABILITY_REGISTRY[b].adapterMaturity],
  );
}
