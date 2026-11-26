// What the member asked of this device's song measuring (tonalProfiles.ts): songs to measure
// first, and a pause. The Desktop's "analyse this song now", its priority list and its start and
// stop answer here in a browser (localFirstLibrary.ts). Kept apart from the profiler so reading
// it pulls in no decoding or worker code. Song ids only; nothing here leaves the device.

const PAUSED_KEY = 'selecta.measuring.paused';
/** Songs asked for first, at most; the oldest ask goes when more are asked. */
export const FIRST_KEPT = 500;

let first: number[] = [];
let waiting: number[] = [];
const listeners = new Set<() => void>();
const tell = () => { for (const listener of listeners) listener(); };

export function onMeasuringControl(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Measure this song before the others still waiting (after the one being measured now). */
export function measureFirst(songId: number): void {
  first = [songId, ...first.filter((id) => id !== songId)].slice(0, FIRST_KEPT);
  tell();
}

/** The song goes back to its place among the others. */
export function measureInTurn(songId: number): void {
  if (!first.includes(songId)) return;
  first = first.filter((id) => id !== songId);
  tell();
}

export const isFirst = (songId: number): boolean => first.includes(songId);
export const firstAsked = (): readonly number[] => first;

/** The profiler says which songs it still has to measure in this pass; a song measured leaves
 * the first list too. */
export function setWaiting(ids: readonly number[], measured?: number): void {
  waiting = [...ids];
  if (measured !== undefined) first = first.filter((id) => id !== measured);
  tell();
}
export const waitingSongs = (): readonly number[] => waiting;

/** Of the songs still to measure, the next: one asked for first, else the first in turn. */
export function nextOf<T extends { id: number }>(left: readonly T[]): T | undefined {
  for (const id of first) {
    const found = left.find((one) => one.id === id);
    if (found) return found;
  }
  return left[0];
}

export function measuringPaused(): boolean {
  try { return window.localStorage.getItem(PAUSED_KEY) === '1'; } catch { return pausedHere; }
}
// a browser that keeps nothing still pauses for this visit
let pausedHere = false;

/** Pause or carry on. A pause lasts until the member carries on, across visits, as on the Desktop. */
export function setMeasuringPaused(paused: boolean): void {
  pausedHere = paused;
  try {
    if (paused) window.localStorage.setItem(PAUSED_KEY, '1');
    else window.localStorage.removeItem(PAUSED_KEY);
  } catch { /* paused for this visit only */ }
  tell();
}
