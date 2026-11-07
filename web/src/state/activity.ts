import { useSyncExternalStore } from 'react';

/** What's happened lately, and what can still be taken back. A toast says something once and goes
 * away. This is where the way back stays, so an Undo is never lost to a message that faded.
 *
 * Undo on the server takes back the newest change in a mix, whichever one was pressed. So within one
 * scope only the newest entry can be undone, and the older ones say why they can't yet. That is what
 * stops pressing an old Undo from quietly taking back something else. */

export type ActivityTone = 'info' | 'problem';
export type UndoState = 'available' | 'running' | 'undone' | 'failed';

export type ActivityEntry = {
  id: number;
  message: string;
  tone: ActivityTone;
  at: number;
  /** Which mix this is about, such as `current` or `draft:4`. Entries with no shared scope stand alone. */
  scope: string | null;
  undo?: () => Promise<unknown> | unknown;
  undoState?: UndoState;
  problem?: string;
};

const KEEP = 30;

let nextId = 1;
let entries: ActivityEntry[] = [];
let unseen = 0;
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

export function recordActivity(message: string, options: { tone?: ActivityTone; scope?: string | null; undo?: ActivityEntry['undo'] } = {}): number {
  const entry: ActivityEntry = {
    id: nextId++,
    message,
    tone: options.tone ?? 'info',
    at: Date.now(),
    scope: options.scope ?? null,
    undo: options.undo,
    undoState: options.undo ? 'available' : undefined,
  };
  entries = [entry, ...entries];
  // Don't evict a failed Undo if an earlier still-actionable change in the same
  // scope depends on it. Losing that failed entry would make an older Undo target
  // the wrong server revision.
  while (entries.length > KEEP) {
    const spare = entries.reduce((found, item, index) =>
      (!item.undo || item.undoState === 'undone' || item.undoState === 'failed')
      && !(item.undoState === 'failed' && item.scope
        && entries.some((older) => older.id < item.id && older.scope === item.scope && older.undoState === 'available'))
        ? index : found, -1);
    entries.splice(spare >= 0 ? spare : entries.length - 1, 1);
  }
  entries = [...entries];
  unseen += 1;
  changed();
  return entry.id;
}

/** Is there a newer change in the same mix that would be taken back instead of this one? */
export function blockedBy(entry: ActivityEntry, all: ActivityEntry[] = entries): ActivityEntry | null {
  if (!entry.scope) return null;
  return all.find((other) => other.id > entry.id && other.scope === entry.scope
    && (other.undoState === 'available' || other.undoState === 'running' || other.undoState === 'failed')) ?? null;
}

export function canUndo(id: number): boolean {
  const entry = entries.find((item) => item.id === id);
  return !!entry && entry.undoState === 'available' && !blockedBy(entry);
}

function patch(id: number, change: Partial<ActivityEntry>) {
  entries = entries.map((item) => (item.id === id ? { ...item, ...change } : item));
  changed();
}

/** Take this one back, once. Throws if it can't, so whoever pressed it can say so. */
export async function runUndo(id: number): Promise<void> {
  const entry = entries.find((item) => item.id === id);
  if (!entry?.undo || entry.undoState !== 'available') return;
  const newer = blockedBy(entry);
  if (newer) {
    if (newer.undoState === 'failed') throw new Error('A newer Undo failed. Check this mix and its latest change before trying to undo an older change.');
    if (newer.undoState === 'running') throw new Error('A newer Undo is still running. Wait for its result before undoing an older change.');
    throw new Error(`Undo “${newer.message}” first, because it’s the newest change in that mix.`);
  }
  patch(id, { undoState: 'running', problem: undefined });
  try {
    await entry.undo();
    patch(id, { undoState: 'undone' });
  } catch (error) {
    const words = (error as Error).message || 'Couldn’t undo that.';
    patch(id, { undoState: 'failed', problem: words });
    throw error;
  }
}

/** The newest change in a mix was undone some other way, such as the Z key. */
export function markNewestUndone(scope: string) {
  const newest = entries.find((item) => item.scope === scope && (item.undoState === 'available' || item.undoState === 'failed'));
  if (newest) patch(newest.id, { undoState: 'undone' });
}

export function clearFinishedActivity() {
  // Failed Undo is also a scope lock until a newer authoritative operation
  // confirms what happened. Do not silently unlock an older activity entry.
  entries = entries.filter((item) => item.undoState === 'available' || item.undoState === 'running'
    || (item.undoState === 'failed' && item.scope
      && entries.some((older) => older.id < item.id && older.scope === item.scope && older.undoState === 'available')));
  changed();
}

export function clearActivity() {
  entries = [];
  unseen = 0;
  changed();
}

export function markActivitySeen() {
  if (!unseen) return;
  unseen = 0;
  changed();
}

export function activityEntries(): ActivityEntry[] {
  return entries;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActivity(): ActivityEntry[] {
  return useSyncExternalStore(subscribe, () => entries);
}

export function useUnseenActivity(): number {
  return useSyncExternalStore(subscribe, () => unseen);
}
