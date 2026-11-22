import type { Recipe, RecipeSeam, RecipeSong, RecipeStore, RecipeSummary } from './recipeStore';
import { flagOn } from '../flags';

/** The mix outbox (cloud.mix_outbox): mixes made or edited while the connection is down are
 * applied in this browser at once and sent, in the order they were made, when it returns.
 *
 * - Every recipe this browser reads, makes or edits is kept here too, so the current mix (and
 *   any saved mix opened before) still opens and plays offline.
 * - A change that cannot reach the server is written to IndexedDB as an operation with the
 *   revision it was based on. A mix made offline has a `local-` id until the server names it.
 * - On reconnect the operations go out one at a time. If the mix changed on another device in
 *   the meantime (`stale_revision`) or was deleted there, the member's version is saved as a new
 *   mix instead of being dropped, and My Mixes says so.
 * - Only song ids, names and move choices are kept: never audio, files or paths.
 */

export type RecipeChange = { songIds?: number[]; name?: string; seamMoves?: Record<number, string | null> };
/** What a song in a mix made offline is called until the server answers. */
export type KnownSong = { id: number; title: string; artist: string | null; duration: number | null };

type Op =
  | { id?: number; workspaceId: string; kind: 'create'; mixId: string; revision: string; name: string; songIds: number[]; at: number }
  | { id?: number; workspaceId: string; kind: 'edit'; mixId: string; baseRevision: string; revision: string; change: RecipeChange; at: number };

/** Fired on window when the outbox changes (queued, sent, or saved as a copy). `detail` is the workspace id. */
export const MIX_OUTBOX_EVENT = 'selecta-mix-outbox';
export const SAVED_AS_COPY = 'Saved as a copy because this mix changed on another device.';
export const WAITING_TO_SYNC = 'Waiting to sync';

const DB_NAME = 'selecta-mix-outbox';
const DB_VERSION = 1;
const MIX_NAME_MAX = 60;

// ---------- storage: IndexedDB, or memory where the browser offers none ----------

