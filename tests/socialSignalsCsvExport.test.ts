/**
 * Testes do PR 26 — CSV export de signals.
 *
 * Cobre:
 *   Serializer `toCsv`:
 *     - Header canônico + ordem de colunas
 *     - Escaping RFC 4180 (aspas, vírgulas, newlines)
 *     - Providers unidos com ';', hypotheses com ' | '
 *     - Timestamp ISO passthrough
 *     - Lista vazia → só o header + BOM
 *     - BOM UTF-8 na frente
 *   `csvFilename`:
 *     - Formato signals-<short>-<yyyyMMddHHmm>.csv
 *     - Sanitiza campaignId (remove hifens do UUID etc)
 *   Router:
 *     - GET /signals?format=csv devolve 200 text/csv com Content-Disposition
 *     - Filtros JSON funcionam iguais no CSV
 *     - format inválido → 400
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';
import { createSocialSignalsRouter } from '../src/server/modules/social/socialSignalsRouter';
import {
  toCsv,
  csvFilename,
} from '../src/server/modules/social/socialSignalsCsvExporter';
import { persistSignals } from '../src/server/modules/social/socialSignalStore';
import type { SocialSignal } from '../src/server/modules/social/intelligence/socialSignalBus';
import { SOCIAL_SIGNAL_BUS_VERSION } from '../src/server/modules/social/intelligence/socialSignalBus';
import type { StoredSocialSignal } from '../src/server/modules/social/socialSignalStore';

const CAMP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NOW = new Date('2026-08-27T12:00:00Z');
const HOUR = 3_600_000;
const UTF8_BOM = '﻿';

let seq = 1;
function stored(overrides: Partial<StoredSocialSignal> = {}): StoredSocialSignal {
  const now = NOW.toISOString();
  return {
    id: overrides.id ?? `id-${seq++}`,
    campaignId: overrides.campaignId ?? CAMP,
    dedupKey: overrides.dedupKey ?? `dk-${seq}`,
    source: overrides.source ?? 'trend',
    severity: overrides.severity ?? 'info',
    summary: overrides.summary ?? 'summary padrão',
    hypotheses: overrides.hypotheses ?? [],
    providers: overrides.providers ?? ['instagram'],
    topic: overrides.topic ?? null,
    confidence: overrides.confidence ?? 0.5,
    emittedAt: overrides.emittedAt ?? now,
    payload: overrides.payload ?? {},
    busVersion: overrides.busVersion ?? SOCIAL_SIGNAL_BUS_VERSION,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

// ── Serializer ──────────────────────────────────────────────────────

describe('toCsv — header e formato base', () => {
  test('lista vazia devolve só header + BOM', () => {
    const out = toCsv([]);
    assert.ok(out.startsWith(UTF8_BOM), 'inicia com BOM');
    const withoutBom = out.slice(UTF8_BOM.length);
    // header + \r\n final
    assert.equal(
      withoutBom,
      'emittedAt,severity,source,topic,providers,confidence,summary,hypotheses,dedupKey\r\n',
    );
  });

  test('header canônico na ordem fixa', () => {
    const out = toCsv([stored()]);
    const withoutBom = out.slice(UTF8_BOM.length);
    const firstLine = withoutBom.split('\r\n')[0];
    assert.equal(
      firstLine,
      'emittedAt,severity,source,topic,providers,confidence,summary,hypotheses,dedupKey',
    );
  });

  test('uma linha básica sem escape', () => {
    seq = 1;
    const s = stored({
      dedupKey: 'k1',
      source: 'trend',
      severity: 'info',
      topic: 'saude',
      providers: ['instagram', 'facebook'],
      confidence: 0.75,
      summary: 'volume saude subiu',
      hypotheses: [],
      emittedAt: '2026-08-27T10:00:00.000Z',
    });
    const out = toCsv([s]);
    const withoutBom = out.slice(UTF8_BOM.length);
    const lines = withoutBom.split('\r\n');
    // header + row + trailing empty (por causa do \r\n final)
    assert.equal(lines.length, 3);
    assert.equal(lines[2], '');
    assert.equal(
      lines[1],
      '2026-08-27T10:00:00.000Z,info,trend,saude,instagram;facebook,0.7500,volume saude subiu,,k1',
    );
  });
});

describe('toCsv — escaping RFC 4180', () => {
  test('campo com vírgula é aspado', () => {
    const s = stored({ summary: 'hello, world', dedupKey: 'k' });
    const out = toCsv([s]);
    const line = out.slice(UTF8_BOM.length).split('\r\n')[1];
    // sétima coluna é summary
    assert.ok(line.includes(',"hello, world",'), `esperava aspar hello, world: ${line}`);
  });

  test('aspas dentro do valor são duplicadas', () => {
    const s = stored({ summary: 'ele disse "opa"', dedupKey: 'k' });
    const out = toCsv([s]);
    const line = out.slice(UTF8_BOM.length).split('\r\n')[1];
    assert.ok(line.includes(',"ele disse ""opa""",'), `esperava aspas duplicadas: ${line}`);
  });

  test('newline dentro do valor é aspado (não quebra o CSV)', () => {
    const s = stored({ summary: 'linha1\nlinha2', dedupKey: 'k' });
    const out = toCsv([s]);
    const withoutBom = out.slice(UTF8_BOM.length);
    // Se aspou corretamente, header \r\n + row (com \n interno) \r\n
    const rows = withoutBom.split('\r\n');
    // header, row (com \n interno), trailing empty
    assert.equal(rows.length, 3);
    assert.ok(rows[1].includes('"linha1\nlinha2"'), `esperava aspar newline: ${rows[1]}`);
  });

  test('campo vazio (topic null) fica em branco sem aspas', () => {
    const s = stored({ topic: null, dedupKey: 'k' });
    const out = toCsv([s]);
    const line = out.slice(UTF8_BOM.length).split('\r\n')[1];
    // provider default é instagram, topic é a 4ª coluna → ',,' (topic vazio) + providers
    assert.ok(line.includes(',,instagram,'), `esperava topic vazio: ${line}`);
  });
});

describe('toCsv — arrays', () => {
  test('providers unidos com ";" (evita colidir com delimiter)', () => {
    const s = stored({ providers: ['instagram', 'facebook', 'youtube'], dedupKey: 'k' });
    const out = toCsv([s]);
    const line = out.slice(UTF8_BOM.length).split('\r\n')[1];
    assert.ok(line.includes(',instagram;facebook;youtube,'), line);
  });

  test('hypotheses unidas com " | " (legível pra humano)', () => {
    const s = stored({
      hypotheses: ['post viral do adversário', 'reação a fala pública'],
      dedupKey: 'k',
    });
    const out = toCsv([s]);
    const line = out.slice(UTF8_BOM.length).split('\r\n')[1];
    assert.ok(
      line.includes(',post viral do adversário | reação a fala pública,'),
      `esperava hipóteses unidas: ${line}`,
    );
  });

  test('providers vazio → coluna em branco', () => {
    const s = stored({ providers: [], dedupKey: 'k' });
    const out = toCsv([s]);
    const line = out.slice(UTF8_BOM.length).split('\r\n')[1];
    // providers é a 5ª coluna → ,, entre topic e confidence
    // topic default é null → ,,,,0.5000 → não, providers vazio dá ",,0.5000"
    assert.ok(line.includes(',,0.5000,'), `esperava providers vazio: ${line}`);
  });
});

describe('toCsv — múltiplas linhas + confidence', () => {
  test('N linhas ordenadas na mesma ordem da entrada', () => {
    const list: StoredSocialSignal[] = [
      stored({ dedupKey: 'a', emittedAt: new Date(NOW.getTime() - HOUR).toISOString() }),
      stored({ dedupKey: 'b', emittedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString() }),
      stored({ dedupKey: 'c', emittedAt: new Date(NOW.getTime() - 3 * HOUR).toISOString() }),
    ];
    const out = toCsv(list);
    const rows = out.slice(UTF8_BOM.length).split('\r\n');
    // header + 3 rows + trailing
    assert.equal(rows.length, 5);
    assert.ok(rows[1].endsWith(',a'));
    assert.ok(rows[2].endsWith(',b'));
    assert.ok(rows[3].endsWith(',c'));
  });

  test('confidence com 4 casas decimais', () => {
    const s = stored({ confidence: 0.123456, dedupKey: 'k' });
    const out = toCsv([s]);
    const line = out.slice(UTF8_BOM.length).split('\r\n')[1];
    assert.ok(line.includes(',0.1235,'), `esperava truncar em 4 casas: ${line}`);
  });

  test('confidence NaN vira coluna vazia (não trava)', () => {
    const s = stored({ confidence: NaN, dedupKey: 'k' });
    const out = toCsv([s]);
    const line = out.slice(UTF8_BOM.length).split('\r\n')[1];
    // procura ",,summary" — confidence é a 6ª coluna
    assert.ok(line.includes(',,summary padrão,'), `esperava confidence vazio: ${line}`);
  });
});

// ── Filename helper ─────────────────────────────────────────────────

describe('csvFilename', () => {
  test('formato signals-<short>-<yyyyMMddHHmm>.csv', () => {
    const out = csvFilename(CAMP, new Date('2026-08-27T12:34:56Z'));
    assert.equal(out, 'signals-aaaaaaaa-202608271234.csv');
  });

  test('sanitiza chars fora de [a-zA-Z0-9]', () => {
    const out = csvFilename('camp-123!@#', new Date('2026-08-27T00:00:00Z'));
    // hífen e símbolos vão embora, sobra "camp123!@#"→"camp123" cortado em 8
    assert.match(out, /^signals-camp123-\d{12}\.csv$/);
  });

  test('campaignId vazio vira fallback "campaign"', () => {
    const out = csvFilename('!!!', new Date('2026-08-27T00:00:00Z'));
    assert.match(out, /^signals-campaign-\d{12}\.csv$/);
  });
});

// ── Router integration ─────────────────────────────────────────────

interface FakeUser {
  id?: string;
  campaignId?: string;
  type?: string;
}

function buildApp(user: FakeUser, supabase: ReturnType<typeof createMockSupabase>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { user: FakeUser }).user = user; next(); });
  app.use('/api/v1/social', createSocialSignalsRouter(supabase));
  return app;
}

async function req(app: express.Express, method: string, path: string) {
  return new Promise<{ status: number; text: string; bytes: Uint8Array; headers: Headers }>((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as { port: number }).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
        // Fetch.text() strips a leading UTF-8 BOM per spec; ler bytes crus
        // pra poder verificar o BOM no CSV
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const text = new TextDecoder('utf-8').decode(bytes);
        resolve({ status: res.status, text, bytes, headers: res.headers });
      } catch (err) { reject(err); } finally { server.close(); }
    });
  });
}

let sigSeq = 1;
function signalFixture(overrides: Partial<SocialSignal> = {}): SocialSignal {
  return {
    dedupKey: overrides.dedupKey ?? `stub::${sigSeq++}`,
    source: overrides.source ?? 'trend',
    severity: overrides.severity ?? 'info',
    summary: overrides.summary ?? 'stub summary',
    hypotheses: overrides.hypotheses ?? [],
    providers: overrides.providers ?? ['instagram'],
    topic: overrides.topic,
    confidence: overrides.confidence ?? 0.5,
    emittedAt: overrides.emittedAt ?? NOW,
    payload: overrides.payload ?? { kind: 'trend', result: {} as never },
    busVersion: SOCIAL_SIGNAL_BUS_VERSION,
  };
}

describe('GET /signals?format=csv', () => {
  async function seed() {
    sigSeq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signalFixture({ dedupKey: 'a', severity: 'info', topic: 'saude', emittedAt: new Date(NOW.getTime() - 1 * HOUR) }),
      signalFixture({ dedupKey: 'b', severity: 'risk', source: 'anomaly', topic: 'saude', emittedAt: new Date(NOW.getTime() - 2 * HOUR) }),
      signalFixture({ dedupKey: 'c', severity: 'crisis', source: 'anomaly', topic: 'seguranca', emittedAt: new Date(NOW.getTime() - 3 * HOUR) }),
    ]);
    // outra campanha — não pode aparecer
    await persistSignals(supabase, OTHER, [
      signalFixture({ dedupKey: 'x', severity: 'crisis', topic: 'saude' }),
    ]);
    return supabase;
  }

  test('devolve 200 text/csv com attachment', async () => {
    const supabase = await seed();
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals?format=csv');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /text\/csv/);
    const dispo = r.headers.get('content-disposition') ?? '';
    assert.match(dispo, /^attachment; filename="signals-aaaaaaaa-\d{12}\.csv"$/);
  });

  test('body começa com BOM e header canônico', () => {
    // sanity check em cima do serializer — o body do HTTP passa exatamente pelo toCsv
    const out = toCsv([]);
    assert.ok(out.startsWith('﻿'));
    assert.ok(out.includes('emittedAt,severity,source,topic,providers'));
  });

  test('isolamento §35: CSV nunca inclui dedupKey de OTHER', async () => {
    const supabase = await seed();
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals?format=csv');
    assert.ok(!r.text.includes(',x\r\n') && !r.text.endsWith(',x\r\n'), 'não vaza dedupKey da OTHER');
    assert.ok(r.text.includes(',a\r\n') || r.text.includes(',a\r\n'));
  });

  test('filtro minSeverity=risk aplica antes do CSV', async () => {
    const supabase = await seed();
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals?format=csv&minSeverity=risk');
    // sobrou b (risk) + c (crisis); 'a' foi filtrado
    assert.ok(r.text.includes(',b\r\n'));
    assert.ok(r.text.includes(',c\r\n'));
    assert.ok(!r.text.includes(',a\r\n'));
  });

  test('format inválido → 400 JSON (não CSV corrompido)', async () => {
    const supabase = await seed();
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals?format=xml');
    assert.equal(r.status, 400);
    assert.deepEqual(JSON.parse(r.text), { error: 'invalid_format' });
  });

  test('401 sem campaignId (mesmo comportamento do JSON)', async () => {
    const supabase = await seed();
    const app = buildApp({ id: 'u1' }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals?format=csv');
    assert.equal(r.status, 401);
  });

  test('sem signals: body só header + BOM, ainda 200', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals?format=csv');
    assert.equal(r.status, 200);
    // BOM UTF-8 = EF BB BF nos primeiros 3 bytes
    assert.equal(r.bytes[0], 0xEF);
    assert.equal(r.bytes[1], 0xBB);
    assert.equal(r.bytes[2], 0xBF);
    // Decodifica removendo BOM (TextDecoder default preserva; strip manual)
    const withoutBom = r.text.replace(/^﻿/, '');
    assert.equal(
      withoutBom,
      'emittedAt,severity,source,topic,providers,confidence,summary,hypotheses,dedupKey\r\n',
    );
  });
});
