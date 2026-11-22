import type { Account } from './api';

// What this browser remembers so Cloud still opens offline (`cloud.offline_shell`).
//
// - The last catalogue the server answered, per workspace, in IndexedDB. The Library and the
//   counts are served from it (merged with this device's own song index) while SelectaDJ cannot be
//   reached, and say so: "Showing what this device knows. Last checked 14:05."
// - The last account snapshot for the signed-in person, in localStorage, so a page opened while
//   the connection is down still knows which workspace and features it has.
// Nothing here is audio or a file; it is the same metadata the server already holds for the
// account. Forgetting the workspace on this device forgets both (deviceData.ts).

export const CATALOGUE_DB_PREFIX = 'selecta-media-catalogue';
const STORE = 'answers';
const ACCOUNT_KEY = 'selecta.account-snapshot';

export type Cached<T> = { at: number; value: T };

function openDb(workspaceId: string): Promise<IDBDatabase | null> {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) return Promise.resolve(null);
    const opening = indexedDB.open(`${CATALOGUE_DB_PREFIX}-${workspaceId}`, 1);
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains(STORE)) opening.result.createObjectStore(STORE);
    };
    return new Promise((resolve) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => resolve(null);
      opening.onblocked = () => resolve(null);
    });
  } catch {
    return Promise.resolve(null);
  }
}

const opened = new Map<string, Promise<IDBDatabase | null>>();
function dbFor(workspaceId: string) {
  let made = opened.get(workspaceId);
  if (!made) { made = openDb(workspaceId); opened.set(workspaceId, made); }
  return made;
}

/** The last answer kept under `key` for this workspace, or null. Never throws. */
export async function readCached<T>(workspaceId: string, key: string): Promise<Cached<T> | null> {
  try {
    const db = await dbFor(workspaceId);
    if (!db) return null;
    return await new Promise((resolve) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as Cached<T> | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Keep `value` as the last answer under `key`. A full or missing store is not an error. */
export async function writeCached<T>(workspaceId: string, key: string, value: T): Promise<void> {
  try {
    const db = await dbFor(workspaceId);
    if (!db) return;
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put({ at: Date.now(), value } satisfies Cached<T>, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  } catch {
    // a cache, never the record of anything
  }
}

/** Forget this workspace's kept answers. */
export async function forgetCached(workspaceId: string): Promise<void> {
  try {
    const db = await opened.get(workspaceId);
    db?.close();
    opened.delete(workspaceId);
    if (typeof indexedDB === 'undefined' || !indexedDB) return;
    await new Promise<void>((resolve) => {
      const deleting = indexedDB.deleteDatabase(`${CATALOGUE_DB_PREFIX}-${workspaceId}`);
      deleting.onsuccess = () => resolve();
      deleting.onerror = () => resolve();
      deleting.onblocked = () => resolve();
    });
  } catch {
    // nothing to forget
  }
  forgetAccountSnapshot(workspaceId);
}

/** Keep the account the server just answered, for an offline open. */
export function rememberAccount(userId: string, account: Account): void {
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ userId, at: Date.now(), account }));
  } catch {
    // storage off or full: an offline open simply has nothing to show
  }
}

/** The last account kept for this person, or null. */
export function rememberedAccount(userId?: string): Cached<Account> | null {
  try {
    const kept = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? 'null') as { userId: string; at: number; account: Account } | null;
    if (!kept || !kept.account?.workspace?.id) return null;
    if (userId !== undefined && kept.userId !== userId) return null;
    return { at: kept.at, value: kept.account };
  } catch {
    return null;
  }
}

function forgetAccountSnapshot(workspaceId: string) {
  try {
    const kept = rememberedAccount();
    if (kept && kept.value.workspace.id === workspaceId) localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // nothing kept
  }
}

/** "14:05" today, or "3 Nov, 14:05" on another day, in the member's own locale. */
export function checkedAt(at: number, now: number = Date.now()): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (new Date(now).toDateString() === when.toDateString()) return time;
  return `${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}
