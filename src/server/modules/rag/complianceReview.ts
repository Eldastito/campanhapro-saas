import { callAgent } from '../../../lib/aiCallAgent';
import { ACCOUNTANT_INSTRUCTION, LEGAL_INSTRUCTION, COMPLIANCE_DISCLAIMER } from '../../../lib/agentInstructions';
import { searchLegalKnowledge, LegalSearchResult } from './legalKnowledge';

export type ComplianceSubjectKind =
  | 'transaction'
  | 'expense'
  | 'donation'
  | 'contract'
  | 'free_query'
  | 'accounts_rendering';

export interface ComplianceSubject {
  kind: ComplianceSubjectKind;
  /** Texto do que analisar (ou a consulta livre do usuário). */
  description: string;
  /** Dados estruturados opcionais (valor, doador, CNPJ da fonte, datas...). */
  data?: Record<string, unknown>;
}

export interface ComplianceStageResult {
  text: string;
  provider: string;
  model: string;
  runId: string;
  costCentsUsd: number;
}

export interface ComplianceReviewResult {
  accounting: ComplianceStageResult;
  legal: ComplianceStageResult;
  /** Fontes da base curada injetadas no contexto (proveniência do parecer). */
  citations: LegalSearchResult[];
  /** Nível de risco extraído do parecer jurídico (best-effort; PR 6 estrutura melhor). */
  riskHint: 'baixo' | 'médio' | 'alto' | 'crítico' | null;
  costCentsUsd: number;
  disclaimer: string;
}

/** Monta o bloco de CONTEXTO com as normas da base, numeradas pra citação. */
function formatRules(rules: LegalSearchResult[]): string {
  if (rules.length === 0) {
    return 'CONTEXTO: nenhuma norma da base curada casou com esta consulta — ' +
      'sinalize explicitamente essa ausência no parecer e não invente fonte.';
  }
  const blocks = rules.map((r, i) => {
    const tag = [r.sourceOrg, r.source, r.electionYear].filter(Boolean).join(' · ');
    const url = r.sourceUrl ? ` ${r.sourceUrl}` : '';
    return `[${i + 1}] (${tag || 'fonte'})${url}\n${r.content}`;
  });
  return 'CONTEXTO — normas/jurisprudência da base curada (cite por [n]):\n\n' + blocks.join('\n\n');
}

/** Heurística leve pra extrair o nível de risco do texto jurídico. */
function extractRisk(text: string): ComplianceReviewResult['riskHint'] {
  const t = text.toLowerCase();
  if (/\bcr[ií]tico\b/.test(t)) return 'crítico';
  if (/\balto\b/.test(t)) return 'alto';
  if (/\bm[ée]dio\b/.test(t)) return 'médio';
  if (/\bbaixo\b/.test(t)) return 'baixo';
  return null;
}

/**
 * Pipeline de blindagem: busca as regras na base curada → Auditor Contábil
 * levanta os achados → Assessor Jurídico avalia risco e monta tese de defesa.
 *
 * Os dois agentes usam provider GPT → Claude → Gemini (ver AGENT_CONFIGS).
 * Lança BudgetExceededError se a campanha estourou o teto mensal de IA.
 *
 * NÃO persiste nada ainda (tabela de pareceres entra no PR 6) — devolve o
 * resultado em memória pra quem chamar decidir o que fazer.
 */
export async function runComplianceReview(
  supabaseAdmin: any,
  opts: {
    campaignId: string;
    userId?: string | null;
    subject: ComplianceSubject;
    electionYear?: number;
    /** Quantas normas puxar da base. Default 6. */
    ragLimit?: number;
  },
): Promise<ComplianceReviewResult> {
  const { campaignId, userId, subject, electionYear } = opts;

  // 1) Busca semântica na base jurídica (campanha + global:legal, só ativas).
  const ragQuery = `${subject.kind} ${subject.description}`.slice(0, 800);
  const citations = await searchLegalKnowledge(supabaseAdmin, campaignId, ragQuery, {
    limit: opts.ragLimit ?? 6,
    electionYear,
  });
  const context = formatRules(citations);

  const subjectBlock =
    `TIPO: ${subject.kind}\n` +
    `DESCRIÇÃO: ${subject.description}` +
    (subject.data ? `\nDADOS: ${JSON.stringify(subject.data)}` : '');

  // 2) Auditor Contábil
  const accounting = await callAgent(supabaseAdmin, 'accountant', subjectBlock, {
    campaignId,
    userId,
    systemInstruction: `${ACCOUNTANT_INSTRUCTION}\n\nDISCLAIMER A INCLUIR:\n${COMPLIANCE_DISCLAIMER}\n\n${context}`,
  });

  // 3) Assessor Jurídico — recebe o handoff do Contábil.
  const legalPrompt =
    `${subjectBlock}\n\n--- ACHADOS DO AUDITOR CONTÁBIL ---\n${accounting.text}`;
  const legal = await callAgent(supabaseAdmin, 'legal', legalPrompt, {
    campaignId,
    userId,
    managerRunId: accounting.runId, // agrupa as duas calls do mesmo fluxo
    systemInstruction: `${LEGAL_INSTRUCTION}\n\nDISCLAIMER A INCLUIR:\n${COMPLIANCE_DISCLAIMER}\n\n${context}`,
  });

  return {
    accounting: {
      text: accounting.text, provider: accounting.provider, model: accounting.model,
      runId: accounting.runId, costCentsUsd: accounting.costCentsUsd,
    },
    legal: {
      text: legal.text, provider: legal.provider, model: legal.model,
      runId: legal.runId, costCentsUsd: legal.costCentsUsd,
    },
    citations,
    riskHint: extractRisk(legal.text),
    costCentsUsd: accounting.costCentsUsd + legal.costCentsUsd,
    disclaimer: COMPLIANCE_DISCLAIMER,
  };
}
