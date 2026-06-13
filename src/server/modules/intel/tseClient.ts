/**
 * Cliente do TSE / DivulgaCandContas (#58).
 *
 * Acessa a API REST PÚBLICA do tribunal para buscar candidatos por nome+UF+ano
 * e devolver dados ESTRUTURADOS: número, partido, cargo, situação, bens
 * declarados. Esses dados entram na RAG como FONTE ANCORADA (não inferência),
 * complementando o sinal solto que vem do web_search (#56).
 *
 * Por que não usar só web_search? Porque o TSE é a FONTE PRIMÁRIA — não tem
 * intermediação, não muda redação, não inventa. Quando a IA cita "bens
 * declarados R$ X" ela precisa estar ancorada aqui, não num jornal regional
 * que copiou errado.
 *
 * Limitação conhecida: cada eleição tem um `idEleicao` que precisa ser
 * descoberto antes de listar candidatos. Cacheamos em memória do processo.
 */

const TSE_BASE = 'https://divulgacandcontas.tse.jus.br/divulga/rest/v1';

export interface TseEleicao {
  id: number;       // idEleicao (ex: 2045202024)
  nome: string;
  ano: number;
}

export interface TseCandidato {
  sqCandidato: number;       // sequencial — usado no "buscar"
  nomeUrna: string;
  nomeCompleto: string;
  numero: string;
  partido: { sigla: string; nome: string; numero: string };
  cargo: string;
  cidade?: string;
  situacao: string;
  reeleicao?: boolean;
}

export interface TseDetalhe extends TseCandidato {
  cpf?: string;
  nascimento?: string;
  bensDeclarados?: number;       // total em R$
  bens?: Array<{ descricao: string; valor: number }>;
  ocupacao?: string;
  escolaridade?: string;
  estadoCivil?: string;
  email?: string;
  proposta?: string | null;
  linkOficial?: string;
}

const _eleicoesCache = new Map<string, TseEleicao[]>();

async function fetchJson(url: string, timeoutMs = 12000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`tse_http_${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Lista as eleições oficiais de uma UF em um ano (genéricas + suplementares). */
export async function listElections(ano: number, uf: string): Promise<TseEleicao[]> {
  const key = `${ano}::${uf}`;
  if (_eleicoesCache.has(key)) return _eleicoesCache.get(key)!;
  try {
    const j = await fetchJson(`${TSE_BASE}/eleicao/listar/uf/${ano}/${uf}`);
    const arr = Array.isArray(j) ? j : (j?.eleicoes || []);
    const out: TseEleicao[] = arr.map((e: any) => ({
      id: Number(e.id ?? e.idEleicao),
      nome: String(e.nome ?? ''),
      ano: Number(e.ano ?? ano),
    })).filter((e: TseEleicao) => e.id);
    _eleicoesCache.set(key, out);
    return out;
  } catch (e) {
    return [];
  }
}

/** Escolhe a eleição "principal" do ano — a primeira não-suplementar, ou a primeira. */
export function pickMainElection(eleicoes: TseEleicao[]): TseEleicao | null {
  if (!eleicoes.length) return null;
  const principal = eleicoes.find(e => !/supleme|complement/i.test(e.nome));
  return principal || eleicoes[0];
}

/** Lista candidatos de uma eleição (toda UF). Filtra por nome se passado. */
export async function searchCandidates(
  ano: number, uf: string, idEleicao: number, nome?: string
): Promise<TseCandidato[]> {
  try {
    const j = await fetchJson(`${TSE_BASE}/candidatura/listar/${ano}/${uf}/${idEleicao}/municipio/-1/candidatos`);
    const list = (j?.candidatos || j || []) as any[];
    const out: TseCandidato[] = list.map((c: any) => ({
      sqCandidato: Number(c.sqCandidato ?? c.id),
      nomeUrna: String(c.nomeUrna ?? c.nm_urna ?? '').trim(),
      nomeCompleto: String(c.nomeCompleto ?? c.nm_candidato ?? '').trim(),
      numero: String(c.numero ?? c.nr_candidato ?? ''),
      partido: {
        sigla: String(c?.partido?.sigla ?? c.sg_partido ?? ''),
        nome: String(c?.partido?.nome ?? c.nm_partido ?? ''),
        numero: String(c?.partido?.numero ?? c.nr_partido ?? ''),
      },
      cargo: String(c?.cargo?.nome ?? c.ds_cargo ?? ''),
      cidade: c?.cidade?.nome || c?.nm_ue || null,
      situacao: String(c?.descricaoSituacao ?? c.ds_situacao_candidato ?? ''),
    })).filter(c => c.sqCandidato);
    if (!nome) return out.slice(0, 100);
    const q = nome.trim().toLowerCase();
    return out.filter(c =>
      c.nomeCompleto.toLowerCase().includes(q) ||
      c.nomeUrna.toLowerCase().includes(q)
    ).slice(0, 50);
  } catch (e) {
    return [];
  }
}

/** Detalhe de 1 candidato (bens declarados, escolaridade, ocupação…). */
export async function getCandidateDetail(
  ano: number, uf: string, idEleicao: number, sqCandidato: number
): Promise<TseDetalhe | null> {
  try {
    const j = await fetchJson(`${TSE_BASE}/candidatura/buscar/${ano}/${uf}/${idEleicao}/candidato/${sqCandidato}`);
    if (!j) return null;
    const bens = Array.isArray(j?.bens) ? j.bens : [];
    const bensTotal = bens.reduce((acc: number, b: any) => acc + (Number(b.valor) || 0), 0);
    return {
      sqCandidato,
      nomeCompleto: String(j.nomeCompleto ?? ''),
      nomeUrna: String(j.nomeUrna ?? ''),
      numero: String(j.numero ?? ''),
      partido: {
        sigla: String(j?.partido?.sigla ?? ''),
        nome: String(j?.partido?.nome ?? ''),
        numero: String(j?.partido?.numero ?? ''),
      },
      cargo: String(j?.cargo?.nome ?? ''),
      situacao: String(j?.descricaoSituacao ?? ''),
      cpf: j.cpf ? String(j.cpf) : undefined,
      nascimento: j.dataNascimento ? String(j.dataNascimento) : undefined,
      bensDeclarados: bensTotal,
      bens: bens.map((b: any) => ({
        descricao: String(b.descricao ?? b.descricaoDeBemCandidato ?? ''),
        valor: Number(b.valor) || 0,
      })),
      ocupacao: j.ocupacao ? String(j.ocupacao) : undefined,
      escolaridade: j.descricaoGrauInstrucao ? String(j.descricaoGrauInstrucao) : undefined,
      estadoCivil: j.descricaoEstadoCivil ? String(j.descricaoEstadoCivil) : undefined,
      email: j.email ? String(j.email) : undefined,
      proposta: j.linkPlano || j.urlPlano || null,
      linkOficial: `https://divulgacandcontas.tse.jus.br/divulga/#/candidato/${ano}/${idEleicao}/${uf}/${sqCandidato}`,
    };
  } catch (e) {
    return null;
  }
}

