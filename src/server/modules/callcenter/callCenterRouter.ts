/**
 * CALL CENTER — endpoints autenticados.
 *
 * Hierarquia (mesma cadeia de convites do Partido):
 *   Coordenador/Admin → convida Líder Call Center → convida Operadores.
 *
 * Fila e atendimento:
 *   GET  /queue           fila (aguardando_humano) + meus atendimentos
 *   POST /assume/:id      operador assume → IA pausa + resumo (Transição Invisível)
 *   POST /release/:id     devolve pra IA (ou pra fila, no Estratégico)
 *   POST /close/:id       encerra o atendimento
 *   Convites: POST/GET/DELETE /invites · GET /team
 *
 * Mensagens em si reusam /api/v1/channels/send e /conversations/:id/messages.
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { summaryFromConversation, saveSummary } from './handoffSummary';

const newToken = () => `cc_${randomBytes(9).toString('hex')}`;

// Broadcast realtime pro painel dos operadores (mesmo padrão do telão do partido).
const RT_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const RT_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export function broadcastCallCenter(campaignId: string, event: string, payload: any = {}) {
  if (!RT_URL || !RT_KEY || !campaignId) return;
  fetch(`${RT_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: RT_KEY, Authorization: `Bearer ${RT_KEY}` },
    body: JSON.stringify({ messages: [{ topic: `callcenter-${campaignId}`, event, payload }] }),
  }).catch(() => { /* best-effort */ });
}

const CC_LEADER = 'Líder Call Center';
const CC_OPERATOR = 'Operador Call Center';

export function createCallCenterRouter(supabase: SupabaseClient): Router {
  const router = Router();

  function ctx(req: Request) {
    const u = (req as any).user;
    return { userId: u?.id as string | undefined, campaignId: u?.campaignId as string | undefined, type: u?.type as string | undefined };
  }

  async function userType(userId: string): Promise<string | null> {
    const { data } = await supabase.from('users').select('type').eq('id', userId).maybeSingle();
    return (data as any)?.type || null;
  }

  // ---------- CONVITES (cadeia coordenador → líder → operador) ----------

  router.post('/invites', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const callerType = await userType(userId);
    const { displayName, phone, role } = req.body || {};
    if (!displayName?.trim()) return res.status(400).json({ error: 'displayName_obrigatorio' });
    const targetRole = role === CC_LEADER ? CC_LEADER : CC_OPERATOR;
    // Coordenador/Admin convida líder e operador; Líder CC convida só operador.
    const canInviteLeader = callerType === 'Admin' || callerType === 'Coordenador' || callerType === 'Candidato de Partido';
    const canInviteOperator = canInviteLeader || callerType === CC_LEADER;
    if (targetRole === CC_LEADER && !canInviteLeader) return res.status(403).json({ error: 'sem_permissao' });
    if (targetRole === CC_OPERATOR && !canInviteOperator) return res.status(403).json({ error: 'sem_permissao' });

    const { data, error } = await supabase.from('cc_invites').insert({
      campaignId, role: targetRole,
      displayName: String(displayName).trim().slice(0, 160),
      phone: phone?.toString().trim() || null,
      token: newToken(), createdBy: userId,
    }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ invite: data });
  });

  router.get('/invites', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const callerType = await userType(userId);
    let q = supabase.from('cc_invites').select('*').eq('campaignId', campaignId).order('createdAt', { ascending: false });
    // Líder vê só o que ele criou; coordenador vê tudo.
    if (callerType === CC_LEADER) q = q.eq('createdBy', userId);
    const { data } = await q;
    return res.json({ invites: data || [] });
  });

  router.delete('/invites/:id', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    await supabase.from('cc_invites').update({ status: 'revoked' })
      .eq('id', req.params.id).eq('campaignId', campaignId).eq('status', 'pending');
    return res.json({ ok: true });
  });

  // Equipe do call center (líderes + operadores da campanha).
  router.get('/team', async (req: Request, res: Response) => {
    const { campaignId } = ctx(req);
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { data } = await supabase.from('users')
      .select('id, name, email, type, phone, "createdAt"')
      .eq('campaignId', campaignId).in('type', [CC_LEADER, CC_OPERATOR])
      .order('type').order('name');
    return res.json({ team: data || [] });
  });

  // ---------- FILA + ATENDIMENTO ----------

  // Fila: aguardando humano (de todos) + em atendimento POR MIM + novas sem dono.
  router.get('/queue', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { data: waiting } = await supabase.from('channel_conversations')
      .select('*').eq('campaignId', campaignId).eq('isOpen', true)
      .in('stage', ['aguardando_humano', 'novo_lead'])
      .order('lastInboundAt', { ascending: true });
    const { data: mine } = await supabase.from('channel_conversations')
      .select('*').eq('campaignId', campaignId).eq('isOpen', true)
      .eq('stage', 'em_atendimento_humano').eq('assignedUserId', userId)
      .order('lastInboundAt', { ascending: false });
    return res.json({ waiting: waiting || [], mine: mine || [] });
  });

  // Assumir: IA pausa + Transição Invisível (gera resumo se ainda não houver).
  router.post('/assume/:id', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { data: convo } = await supabase.from('channel_conversations')
      .select('id, "handoffSummary", "assignedUserId", stage')
      .eq('id', req.params.id).eq('campaignId', campaignId).maybeSingle();
    if (!convo) return res.status(404).json({ error: 'not_found' });
    if ((convo as any).assignedUserId && (convo as any).assignedUserId !== userId && (convo as any).stage === 'em_atendimento_humano') {
      return res.status(409).json({ error: 'ja_assumido', detail: 'Outro operador já assumiu esta conversa.' });
    }

    await supabase.from('channel_conversations').update({
      assignedUserId: userId, aiPaused: true, stage: 'em_atendimento_humano',
      updatedAt: new Date().toISOString(),
    }).eq('id', req.params.id);

    // TRANSIÇÃO INVISÍVEL: gera o resumo agora se a IA ainda não deixou um.
    let summary = (convo as any).handoffSummary || '';
    if (!summary) {
      summary = await summaryFromConversation(supabase, campaignId, req.params.id);
      await saveSummary(supabase, campaignId, req.params.id, summary);
    }

    broadcastCallCenter(campaignId, 'queue_changed', { conversationId: req.params.id });
    return res.json({ ok: true, stage: 'em_atendimento_humano', summary });
  });

  // Devolver: tira o dono. No Total a IA volta a responder; no Estratégico volta pra fila.
  router.post('/release/:id', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { data: cfg } = await supabase.from('campaign_configs').select('"planTier"').eq('id', campaignId).maybeSingle();
    const aiAllowed = (cfg as any)?.planTier === 'completo';
    await supabase.from('channel_conversations').update({
      assignedUserId: null, aiPaused: !aiAllowed,
      stage: aiAllowed ? 'ia_atendendo' : 'aguardando_humano',
      updatedAt: new Date().toISOString(),
    }).eq('id', req.params.id).eq('campaignId', campaignId);
    broadcastCallCenter(campaignId, 'queue_changed', { conversationId: req.params.id });
    return res.json({ ok: true });
  });

  // Encerrar o atendimento.
  router.post('/close/:id', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    await supabase.from('channel_conversations').update({
      stage: 'fechado', isOpen: false, aiPaused: false, assignedUserId: null,
      updatedAt: new Date().toISOString(),
    }).eq('id', req.params.id).eq('campaignId', campaignId);
    broadcastCallCenter(campaignId, 'queue_changed', { conversationId: req.params.id });
    return res.json({ ok: true });
  });

  return router;
}
