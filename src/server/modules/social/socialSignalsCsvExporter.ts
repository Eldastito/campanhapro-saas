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

import type { StoredSocialSignal, SignalStats } from './socialSignalStore.js';

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

// ── Stats CSV ──────────────────────────────────────────────────────

/**
 * Serializa SignalStats como CSV multi-seção (RFC 4180 relaxado). Um
 * único arquivo com blocos separados por linha em branco:
 *
 *   1) Metadados (sinceDate, untilDate, total)
 *   2) bySeverity
 *   3) bySource
 *   4) byTopic
 *   5) byProvider
 *   6) byDay (se presente)
 *
 * PORQUÊ tudo num arquivo só (e não N arquivos): analista abre no Excel/
 * Sheets uma vez e vê tudo. Blocos separados são fáceis de selecionar
 * e copiar-colar em relatórios.
 *
 * Cada bloco começa com uma linha de "seção" (comentário curto) seguida
 * do header. Excel ignora comentários de aspas simples ainda como texto,
 * então usamos header explícito ao invés de tentar sinalizar seções.
 */
export function statsCsv(stats: SignalStats): string {
  const lines: string[] = [];

  // Bloco 1: Metadados
  lines.push('section,key,value');
  lines.push(`meta,sinceDate,${csvEscape(stats.sinceDate)}`);
  lines.push(`meta,untilDate,${csvEscape(stats.untilDate)}`);
  lines.push(`meta,total,${stats.total}`);
  lines.push('');

  // Bloco 2: bySeverity
  lines.push('bySeverity,count');
  for (const key of ['info', 'attention', 'risk', 'crisis'] as const) {
    lines.push(`${key},${stats.bySeverity[key]}`);
  }
  lines.push('');

  // Bloco 3: bySource
  lines.push('bySource,count');
  const sources: readonly string[] = ['trend', 'anomaly', 'cross_network_trend', 'cross_network_anomaly'];
  for (const key of sources) {
    lines.push(`${key},${stats.bySource[key as keyof typeof stats.bySource] ?? 0}`);
  }
  lines.push('');

  // Bloco 4: byTopic (ordenado alfabético, __null__ vira "(sem topic)")
  lines.push('byTopic,count');
  const topics = Object.entries(stats.byTopic).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [key, count] of topics) {
    const label = key === '__null__' ? '(sem topic)' : key;
    lines.push(`${csvEscape(label)},${count}`);
  }
  lines.push('');

  // Bloco 5: byProvider
  lines.push('byProvider,count');
  const providers: readonly string[] = ['instagram', 'facebook', 'youtube', 'tiktok', 'x', 'linkedin', 'kwai'];
  for (const key of providers) {
    lines.push(`${key},${stats.byProvider[key as keyof typeof stats.byProvider] ?? 0}`);
  }

  // Bloco 6: byDay (opcional, só se presente)
  if (stats.byDay && stats.byDay.length > 0) {
    lines.push('');
    lines.push('byDay,total,crisis,risk,attention,info');
    for (const b of stats.byDay) {
      lines.push(`${b.date},${b.total},${b.crisis},${b.risk},${b.attention},${b.info}`);
    }
  }

  // BOM + CRLF (mesmo formato do CSV de signals)
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}

/** Filename sugerido pro CSV de stats. */
export function statsCsvFilename(campaignId: string, now: Date = new Date()): string {
  const short = campaignId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'campaign';
  const iso = now.toISOString();
  const stamp = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}`;
  return `signals-stats-${short}-${stamp}.csv`;
}

export const SOCIAL_SIGNALS_CSV_EXPORTER_VERSION = '2026-08-27.v1';
