/**
 * Content Studio — AI-generated posts for Instagram / TikTok / WhatsApp / Facebook / Twitter.
 * Mounted under: /api/v1/content
 *
 * Pipeline:
 *  1. POST /generate  — brief (channel, tone, topic) → AI text + hashtags + compliance check
 *  2. POST /          — save draft with optional generated content
 *  3. PATCH /:id      — edit text, image, hashtags
 *  4. POST /:id/approve  — promote draft to approved (audit + final compliance gate)
 *  5. POST /:id/schedule — define scheduledAt (status → scheduled)
 *  6. POST /:id/publish  — mark as published (manual confirmation; v1 does not auto-post)
 *  7. GET /            — list with optional ?status filter
 */
import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { chatCompletion, isChatConfigured, activeChatProvider } from '../ai/chatCompletion';
import { generateImage, isImageGenerationConfigured } from '../ai/imageGeneration';
import { audit, actorFromRequest } from '../observability/auditLogger';

function campaignIdOf(req: Request): string | undefined {
  return (req as any).user?.campaignId;
}
function userIdOf(req: Request): string | null {
  return (req as any).user?.id ?? null;
}

const ALLOWED_CHANNELS = ['instagram', 'tiktok', 'whatsapp', 'facebook', 'twitter', 'generic'] as const;
const ALLOWED_TONES = ['formal', 'neutro', 'popular', 'jovem', 'combativo'] as const;
const ALLOWED_POST_TYPES = ['post', 'story', 'reel', 'blast', 'thread'] as const;
type Channel = typeof ALLOWED_CHANNELS[number];
type Tone = typeof ALLOWED_TONES[number];

const CHANNEL_GUIDANCE: Record<Channel, string> = {
  instagram: 'Texto curto e direto (até 2200 caracteres). Use emojis com moderação. Hashtags relevantes ao final. Sem links clicáveis na legenda — use bio. Tom visual.',
  tiktok: 'Roteiro para vídeo curto (15-60s). Frases curtas, ganchos nas 2 primeiras linhas. Tendências de áudio. Hashtags em PT-BR.',
  whatsapp: 'Tom pessoal e direto. Pode usar negrito *assim*, itálico _assim_. Máx 1024 caracteres por mensagem. Mensagem prática, sem hashtags. Trate como conversa 1:1.',
  facebook: 'Texto mais longo permitido (até 5000 caracteres). Pode incluir links. Parágrafos curtos.',
  twitter: 'Máximo 280 caracteres. Hashtags estratégicas. Direto e provocativo. Pode usar thread.',
  generic: 'Texto adaptável para múltiplas plataformas. Versão neutra e flexível.',
};

const TONE_GUIDANCE: Record<Tone, string> = {
  formal: 'Linguagem institucional, formal, respeitosa. Sem gírias.',
  neutro: 'Linguagem clara e profissional, acessível para todos os públicos.',
  popular: 'Linguagem cotidiana, próxima do eleitor. Pode usar expressões regionais brasileiras.',
  jovem: 'Linguagem descontraída, gírias atuais com moderação, foco em engajamento digital.',
  combativo: 'Linguagem firme, direta, com posicionamento claro. Sem ofensas pessoais.',
};

// TSE compliance — basic banned-content check (Resolução TSE 23.610/2019).
function checkCompliance(text: string): Array<{ rule: string; severity: 'warn' | 'error'; message: string }> {
  const flags: Array<{ rule: string; severity: 'warn' | 'error'; message: string }> = [];
  const lower = text.toLowerCase();

  const offenseTerms = ['idiota', 'imbecil', 'corrupto', 'ladrão', 'criminoso', 'bandido'];
  const found = offenseTerms.filter(t => lower.includes(t));
  if (found.length > 0) {
    flags.push({
      rule: 'TSE-23610-Art27',
      severity: 'warn',
      message: `Termos potencialmente ofensivos detectados: ${found.join(', ')}. Risco de ação por propaganda negativa.`,
    });
  }

  if (/vote\s+(em\s+)?(eu|mim|nós)/i.test(text) && !/\d{1,5}/.test(text)) {
    flags.push({
      rule: 'TSE-23610-Art18',
      severity: 'warn',
      message: 'Pedido explícito de voto sem número de urna pode confundir o eleitor. Considere incluir o número.',
    });
  }

  if (text.length > 5000) {
    flags.push({
      rule: 'length',
      severity: 'warn',
      message: 'Texto muito longo (>5000 caracteres). Pode ser truncado em algumas plataformas.',
    });
  }

  return flags;
}

