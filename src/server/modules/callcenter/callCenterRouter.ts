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

  // ---------- ÁREAS DE ATENDIMENTO (F3 — menu no mesmo número + roteamento) ----------
  // Quem gerencia áreas: coordenador/admin/partido e o líder do call center.
  async function canManageAreas(userId: string): Promise<boolean> {
    const t = await userType(userId);
    return t === 'Admin' || t === 'Coordenador' || t === 'Candidato de Partido' || t === CC_LEADER;
  }

  // Lista as áreas (todas as funções autenticadas da campanha veem; o painel do
  // operador usa pra mostrar o badge da área na conversa).
  router.get('/areas', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { data } = await supabase.from('service_areas')
      .select('*').eq('campaignId', campaignId)
      .order('position', { ascending: true }).order('createdAt', { ascending: true });
    return res.json({ areas: data || [] });
  });

  router.post('/areas', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await canManageAreas(userId))) return res.status(403).json({ error: 'sem_permissao' });
    const { name, description, persona, assignedUserId } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name_obrigatorio' });
    // Próxima posição no menu (sequencial, começando em 1).
    const { data: last } = await supabase.from('service_areas')
      .select('position').eq('campaignId', campaignId)
      .order('position', { ascending: false }).limit(1).maybeSingle();
    const position = ((last as any)?.position ?? 0) + 1;
    const { data, error } = await supabase.from('service_areas').insert({
      campaignId, name: String(name).trim().slice(0, 80),
      description: description?.toString().trim().slice(0, 280) || null,
      persona: persona?.toString().trim().slice(0, 1200) || null,
      assignedUserId: assignedUserId || null,
      position, active: true,
    }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ area: data });
  });

  router.patch('/areas/:id', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await canManageAreas(userId))) return res.status(403).json({ error: 'sem_permissao' });
    const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    const b = req.body || {};
    if (typeof b.name === 'string') patch.name = b.name.trim().slice(0, 80);
    if ('description' in b) patch.description = b.description?.toString().trim().slice(0, 280) || null;
    if ('persona' in b) patch.persona = b.persona?.toString().trim().slice(0, 1200) || null;
    if ('assignedUserId' in b) patch.assignedUserId = b.assignedUserId || null;
    if (typeof b.active === 'boolean') patch.active = b.active;
    if (typeof b.position === 'number') patch.position = b.position;
    const { data, error } = await supabase.from('service_areas')
      .update(patch).eq('id', req.params.id).eq('campaignId', campaignId).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ area: data });
  });

  router.delete('/areas/:id', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await canManageAreas(userId))) return res.status(403).json({ error: 'sem_permissao' });
    // Soft-delete: desativa (active=false) pra não quebrar conversas que já
    // foram roteadas com esse areaId. Some do menu, mas o histórico fica.
    await supabase.from('service_areas').update({ active: false, updatedAt: new Date().toISOString() })
      .eq('id', req.params.id).eq('campaignId', campaignId);
    return res.json({ ok: true });
  });

  // ---------- TELEMARKETING ATIVO (F4 — listas do CRM → operador → resultado) ----------

  // Conta os alvos por status (pra barra de progresso da campanha ativa).
  async function targetCounts(activeCampaignId: string) {
    const statuses = ['pendente', 'em_andamento', 'concluido', 'sem_resposta', 'retorno'] as const;
    const out: Record<string, number> = { total: 0 };
    for (const s of statuses) {
      const { count } = await supabase.from('active_campaign_targets')
        .select('id', { count: 'exact', head: true })
        .eq('activeCampaignId', activeCampaignId).eq('status', s);
      out[s] = count || 0; out.total += count || 0;
    }
    return out;
  }

  // Criar campanha ativa + semear alvos a partir do CRM.
  // body: { name, script?, areaId?, contactIds?[] } — sem contactIds, semeia
  // TODOS os contatos da campanha que têm telefone (cap 2000).
  router.post('/active', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await canManageAreas(userId))) return res.status(403).json({ error: 'sem_permissao' });
    const { name, script, areaId, contactIds } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name_obrigatorio' });

    const { data: camp, error: e1 } = await supabase.from('active_campaigns').insert({
      campaignId, name: String(name).trim().slice(0, 120),
      script: script?.toString().slice(0, 4000) || null,
      areaId: areaId || null, createdBy: userId, status: 'ativa',
    }).select('*').single();
    if (e1) return res.status(500).json({ error: e1.message });

    // Semeia os alvos a partir dos contatos.
    let q = supabase.from('contacts').select('id, name, phone').eq('campaignId', campaignId).not('phone', 'is', null);
    if (Array.isArray(contactIds) && contactIds.length) q = q.in('id', contactIds.slice(0, 2000));
    const { data: contacts } = await q.limit(2000);
    const rows = (contacts || [])
      .filter((c: any) => (c.phone || '').toString().replace(/\D+/g, '').length >= 10)
      .map((c: any) => ({
        activeCampaignId: (camp as any).id, campaignId,
        contactId: c.id, phone: String(c.phone), name: c.name || null, status: 'pendente',
      }));
    if (rows.length) await supabase.from('active_campaign_targets').insert(rows);

    return res.json({ campaign: camp, seeded: rows.length });
  });

  // Lista campanhas ativas + progresso.
  router.get('/active', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { data } = await supabase.from('active_campaigns')
      .select('*').eq('campaignId', campaignId).order('createdAt', { ascending: false });
    const campaigns = await Promise.all((data || []).map(async (c: any) => ({
      ...c, counts: await targetCounts(c.id),
    })));
    return res.json({ campaigns });
  });

  // Pausar / retomar / concluir.
  router.post('/active/:id/status', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await canManageAreas(userId))) return res.status(403).json({ error: 'sem_permissao' });
    const status = ['ativa', 'pausada', 'concluida'].includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: 'status_invalido' });
    await supabase.from('active_campaigns').update({ status, updatedAt: new Date().toISOString() })
      .eq('id', req.params.id).eq('campaignId', campaignId);
    return res.json({ ok: true });
  });

  // Operador puxa o PRÓXIMO alvo pendente (claim otimista p/ não dar o mesmo a dois).
  router.post('/active/:id/next', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { data: camp } = await supabase.from('active_campaigns')
      .select('id, status, script, name').eq('id', req.params.id).eq('campaignId', campaignId).maybeSingle();
    if (!camp) return res.status(404).json({ error: 'not_found' });
    if ((camp as any).status !== 'ativa') return res.status(409).json({ error: 'campanha_nao_ativa' });

    // Tenta reservar um pendente. Algumas tentativas pra absorver corrida entre
    // operadores (o WHERE status='pendente' no update garante exclusão mútua).
    for (let i = 0; i < 5; i++) {
      const { data: cand } = await supabase.from('active_campaign_targets')
        .select('id, attempts').eq('activeCampaignId', req.params.id).eq('status', 'pendente')
        .order('createdAt', { ascending: true }).limit(1).maybeSingle();
      if (!cand) break;
      const { data: claimed } = await supabase.from('active_campaign_targets')
        .update({ status: 'em_andamento', assignedUserId: userId, attempts: ((cand as any).attempts || 0) + 1, lastAttemptAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .eq('id', (cand as any).id).eq('status', 'pendente')
        .select('*').maybeSingle();
      if (claimed) {
        return res.json({ target: claimed, script: (camp as any).script || '', campaignName: (camp as any).name });
      }
    }
    return res.json({ target: null, done: true });
  });

  // Operador registra o resultado e libera o alvo.
  router.post('/active/targets/:id/result', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { status, disposition, notes } = req.body || {};
    const finalStatus = ['concluido', 'sem_resposta', 'retorno', 'pendente'].includes(status) ? status : 'concluido';
    const { data, error } = await supabase.from('active_campaign_targets').update({
      status: finalStatus,
      disposition: disposition?.toString().slice(0, 60) || null,
      notes: notes?.toString().slice(0, 1000) || null,
      // 'retorno'/'pendente' devolvem o alvo pra fila (tira o dono);
      // 'concluido'/'sem_resposta' encerram com o operador como autor.
      assignedUserId: (finalStatus === 'pendente') ? null : userId,
      updatedAt: new Date().toISOString(),
    }).eq('id', req.params.id).eq('campaignId', campaignId).select('*').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ target: data });
  });

  // ---------- SUPERVISÃO + RELATÓRIOS (F5 — coordenador/candidato/líder) ----------
  router.get('/reports', async (req: Request, res: Response) => {
    const { userId, campaignId } = ctx(req);
    if (!userId || !campaignId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await canManageAreas(userId))) return res.status(403).json({ error: 'sem_permissao' });

    // Nomes da equipe (pra atribuir produtividade por operador).
    const { data: team } = await supabase.from('users')
      .select('id, name, type').eq('campaignId', campaignId).in('type', [CC_LEADER, CC_OPERATOR]);
    const nameOf = (id: string | null) => (team || []).find((u: any) => u.id === id)?.name || 'Operador';

    // ----- RECEPTIVO: conversas por estágio -----
    const { data: convos } = await supabase.from('channel_conversations')
      .select('stage, "isOpen"').eq('campaignId', campaignId).limit(8000);
    const byStage: Record<string, number> = {};
    let openCount = 0;
    for (const c of (convos || []) as any[]) {
      const s = c.stage || 'novo_lead';
      byStage[s] = (byStage[s] || 0) + 1;
      if (c.isOpen) openCount++;
    }

    // ----- ATIVO: campanhas + alvos (status, disposição, operador) -----
    const { data: acts } = await supabase.from('active_campaigns')
      .select('id, name, status').eq('campaignId', campaignId).order('createdAt', { ascending: false });
    const campaigns = await Promise.all((acts || []).map(async (c: any) => ({
      id: c.id, name: c.name, status: c.status, counts: await targetCounts(c.id),
    })));

    const { data: targets } = await supabase.from('active_campaign_targets')
      .select('status, disposition, "assignedUserId"').eq('campaignId', campaignId).limit(20000);
    const byDisposition: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const opAgg: Record<string, { worked: number; interested: number }> = {};
    const INTEREST = new Set(['Interessado', 'Vai votar']);
    for (const t of (targets || []) as any[]) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      if (t.disposition) byDisposition[t.disposition] = (byDisposition[t.disposition] || 0) + 1;
      const worked = t.status === 'concluido' || t.status === 'sem_resposta';
      if (worked && t.assignedUserId) {
        const a = (opAgg[t.assignedUserId] ||= { worked: 0, interested: 0 });
        a.worked++;
        if (t.disposition && INTEREST.has(t.disposition)) a.interested++;
      }
    }
    const operators = Object.entries(opAgg)
      .map(([id, v]) => ({ userId: id, name: nameOf(id), ...v }))
      .sort((a, b) => b.worked - a.worked);

    return res.json({
      receptivo: { total: (convos || []).length, open: openCount, byStage },
      ativo: { byStatus, byDisposition, operators, campaigns },
      teamSize: (team || []).length,
    });
  });

  return router;
}
