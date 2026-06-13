/**
 * Tiny in-memory Supabase mock that supports the subset of the JS client
 * used by this project's routers: select / insert / update / upsert with
 * eq / gte / order / limit / single / maybeSingle / select(count).
 *
 * It does NOT enforce RLS — but the routers under test enforce campaign
 * isolation themselves at the Express layer (req.user.campaignId), so
 * the test asserts: "given mismatched campaign in URL params, does the
 * router return data from another campaign?"  The mock returns *all*
 * matching rows so the assertion catches any accidental cross-tenant leak.
 */

type Row = Record<string, any>;

interface QueryState {
  table: string;
  store: Map<string, Row[]>;
  filters: Array<(row: Row) => boolean>;
  selectCols: string;
  isCount: boolean;
  limitN?: number;
  orderKey?: string;
  orderAsc?: boolean;
  insertRows?: Row[];
  updatePayload?: Row;
  upsertRows?: Row[];
  upsertOnConflict?: string;
  upsertIgnoreDup?: boolean;
  mode: 'select' | 'insert' | 'update' | 'upsert';
}

function applyFilters(rows: Row[], filters: QueryState['filters']): Row[] {
  return rows.filter(r => filters.every(f => f(r)));
}

function buildQuery(table: string, store: Map<string, Row[]>): any {
  const state: QueryState = {
    table, store, filters: [], selectCols: '*',
    isCount: false, mode: 'select',
  };

  const exec = async () => {
    const rows = store.get(table) ?? [];
    if (state.mode === 'insert' && state.insertRows) {
      const nowIso = new Date().toISOString();
      const inserted = state.insertRows.map(r => ({
        id: r.id ?? cryptoRandomId(),
        // simulate DB defaults — only set if caller didn't provide
        createdAt: r.createdAt ?? nowIso,
        updatedAt: r.updatedAt ?? nowIso,
        recordedAt: r.recordedAt ?? nowIso,
        receivedAt: r.receivedAt ?? nowIso,
        ...r,
      }));
      store.set(table, [...rows, ...inserted]);
      return { data: inserted, error: null };
    }
    if (state.mode === 'update' && state.updatePayload) {
      // Match rows BEFORE applying the update — Postgres semantics for
      // UPDATE...WHERE...RETURNING: the returned rows are those that matched
      // the predicate at the time of the update, not after.
      const matching = applyFilters(rows, state.filters);
      const updatedRows = rows.map(r =>
        matching.includes(r) ? { ...r, ...state.updatePayload } : r,
      );
      store.set(table, updatedRows);
      const returned = updatedRows.filter((_r, i) => matching.includes(rows[i]));
      return { data: returned, error: null };
    }
    if (state.mode === 'upsert' && state.upsertRows) {
      const updated = [...rows];
      for (const row of state.upsertRows) {
        const conflictCols = (state.upsertOnConflict ?? 'id').split(',').map(s => s.trim());
        const matchIdx = updated.findIndex(r =>
          conflictCols.every(c => r[c] === row[c]),
        );
        if (matchIdx >= 0) {
          if (!state.upsertIgnoreDup) updated[matchIdx] = { ...updated[matchIdx], ...row };
        } else {
          updated.push({ id: cryptoRandomId(), ...row });
        }
      }
      store.set(table, updated);
      return { data: state.upsertRows, error: null };
    }
    // select
    let out = applyFilters(rows, state.filters);
    if (state.orderKey) {
      const k = state.orderKey;
      out = [...out].sort((a, b) => {
        const av = a[k]; const bv = b[k];
        if (av === bv) return 0;
        return (av > bv ? 1 : -1) * (state.orderAsc ? 1 : -1);
      });
    }
    if (state.limitN) out = out.slice(0, state.limitN);
    if (state.isCount) return { count: out.length, error: null };
    return { data: out, error: null };
  };

  const chain: any = {
    select: (cols = '*', opts?: { count?: 'exact' | 'estimated'; head?: boolean }) => {
      state.selectCols = cols;
      state.isCount = !!opts?.count;
      return chain;
    },
    insert: (rows: Row | Row[]) => {
      state.mode = 'insert';
      state.insertRows = Array.isArray(rows) ? rows : [rows];
      return {
        select: () => ({
          single: async () => {
            const r = await exec();
            return { data: r.data?.[0] ?? null, error: r.error };
          },
        }),
        ...thenable(exec),
      };
    },
    update: (payload: Row) => {
      state.mode = 'update';
      state.updatePayload = payload;
      return chain;
    },
    upsert: (rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
      state.mode = 'upsert';
      state.upsertRows = Array.isArray(rows) ? rows : [rows];
      state.upsertOnConflict = opts?.onConflict;
      state.upsertIgnoreDup = !!opts?.ignoreDuplicates;
      return {
        select: () => ({
          single: async () => {
            const r = await exec();
            return { data: r.data?.[0] ?? null, error: r.error };
          },
        }),
        ...thenable(exec),
      };
    },
    eq: (col: string, val: any) => { state.filters.push(r => r[col] === val); return chain; },
    // .is('col', null) / .is('col', true) — emula o operador IS do PostgREST.
    // Diferente de .eq, casa NULL/undefined com null.
    is: (col: string, val: any) => {
      state.filters.push(r => {
        if (val === null) return r[col] === null || r[col] === undefined;
        return r[col] === val;
      });
      return chain;
    },
    in: (col: string, vals: any[]) => { state.filters.push(r => vals.includes(r[col])); return chain; },
    gte: (col: string, val: any) => { state.filters.push(r => r[col] >= val); return chain; },
    gt: (col: string, val: any) => { state.filters.push(r => r[col] > val); return chain; },
    lt: (col: string, val: any) => { state.filters.push(r => r[col] < val); return chain; },
    lte: (col: string, val: any) => { state.filters.push(r => r[col] <= val); return chain; },
    ilike: (col: string, pattern: string) => {
      const re = new RegExp('^' + pattern.replace(/%/g, '.*'), 'i');
      state.filters.push(r => re.test(String(r[col] ?? '')));
      return chain;
    },
    order: (key: string, opts?: { ascending?: boolean }) => {
      state.orderKey = key; state.orderAsc = opts?.ascending ?? true; return chain;
    },
    limit: (n: number) => { state.limitN = n; return chain; },
    single: async () => { const r = await exec(); return { data: r.data?.[0] ?? null, error: r.data?.length ? null : { message: 'no_rows' } }; },
    maybeSingle: async () => { const r = await exec(); return { data: r.data?.[0] ?? null, error: null }; },
    ...thenable(exec),
  };
  return chain;
}

function thenable(exec: () => Promise<any>) {
  return { then: (resolve: any, reject: any) => exec().then(resolve, reject) };
}

function cryptoRandomId() {
  return 'id-' + Math.random().toString(36).slice(2, 11);
}

export function createMockSupabase(initialData: Record<string, Row[]> = {}) {
  const store = new Map<string, Row[]>();
  for (const [k, v] of Object.entries(initialData)) store.set(k, v);
  return {
    from: (table: string) => buildQuery(table, store),
    _store: store,
  } as any;
}
