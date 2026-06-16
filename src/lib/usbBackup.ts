/**
 * Backup em unidade externa / pasta local (#147c).
 *
 * O servidor roda na nuvem e NÃO enxerga o pendrive do usuário — quem grava no
 * pendrive é o navegador, via File System Access API (showDirectoryPicker).
 * Aqui ficam os utilitários:
 *   - escolher uma pasta/pendrive (1x) e LEMBRAR dela (IndexedDB guarda o handle)
 *   - gravar arquivos nessa pasta nas próximas vezes sem reescolher
 *   - fallback de download quando o navegador não suporta (Firefox/Safari/celular)
 *   - geração de CSV (Excel pt-BR) a partir de linhas
 *
 * Segurança: nada é enviado pra lugar nenhum — o arquivo vai direto do navegador
 * pra unidade que o próprio usuário apontou.
 */

// ── IndexedDB mínimo só pra guardar o handle da pasta (não serializa em string) ──
const IDB_NAME = 'cp_backup';
const IDB_STORE = 'handles';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key: string, val: any): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function idbGet<T = any>(key: string): Promise<T | null> {
  const db = await openIdb();
  const v = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const r = tx.objectStore(IDB_STORE).get(key);
    r.onsuccess = () => resolve((r.result as T) ?? null);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return v;
}
async function idbDel(key: string): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

const DIR_KEY = 'party_backup_dir';

// ── File System Access API (tipos não estão no lib.dom desta versão → any) ──
export function supportsDirectoryPicker(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function';
}

/** Abre o seletor pra o usuário escolher o pendrive/pasta. Lembra a escolha. */
export async function pickDirectory(): Promise<any> {
  const dir = await (window as any).showDirectoryPicker({ mode: 'readwrite', id: 'cp-party-backup' });
  try { await idbSet(DIR_KEY, dir); } catch { /* ok — segue sem lembrar */ }
  return dir;
}

/** Recupera a pasta lembrada (ou null). Não pede permissão ainda. */
export async function loadSavedDirectory(): Promise<any | null> {
  try { return await idbGet(DIR_KEY); } catch { return null; }
}

export async function forgetDirectory(): Promise<void> {
  try { await idbDel(DIR_KEY); } catch { /* ok */ }
}

/** Garante permissão de escrita no handle (pede ao usuário se preciso). */
export async function ensurePermission(dir: any): Promise<boolean> {
  if (!dir) return false;
  const opts = { mode: 'readwrite' } as any;
  try {
    if ((await dir.queryPermission?.(opts)) === 'granted') return true;
    if ((await dir.requestPermission?.(opts)) === 'granted') return true;
  } catch { /* */ }
  return false;
}

/** Grava os arquivos dentro da pasta escolhida. */
export async function writeFilesToDir(dir: any, files: { name: string; content: string | Blob }[]): Promise<void> {
  for (const f of files) {
    const fh = await dir.getFileHandle(f.name, { create: true });
    const w = await fh.createWritable();
    await w.write(f.content);
    await w.close();
  }
}

/** Fallback: baixa o arquivo pela pasta de Downloads do navegador. */
export function downloadFile(name: string, content: string | Blob, type = 'application/json'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── CSV (separador ';' + BOM → abre certinho no Excel pt-BR) ──
export interface CsvColumn { key?: string; label: string; get?: (row: any) => any }
export function toCSV(rows: any[], columns: CsvColumn[]): string {
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(';');
  const body = (rows || []).map((r) => columns.map((c) => esc(c.get ? c.get(r) : r[c.key as string])).join(';')).join('\n');
  return '﻿' + header + '\n' + body;
}
