/** Scripted seam windows: bounded ahead-of-time seam schedules (ADR-0459, BF-0459-04).
 *
 * Given two tracks' beat grids, tempo estimates and a seam spec, produce the timed event list
 * the engine's scheduler consumes. The honesty rules from the ADR are enforced here, not left
 * to callers:
 *  - a low-confidence or half/double-time-ambiguous tempo on either side refuses a
 *    beatmatched seam and falls back to an equal-power fade, with the reason recorded;
 *  - a transition never starts before 30 s into a song, the `leave_after` settle rule from
 *    `src/selecta/mix.py::with_room` (SHORTEST_STAY), so every song in a mix gets played;
 *  - the prepared window length is bounded, so a weak device never has to hold a long seam.
 *
 * Timing semantics match the local player: the seam lands on a beat with a 30 ms crossfade,
 * and a fade fallback crosses over 3 s (web/src/player.ts).
 */

import type { SeamEffects } from './seamEffects';
import {
  CROSSFADE_IMPLEMENTATION,
  FALLBACK_FADE_SECONDS,
  SEAM_FADE_SECONDS,
  fadeInPoints,
  fadeOutPoints,
} from './crossfade';
import type { TempoEstimate } from './analysis/tempo';
import type { StemName, StemSeamPlan } from './stemMoves/types';

export const SEAMS_IMPLEMENTATION = 'scripted-seam-windows-v1';

/** `SHORTEST_STAY` from src/selecta/mix.py: a transition never leaves a song earlier. */
export const LEAVE_AFTER_SECONDS = 30;
/** The longest seam overlap a schedule may ask for: 16 bars at 120 BPM, local mode's usual blend
 * (planner/choose.py gives most families 8 or 16 bars). A stretched clip covering it plus B's ramp
 * back stays inside the stretch's own 60 s input limit. */
export const MAX_WINDOW_SECONDS = 32;
/** Below this tempo confidence a beatmatched seam is refused in favour of a fade. */
export const MIN_BEATMATCH_CONFIDENCE = 0.5;
/** The default beatmatched crossfade length when the spec names none. */
export const DEFAULT_WINDOW_SECONDS = 8;
/** How many gain points each deck's fade is described with in the schedule. */
export const SCHEDULE_CURVE_STEPS = 48;

/** One timed event on the shared output timeline. Self-contained: this is the type the
 * engine's scheduler consumes, exported from here and nowhere else.
 *  - 'start': the deck begins playing its track from `sourceAt` seconds at output time `at`.
 *  - 'gain':  the deck's gain ramps linearly from its previous point to `value` at `at`.
 *  - 'stop':  the deck stops at `at`.
 *  - 'eq':    the deck's `band` gain (linear, 1 untouched, 0 removed) ramps to `value` at `at`.
 *  - 'filter': the deck's `filter` cutoff sweeps (exponentially) to `hz` at `at`.
 *  - 'send': the deck's `effect` send (echo or wash, seamEffects.ts) ramps to `value` at `at`.
 * 'eq' and 'filter' are the scripted moves of seamScript.ts; a device without the move chain
 * (seamMoves.ts) never receives them, because the scripter degrades the move first. 'send'
 * events come only with the schedule's `effects`, and only to a device with the returns.
 */
export interface SeamEvent {
  deck: 'a' | 'b';
  kind: 'start' | 'gain' | 'stop' | 'eq' | 'filter' | 'send';
  /** For 'send': which return the send feeds. */
  effect?: 'echo' | 'wash';
  /** For 'eq': which of the reference's three bands. */
  band?: 'low' | 'mid' | 'high';
  /** For 'filter': which filter moves. */
  filter?: 'highpass' | 'lowpass';
  /** For 'filter': the cutoff reached at `at`, in Hz. */
  hz?: number;
  /** Seconds on the output timeline (deck A's track starts at 0). */
  at: number;
  /** For 'start': seconds into the entering deck's own track. */
  sourceAt?: number;
  /** For 'gain': the gain in [0, 1] reached at `at`. */
  value?: number;
}

