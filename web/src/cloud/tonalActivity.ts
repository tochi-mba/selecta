// What the song key measuring (tonalProfiles.ts) is doing in this tab, for the Workspace line. Kept
// apart from the profiler so reading it pulls in no decoding or worker code.
//
// `idle` covers everything measured, another tab holding the measuring lock, and the profiler not
// running at all, so the line shows only while this tab has songs to measure.

export type TonalActivity = 'measuring' | 'waiting_import' | 'waiting_music' | 'paused' | 'idle';

let now: TonalActivity = 'idle';
const listeners = new Set<() => void>();

export function setTonalActivity(next: TonalActivity): void {
  if (next === now) return;
  now = next;
  for (const listener of listeners) listener();
}

export function tonalActivity(): TonalActivity {
  return now;
}

/** Songs still waiting to be measured in this pass, and whether the next one also times the
 * neural beat finder on this device (the Activity drawer, T-20261126-36c7). */
let left = 0;
let timing = false;
export function setTonalLeft(count: number, timingBeats = timing): void {
  if (count === left && timingBeats === timing) return;
  left = Math.max(0, count);
  timing = timingBeats;
  for (const listener of listeners) listener();
}
export const tonalLeft = (): number => left;
export const timingBeats = (): boolean => timing;

export function onTonalActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The Workspace's words for it, or null when there is nothing to say. */
export function tonalActivityWords(activity: TonalActivity): string | null {
  if (activity === 'measuring') return 'Measuring song keys for Harmonic matches.';
  if (activity === 'waiting_music') return 'Measuring song keys carries on when the music stops.';
  if (activity === 'waiting_import') return 'Measuring song keys carries on when adding music finishes.';
  if (activity === 'paused') return 'Measuring songs is paused.';
  return null;
}
