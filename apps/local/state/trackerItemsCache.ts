import type { TrackerItem } from "@/lib/tracker/types";

const DB_NAME = "agx-tracker-cache";
const STORE = "items";
const VERSION = 1;

export interface CachedItemsPage {
  items: TrackerItem[];
  endCursor: string | null;
  hasNextPage: boolean;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

export async function readCachedItems(key: string): Promise<CachedItemsPage | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as CachedItemsPage) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function writeCachedItems(key: string, value: CachedItemsPage): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function buildCacheKey(
  trackerType: string,
  projectId: string,
  filters: Record<string, unknown>
): string {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(filters).sort()) {
    const v = filters[k];
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      normalized[k] = [...v].map(String).sort();
    } else {
      normalized[k] = v;
    }
  }
  return `${trackerType}:${projectId}:${JSON.stringify(normalized)}`;
}