export interface TrackTiming {
  /** Beat times in seconds from the lightweight analysis, ascending. May be empty. */
  beats: number[];
  tempo: Pick<TempoEstimate, 'bpm' | 'confidence' | 'ambiguous'>;
  durationSeconds: number;
}

export interface SeamSpec {
  /** Wanted seam point in A, seconds. Clamped to honour `leave_after`. */
  exitSeconds?: number;
  /** The settle rule's floor; never below LEAVE_AFTER_SECONDS whatever the spec says. */
  leaveAfterSeconds?: number;
  /** Wanted crossfade length for a beatmatched seam; clamped to MAX_WINDOW_SECONDS. */
  windowSeconds?: number;
  /** Where B enters its own audio; snapped to B's first beat at or after it. */
  entrySeconds?: number;
}

export interface SeamSchedule {
  implementation: string;
  kind: 'beatmatch' | 'fade';
  /** Why a fade was scheduled instead of a beatmatch, when it was. */
  reason?: string;
  /** Output time the seam starts (B becomes audible). */
  startSeconds: number;
  /** Crossfade length actually scheduled. */
  windowSeconds: number;
  events: SeamEvent[];
  /** The move this schedule plays (seamScript.ts), when it came from a scripted move. */
  style?: string;
  /** Every part of the asked-for move this device could not do, and what it did instead. */
  degraded?: SeamDegrade[];
  /** The returns deck A's sends feed (seamEffects.ts), for an echo or wash move. */
  effects?: SeamEffects;
  /** Bars of overlap for a beatmatched move, as scheduled. */
  bars?: number;
  /** Why SelectaDJ picked this move, when the seam asked it to pick ('auto'). */
  why?: string;
  /** B enters stretched to A's tempo without changing its pitch (seamScript.ts, stretch.ts). */
  stretch?: SeamStretch;
  /** A stem move (stemSchedule.ts): the recipe's plan and, once prepared, its per-stem audio. */
  stems?: SeamStems;
}

/** A stem move's plan (stemMoves/types.ts) and the stems it plays. The events of the schedule
 * carry the full mixes' hand-offs; the plan's layers carry every stem's own curves. */
export interface SeamStems {
  plan: StemSeamPlan;
  /** Attached by the seam provider just before the schedule is played; never kept in a record. */
  buffers?: StemBuffers;
}

/** Per-stem audio, two channels each. A's stems are A's own audio from song second `origin`;
 * B's are already stretched onto A's bars, so B's sample 0 plays at A-timeline second `at`. */
export interface StemBuffers {
  sampleRate: number;
  a: { origin: number; stems: Partial<Record<StemName, Float32Array[]>> };
  b: { at: number; stems: Partial<Record<StemName, Float32Array[]>> };
}

/** A stretched entry, as the Python engine's `in_context` plays one: native A, a pre-rendered
 * clip of B stretched to A's tempo, then native B. The clip starts with B's 'start' event at
 * `sourceFrom` and holds `ratio` until `holdUntil`, eases linearly back to 1 by `rampUntil`,
 * and hands over to native B at `handoverAt` (B's own `handoverSourceAt`) with a 30 ms
 * crossfade. Times named `...Until`/`...At` are on A's timeline; `source...` are B's seconds. */
export interface SeamStretch {
  /** B's tempo ratio through the overlap: A's tempo over B's (new tempo over old). */
  ratio: number;
  holdUntil: number;
  rampUntil: number;
  sourceFrom: number;
  /** Seconds of B the clip plays up to the handover: `handoverSourceAt - sourceFrom`. */
  inputSeconds: number;
  handoverAt: number;
  handoverSourceAt: number;
  /** The rendered clip, attached by the seam provider just before the schedule is played; it is
   * never kept in a seam record. */
  clip?: StretchedClip;
}

/** B's stretched entry clip. `skipSeconds` of lead-in come before the clip's 'start' point, so
 * the stretch's first frame is warmed up before anyone hears it. */
export interface StretchedClip {
  channels: Float32Array[];
  sampleRate: number;
  skipSeconds: number;
}