async function buildCampaignContext(supabase: SupabaseClient, campaignId: string): Promise<string> {
  const lines: string[] = [];
  const { data: settings } = await supabase
    .from('settings')
    .select('campaignDetails')
    .eq('campaignId', campaignId)
    .maybeSingle();

  const d = settings?.campaignDetails ?? {};
  if (d.nomeUrna) lines.push(`Candidato: ${d.nomeUrna}`);
  if (d.partido) lines.push(`Partido: ${d.partido}`);
  if (d.numero) lines.push(`Número de urna: ${d.numero}`);
  if (d.cargo) lines.push(`Cargo: ${d.cargo}`);
  if (d.cidade || d.municipio) lines.push(`Município: ${d.cidade ?? d.municipio}`);
  if (d.estado) lines.push(`Estado: ${d.estado}`);
  if (d.slogan) lines.push(`Slogan: ${d.slogan}`);
  if (d.electionDate) {
    const days = Math.round((new Date(d.electionDate).getTime() - Date.now()) / 86400000);
    lines.push(`Data da eleição: ${d.electionDate} (${days > 0 ? `${days} dias` : 'já passou'})`);
  }

  return lines.length > 0 ? lines.join('\n') : 'Sem contexto detalhado da campanha.';
}

export function createContentRouter(supabase: SupabaseClient) {
  const router = Router();

  // ---------------------------------------------------------------------------
  // POST /generate  — generate text + hashtags via AI (does NOT save)
  // ---------------------------------------------------------------------------
  router.post('/generate', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    const { channel, tone, topic, postType, lengthHint } = req.body as {
      channel?: string;
      tone?: string;
      topic?: string;
      postType?: string;
      lengthHint?: 'curto' | 'medio' | 'longo';
    };

    if (!channel || !ALLOWED_CHANNELS.includes(channel as Channel)) {
      return res.status(400).json({ error: 'channel inválido', allowed: ALLOWED_CHANNELS });
    }
    if (!topic || topic.trim().length < 3) {
      return res.status(400).json({ error: 'topic é obrigatório (mín 3 caracteres)' });
    }
    const t: Tone = (ALLOWED_TONES.includes(tone as Tone) ? tone : 'neutro') as Tone;
    const pt = ALLOWED_POST_TYPES.includes(postType as any) ? postType! : 'post';
    const length = lengthHint ?? 'medio';

    if (!isChatConfigured()) return res.status(503).json({ error: 'IA não configurada (defina OPENAI_API_KEY ou CLAUDE_API_KEY)' });

    try {
      const context = await buildCampaignContext(supabase, campaignId);

      const content = await chatCompletion({
        system: `Você é um redator-chefe de campanha política brasileira, especialista em comunicação digital e em conformidade com a legislação eleitoral (Resolução TSE 23.610/2019).
Você gera conteúdo persuasivo, ético e otimizado por canal.
Regras invioláveis:
- NUNCA atribua crime sem prova em texto público.
- NUNCA use linguagem que possa ser enquadrada como propaganda negativa ofensiva.
- Sempre que houver pedido de voto, inclua número de urna quando disponível.
- Use SOMENTE português do Brasil.
- Responda ESTRITAMENTE em JSON no formato:
{ "text": "string", "hashtags": ["string"], "callToAction": "string" }`,
        user: `CONTEXTO DA CAMPANHA:
${context}

GERAR PARA:
- Canal: ${channel}
- Tipo: ${pt}
- Tom: ${t}
- Tamanho: ${length}
- Tópico/briefing: ${topic.trim()}

DIRETRIZES DO CANAL:
${CHANNEL_GUIDANCE[channel as Channel]}

DIRETRIZES DO TOM:
${TONE_GUIDANCE[t]}

Gere o conteúdo final, pronto para publicar. Inclua de 3 a 8 hashtags relevantes (vazio para WhatsApp).`,
        maxTokens: 1200,
        temperature: 0.7,
        jsonMode: true,
      });

      const parsed = JSON.parse(content || '{}');
      const text: string = parsed.text ?? '';
      const hashtags: string[] = Array.isArray(parsed.hashtags) ? parsed.hashtags : [];
      const callToAction: string = parsed.callToAction ?? '';

      const complianceFlags = checkCompliance(text);

      return res.json({
        text,
        hashtags,
        callToAction,
        complianceFlags,
        provider: activeChatProvider(),
      });
    } catch (err: any) {
      console.error('[Content] generate:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /generate-image  — image for a post via Gemini nano-banana → OpenAI gpt-image-1
  // Body: { prompt, channel?, postType? } — frontend may add channel/tone for styling
  // Returns: { imageUrl: data-URL, provider }
  // ---------------------------------------------------------------------------
  router.post('/generate-image', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });
    if (!isImageGenerationConfigured()) {
      return res.status(503).json({ error: 'Geração de imagem não configurada (defina GEMINI_API_KEY ou OPENAI_API_KEY)' });
    }
    const { prompt, channel } = req.body ?? {};
    if (!prompt || String(prompt).trim().length < 5) {
      return res.status(400).json({ error: 'prompt é obrigatório (mín 5 caracteres)' });
    }
    try {
      // Enriquece o prompt com diretriz visual leve por canal (sem trocar a intenção do usuário).
      const channelHint = channel === 'instagram' || channel === 'facebook'
        ? ' Estilo: foto editorial limpa, iluminação natural, espaço para overlay de texto.'
        : channel === 'tiktok'
        ? ' Estilo: visual vibrante, alto contraste, vertical-friendly.'
        : '';
      const enriched = `${String(prompt).trim()}.${channelHint} Sem texto na imagem, sem logos de terceiros.`;
      const { dataUrl, provider } = await generateImage({ prompt: enriched });
      return res.json({ imageUrl: dataUrl, provider });
    } catch (err: any) {
      console.error('[Content] generate-image:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /  — create post (draft)
  // ---------------------------------------------------------------------------
  router.post('/', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    const userId = userIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    const b = req.body ?? {};
    if (!b.channel || !ALLOWED_CHANNELS.includes(b.channel)) {
      return res.status(400).json({ error: 'channel inválido' });
    }

    const insert = {
      campaignId,
      channel: b.channel,
      postType: ALLOWED_POST_TYPES.includes(b.postType) ? b.postType : 'post',
      tone: ALLOWED_TONES.includes(b.tone) ? b.tone : null,
      topic: b.topic ?? null,
      brief: b.brief ?? null,
      generatedText: b.generatedText ?? null,
      finalText: b.finalText ?? b.generatedText ?? null,
      hashtags: Array.isArray(b.hashtags) ? b.hashtags : null,
      imageUrl: b.imageUrl ?? null,
      complianceFlags: b.complianceFlags ?? null,
      status: 'draft',
      createdBy: userId,
      updatedAt: new Date().toISOString(),
    };

    try {
      const { data, error } = await supabase
        .from('content_posts')
        .insert(insert)
        .select()
        .single();
      if (error) throw error;

      await audit(supabase, {
        ...actorFromRequest(req),
        action: 'content.created',
        resourceType: 'content_posts',
        resourceId: data.id,
        severity: 'info',
        metadata: { channel: data.channel, postType: data.postType },
      });

      return res.status(201).json({ post: data });
    } catch (err: any) {
      console.error('[Content] create:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /  — list posts, optional ?status filter
  // ---------------------------------------------------------------------------
  router.get('/', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    try {
      let q = supabase
        .from('content_posts')
        .select('id, channel, postType, tone, topic, finalText, hashtags, imageUrl, status, scheduledAt, publishedAt, createdAt, updatedAt')
        .eq('campaignId', campaignId)
        .order('createdAt', { ascending: false })
        .limit(200);

      const status = req.query.status as string | undefined;
      if (status) q = q.eq('status', status);

      const { data, error } = await q;
      if (error) throw error;
      return res.json({ posts: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /:id
  // ---------------------------------------------------------------------------
  router.get('/:id', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    try {
      const { data, error } = await supabase
        .from('content_posts')
        .select('*')
        .eq('id', req.params.id)
        .eq('campaignId', campaignId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'not_found' });
      return res.json({ post: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // PATCH /:id  — edit any mutable field
  // ---------------------------------------------------------------------------
  router.patch('/:id', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    const allowed = ['topic', 'brief', 'tone', 'generatedText', 'finalText', 'hashtags', 'imageUrl', 'postType'];
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    // Recompute compliance if finalText changed
    if (typeof updates.finalText === 'string') {
      updates.complianceFlags = checkCompliance(updates.finalText as string);
    }

    try {
      const { data, error } = await supabase
        .from('content_posts')
        .update(updates)
        .eq('id', req.params.id)
        .eq('campaignId', campaignId)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'not_found' });
      return res.json({ post: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /:id/approve
  // ---------------------------------------------------------------------------
  router.post('/:id/approve', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    const userId = userIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    try {
      const { data: post, error: fetchErr } = await supabase
        .from('content_posts')
        .select('id, finalText, generatedText, status')
        .eq('id', req.params.id)
        .eq('campaignId', campaignId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!post) return res.status(404).json({ error: 'not_found' });

      const text = post.finalText ?? post.generatedText ?? '';
      const flags = checkCompliance(text);
      const hasErrors = flags.some(f => f.severity === 'error');
      if (hasErrors) {
        return res.status(400).json({ error: 'Conteúdo bloqueado por compliance', flags });
      }

      const { error } = await supabase
        .from('content_posts')
        .update({
          status: 'approved',
          approvedBy: userId,
          complianceFlags: flags,
          updatedAt: new Date().toISOString(),
        })
        .eq('id', req.params.id);
      if (error) throw error;

      await audit(supabase, {
        ...actorFromRequest(req),
        action: 'content.approved',
        resourceType: 'content_posts',
        resourceId: req.params.id,
        severity: 'info',
        metadata: { flagsCount: flags.length },
      });

      return res.json({ ok: true, complianceFlags: flags });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /:id/schedule  { scheduledAt: ISO }
  // ---------------------------------------------------------------------------
  router.post('/:id/schedule', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    const when = req.body?.scheduledAt;
    if (!when) return res.status(400).json({ error: 'scheduledAt obrigatório (ISO)' });
    const parsed = new Date(when);
    if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'scheduledAt inválido' });
    if (parsed.getTime() < Date.now() - 60_000) {
      return res.status(400).json({ error: 'scheduledAt deve ser futuro' });
    }

    try {
      const { error } = await supabase
        .from('content_posts')
        .update({
          status: 'scheduled',
          scheduledAt: parsed.toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .eq('id', req.params.id)
        .eq('campaignId', campaignId);
      if (error) throw error;

      await audit(supabase, {
        ...actorFromRequest(req),
        action: 'content.scheduled',
        resourceType: 'content_posts',
        resourceId: req.params.id,
        severity: 'info',
        metadata: { scheduledAt: parsed.toISOString() },
      });

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /:id/publish  — manual confirmation that user posted externally
  // ---------------------------------------------------------------------------
  router.post('/:id/publish', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    try {
      const { error } = await supabase
        .from('content_posts')
        .update({
          status: 'published',
          publishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .eq('id', req.params.id)
        .eq('campaignId', campaignId);
      if (error) throw error;

      await audit(supabase, {
        ...actorFromRequest(req),
        action: 'content.published',
        resourceType: 'content_posts',
        resourceId: req.params.id,
        severity: 'info',
      });

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // DELETE /:id
  // ---------------------------------------------------------------------------
  router.delete('/:id', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    try {
      const { error } = await supabase
        .from('content_posts')
        .delete()
        .eq('id', req.params.id)
        .eq('campaignId', campaignId);
      if (error) throw error;
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
