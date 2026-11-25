import { FALLBACK_FADE_SECONDS } from '../dsp/crossfade';
import type { SeamRecord } from '../dsp/seamProvider';
import type { SchedulerClock } from '../engine/scheduler';
import { playedWords } from './playedSeams';

// What Listen shows about a hand-over in Cloud, from what the browser engine really scheduled
// (engine/scheduler.ts clock()), not from the seam the provider planned. The two differ when the
// scheduler could not use the planned seam and fell back to its own fade at the end of the song:
// trusting the plan then showed "Transition in progress" while the old song played on, and
// "0:00 until the hand-off" until the real fade at the song's end (T-20261125-37fe).
//
// The engine makes the next song current the moment it becomes audible. Listen keeps naming the
// outgoing song until the hand-over has finished, as local mode does until its switch point, so
// the From and Into pair, the hand-over bar and the live blend drawing have a song to come from.

/** A hand-over the engine scheduled within this many seconds of a planned seam's start is it. */
export const SAME_SEAM_S = 0.1;

export type SeamShown = {
  position: number;
  songTime: number;
  duration: number;
  inSeam: boolean;
  seamAt: number | null;
  nextReady: boolean;
  blend: { window: number; nextLength: number; nextFrom: number; move: string | null } | null;
};

/** The planned seam the engine really played for the hand-over from `fromIndex` into `toIndex`
 * that starts at `at` in the outgoing song, or null where it played its own fade instead. */
function playedSeam(records: readonly SeamRecord[], fromIndex: number, toIndex: number, at: number): SeamRecord | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record.fromIndex !== fromIndex || record.toIndex !== toIndex) continue;
    const end = record.schedule.startSeconds + record.schedule.windowSeconds;
    if (at >= record.schedule.startSeconds - SAME_SEAM_S && at < end) return record;
  }
  return null;
}

/** How long the hand-over from `fromIndex` into `toIndex`, which the engine starts at `at` in the
 * outgoing song, lasts. A planned seam it really played gives its own remaining window; otherwise
 * the engine played its fallback fade, which is at most FALLBACK_FADE_SECONDS and at most half the
 * incoming song (engine/scheduler.ts fadeInto). */
export function handoverWindow(records: readonly SeamRecord[], fromIndex: number, toIndex: number, at: number, nextLength: number): number {
  const record = playedSeam(records, fromIndex, toIndex, at);
  if (record) return record.schedule.startSeconds + record.schedule.windowSeconds - at;
  return nextLength > 0 ? Math.min(FALLBACK_FADE_SECONDS, nextLength / 2) : FALLBACK_FADE_SECONDS;
}

/** The name of the move that hand-over really plays, in Up Next's words (playedSeams.ts), or null
 * where the engine fell back to its own fade with no planned seam: no name is made up for that. */
export function handoverMove(records: readonly SeamRecord[], fromIndex: number, toIndex: number, at: number): string | null {
  const record = playedSeam(records, fromIndex, toIndex, at);
  return record ? playedWords(record.schedule).label : null;
}

/** The song, time and hand-over Listen shows while this device's engine plays. `at` is where the
 * engine is now; `lengthOf` is a song's stored length (0 when unknown), and the decoded length
 * stands in where it is missing. */
export function seamShown(
  at: { position: number; songTime: number },
  lengthOf: (index: number) => number,
  records: readonly SeamRecord[],
  clock: SchedulerClock,
): SeamShown {
  const entered = clock.entered;
  if (entered) {
    const window = handoverWindow(records, entered.fromIndex, at.position, entered.fromAt, clock.length);
    // still handing over: the outgoing song plays on underneath, at its own real time
    if (entered.heard < window) {
      return {
        position: entered.fromIndex,
        songTime: entered.fromAt + entered.heard,
        duration: lengthOf(entered.fromIndex) || entered.fromLength,
        inSeam: true,
        seamAt: entered.fromAt,
        nextReady: true,
        // where the incoming song came in, by its own clock less the time it has been heard
        blend: {
          window,
          nextLength: clock.length,
          nextFrom: Math.max(0, at.songTime - entered.heard),
          move: handoverMove(records, entered.fromIndex, at.position, entered.fromAt),
        },
      };
    }
  }
  const duration = lengthOf(at.position) || clock.length;
  const next = clock.next;
  if (!next) return { ...at, duration, inSeam: false, seamAt: null, nextReady: false, blend: null };
  const window = handoverWindow(records, at.position, next.index, next.at, next.length);
  return {
    ...at, duration, inSeam: at.songTime >= next.at, seamAt: next.at, nextReady: true,
    blend: { window, nextLength: next.length, nextFrom: 0, move: handoverMove(records, at.position, next.index, next.at) },
  };
}
