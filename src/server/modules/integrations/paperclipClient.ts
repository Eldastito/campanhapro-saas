// Stub client for Paperclip agent orchestration engine.
// Phase 4 will implement real task dispatch; for now all methods return graceful no-ops.

import { getInternalToken } from './internalAuth';

const BASE_URL = process.env.PAPERCLIP_URL;

export interface AgentTask {
  campaignId: string;
  type: 'strategic-plan' | 'engagement-analysis' | 'risk-report' | 'compliance-check';
  payload: Record<string, unknown>;
  requiresApproval?: boolean;
}

export interface AgentTaskResult {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting_approval';
  result?: string;
  cost?: number;
  createdAt: string;
}

async function post(path: string, body: unknown, campaignId: string): Promise<unknown> {
  if (!BASE_URL) {
    console.warn('[Paperclip] PAPERCLIP_URL not set — stub mode active');
    return null;
  }
  const token = getInternalToken('campanhapro', campaignId);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`[Paperclip] ${path} failed: ${res.status}`);
  return res.json();
}

export async function dispatchTask(task: AgentTask): Promise<AgentTaskResult | null> {
  return (await post('/api/v1/tasks', task, task.campaignId)) as AgentTaskResult | null;
}

export async function getTaskStatus(taskId: string, campaignId: string): Promise<AgentTaskResult | null> {
  if (!BASE_URL) return null;
  const token = getInternalToken('campanhapro', campaignId);
  const res = await fetch(`${BASE_URL}/api/v1/tasks/${taskId}`, {
    headers: { 'X-Internal-Token': token },
  });
  if (!res.ok) return null;
  return res.json() as Promise<AgentTaskResult>;
}
