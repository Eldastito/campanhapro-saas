/**
 * Meeting records — agenda generation, audio transcription, AI analysis.
 * Mounted under: /api/v1/meetings
 *
 * Security:
 *  - All routes require requireAuth + requireFeature('meetings')
 *  - campaignId always validated against authenticated user
 *  - Audio transcription is done server-side via OpenAI Whisper
 *  - All AI calls server-side; no API keys in frontend
 */
import express, { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { enqueueTask } from '../paperclip/taskQueue';
import { audit, actorFromRequest } from '../observability/auditLogger';
import { chatCompletion, isChatConfigured } from '../ai/chatCompletion';

function campaignIdOf(req: Request): string | undefined {
  return (req as any).user?.campaignId;
}

function userIdOf(req: Request): string | null {
  return (req as any).user?.id ?? null;
}

async function guardOwnership(
  supabase: SupabaseClient,
  meetingId: string,
  campaignId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('meeting_records')
    .select('id')
    .eq('id', meetingId)
    .eq('campaignId', campaignId)
    .maybeSingle();
  return !!data;
}

async function buildCampaignContext(supabase: SupabaseClient, campaignId: string): Promise<string> {
  const lines: string[] = [];

  // Goals
  const { data: goals } = await supabase
    .from('goals')
    .select('title, targetValue, currentValue, unit, deadline, status')
    .eq('campaignId', campaignId)
    .not('status', 'eq', 'achieved')
    .limit(8);
  if (goals?.length) {
    lines.push('METAS PENDENTES:');
    goals.forEach(g => {
      const progress = g.targetValue > 0
        ? Math.round((g.currentValue / g.targetValue) * 100)
        : 0;
      lines.push(`- ${g.title}: ${progress}% (prazo: ${g.deadline ?? 'sem prazo'})`);
    });
  }

  // Budget
  const { data: allocs } = await supabase
    .from('budget_allocations')
    .select('bucket, amountCents')
    .eq('campaignId', campaignId)
    .eq('status', 'approved')
    .limit(20);
  if (allocs?.length) {
    const totals: Record<string, number> = {};
    allocs.forEach(a => { totals[a.bucket] = (totals[a.bucket] ?? 0) + a.amountCents; });
    lines.push('\nORÇAMENTO APROVADO POR BUCKET (R$):');
    Object.entries(totals).forEach(([b, v]) => lines.push(`- ${b}: R$ ${(v / 100).toFixed(2)}`));
  }

  // Recent agent tasks / pending actions
  const { data: tasks } = await supabase
    .from('agent_tasks')
    .select('type, status, createdAt')
    .eq('campaignId', campaignId)
    .in('status', ['pending', 'running'])
    .order('createdAt', { ascending: false })
    .limit(5);
  if (tasks?.length) {
    lines.push('\nTAREFAS DE AGENTES EM ABERTO:');
    tasks.forEach(t => lines.push(`- ${t.type} (${t.status})`));
  }

  // Election date
  const { data: settings } = await supabase
    .from('settings')
    .select('campaignDetails')
    .eq('campaignId', campaignId)
    .maybeSingle();
  const electionDate = settings?.campaignDetails?.electionDate;
  if (electionDate) {
    const days = Math.round((new Date(electionDate).getTime() - Date.now()) / 86400000);
    lines.push(`\nDIA DA ELEIÇÃO: ${electionDate} (${days > 0 ? `${days} dias` : 'passou'})`);
  }

  return lines.join('\n') || 'Contexto não disponível.';
}

export function createMeetingsRouter(supabase: SupabaseClient) {
  const router = Router();

  // -------------------------------------------------------------------------
  // GET /  — list meetings
  // -------------------------------------------------------------------------
  router.get('/', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    try {
      const { data, error } = await supabase
        .from('meeting_records')
        .select('id, title, status, scheduledAt, recordedAt, duration, createdAt, updatedAt')
        .eq('campaignId', campaignId)
        .order('createdAt', { ascending: false })
        .limit(50);

      if (error) throw error;
      return res.json({ meetings: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // POST /  — create meeting (optionally with AI agenda)
  // -------------------------------------------------------------------------
  router.post('/', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    const { title, scheduledAt, generateAgenda, bairro, municipio } = req.body as {
      title?: string;
      scheduledAt?: string;
      generateAgenda?: boolean;
      bairro?: string;
      municipio?: string;
    };

    try {
      const { data: meeting, error: insertErr } = await supabase
        .from('meeting_records')
        .insert({
          campaignId,
          title: title?.trim() || 'Reunião de Planejamento',
          scheduledAt: scheduledAt ?? null,
          bairro: (bairro || '').trim() || null,
          municipio: (municipio || '').trim() || null,
          status: 'draft',
          updatedAt: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      let agenda: Array<{ topic: string; description: string }> = [];
      if (generateAgenda && isChatConfigured()) {
        const context = await buildCampaignContext(supabase, campaignId);
        try {
          const content = await chatCompletion({
            system: 'Você é um assessor político experiente. Com base no contexto da campanha, gere uma pauta objetiva e estratégica para a reunião de planejamento. Responda SOMENTE com JSON no formato: { "agenda": [{ "topic": "string", "description": "string" }] }. Máximo 8 tópicos, em português do Brasil.',
            user: `Contexto da campanha:\n${context}\n\nGere a pauta da reunião de planejamento.`,
            maxTokens: 800,
            temperature: 0.5,
            jsonMode: true,
          });
          const parsed = JSON.parse(content || '{}');
          agenda = Array.isArray(parsed.agenda) ? parsed.agenda : [];
        } catch (aiErr) {
          console.error('[Meetings] agenda generation failed:', aiErr);
        }

        if (agenda.length > 0) {
          await supabase
            .from('meeting_records')
            .update({ agenda, updatedAt: new Date().toISOString() })
            .eq('id', meeting.id);
          meeting.agenda = agenda;
        }
      }

      await audit(supabase, {
        ...actorFromRequest(req),
        action: 'meeting.created',
        resourceType: 'meeting_records',
        resourceId: meeting.id,
        severity: 'info',
        metadata: { title: meeting.title, generateAgenda },
      });

      return res.status(201).json({ meeting });
    } catch (err: any) {
      console.error('[Meetings] create:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /:id  — single meeting with full fields
  // -------------------------------------------------------------------------
  router.get('/:id', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    try {
      const { data, error } = await supabase
        .from('meeting_records')
        .select('*')
        .eq('id', req.params.id)
        .eq('campaignId', campaignId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'not_found' });
      return res.json({ meeting: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /:id  — update title, transcript, scheduledAt, status
  // -------------------------------------------------------------------------
  router.patch('/:id', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    if (!await guardOwnership(supabase, req.params.id, campaignId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const allowed = ['title', 'transcript', 'scheduledAt', 'status', 'summary', 'actions', 'agenda'];
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    allowed.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    try {
      const { error } = await supabase
        .from('meeting_records')
        .update(updates)
        .eq('id', req.params.id);
      if (error) throw error;
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // POST /:id/transcribe  — raw audio → Whisper → update transcript
  // Accepts: audio/webm, audio/ogg, audio/mpeg, application/octet-stream
  // Body is raw binary (set by express.raw middleware mounted per-route)
  // -------------------------------------------------------------------------
  router.post(
    '/:id/transcribe',
    express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }),
    async (req: Request, res: Response) => {
      const campaignId = campaignIdOf(req);
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      if (!await guardOwnership(supabase, req.params.id, campaignId)) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const OPENAI_KEY = process.env.OPENAI_API_KEY;
      if (!OPENAI_KEY) return res.status(503).json({ error: 'Whisper não configurado (OPENAI_API_KEY ausente)' });

      const audioBuffer = req.body as Buffer;
      if (!audioBuffer || audioBuffer.length < 100) {
        return res.status(400).json({ error: 'Áudio vazio ou inválido' });
      }
      // Whisper API hard-limits at 25MB. Reject early with a clear message
      // instead of forwarding and surfacing a 413 from OpenAI.
      if (audioBuffer.length > 25 * 1024 * 1024) {
        return res.status(413).json({ error: 'Áudio excede 25MB. Reuniões longas devem ser divididas em segmentos menores.' });
      }

      try {
        const contentType = req.headers['content-type'] ?? 'audio/webm';
        const ext = contentType.includes('ogg') ? 'ogg'
          : contentType.includes('mpeg') || contentType.includes('mp3') ? 'mp3'
          : contentType.includes('mp4') ? 'mp4'
          : 'webm';

        // Node 22: native FormData + Blob
        const blob = new Blob([new Uint8Array(audioBuffer)], { type: contentType });
        const formData = new FormData();
        formData.append('file', blob, `recording.${ext}`);
        formData.append('model', 'whisper-1');
        formData.append('language', 'pt');
        formData.append('response_format', 'text');

        const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${OPENAI_KEY}` },
          body: formData,
        });

        if (!whisperRes.ok) {
          const errText = await whisperRes.text();
          throw new Error(`Whisper error ${whisperRes.status}: ${errText}`);
        }

        const transcript = (await whisperRes.text()).trim();

        await supabase
          .from('meeting_records')
          .update({
            transcript,
            status: 'transcribed',
            recordedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .eq('id', req.params.id);

        return res.json({ ok: true, transcript });
      } catch (err: any) {
        console.error('[Meetings] transcribe:', err);
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /:id/analyze  — AI analysis of transcript → summary + actions
  // -------------------------------------------------------------------------
  router.post('/:id/analyze', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    if (!await guardOwnership(supabase, req.params.id, campaignId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    if (!isChatConfigured()) return res.status(503).json({ error: 'IA não configurada (defina OPENAI_API_KEY ou CLAUDE_API_KEY)' });

    try {
      const { data: meeting } = await supabase
        .from('meeting_records')
        .select('transcript, title')
        .eq('id', req.params.id)
        .single();

      if (!meeting?.transcript) {
        return res.status(400).json({ error: 'Transcrição ausente. Grave ou cole a ata primeiro.' });
      }

      const context = await buildCampaignContext(supabase, campaignId);

      const content = await chatCompletion({
        system: `Você é um assessor político experiente. Analise a ata da reunião de campanha e retorne SOMENTE um JSON válido no formato:
{
  "summary": "resumo executivo em 3-5 frases",
  "highlights": ["ponto chave 1", "ponto chave 2"],
  "actions": [
    {
      "title": "descrição da ação",
      "assignee": "nome ou cargo responsável",
      "dueDate": "YYYY-MM-DD ou null",
      "bucket": "recursos|financeiro|material|pessoal|redes_sociais|outros",
      "priority": "alta|media|baixa"
    }
  ]
}
Foco em ações concretas e mensuráveis. Use o contexto da campanha para priorizar. Máximo 10 ações.`,
        user: `Contexto da campanha:\n${context}\n\n---\nATA DA REUNIÃO "${meeting.title}":\n${meeting.transcript}`,
        maxTokens: 1500,
        temperature: 0.4,
        jsonMode: true,
      });
      const result = JSON.parse(content || '{}');

      const summary: string = result.summary ?? '';
      const highlights: string[] = Array.isArray(result.highlights) ? result.highlights : [];
      const actions = Array.isArray(result.actions)
        ? result.actions.map((a: any) => ({ ...a, approved: false, agentTaskId: null }))
        : [];

      await supabase
        .from('meeting_records')
        .update({
          summary,
          highlights,
          actions,
          status: 'analyzed',
          updatedAt: new Date().toISOString(),
        })
        .eq('id', req.params.id);

      return res.json({ ok: true, summary, highlights, actions });
    } catch (err: any) {
      console.error('[Meetings] analyze:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // POST /:id/actions/:index/approve  — approve action → agent_task
  // -------------------------------------------------------------------------
  router.post('/:id/actions/:index/approve', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    const userId = userIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    if (!await guardOwnership(supabase, req.params.id, campaignId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const idx = parseInt(req.params.index, 10);
    if (Number.isNaN(idx)) return res.status(400).json({ error: 'index inválido' });

    try {
      const { data: meeting } = await supabase
        .from('meeting_records')
        .select('actions, title')
        .eq('id', req.params.id)
        .single();

      if (!meeting?.actions || !Array.isArray(meeting.actions)) {
        return res.status(404).json({ error: 'Ações não encontradas' });
      }

      const action = meeting.actions[idx];
      if (!action) return res.status(404).json({ error: `Ação ${idx} não encontrada` });
      if (action.approved) return res.json({ ok: true, alreadyApproved: true, agentTaskId: action.agentTaskId });

      // Enqueue as agent_task
      const { id: taskId } = await enqueueTask(supabase, {
        campaignId,
        type: 'meeting-action',
        payload: {
          meetingId: req.params.id,
          meetingTitle: meeting.title,
          action: action.title,
          assignee: action.assignee,
          dueDate: action.dueDate,
          bucket: action.bucket,
          priority: action.priority,
          approvedBy: userId,
        },
      });

      // Mark action as approved in the array
      const updatedActions = [...meeting.actions];
      updatedActions[idx] = { ...action, approved: true, agentTaskId: taskId };

      await supabase
        .from('meeting_records')
        .update({ actions: updatedActions, updatedAt: new Date().toISOString() })
        .eq('id', req.params.id);

      await audit(supabase, {
        ...actorFromRequest(req),
        action: 'meeting.action.approved',
        resourceType: 'meeting_records',
        resourceId: req.params.id,
        severity: 'info',
        metadata: { actionTitle: action.title, taskId },
      });

      return res.json({ ok: true, agentTaskId: taskId });
    } catch (err: any) {
      console.error('[Meetings] approve action:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /:id
  // -------------------------------------------------------------------------
  router.delete('/:id', async (req: Request, res: Response) => {
    const campaignId = campaignIdOf(req);
    if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

    if (!await guardOwnership(supabase, req.params.id, campaignId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const { error } = await supabase
        .from('meeting_records')
        .delete()
        .eq('id', req.params.id);
      if (error) throw error;
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