/** Pipeline completo: nome+UF+ano → matches detalhados. */
export async function lookupByName(args: { nome: string; uf: string; ano: number }): Promise<{
  eleicao: TseEleicao | null;
  matches: TseCandidato[];
  detail?: TseDetalhe | null;
}> {
  const uf = String(args.uf || '').toUpperCase().slice(0, 2);
  const ano = Number(args.ano);
  if (!uf || !ano) return { eleicao: null, matches: [] };

  const eleicoes = await listElections(ano, uf);
  const eleicao = pickMainElection(eleicoes);
  if (!eleicao) return { eleicao: null, matches: [] };

  const matches = await searchCandidates(ano, uf, eleicao.id, args.nome);
  let detail: TseDetalhe | null = null;
  if (matches.length === 1) {
    detail = await getCandidateDetail(ano, uf, eleicao.id, matches[0].sqCandidato);
  }
  return { eleicao, matches, detail };
}

/** Texto formatado pra ingerir como chunk na RAG. */
export function detailToRagText(d: TseDetalhe, ano: number): string {
  const lines: string[] = [];
  lines.push(`Candidato ${d.nomeCompleto}${d.nomeUrna && d.nomeUrna !== d.nomeCompleto ? ' (urna: ' + d.nomeUrna + ')' : ''} — eleição ${ano}.`);
  lines.push(`Cargo: ${d.cargo}. Número: ${d.numero}. Partido: ${d.partido.sigla} (${d.partido.nome}). Situação: ${d.situacao}.`);
  if (d.escolaridade) lines.push(`Escolaridade: ${d.escolaridade}.`);
  if (d.ocupacao) lines.push(`Ocupação: ${d.ocupacao}.`);
  if (d.estadoCivil) lines.push(`Estado civil: ${d.estadoCivil}.`);
  if (typeof d.bensDeclarados === 'number') {
    lines.push(`Bens declarados (total): R$ ${d.bensDeclarados.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`);
    if (d.bens && d.bens.length) {
      const top = [...d.bens].sort((a, b) => b.valor - a.valor).slice(0, 5);
      lines.push('Principais bens:');
      for (const b of top) lines.push(`  · ${b.descricao} — R$ ${b.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    }
  }
  if (d.linkOficial) lines.push(`Fonte: ${d.linkOficial}`);
  return lines.join('\n');
}
