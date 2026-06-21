import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export interface ExtractedPdf {
  text: string;
  pages: number;
}

// Postgres rejeita o byte NUL em colunas text; PDFs mal formados às vezes o
// devolvem no meio do texto extraído. Tiramos antes de qualquer ingestão.
const NUL_BYTE = /\u0000/g;

/**
 * Extrai texto de um PDF (Resoluções TSE/TRE, manuais SPCE, jurisprudência,
 * contratos enviados pelo usuário).
 *
 * Importamos de 'pdf-parse/lib/pdf-parse.js' de propósito: a entrada raiz
 * ('pdf-parse') roda um bloco de auto-teste que tenta ler um PDF de exemplo
 * do disco quando não há require.main — isso quebra em runtime ESM. O subpath
 * pula esse harness. Já mordeu aqui em ambiente ESM.
 */
export async function extractPdfText(data: Buffer | Uint8Array): Promise<ExtractedPdf> {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const parsed = await pdfParse(buf);
  return {
    text: (parsed.text || '').replace(NUL_BYTE, '').trim(),
    pages: parsed.numpages ?? 0,
  };
}
