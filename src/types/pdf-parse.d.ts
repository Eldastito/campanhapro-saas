// Tipos para o subpath interno do pdf-parse. Importamos de
// 'pdf-parse/lib/pdf-parse.js' (e não da raiz) para fugir do bloco de teste
// que a entrada principal roda em runtime ESM — ver pdfExtract.ts.
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }
  export default function pdfParse(
    dataBuffer: Buffer | Uint8Array,
    options?: Record<string, unknown>,
  ): Promise<PdfParseResult>;
}
