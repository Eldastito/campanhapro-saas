/**
 * OCR de comprovantes via GPT-4o (visão). Recebe a imagem (data URL base64) e
 * extrai os campos da nota/recibo em JSON estruturado, para PRÉ-PREENCHER o
 * lançamento. Nada é gravado sem a confirmação do revisor — isto só sugere.
 *
 * PDF não é enviado ao modelo de visão (a Chat Completions só aceita imagem):
 * o chamador checa o mime e pula o OCR quando for PDF.
 */
import axios from 'axios';

export interface ReceiptOcr {
  valor?: number;        // valor total
  data?: string;         // AAAA-MM-DD
  documento?: string;    // CPF/CNPJ do fornecedor (despesa) ou doador (receita)
  nome?: string;         // razão social/fornecedor (despesa) ou doador (receita)
  descricao?: string;    // resumo do que foi pago/recebido
  tipo?: string;         // ex.: Nota Fiscal, Cupom Fiscal, Recibo
  confidence?: 'high' | 'medium' | 'low';
}

const SYSTEM = `Você extrai dados de comprovantes financeiros brasileiros (nota fiscal, cupom fiscal, recibo, comprovante de transferência/PIX).
Responda SOMENTE um objeto JSON com as chaves: valor (número, em reais, ponto decimal), data (AAAA-MM-DD), documento (CPF ou CNPJ só dígitos), nome (razão social/fornecedor ou doador), descricao (curta), tipo (Nota Fiscal|Cupom Fiscal|Recibo|Outro), confidence (high|medium|low).
Use null quando não encontrar o campo. Não invente valores.`;

export async function extractReceipt(imageDataUrl: string, kind: 'income' | 'expense'): Promise<ReceiptOcr> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY ausente');

  const contexto = kind === 'income'
    ? 'Este comprovante é de um RECEBIMENTO (doação/recurso recebido). "nome"/"documento" = quem doou/pagou.'
    : 'Este comprovante é de uma DESPESA (gasto da campanha). "nome"/"documento" = o fornecedor.';

  const body = {
    model: 'gpt-4o',
    temperature: 0,
    max_tokens: 800,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${contexto} Extraia os campos do comprovante.` },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
  };

  const res = await axios.post('https://api.openai.com/v1/chat/completions', body, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 60000,
  });

  const txt = res.data?.choices?.[0]?.message?.content ?? '{}';
  let parsed: any = {};
  try { parsed = JSON.parse(txt); } catch { parsed = {}; }

  // Normaliza valor para número (aceita "1.234,56" ou "1234.56").
  let valor: number | undefined;
  if (typeof parsed.valor === 'number') valor = parsed.valor;
  else if (typeof parsed.valor === 'string') {
    const n = parseFloat(parsed.valor.replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, ''));
    valor = Number.isFinite(n) ? n : undefined;
  }

  return {
    valor,
    data: typeof parsed.data === 'string' ? parsed.data : undefined,
    documento: parsed.documento ? String(parsed.documento).replace(/\D/g, '') : undefined,
    nome: typeof parsed.nome === 'string' ? parsed.nome : undefined,
    descricao: typeof parsed.descricao === 'string' ? parsed.descricao : undefined,
    tipo: typeof parsed.tipo === 'string' ? parsed.tipo : undefined,
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : undefined,
  };
}
