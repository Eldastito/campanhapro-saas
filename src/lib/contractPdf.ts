/**
 * Gera o PDF do contrato no cliente (jsPDF). Texto selecionável, com quebra de
 * página automática, e as assinaturas desenhadas na tela embutidas como imagem
 * no fim. Mantemos layout simples e jurídico (sem depender de render de HTML).
 */
import { jsPDF } from 'jspdf';

interface Party { razaoSocial?: string; cnpj?: string; endereco?: string; cidade?: string; estado?: string; cep?: string; representante?: string; email?: string; telefone?: string; }
interface Person { nome?: string; papel?: string; cpf?: string; email?: string; }
interface Clause { titulo?: string; texto?: string; }
interface Signature { nome?: string; papel?: string; imageDataUrl?: string; signedAt?: string; }
export interface ContractData {
  title: string;
  provider?: Party; client?: Party;
  people?: Person[]; clauses?: Clause[];
  fields?: { objeto?: string; valor?: string; vigenciaInicio?: string; vigenciaFim?: string; foro?: string; observacoes?: string };
  signatures?: Signature[];
}

const M = 18;          // margem (mm)
const W = 210;         // largura A4
const MAXW = W - M * 2;
const BOTTOM = 280;    // y máximo antes de quebrar página
const fmtDate = (s?: string) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—');

export function generateContractPdf(c: ContractData): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = M;

  const ensure = (h: number) => { if (y + h > BOTTOM) { doc.addPage(); y = M; } };
  const para = (text: string, size = 10, style: 'normal' | 'bold' = 'normal', gap = 1.5) => {
    if (!text) return;
    doc.setFont('helvetica', style); doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, MAXW) as string[];
    for (const ln of lines) { ensure(size * 0.45); doc.text(ln, M, y); y += size * 0.45 + 0.8; }
    y += gap;
  };
  const heading = (text: string) => { y += 2; ensure(8); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(text, M, y); y += 5; doc.setDrawColor(200); doc.line(M, y - 2.5, W - M, y - 2.5); };
  const partyBlock = (p?: Party) => {
    if (!p) { para('—'); return; }
    const bits = [
      p.razaoSocial && `${p.razaoSocial}`,
      p.cnpj && `CNPJ/CPF: ${p.cnpj}`,
      p.endereco && `Endereço: ${p.endereco}${p.cidade ? `, ${p.cidade}` : ''}${p.estado ? `/${p.estado}` : ''}${p.cep ? ` — CEP ${p.cep}` : ''}`,
      p.representante && `Representante: ${p.representante}`,
      [p.email, p.telefone].filter(Boolean).join(' · '),
    ].filter(Boolean) as string[];
    para(bits.join('\n') || '—');
  };

  // Título
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  const tl = doc.splitTextToSize(c.title || 'Contrato', MAXW) as string[];
  for (const ln of tl) { doc.text(ln, W / 2, y, { align: 'center' }); y += 7; }
  y += 2;

  heading('CONTRATADA (presta o serviço / licencia)');
  partyBlock(c.provider);
  heading('CONTRATANTE');
  partyBlock(c.client);

  const f = c.fields || {};
  heading('OBJETO E CONDIÇÕES');
  if (f.objeto) para(f.objeto);
  const cond = [
    f.valor && `Valor: ${f.valor}`,
    (f.vigenciaInicio || f.vigenciaFim) && `Vigência: ${fmtDate(f.vigenciaInicio)} a ${fmtDate(f.vigenciaFim)}`,
    f.foro && `Foro: ${f.foro}`,
  ].filter(Boolean) as string[];
  if (cond.length) para(cond.join('\n'));
  if (f.observacoes) para(`Observações: ${f.observacoes}`);

  if (c.clauses?.length) {
    heading('CLÁUSULAS');
    c.clauses.forEach((cl, i) => {
      para(`${i + 1}. ${cl.titulo || 'Cláusula'}`, 10, 'bold', 0.5);
      if (cl.texto) para(cl.texto);
    });
  }

  if (c.people?.length) {
    heading('PESSOAS ENVOLVIDAS');
    c.people.forEach((p) => para(
      [p.nome, p.papel && `(${p.papel})`, p.cpf && `CPF ${p.cpf}`, p.email].filter(Boolean).join(' — ') || '—', 10, 'normal', 0.5,
    ));
  }

  heading('ASSINATURAS');
  const sigs = c.signatures ?? [];
  if (!sigs.length) {
    para('(sem assinaturas coletadas)');
  } else {
    for (const s of sigs) {
      ensure(34);
      if (s.imageDataUrl) {
        try { doc.addImage(s.imageDataUrl, 'PNG', M, y, 60, 24); } catch { /* imagem inválida: ignora */ }
      }
      doc.setDrawColor(120); doc.line(M, y + 25, M + 60, y + 25);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text(`${s.nome || 'Assinante'}${s.papel ? ` — ${s.papel}` : ''}`, M, y + 29);
      doc.text(`Assinado em ${s.signedAt ? new Date(s.signedAt).toLocaleString('pt-BR') : '—'}`, M, y + 33);
      y += 40;
    }
  }

  const fileName = `contrato-${(c.title || 'contrato').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)}.pdf`;
  doc.save(fileName);
}
