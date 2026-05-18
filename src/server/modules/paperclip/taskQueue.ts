/**
 * Task queue with:
 *  - Paperclip delegation (when PAPERCLIP_URL is set) or local execution
 *  - Human approval gate (requiresApproval tasks block until approved)
 *  - Exponential-backoff retry (max 3 attempts: 5s → 15s → 45s)
 *  - Full status lifecycle persisted to agent_tasks
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  dispatchTask as paperclipDispatch,
  getTaskStatus as paperclipGetStatus,
  AgentTask,
} from '../integrations/paperclipClient';

const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

type LocalTaskHandler = (
  supabase: SupabaseClient,
  task: { id: string; campaignId: string; type: string; payload: Record<string, unknown> }
) => Promise<{ result: string; costCents: number }>;

const _localHandlers = new Map<string, LocalTaskHandler>();

export function registerLocalTaskHandler(type: string, handler: LocalTaskHandler): void {
  _localHandlers.set(type, handler);
}

export type TaskStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected';

export interface QueuedTask {
  id: string;
  campaignId: string;
  type: AgentTask['type'];
  payload: Record<string, unknown>;
  requiresApproval: boolean;
  status: TaskStatus;
  providerTaskId: string | null;
  result: string | null;
  costCents: number | null;
  attempts: number;
  errorMessage: string | null;
  approvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Enqueue a new task. Returns the local task row immediately. */
export async function enqueueTask(
  supabase: SupabaseClient,
  task: AgentTask
): Promise<QueuedTask> {
  const status: TaskStatus = task.requiresApproval ? 'awaiting_approval' : 'pending';

  const { data, error } = await supabase
    .from('agent_tasks')
    .insert({
      campaignId: task.campaignId,
      type: task.type,
      payload: task.payload,
      requiresApproval: task.requiresApproval ?? false,
      status,
      providerTaskId: null,
      result: null,
      costCents: null,
      attempts: 0,
      errorMessage: null,
      approvedByUserId: null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as QueuedTask;
}

/** Approve a task that is awaiting_approval. */
export async function approveTask(
  supabase: SupabaseClient,
  taskId: string,
  campaignId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('agent_tasks')
    .update({ status: 'pending', approvedByUserId: userId, updatedAt: new Date().toISOString() })
    .eq('id', taskId)
    .eq('campaignId', campaignId)
    .eq('status', 'awaiting_approval');

  if (error) throw error;
}

/** Reject a task that is awaiting_approval. */
export async function rejectTask(
  supabase: SupabaseClient,
  taskId: string,
  campaignId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('agent_tasks')
    .update({ status: 'rejected', approvedByUserId: userId, updatedAt: new Date().toISOString() })
    .eq('id', taskId)
    .eq('campaignId', campaignId)
    .eq('status', 'awaiting_approval');

  if (error) throw error;
}

/**
 * Execute a pending task — dispatch to Paperclip or run a local stub.
 * Called by the router after enqueue (or after approval).
 */
export async function executeTask(
  supabase: SupabaseClient,
  taskId: string,
  campaignId: string
): Promise<QueuedTask> {
  const { data: task, error: fetchErr } = await supabase
    .from('agent_tasks')
    .select('*')
    .eq('id', taskId)
    .eq('campaignId', campaignId)
    .single();

  if (fetchErr || !task) throw new Error('Tarefa não encontrada');
  if (task.status === 'awaiting_approval') {
    throw new Error('Tarefa aguarda aprovação humana antes de executar');
  }

  const attempts = (task.attempts ?? 0) + 1;

  await supabase
    .from('agent_tasks')
    .update({ status: 'running', attempts, updatedAt: new Date().toISOString() })
    .eq('id', taskId);

  try {
    const agentTask: AgentTask = {
      campaignId,
      type: task.type,
      payload: task.payload ?? {},
      requiresApproval: task.requiresApproval ?? false,
    };

    const result = await paperclipDispatch(agentTask);

    if (!result) {
      const localHandler = _localHandlers.get(task.type);
      if (localHandler) {
        // Run registered local handler (throws → retry logic in outer catch applies)
        const { result: localResult, costCents: localCost } = await localHandler(supabase, {
          id: taskId,
          campaignId,
          type: task.type,
          payload: task.payload ?? {},
        });
        await supabase.from('agent_tasks').update({
          status: 'completed',
          result: localResult,
          costCents: localCost,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }).eq('id', taskId);
      } else {
        // Paperclip not configured and no local handler — mark completed with stub note
        await supabase.from('agent_tasks').update({
          status: 'completed',
          result: JSON.stringify({ note: 'Paperclip não configurado — execução local simulada', type: task.type }),
          costCents: 0,
          updatedAt: new Date().toISOString(),
        }).eq('id', taskId);
      }
    } else {
      await supabase.from('agent_tasks').update({
        status: result.status === 'completed' ? 'completed' : 'running',
        providerTaskId: result.taskId,
        result: result.result ?? null,
        costCents: result.cost != null ? Math.round(result.cost * 100) : null,
        updatedAt: new Date().toISOString(),
      }).eq('id', taskId);
    }
  } catch (err: any) {
    const delay = RETRY_DELAYS_MS[attempts - 1];
    const canRetry = attempts < 3 && delay != null;

    await supabase.from('agent_tasks').update({
      status: canRetry ? 'pending' : 'failed',
      errorMessage: err.message,
      updatedAt: new Date().toISOString(),
    }).eq('id', taskId);

    if (canRetry) {
      setTimeout(() => executeTask(supabase, taskId, campaignId), delay);
    }
  }

  const { data: updated } = await supabase
    .from('agent_tasks').select('*').eq('id', taskId).single();
  return updated as QueuedTask;
}

/** Sync status from Paperclip for a running task. */
export async function syncTaskStatus(
  supabase: SupabaseClient,
  taskId: string,
  campaignId: string
): Promise<QueuedTask | null> {
  const { data: task } = await supabase
    .from('agent_tasks')
    .select('providerTaskId, status')
    .eq('id', taskId)
    .eq('campaignId', campaignId)
    .single();

  if (!task?.providerTaskId || task.status !== 'running') return null;

  const remote = await paperclipGetStatus(task.providerTaskId, campaignId);
  if (!remote) return null;

  await supabase.from('agent_tasks').update({
    status: remote.status as TaskStatus,
    result: remote.result ?? null,
    costCents: remote.cost != null ? Math.round(remote.cost * 100) : null,
    updatedAt: new Date().toISOString(),
  }).eq('id', taskId);

  const { data: updated } = await supabase
    .from('agent_tasks').select('*').eq('id', taskId).single();
  return updated as QueuedTask;
}
