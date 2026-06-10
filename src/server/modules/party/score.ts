/**
 * Motor de score do PARTIDO (rule-based, anti-fraude).
 *
 * Responde à pergunta central do presidente: "o dinheiro que repassei virou
 * estrutura real e está prestado de contas?" Cruza 5 sinais objetivos — sem IA,
 * sem caixa-preta — e devolve 🟢🟡🔴 + os motivos (o "porquê") de cada candidato.
 *
 * Dimensões e pesos (total 100):
 *   - Cadastro ativo .......... 15
 *   - Comitê (foto + GPS) ..... 25   (gps=25 | endereço=15 | só foto=8 | nada=0)
 *   - Atividade (check-ins) ... 25   (recência do último check-in)
 *   - Equipe (coord + líderes)  15
 *   - Prestação de contas ..... 20   (% do repasse alocado no rateio)
 *
 * É a base que o painel (Fase 6) usa pra ranquear e a válvula (Fase 6) usa pra
 * decidir aprovar/segurar/cortar repasse.
 */
export interface ScoreSignals {
  status: string;
  committee: { hasPhoto: boolean; geoSource: string | null } | null;
  checkinCount: number;
  lastCheckinAt: string | null;
  coordCount: number;
  leaderCount: number;
  valorRecebido: number;
  valorAlocado: number;
}

export type ScoreLevel = 'green' | 'yellow' | 'red';

export interface ScoreResult {
  score: number;            // 0-100
  level: ScoreLevel;
  emoji: '🟢' | '🟡' | '🔴';
  reasons: string[];        // alertas (por que não está verde) — ordenados por gravidade
  breakdown: { cadastro: number; comite: number; atividade: number; equipe: number; contas: number };
}

const LEADER_GOAL = 5;
const DAY = 24 * 60 * 60 * 1000;

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function computeScore(s: ScoreSignals, now: number = Date.now()): ScoreResult {
  const reasons: string[] = [];

  // 1) Cadastro ativo
  const cadastro = s.status === 'active' ? 15 : 0;
  if (s.status !== 'active') reasons.push('Ainda não concluiu o cadastro (conta não ativada).');

  // 2) Comitê — GPS no local é prova forte; endereço é aproximado
  let comite = 0;
  if (s.committee) {
    const geo = s.committee.geoSource;
    if (geo === 'gps') comite = 25;
    else if (geo === 'address') { comite = 15; reasons.push('Comitê com localização aproximada (endereço), sem GPS no local.'); }
    else if (s.committee.hasPhoto) { comite = 8; reasons.push('Comitê sem localização (só foto).'); }
    else { comite = 4; reasons.push('Comitê sem foto e sem GPS.'); }
    if (!s.committee.hasPhoto && comite > 4) reasons.push('Comitê sem foto.');
  } else {
    reasons.push('Sem comitê cadastrado.');
  }

  // 3) Atividade — recência do último check-in
  let atividade = 0;
  if (s.checkinCount > 0 && s.lastCheckinAt) {
    const days = Math.floor((now - new Date(s.lastCheckinAt).getTime()) / DAY);
    if (days <= 14) atividade = 25;
    else if (days <= 30) { atividade = 15; reasons.push(`Último check-in há ${days} dias.`); }
    else if (days <= 60) { atividade = 7; reasons.push(`Último check-in há ${days} dias (atividade caindo).`); }
    else { atividade = 2; reasons.push(`Sem check-in há ${days} dias.`); }
  } else {
    reasons.push('Nunca fez check-in no comitê.');
  }

  // 4) Equipe — coordenador + líderes
  let equipe = 0;
  if (s.coordCount >= 1) equipe += 7; else reasons.push('Sem coordenador cadastrado.');
  const leaderPts = Math.min(8, Math.round((s.leaderCount / LEADER_GOAL) * 8));
  equipe += leaderPts;
  if (s.leaderCount < LEADER_GOAL) reasons.push(`Só ${s.leaderCount} líder(es) cadastrado(s) (meta ${LEADER_GOAL}).`);

  // 5) Prestação de contas — % do repasse alocado no rateio (o "restante a justificar")
  let contas = 20;
  const recebido = Number(s.valorRecebido) || 0;
  const alocado = Number(s.valorAlocado) || 0;
  if (recebido > 0) {
    const ratio = Math.max(0, Math.min(1, alocado / recebido));
    contas = Math.round(20 * ratio);
    const restante = recebido - alocado;
    if (restante > 0.5) {
      const pct = Math.round((restante / recebido) * 100);
      reasons.push(`${brl(restante)} sem justificar (${pct}% do que recebeu).`);
    }
  }
  // recebido == 0 → nada a justificar (contas fica nos 20, neutro)

  const score = cadastro + comite + atividade + equipe + contas;
  const level: ScoreLevel = score >= 70 ? 'green' : score >= 45 ? 'yellow' : 'red';
  const emoji = level === 'green' ? '🟢' : level === 'yellow' ? '🟡' : '🔴';

  return {
    score, level, emoji,
    reasons: reasons.slice(0, 6),
    breakdown: { cadastro, comite, atividade, equipe, contas },
  };
}
