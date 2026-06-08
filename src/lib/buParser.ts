/**
 * Parser do Boletim de Urna (BU) — padrão TSE (manual "QR Code no Boletim de
 * Urna", 2024, válido p/ 2026). O BU é codificado em 1..4 QR Codes alfanuméricos
 * de até 1.100 chars, no formato "chave:valor" separado por espaços, com 3 seções
 * por QR: cabeçalho (QRBU/VRQR/VRCH), conteúdo, e segurança (HASH/ASSI).
 *
 * Ref. seção 4 do manual. Aqui remontamos o conteúdo dos QRs e extraímos o que
 * a apuração paralela precisa: identificação da seção + votos por cargo/candidato.
 */

export const CARGO_NOMES: Record<number, string> = {
  1: 'Presidente', 3: 'Governador', 5: 'Senador', 6: 'Deputado Federal',
  7: 'Deputado Estadual', 8: 'Deputado Distrital', 9: 'Conselheiro Distrital',
  11: 'Prefeito', 13: 'Vereador',
};
/** Mapeia o nome do cargo (cadastro da campanha) para o código do TSE. */
export const cargoNomeToCodigo = (nome?: string): number | null => {
  if (!nome) return null;
  const n = nome.trim().toLowerCase();
  const hit = Object.entries(CARGO_NOMES).find(([, v]) => v.toLowerCase() === n);
  return hit ? Number(hit[0]) : null;
};

export interface BUCargo {
  codigo: number;
  tipo: number | null;          // 0 majoritário, 1 proporcional, 2 consulta
  candidatos: Record<string, number>; // número → votos
  nominais?: number;
  brancos?: number;
  nulos?: number;
  total?: number;
}
export interface BUParsed {
  qrCount: number;
  header: {
    uf?: string; municipio?: string; zona?: string; secao?: string;
    turno?: string; data?: string; fase?: string; urna?: string;
    comparecimento?: number; aptos?: number;
  };
  cargos: BUCargo[];
  hash?: string;
  assinatura?: string;
  raw: string;
}

/** Remove cabeçalho (QRBU/VRQR/VRCH) e a seção de segurança (HASH/ASSI) de 1 QR. */
function fragmentOf(qr: string): string {
  let s = qr.trim().replace(/\s+/g, ' ');
  const head = s.match(/^QRBU:\d+:\d+\s+VRQR:[\d.]+\s+VRCH:\d+\s+/);
  if (head) s = s.slice(head[0].length);
  const hi = s.indexOf('HASH:');
  if (hi >= 0) s = s.slice(0, hi).trim();
  return s;
}

/** Índice e total de QRs a partir do prefixo QRBU:n:x. */
export function qrIndex(qr: string): { n: number; total: number } | null {
  const m = qr.match(/QRBU:(\d+):(\d+)/);
  return m ? { n: Number(m[1]), total: Number(m[2]) } : null;
}

const splitKV = (token: string): [string, string] => {
  const i = token.indexOf(':');
  return i < 0 ? [token, ''] : [token.slice(0, i), token.slice(i + 1)];
};

/**
 * Recebe os textos dos QRs (em qualquer ordem) e devolve o BU estruturado.
 * Ignora QRs que não sejam do BU. Tolerante a QRs faltando (parseia o que tem).
 */
export function parseBU(qrTexts: string[]): BUParsed {
  const bus = qrTexts.filter((t) => /QRBU:\d+:\d+/.test(t));
  const ordered = [...bus].sort((a, b) => (qrIndex(a)?.n ?? 0) - (qrIndex(b)?.n ?? 0));
  const total = qrIndex(ordered[0] || '')?.total ?? ordered.length;

  // Segurança do último QR (hash/assinatura)
  const last = ordered[ordered.length - 1] || '';
  const hash = (ordered.map((q) => q.match(/HASH:([0-9A-Fa-f]+)/)?.[1]).filter(Boolean).pop()) || undefined;
  const assinatura = last.match(/ASSI:([0-9A-Fa-f]+)/)?.[1] || undefined;

  const content = ordered.map(fragmentOf).join(' ');
  const tokens = content.split(' ').filter(Boolean);

  const header: BUParsed['header'] = {};
  const cargos: BUCargo[] = [];
  let cur: BUCargo | null = null;

  for (const tk of tokens) {
    const [key, val] = splitKV(tk);
    switch (key) {
      case 'UNFE': header.uf = val; break;
      case 'MUNI': header.municipio = val; break;
      case 'ZONA': header.zona = val; break;
      case 'SECA': header.secao = val; break;
      case 'TURN': header.turno = val; break;
      case 'DTPL': header.data = val; break;
      case 'FASE': header.fase = val; break;
      case 'IDUE': header.urna = val; break;
      case 'COMP': header.comparecimento = Number(val) || 0; break;
      case 'APTO': header.aptos = Number(val) || 0; break;
      case 'CARG': cur = { codigo: Number(val), tipo: null, candidatos: {} }; cargos.push(cur); break;
      case 'TIPO': if (cur) cur.tipo = Number(val); break;
      case 'NOMI': if (cur) cur.nominais = Number(val) || 0; break;
      case 'BRAN': if (cur) cur.brancos = Number(val) || 0; break;
      case 'NULO': if (cur) cur.nulos = Number(val) || 0; break;
      case 'TOTC': if (cur) cur.total = Number(val) || 0; break;
      // cabeçalho/partido/resumo que não usamos diretamente
      case 'PART': case 'LEGP': case 'TOTP': case 'APTA': case 'APTS': case 'APTT':
      case 'CSEC': case 'LEGC': case 'VERC': case 'IDEL': case 'MAJO': case 'PROP':
      case 'ORIG': case 'ORLC': case 'PROC': case 'PLEI': case 'AGRE': case 'IDCA':
      case 'HIQT': case 'HICA': case 'VERS': case 'LOCA': case 'FALT': case 'HBBM':
      case 'HBBG': case 'HBSB': case 'DTAB': case 'HRAB': case 'DTFC': case 'HRFC':
      case 'DTEM': case 'HREM': case 'JUNT': case 'TURM':
        break;
      default:
        // Voto em candidata/candidato/resposta: número:votos (chave numérica)
        if (cur && /^\d+$/.test(key) && /^\d+$/.test(val)) {
          cur.candidatos[key] = Number(val);
        }
    }
  }

  return { qrCount: total, header, cargos, hash, assinatura, raw: content };
}

/** Votos de um número de candidato em um cargo específico (ou no BU todo). */
export function votosDoCandidato(bu: BUParsed, numero: string, cargoCodigo?: number | null): {
  votos: number; cargo: BUCargo | null;
} {
  const num = (numero || '').trim();
  if (!num) return { votos: 0, cargo: null };
  const candidatos = cargoCodigo != null
    ? bu.cargos.filter((c) => c.codigo === cargoCodigo)
    : bu.cargos;
  for (const c of candidatos) {
    if (c.candidatos[num] != null) return { votos: c.candidatos[num], cargo: c };
  }
  return { votos: 0, cargo: cargoCodigo != null ? (bu.cargos.find((c) => c.codigo === cargoCodigo) ?? null) : null };
}