/** A move the browser tier could not do honestly, and the documented fallback it took. */
export interface SeamDegrade {
  /** What was asked for: a move name, or a part of one ('eq', 'stretch', 'stems', 'echo'). */
  wanted: string;
  /** What was scheduled instead. */
  instead: string;
  reason: string;
}

export function firstBeatAtOrAfter(beats: number[], time: number): number | null {
  for (const beat of beats) {
    if (beat >= time) {
      return beat;
    }
  }
  return null;
}

export function confident(track: TrackTiming): boolean {
  return track.tempo.confidence >= MIN_BEATMATCH_CONFIDENCE && !track.tempo.ambiguous;
}

export function gainEvents(deck: 'a' | 'b', points: ReadonlyArray<readonly [number, number]>): SeamEvent[] {
  return points.map(([at, value]) => ({ deck, kind: 'gain', at, value }));
}

export function fadeSchedule(startSeconds: number, entrySeconds: number, reason: string): SeamSchedule {
  const window = FALLBACK_FADE_SECONDS;
  const end = startSeconds + window;
  const events: SeamEvent[] = [
    { deck: 'b', kind: 'start', at: startSeconds, sourceAt: entrySeconds },
    ...gainEvents('a', fadeOutPoints(startSeconds, end, SCHEDULE_CURVE_STEPS)),
    ...gainEvents('b', fadeInPoints(startSeconds, end, SCHEDULE_CURVE_STEPS)),
    { deck: 'a', kind: 'stop', at: end + 1e-6 },
  ];
  events.sort((left, right) => left.at - right.at);
  return {
    implementation: `${SEAMS_IMPLEMENTATION}+${CROSSFADE_IMPLEMENTATION}`,
    kind: 'fade',
    reason,
    startSeconds,
    windowSeconds: window,
    events,
  };
}

/** Build the bounded ahead-of-time schedule for the seam from track A into track B. */
export function scheduleSeam(a: TrackTiming, b: TrackTiming, spec: SeamSpec = {}): SeamSchedule {
  const leaveAfter = Math.max(spec.leaveAfterSeconds ?? LEAVE_AFTER_SECONDS, LEAVE_AFTER_SECONDS);
  const wantedExit = Math.max(spec.exitSeconds ?? leaveAfter, leaveAfter);
  const entryWanted = spec.entrySeconds ?? 0;

  if (!confident(a) || !confident(b)) {
    const side = !confident(a) ? 'the outgoing song' : 'the incoming song';
    const why = (!confident(a) ? a : b).tempo.ambiguous
      ? 'its tempo estimate is half/double-time ambiguous'
      : 'its tempo confidence is low';
    return fadeSchedule(wantedExit, entryWanted, `no beatmatch: ${why} on ${side}`);
  }
  const exitBeat = firstBeatAtOrAfter(a.beats, wantedExit);
  const entryBeat = firstBeatAtOrAfter(b.beats, entryWanted);
  if (exitBeat === null || entryBeat === null) {
    return fadeSchedule(wantedExit, entryWanted, 'no beatmatch: no usable beat near the seam');
  }
  const window = Math.min(
    Math.max(spec.windowSeconds ?? DEFAULT_WINDOW_SECONDS, SEAM_FADE_SECONDS),
    MAX_WINDOW_SECONDS
  );
  const end = exitBeat + window;
  const events: SeamEvent[] = [
    { deck: 'b', kind: 'start', at: exitBeat, sourceAt: entryBeat },
    ...gainEvents('a', fadeOutPoints(exitBeat, end, SCHEDULE_CURVE_STEPS)),
    ...gainEvents('b', fadeInPoints(exitBeat, end, SCHEDULE_CURVE_STEPS)),
    { deck: 'a', kind: 'stop', at: end + 1e-6 },
  ];
  events.sort((left, right) => left.at - right.at);
  return {
    implementation: `${SEAMS_IMPLEMENTATION}+${CROSSFADE_IMPLEMENTATION}`,
    kind: 'beatmatch',
    startSeconds: exitBeat,
    windowSeconds: window,
    events,
  };
}
