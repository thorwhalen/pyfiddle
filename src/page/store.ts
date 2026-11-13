/**
 * Where a page keeps what a student did: their edits, the hints they revealed, the stage a teacher
 * released. One small key-value seam, so a host can keep it in its own store (a zodal
 * `DataProvider`, a server, a class-wide document that carries a teacher's releases to every
 * student) by passing an object with `get` and `set`, and `subscribe` when values can change from
 * elsewhere.
 *
 * The default keeps it in the browser's localStorage (under `pyfiddle:`), and in memory when
 * storage is unavailable (a private window, a sandboxed frame), so a page always works.
 *
 * A page reads every key once when it mounts, and listens (`subscribe`) only to the released stage:
 * a host that changes a student's draft or answers from elsewhere remounts the page.
 */

export interface FiddleStore {
  get<T = unknown>(key: string): T | undefined | Promise<T | undefined>;
  set<T = unknown>(key: string, value: T | undefined): void | Promise<void>;
  /** Called when a key changes from elsewhere (another tab, a teacher). Optional. */
  subscribe?(key: string, onChange: (value: unknown) => void): () => void;
}

/** A store in memory only: for tests, and for pages that must keep nothing. */
export function memoryStore(initial: Record<string, unknown> = {}): FiddleStore {
  const data = new Map(Object.entries(initial));
  const listeners = new Map<string, Set<(v: unknown) => void>>();
  return {
    get: <T>(key: string) => data.get(key) as T | undefined,
    set: (key, value) => {
      if (value === undefined) data.delete(key);
      else data.set(key, value);
      listeners.get(key)?.forEach((l) => l(value));
    },
    subscribe: (key, onChange) => {
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set.add(onChange));
      return () => {
        set.delete(onChange);
      };
    },
  };
}

/** The default store: localStorage under `prefix`, falling back to memory; other tabs' changes arrive through `subscribe`. */
export function localStore({ prefix = 'pyfiddle:' }: { prefix?: string } = {}): FiddleStore {
  let storage: Storage | null = null;
  try {
    storage = globalThis.localStorage ?? null;
    storage?.getItem(prefix); // throws where storage is blocked
  } catch {
    storage = null;
  }
  const memory = memoryStore();
  if (!storage) return memory;
  const s = storage;
  return {
    get: <T>(key: string) => {
      try {
        const raw = s.getItem(prefix + key);
        return raw === null ? (memory.get(key) as T | undefined) : (JSON.parse(raw) as T);
      } catch {
        return memory.get(key) as T | undefined;
      }
    },
    set: (key, value) => {
      memory.set(key, value);
      try {
        if (value === undefined) s.removeItem(prefix + key);
        else s.setItem(prefix + key, JSON.stringify(value));
      } catch {
        // full or blocked: the memory copy still serves this visit
      }
    },
    subscribe: (key, onChange) => {
      const offMemory = memory.subscribe!(key, onChange);
      const onStorage = (e: StorageEvent) => {
        if (e.key !== prefix + key) return;
        try {
          onChange(e.newValue === null ? undefined : JSON.parse(e.newValue));
        } catch {
          // a value another program wrote: ignore it
        }
      };
      globalThis.addEventListener?.('storage', onStorage);
      return () => {
        offMemory();
        globalThis.removeEventListener?.('storage', onStorage);
      };
    },
  };
}

/**
 * The keys a page uses (one place, so they never drift): `<page>/<cell>/<field>` for a cell's
 * draft, hints shown, solved flag and choice answer, `<page>/released` for the released stage. A
 * host store mapping them onto its own shape reads them with `parseStoreKey`.
 */
export const storeKeys = {
  draft: (page: string, cell: string) => `${page}/${cell}/draft`,
  hints: (page: string, cell: string) => `${page}/${cell}/hints`,
  solved: (page: string, cell: string) => `${page}/${cell}/solved`,
  answer: (page: string, cell: string) => `${page}/${cell}/answer`,
  released: (page: string) => `${page}/released`,
};

export type StoreKey =
  | { page: string; field: 'released' }
  | { page: string; cell: string; field: 'draft' | 'hints' | 'solved' | 'answer' };

/** The inverse of `storeKeys`: which page, cell and field a key names (undefined for a key that is not pyfiddle's). */
export function parseStoreKey(key: string): StoreKey | undefined {
  const parts = key.split('/');
  if (parts.length === 2 && parts[1] === 'released') return { page: parts[0], field: 'released' };
  const [page, cell, field] = parts;
  if (parts.length === 3 && (field === 'draft' || field === 'hints' || field === 'solved' || field === 'answer')) return { page, cell, field };
  return undefined;
}

/**
 * Hand a store value to `fn`: at once when the store answered synchronously (no flash of the
 * unreleased or unsaved state), when it arrives otherwise.
 */
export function whenRead<T>(value: T | undefined | Promise<T | undefined>, fn: (v: T | undefined) => void): void {
  if (value instanceof Promise) void value.then(fn, () => fn(undefined));
  else fn(value);
}
