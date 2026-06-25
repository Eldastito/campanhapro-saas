/**
 * Motor de score do PARTIDO (rule-based, anti-fraude).
 *
 * Responde à pergunta central do presidente: "o candidato montou estrutura real
 * de campo e está ativo?" Cruza 4 sinais objetivos — sem IA, sem caixa-preta —
 * e devolve 🟢🟡🔴 + os motivos (o "porquê") de cada candidato.
 *
 * NOTA (remoção do módulo financeiro): o partido NÃO movimenta mais dinheiro
 * aqui. A antiga dimensão "Prestação de contas" (20 pts, % do repasse alocado)
 * foi REMOVIDA e seus 20 pts redistribuídos proporcionalmente nas 4 que ficam
 * (fator 1.25), mantendo a escala 0–100 que o presidente já conhece.
 *
 * Dimensões e pesos (total 100):
 *   - Cadastro ativo .......... 19
 *   - Comitê (foto + GPS) ..... 31   (gps=31 | endereço=19 | só foto=10 | nada=5)
 *   - Atividade (check-ins) ... 31   (recência do último check-in)
 *   - Equipe (coord + líderes)  19
 *
 * É a base que o painel usa pra ranquear e o antifraude usa pra priorizar.
 */
export interface ScoreSignals {
  status: string;
  committee: { hasPhoto: boolean; geoSource: string | null } | null;
  checkinCount: number;
  lastCheckinAt: string | null;
  coordCount: number;
  leaderCount: number;
}

export type ScoreLevel = 'green' | 'yellow' | 'red';

export interface ScoreResult {
  score: number;            // 0-100
  level: ScoreLevel;
  emoji: '🟢' | '🟡' | '🔴';
  reasons: string[];        // alertas (por que não está verde) — ordenados por gravidade
  breakdown: { cadastro: number; comite: number; atividade: number; equipe: number };
}

const LEADER_GOAL = 5;
const DAY = 24 * 60 * 60 * 1000;

export function computeScore(s: ScoreSignals, now: number = Date.now()): ScoreResult {
  const reasons: string[] = [];

  // 1) Cadastro ativo
  const cadastro = s.status === 'active' ? 19 : 0;
  if (s.status !== 'active') reasons.push('Ainda não concluiu o cadastro (conta não ativada).');

  // 2) Comitê — GPS no local é prova forte; endereço é aproximado
  let comite = 0;
  if (s.committee) {
    const geo = s.committee.geoSource;
    if (geo === 'gps') comite = 31;
    else if (geo === 'address') { comite = 19; reasons.push('Comitê com localização aproximada (endereço), sem GPS no local.'); }
    else if (s.committee.hasPhoto) { comite = 10; reasons.push('Comitê sem localização (só foto).'); }
    else { comite = 5; reasons.push('Comitê sem foto e sem GPS.'); }
    if (!s.committee.hasPhoto && comite > 5) reasons.push('Comitê sem foto.');
  } else {
    reasons.push('Sem comitê cadastrado.');
  }

  // 3) Atividade — recência do último check-in
  let atividade = 0;
  if (s.checkinCount > 0 && s.lastCheckinAt) {
    const days = Math.floor((now - new Date(s.lastCheckinAt).getTime()) / DAY);
    if (days <= 14) atividade = 31;
    else if (days <= 30) { atividade = 19; reasons.push(`Último check-in há ${days} dias.`); }
    else if (days <= 60) { atividade = 9; reasons.push(`Último check-in há ${days} dias (atividade caindo).`); }
    else { atividade = 2; reasons.push(`Sem check-in há ${days} dias.`); }
  } else {
    reasons.push('Nunca fez check-in no comitê.');
  }

  // 4) Equipe — coordenador + líderes
  let equipe = 0;
  if (s.coordCount >= 1) equipe += 9; else reasons.push('Sem coordenador cadastrado.');
  const leaderPts = Math.min(10, Math.round((s.leaderCount / LEADER_GOAL) * 10));
  equipe += leaderPts;
  if (s.leaderCount < LEADER_GOAL) reasons.push(`Só ${s.leaderCount} líder(es) cadastrado(s) (meta ${LEADER_GOAL}).`);

  const score = cadastro + comite + atividade + equipe;
  const level: ScoreLevel = score >= 70 ? 'green' : score >= 45 ? 'yellow' : 'red';
  const emoji = level === 'green' ? '🟢' : level === 'yellow' ? '🟡' : '🔴';

  return {
    score, level, emoji,
    reasons: reasons.slice(0, 6),
    breakdown: { cadastro, comite, atividade, equipe },
  };
}