type Stores = { ops: Op[]; recipes: Map<string, Recipe>; lists: Map<string, RecipeSummary[]> };
const memory: Stores = { ops: [], recipes: new Map(), lists: new Map() };
let memoryOpId = 0;
let opening: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('ops')) db.createObjectStore('ops', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('recipes')) db.createObjectStore('recipes');
        if (!db.objectStoreNames.contains('lists')) db.createObjectStore('lists');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(store: 'ops' | 'recipes' | 'lists', mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest | null): Promise<T | undefined> {
  return database().then((db) => new Promise<T | undefined>((resolve) => {
    if (!db) return resolve(undefined);
    try {
      const tx = db.transaction(store, mode);
      const request = work(tx.objectStore(store));
      tx.oncomplete = () => resolve(request ? (request.result as T) : undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  }));
}

const recipeKey = (workspaceId: string, mixId: string) => `${workspaceId}:${mixId}`;

const box = {
  async ops(workspaceId: string): Promise<Op[]> {
    const db = await database();
    const all = db ? ((await run<Op[]>('ops', 'readonly', (store) => store.getAll())) ?? []) : memory.ops;
    return all.filter((op) => op.workspaceId === workspaceId).sort((one, other) => (one.id ?? 0) - (other.id ?? 0));
  },
  async add(op: Op): Promise<void> {
    if (await database()) await run('ops', 'readwrite', (store) => store.add(op));
    else memory.ops.push({ ...op, id: ++memoryOpId });
  },
  async put(op: Op): Promise<void> {
    if (await database()) await run('ops', 'readwrite', (store) => store.put(op));
    else memory.ops = memory.ops.map((one) => (one.id === op.id ? op : one));
  },
  async drop(id: number | undefined): Promise<void> {
    if (id === undefined) return;
    if (await database()) await run('ops', 'readwrite', (store) => store.delete(id));
    else memory.ops = memory.ops.filter((op) => op.id !== id);
  },
  async recipe(workspaceId: string, mixId: string): Promise<Recipe | null> {
    const key = recipeKey(workspaceId, mixId);
    if (await database()) return (await run<Recipe>('recipes', 'readonly', (store) => store.get(key))) ?? null;
    return memory.recipes.get(key) ?? null;
  },
  async keep(workspaceId: string, recipe: Recipe): Promise<void> {
    const key = recipeKey(workspaceId, recipe.mix_id);
    if (await database()) await run('recipes', 'readwrite', (store) => store.put(recipe, key));
    else memory.recipes.set(key, recipe);
  },
  async forget(workspaceId: string, mixId: string): Promise<void> {
    const key = recipeKey(workspaceId, mixId);
    if (await database()) await run('recipes', 'readwrite', (store) => store.delete(key));
    else memory.recipes.delete(key);
  },
  async list(workspaceId: string): Promise<RecipeSummary[] | null> {
    if (await database()) return (await run<RecipeSummary[]>('lists', 'readonly', (store) => store.get(workspaceId))) ?? null;
    return memory.lists.get(workspaceId) ?? null;
  },
  async keepList(workspaceId: string, list: RecipeSummary[]): Promise<void> {
    if (await database()) await run('lists', 'readwrite', (store) => store.put(list, workspaceId));
    else memory.lists.set(workspaceId, list);
  },
};

// ---------- what the server said, and what "unreachable" means ----------

/** True when a request failed because the server could not be reached (the network is down, it
 * timed out, or the service is not answering), as opposed to the server refusing it. */
export function unreachable(problem: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const status = (problem as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return status === 0 || status === 408 || status >= 500;
  const name = (problem as { name?: unknown } | null)?.name;
  return problem instanceof TypeError || name === 'AbortError' || name === 'TimeoutError' || name === 'NetworkError';
}

const codeOf = (problem: unknown) => (problem as { code?: unknown } | null)?.code;
const statusOf = (problem: unknown) => (problem as { status?: unknown } | null)?.status;

// Local mix ids and revisions are remembered against the server's once a queued create or edit
// lands, so later operations (and a tab that reloads mid-way) find the right mix and base.
const aliasKey = (workspaceId: string) => `selecta-mix-outbox-alias:${workspaceId}`;
function aliases(workspaceId: string): Record<string, string> {
  try { return JSON.parse(window.localStorage.getItem(aliasKey(workspaceId)) ?? '{}') as Record<string, string>; } catch { return {}; }
}
function rememberAlias(workspaceId: string, local: string, server: string) {
  try {
    const all = aliases(workspaceId);
    all[local] = server;
    window.localStorage.setItem(aliasKey(workspaceId), JSON.stringify(all));
  } catch { /* the operations still name the local ids; a reload re-sends from the copy */ }
}

const noticeKey = (workspaceId: string) => `selecta-mix-outbox-notices:${workspaceId}`;
function note(workspaceId: string, text: string) {
  try {
    const kept = JSON.parse(window.localStorage.getItem(noticeKey(workspaceId)) ?? '[]') as string[];
    window.localStorage.setItem(noticeKey(workspaceId), JSON.stringify([...kept, text].slice(-5)));
  } catch { /* the copy is still in My Mixes */ }
}
/** Notices from sending queued changes (a conflict saved as a copy), each said once. */
export function takeOutboxNotices(workspaceId: string): string[] {
  try {
    const kept = JSON.parse(window.localStorage.getItem(noticeKey(workspaceId)) ?? '[]') as string[];
    window.localStorage.removeItem(noticeKey(workspaceId));
    return kept;
  } catch {
    return [];
  }
}

const changed = (workspaceId: string) => {
  try { window.dispatchEvent(new CustomEvent(MIX_OUTBOX_EVENT, { detail: workspaceId })); } catch { /* no window: nothing listens */ }
};

const localId = (prefix: string) => `local-${prefix}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
export const isLocalMix = (mixId: string) => mixId.startsWith('local-');

// ---------- applying a change in this browser ----------

function songFor(id: number, before: readonly RecipeSong[], known: readonly KnownSong[]): RecipeSong {
  const kept = before.find((song) => song.song_id === id);
  if (kept) return kept;
  const info = known.find((song) => song.id === id);
  return { song_id: id, id: String(id), title: info?.title ?? 'A song from your library', artist: info?.artist ?? null, duration: info?.duration ?? null, sha256: null, in_library: true, available_on: 1 };
}

const plainSeam = (into: number): RecipeSeam => ({ into, method: 'blend', bars: 0, basis: 'browser', intelligent: false, reason: '' });

/** The recipe after `change`, worked out here the way the server would. */
export function applyChange(recipe: Recipe, change: RecipeChange, known: readonly KnownSong[], revision: string): Recipe {
  let songs = recipe.songs;
  let seams = recipe.seams;
  if (change.songIds) {
    songs = change.songIds.map((id) => songFor(id, recipe.songs, known));
    // a chosen move stays with the two songs it joined
    seams = songs.slice(1).map((song, at) => {
      const into = at + 1;
      const before = songs[at].song_id;
      const was = recipe.seams.find((seam) => recipe.songs[seam.into]?.song_id === song.song_id && recipe.songs[seam.into - 1]?.song_id === before);
      return was ? { ...was, into } : plainSeam(into);
    });
  }
  if (change.seamMoves) {
    seams = seams.map((seam) => {
      if (!(seam.into in change.seamMoves!)) return seam;
      const move = change.seamMoves![seam.into];
      return { ...seam, settings: move ? { ...seam.settings, move } : undefined };
    });
  }
  return { ...recipe, songs, seams, name: change.name?.trim() || recipe.name, revision };
}

const summaryOf = (recipe: Recipe, pending: boolean, updatedAt: number): RecipeSummary => ({
  mix_id: recipe.mix_id, name: recipe.name, revision: recipe.revision, number: recipe.number,
  songs: recipe.songs.length, updated_at: updatedAt, ...(pending ? { pending: true } : {}),
});

const copyName = (name: string) => {
  const made = `${name} (copy)`;
  return made.length > MIX_NAME_MAX ? `${name.slice(0, MIX_NAME_MAX - 8).trimEnd()} (copy)` : made;
};

// ---------- the store with an outbox ----------

const flushing = new Map<string, Promise<void>>();
const listening = new Set<string>();

/** `server` is the plain recipe store; with cloud.mix_outbox off every call goes straight to it. */
export function withOutbox(server: RecipeStore, workspaceId: string): RecipeStore {
  const on = () => flagOn('cloud.mix_outbox');
  const resolveId = (mixId: string) => aliases(workspaceId)[mixId] ?? mixId;
  const pendingFor = async (mixId: string) => (await box.ops(workspaceId)).some((op) => op.mixId === mixId || resolveId(op.mixId) === mixId);

  const kept = async (recipe: Recipe) => { await box.keep(workspaceId, recipe); return recipe; };

  const queueCreate = async (name: string, songIds: number[], known: readonly KnownSong[]): Promise<Recipe> => {
    const recipe: Recipe = {
      mix_id: localId('mix'), name, number: 0, parent: null, revision: localId('rev'),
      songs: songIds.map((id) => songFor(id, [], known)), seams: [],
    };
    const shaped = applyChange(recipe, { songIds }, known, recipe.revision);
    await box.keep(workspaceId, shaped);
    await box.add({ workspaceId, kind: 'create', mixId: shaped.mix_id, revision: shaped.revision, name, songIds, at: Date.now() / 1000 });
    changed(workspaceId);
    return shaped;
  };

  const queueEdit = async (mixId: string, baseRevision: string, change: RecipeChange, known: readonly KnownSong[]): Promise<Recipe> => {
    const now = await box.recipe(workspaceId, mixId);
    if (!now) throw Object.assign(new Error('This mix has not been opened on this device yet, so it can’t be changed until the connection is back.'), { code: 'not_cached' });
    if (now.revision !== baseRevision) {
      throw Object.assign(new Error('This mix changed since you opened it. Reload it to see the newest version.'), { code: 'stale_revision', status: 409 });
    }
    const next = applyChange(now, change, known, localId('rev'));
    await box.keep(workspaceId, next);
    await box.add({ workspaceId, kind: 'edit', mixId, baseRevision, revision: next.revision, change, at: Date.now() / 1000 });
    changed(workspaceId);
    return next;
  };

  /** Keep the member's version of a mix that changed (or went) on another device as a new mix. */
  const saveAsCopy = async (mixId: string) => {
    const mine = await box.recipe(workspaceId, mixId);
    if (!mine) return;
    const made = await server.create(copyName(mine.name), mine.songs.map((song) => song.song_id));
    const moves = Object.fromEntries(mine.seams.filter((seam) => seam.settings?.move).map((seam) => [seam.into, seam.settings!.move!]));
    const final = Object.keys(moves).length ? await server.edit(made.mix_id, made.revision, { seamMoves: moves }).catch(() => made) : made;
    await box.keep(workspaceId, final);
    await box.forget(workspaceId, mixId);
    if (server.current() === mixId) server.setCurrent(final.mix_id);
    note(workspaceId, SAVED_AS_COPY);
  };

  /** Send what is queued, oldest first. Stops at the first change the server can't be reached for. */
  const sendQueued = async () => {
    const ops = await box.ops(workspaceId);
    if (!ops.length) return;
    const folded = new Set<string>();
    const lastMade = new Map<string, Recipe>();
    for (const op of ops) {
      if (folded.has(op.mixId)) { await box.drop(op.id); continue; }
      const target = resolveId(op.mixId);
      try {
        const made = op.kind === 'create'
          ? await server.create(op.name, op.songIds)
          : await server.edit(target, resolveId(op.baseRevision), op.change);
        if (op.kind === 'create') rememberAlias(workspaceId, op.mixId, made.mix_id);
        rememberAlias(workspaceId, op.revision, made.revision);
        lastMade.set(op.mixId, made);
        await box.drop(op.id);
      } catch (problem) {
        if (unreachable(problem)) break;
        if (op.kind === 'edit' && (codeOf(problem) === 'stale_revision' || statusOf(problem) === 404)) {
          try {
            await saveAsCopy(op.mixId);
          } catch (again) {
            if (unreachable(again)) break;
          }
          folded.add(op.mixId);
          lastMade.delete(op.mixId);
        } else {
          note(workspaceId, `A change made while offline couldn’t be saved: ${(problem as Error).message || 'the server refused it'}.`);
        }
        await box.drop(op.id);
      }
    }
    // the server's own versions replace this browser's, under the server's ids
    const left = await box.ops(workspaceId);
    for (const [mixId, made] of lastMade) {
      if (left.some((op) => op.mixId === mixId)) continue;
      await box.keep(workspaceId, made);
      if (made.mix_id !== mixId) {
        await box.forget(workspaceId, mixId);
        if (server.current() === mixId) server.setCurrent(made.mix_id);
      }
    }
    changed(workspaceId);
  };

  const flush = (): Promise<void> => {
    if (!on()) return Promise.resolve();
    const running = flushing.get(workspaceId);
    if (running) return running;
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    // one tab sends at a time; another tab that finds the lock taken leaves it to that one
    const task = (locks
      ? locks.request(`selecta-mix-outbox:${workspaceId}`, { ifAvailable: true }, async (lock) => { if (lock) await sendQueued(); })
      : sendQueued()
    ).catch(() => undefined).finally(() => flushing.delete(workspaceId));
    flushing.set(workspaceId, task);
    return task;
  };

  if (typeof window !== 'undefined' && !listening.has(workspaceId)) {
    listening.add(workspaceId);
    window.addEventListener('online', () => void flush());
    window.setTimeout(() => void flush(), 0);
  }

  return {
    ...server,
    create: async (name, songIds, known = []) => {
      if (!on()) return server.create(name, songIds, known);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return queueCreate(name, songIds, known);
      try {
        return await kept(await server.create(name, songIds, known));
      } catch (problem) {
        if (unreachable(problem)) return queueCreate(name, songIds, known);
        throw problem;
      }
    },
    read: async (mixId) => {
      if (!on()) return server.read(mixId);
      const target = resolveId(mixId);
      if (isLocalMix(target) || (await pendingFor(mixId))) {
        const mine = await box.recipe(workspaceId, mixId) ?? await box.recipe(workspaceId, target);
        if (mine) return mine;
      }
      try {
        return await kept(await server.read(target));
      } catch (problem) {
        if (unreachable(problem)) {
          const mine = await box.recipe(workspaceId, target);
          if (mine) return mine;
        }
        if (statusOf(problem) === 404) await box.forget(workspaceId, target);
        throw problem;
      }
    },
    list: async () => {
      if (!on()) return server.list();
      const ops = await box.ops(workspaceId);
      const waiting = new Set(ops.map((op) => op.mixId));
      let listed: RecipeSummary[];
      try {
        listed = await server.list();
        await box.keepList(workspaceId, listed);
        if (ops.length) void flush();
      } catch (problem) {
        const cached = unreachable(problem) ? await box.list(workspaceId) : null;
        if (!cached) throw problem;
        listed = cached;
      }
      const shown = await Promise.all(listed.map(async (summary) => {
        if (!waiting.has(summary.mix_id)) return summary;
        const mine = await box.recipe(workspaceId, summary.mix_id);
        return mine ? summaryOf(mine, true, summary.updated_at) : { ...summary, pending: true };
      }));
      const madeHere = await Promise.all(ops.filter((op) => op.kind === 'create' && !listed.some((one) => one.mix_id === resolveId(op.mixId)))
        .map(async (op) => { const mine = await box.recipe(workspaceId, op.mixId); return mine ? summaryOf(mine, true, op.at) : null; }));
      return [...madeHere.filter((one): one is RecipeSummary => one !== null).reverse(), ...shown];
    },
    edit: async (asked, baseRevision, change, known = []) => {
      if (!on()) return server.edit(asked, baseRevision, change, known);
      const mixId = resolveId(asked);
      // a mix with changes still waiting keeps its order: this one joins the queue behind them
      if (isLocalMix(mixId) || (await pendingFor(mixId))) {
        const next = await queueEdit(mixId, baseRevision, change, known);
        void flush();
        return next;
      }
      try {
        return await kept(await server.edit(mixId, baseRevision, change, known));
      } catch (problem) {
        if (unreachable(problem)) return queueEdit(mixId, baseRevision, change, known);
        throw problem;
      }
    },
    duplicate: async (asked, name) => {
      if (!on()) return server.duplicate(asked, name);
      const mixId = resolveId(asked);
      if (isLocalMix(mixId) || (await pendingFor(mixId))) {
        const mine = await box.recipe(workspaceId, mixId);
        if (!mine) throw new Error('Couldn’t copy this mix. Try again.');
        return queueCreate(name ?? copyName(mine.name), mine.songs.map((song) => song.song_id), []).then(async (copy) => {
          const moves = Object.fromEntries(mine.seams.filter((seam) => seam.settings?.move).map((seam) => [seam.into, seam.settings!.move!]));
          const shaped = Object.keys(moves).length ? await queueEdit(copy.mix_id, copy.revision, { seamMoves: moves }, []) : copy;
          void flush();
          return shaped;
        });
      }
      return kept(await server.duplicate(mixId, name));
    },
    remove: async (asked) => {
      if (!on()) return server.remove(asked);
      const mixId = resolveId(asked);
      const ops = (await box.ops(workspaceId)).filter((op) => op.mixId === mixId);
      if (isLocalMix(mixId)) {
        // never sent: deleting it here is the whole of it
        for (const op of ops) await box.drop(op.id);
        await box.forget(workspaceId, mixId);
        changed(workspaceId);
        return;
      }
      await server.remove(mixId);
      for (const op of ops) await box.drop(op.id);
      await box.forget(workspaceId, mixId);
      changed(workspaceId);
    },
    flush,
  };
}

/** True when this browser holds changes for the workspace that the server hasn't had yet. */
export async function outboxWaiting(workspaceId: string): Promise<number> {
  return (await box.ops(workspaceId)).length;
}

