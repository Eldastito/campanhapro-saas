/**
 * socialSignalsCsvExporter — serializa `StoredSocialSignal[]` como CSV
 * (RFC 4180) para export de auditoria/relatório humano.
 *
 * FORMAT:
 *   - UTF-8 BOM na frente pra Excel abrir com acentos certos (Excel PT-BR
 *     assume Windows-1252 sem o BOM)
 *   - CRLF entre linhas (RFC 4180)
 *   - Aspas duplas em qualquer campo que contenha ',', '"', '\n' ou '\r'
 *   - Aspas dentro de campo aspado → duplicar (`""`)
 *   - Coluna `providers` = array unido com `;` (RFC não define, mas ';'
 *     evita ambiguidade com o delimitador de CSV)
 *   - Coluna `hypotheses` = array unido com ` | ` — legível pra humano,
 *     REGRA §42 preservada: rótulo da coluna "hypotheses" já sinaliza
 *     que NÃO é fato (o header explícito ajuda o leitor CSV também)
 *
 * ORDEM DE COLUNAS (fixa):
 *   emittedAt,severity,source,topic,providers,confidence,summary,hypotheses,dedupKey
 *
 * PORQUÊ essa ordem: mais importante à esquerda pro humano scanning
 * (quando; quão grave; que tipo; sobre o quê; quais redes; certeza;
 *  o que aconteceu; hipóteses; chave técnica no fim pra grep/join).
 *
 * NÃO expõe `payload` opaco — o CSV é pra humano; drill-down técnico
 * fica no modal §58 do Pulso Digital.
 */

import type { StoredSocialSignal } from './socialSignalStore.js';

// UTF-8 BOM — Excel PT-BR sem isso lê acentos como mojibake
const UTF8_BOM = '﻿';

const HEADER = [
  'emittedAt',
  'severity',
  'source',
  'topic',
  'providers',
  'confidence',
  'summary',
  'hypotheses',
  'dedupKey',
] as const;

/**
 * Escape RFC 4180. Se o valor contém `,`, `"`, `\n` ou `\r`, envolve
 * em aspas duplas e duplica cada aspa interna.
 */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str === '') return '';
  const needsQuote = /[",\r\n]/.test(str);
  if (!needsQuote) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

function serializeRow(s: StoredSocialSignal): string {
  const providers = Array.isArray(s.providers) ? s.providers.join(';') : '';
  const hypotheses = Array.isArray(s.hypotheses) ? s.hypotheses.join(' | ') : '';
  // confidence com 4 casas decimais — margem de precisão sem lixo científico
  const confidence = Number.isFinite(s.confidence) ? s.confidence.toFixed(4) : '';
  const cells = [
    s.emittedAt,
    s.severity,
    s.source,
    s.topic ?? '',
    providers,
    confidence,
    s.summary,
    hypotheses,
    s.dedupKey,
  ];
  return cells.map(csvEscape).join(',');
}

/**
 * Serializa a lista completa. Lista vazia → só o header (permite ao
 * consumer distinguir "sem dados" de "erro" pelo status HTTP + presença
 * do header canônico).
 */
export function toCsv(signals: StoredSocialSignal[]): string {
  const lines: string[] = [HEADER.join(',')];
  for (const s of signals) lines.push(serializeRow(s));
  // CRLF entre linhas + BOM na frente
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}

/**
 * Filename sugerido, safe para header `Content-Disposition`. Formato:
 *   signals-<campaignShort>-<yyyyMMddHHmm>.csv
 * `campaignId` cortado em 8 chars pra evitar filename gigante; UUID
 * completo fica implícito no auth.
 */
export function csvFilename(campaignId: string, now: Date = new Date()): string {
  const short = campaignId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'campaign';
  const iso = now.toISOString();
  const stamp = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}`;
  return `signals-${short}-${stamp}.csv`;
}

export const SOCIAL_SIGNALS_CSV_EXPORTER_VERSION = '2026-08-27.v1';
