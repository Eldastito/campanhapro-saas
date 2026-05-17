// Stub client for CampanhaProCenarios intelligence service.

import { getInternalToken } from './internalAuth';

const BASE_URL = process.env.CAMPANHAPRO_CENARIOS_URL;

export interface CampaignSnapshot {
  schemaVersion: 'campanhapro.snapshot.v1';
  campaignId: string;
  generatedAt: string;
  visits: unknown[];
  teamMembers: unknown[];
  pesquisas: unknown[];
  engagements: unknown[];
  financialSummary: unknown;
}

export interface IntelligenceFactors {
  score: number;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  opportunities: string[];
  syncedAt: string;
}

async function post(path: string, body: unknown, campaignId: string): Promise<unknown> {
  if (!BASE_URL) {
    console.warn('[CampanhaProCenarios] CAMPANHAPRO_CENARIOS_URL not set — stub mode active');
    return null;
  }
  const token = getInternalToken('campanhapro', campaignId);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`[CampanhaProCenarios] ${path} failed: ${res.status}`);
  return res.json();
}

export async function ingestSnapshot(snapshot: CampaignSnapshot): Promise<void> {
  await post('/api/v1/campanhapro/ingest/snapshots', snapshot, snapshot.campaignId);
}

export async function getLatestFactors(campaignId: string): Promise<IntelligenceFactors | null> {
  if (!BASE_URL) return null;
  const token = getInternalToken('campanhapro', campaignId);
  const res = await fetch(`${BASE_URL}/api/v1/campaigns/${campaignId}/factors`, {
    headers: { 'X-Internal-Token': token },
  });
  if (!res.ok) return null;
  return res.json() as Promise<IntelligenceFactors>;
}

export interface ScenarioProjection {
  id: string;
  name: string;
  probability: number;
  projectedVotes: number;
  description: string;
  requiredActions: string[];
}

export async function getScenarios(campaignId: string): Promise<ScenarioProjection[]> {
  if (!BASE_URL) return [];
  const token = getInternalToken('campanhapro', campaignId);
  const res = await fetch(`${BASE_URL}/api/v1/campaigns/${campaignId}/scenarios`, {
    headers: { 'X-Internal-Token': token },
  });
  if (!res.ok) return [];
  return res.json() as Promise<ScenarioProjection[]>;
}
