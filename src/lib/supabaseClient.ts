import { createClient } from '@supabase/supabase-js';

// ============================================================
// DETECCAO DE AMBIENTE E CREDENCIAIS
// ============================================================
const isBrowser = typeof window !== 'undefined';

const supabaseUrl = (isBrowser ? import.meta.env.VITE_SUPABASE_URL : null) ||
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  '';

const supabaseAnonKey = (isBrowser ? import.meta.env.VITE_SUPABASE_ANON_KEY : null) ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Credenciais nao detectadas. Verifique as variaveis de ambiente (VITE_SUPABASE_URL/ANON_KEY).');
}

// ============================================================
// CLIENTE RAW (subjacente)
// Para uso interno do wrapper e para casos especiais
// ============================================================
const rawSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'campanhapro-auth-token',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    // Desabilita navigator.locks para evitar NavigatorLockAcquireTimeoutError
    // causado pelo React Strict Mode montando dois subscribers simultaneos.
    lock: <R>(_name: string, _timeout: number, fn: () => Promise<R>): Promise<R> => fn(),
  }
});

// ============================================================
// FUNCOES DE TRADUCAO camelCase <-> snake_case
// ============================================================

/** Converte 'campaignId' -> 'campaign_id' */
const camelToSnake = (str: string): string => {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
};

/** Converte 'campaign_id' -> 'campaignId' */
const snakeToCamel = (str: string): string => {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
};

/**
 * Converte uma string de SELECT do PostgREST traduzindo
 * apenas os identificadores (nomes de colunas/relacoes),
 * preservando virgulas, parenteses, asteriscos, espacos, alias.
 *
 * Exemplos:
 *   'voterId, lider'                          -> 'voter_id, lider'
 *   'id, name, voter_journey(currentStage)'   -> 'id, name, voter_journey(current_stage)'
 *   '*'                                       -> '*'
 *   'campaignId, contactId'                   -> 'campaign_id, contact_id'
 */
const convertSelectString = (selectStr: string): string => {
  if (!selectStr || typeof selectStr !== 'string') return selectStr;
  // Substitui apenas tokens identificadores (letras/digitos/underline)
  // sem mexer em virgulas, parenteses, asteriscos, espacos, dois-pontos (alias).
  return selectStr.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (token) => camelToSnake(token));
};

/**
 * Converte recursivamente todas as chaves de um objeto/array
 * de camelCase para snake_case.
 * Preserva valores (so altera nomes das chaves).
 */
const convertKeysToSnake = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(convertKeysToSnake);
  if (typeof obj !== 'object') return obj;
  // Preserva tipos especiais (Date, File, Blob, etc.)
  if (obj instanceof Date) return obj;
  if (obj instanceof File) return obj;
  if (obj instanceof Blob) return obj;

  const result: any = {};
  for (const key of Object.keys(obj)) {
    result[camelToSnake(key)] = convertKeysToSnake(obj[key]);
  }
  return result;
};

/**
 * Converte recursivamente todas as chaves de snake_case para camelCase.
 * Usado nas RESPOSTAS do banco antes de devolver ao front.
 */
const convertKeysToCamel = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(convertKeysToCamel);
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj;

  const result: any = {};
  for (const key of Object.keys(obj)) {
    result[snakeToCamel(key)] = convertKeysToCamel(obj[key]);
  }
  return result;
};

// ============================================================
// WRAPPER DO QUERY BUILDER
// Intercepta chamadas de filtro/insert/update/etc para traduzir
// automaticamente entre camelCase (front) e snake_case (banco)
// ============================================================

/** Metodos de filtro que recebem (column, value) - precisam traduzir column */
const FILTER_METHODS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'like', 'ilike', 'is', 'in', 'contains', 'containedBy',
  'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte',
  'rangeAdjacent', 'overlaps', 'textSearch', 'match',
  'not', 'filter'
];

/** Metodos que recebem dados (objeto/array de objetos) - precisam traduzir as chaves */
const DATA_METHODS = ['insert', 'update', 'upsert'];

/** Metodos que recebem coluna(s) ou opcoes com coluna */
const COLUMN_METHODS = ['order'];

/**
 * Cria um Proxy que intercepta chamadas no QueryBuilder do Supabase
 * para traduzir colunas/dados automaticamente.
 */
const wrapQueryBuilder = (builder: any): any => {
  return new Proxy(builder, {
    get(target, prop: string) {
      const original = target[prop];

      // select: traduz a string de selecao (ex: 'voterId, lider' -> 'voter_id, lider')
      if (typeof original === 'function' && prop === 'select') {
        return (...args: any[]) => {
          if (typeof args[0] === 'string') {
            args[0] = convertSelectString(args[0]);
          }
          const result = original.apply(target, args);
          return wrapQueryBuilder(result);
        };
      }

      // Metodos de filtro: traduz a coluna (1o argumento)
      if (typeof original === 'function' && FILTER_METHODS.includes(prop)) {
        return (...args: any[]) => {
          if (typeof args[0] === 'string') {
            args[0] = camelToSnake(args[0]);
          }
          // Para .in() e .contains() o segundo arg pode ter chaves
          // mas geralmente sao valores literais. Mantemos valores intocados.
          const result = original.apply(target, args);
          return wrapQueryBuilder(result);
        };
      }

      // insert/update/upsert: traduz as chaves do payload
      if (typeof original === 'function' && DATA_METHODS.includes(prop)) {
        return (...args: any[]) => {
          if (args[0] !== undefined) {
            args[0] = convertKeysToSnake(args[0]);
          }
          const result = original.apply(target, args);
          return wrapQueryBuilder(result);
        };
      }

      // order: traduz a coluna no 1o arg
      if (typeof original === 'function' && COLUMN_METHODS.includes(prop)) {
        return (...args: any[]) => {
          if (typeof args[0] === 'string') {
            args[0] = camelToSnake(args[0]);
          }
          const result = original.apply(target, args);
          return wrapQueryBuilder(result);
        };
      }

      // .then() = momento de resolucao da query - traduz a resposta de volta
      if (prop === 'then' && typeof original === 'function') {
        return (onFulfilled: any, onRejected: any) => {
          return original.call(target, (response: any) => {
            if (response?.data !== undefined) {
              response.data = convertKeysToCamel(response.data);
            }
            return onFulfilled ? onFulfilled(response) : response;
          }, onRejected);
        };
      }

      // single/maybeSingle/range/limit/etc: passa direto, mas embrulha o retorno
      if (typeof original === 'function') {
        return (...args: any[]) => {
          const result = original.apply(target, args);
          // Se o retorno tambem for um QueryBuilder (chainable), embrulha
          if (result && typeof result === 'object' && typeof result.then === 'function') {
            return wrapQueryBuilder(result);
          }
          return result;
        };
      }

      return original;
    }
  });
};

// ============================================================
// CLIENTE TRADUZIDO (exportado como `supabase`)
// ============================================================

export const supabase = new Proxy(rawSupabase, {
  get(target: any, prop: string) {
    // Intercepta apenas .from() - resto passa direto (auth, storage, rpc, channel, etc.)
    if (prop === 'from') {
      return (table: string) => {
        const builder = target.from(table);
        return wrapQueryBuilder(builder);
      };
    }
    return target[prop];
  }
});

// ============================================================
// EXPORT ADICIONAL: cliente raw, para casos especiais
// (uso interno em sync, scripts, ou queries que precisam burlar a traducao)
// ============================================================
export { rawSupabase };
