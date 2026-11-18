/** The seam script, ported to the browser tier (ADR-0459, BF-0459-04).
 *
 * The Python engine describes a transition as data (`src/selecta/render/script.py`
 * TransitionScript) and a recipe per move builds one (`src/selecta/styles/blend.py`,
 * `exits.py`). This module ports those recipes' semantics onto the bounded ahead-of-time
 * SeamSchedule the browser scheduler plays:
 *  - bass_swap_blend: equal-power gains over 65 percent of the overlap at each end, and one low
 *    end at a time, traded on a bar line near the middle across one beat (`_low_curves`);
 *  - filter_sweep: the same bass trade, A's highpass sweeping 30 Hz to 2 kHz and B's lowpass
 *    300 Hz to 20 kHz across the overlap, gains over 35 percent of it;
 *  - cut_on_one: a declicked cut (8 ms) on the downbeat;
 *  - blend (no move named): the plain equal-power beatmatched blend of seams.ts.
 *
 * What the browser cannot do honestly is degraded to a documented fallback and recorded on the
 * schedule's `degraded` list, never silently swapped:
 *  - tempo_ramp needs a pitch-preserving stretch (stretch.ts reports it unsupported) -> a fade;
 *  - echo_out and reverb_wash need the echo and wash returns, not built here -> a fade;
 *  - delay_throw needs vocal timing and stems (Tier 3, unsupported) -> a fade;
 *  - a beatmatched blend between songs whose tempos differ needs a stretch too, so the overlap
 *    is shortened until the beats drift by at most an eighth of a beat, or becomes a fade;
 *  - EQ and filter moves need the move chain (seamMoves.ts) -> the plain blend without them;
 *  - low or ambiguous tempo confidence, or no beatmatch capability -> a fade (seams.ts rule).
 * The 30 s `leave_after` settle rule and the 16 s window bound of seams.ts hold for every move.
 */

import { fadeInPoints, fadeOutPoints } from './crossfade';
import { SEAM_MOVES_IMPLEMENTATION } from './seamMoves';
import {
  confident,
  fadeSchedule,
  firstBeatAtOrAfter,
  gainEvents,
  LEAVE_AFTER_SECONDS,
  MAX_WINDOW_SECONDS,
  SCHEDULE_CURVE_STEPS,
  SEAMS_IMPLEMENTATION,
  type SeamDegrade,
  type SeamEvent,
  type SeamSchedule,
  type TrackTiming,
} from './seams';

export const SEAM_SCRIPT_IMPLEMENTATION = 'browser-seam-script-v1';
export const BEATS_PER_BAR = 4;
/** `_FADE_SHARE` in src/selecta/styles/blend.py. */
export const BLEND_FADE_SHARE = 0.65;
/** filter_sweep's gain share of the overlap. */
export const SWEEP_FADE_SHARE = 0.35;
/** `_DECLICK` in src/selecta/styles/exits.py. */
export const CUT_DECLICK_SECONDS = 0.008;
/** Without a stretch the two beat grids drift apart; an overlap may drift at most this much. */
export const MAX_DRIFT_BEATS = 0.125;
/** A default exit leaves this much of A after the overlap ends. */
export const TAIL_GUARD_SECONDS = 2;
const BAR_CHOICES = [32, 16, 8, 4, 2, 1];

/** Every move a recipe can name (src/selecta/styles/__init__.py all_recipes), plus 'blend'. */
export type SeamMove =
  | 'blend' | 'bass_swap_blend' | 'filter_sweep' | 'tempo_ramp'
  | 'cut_on_one' | 'echo_out' | 'reverb_wash' | 'delay_throw';

/** What the device can do, from its capability record; a reason whenever it cannot. */
export type Ability = { ok: true } | { ok: false; reason: string };
export type SeamAbilities = {
  beatmatch: Ability;
  eqFilters: Ability;
  stretch: Ability;
  stems: Ability;
  echo: Ability;
};

export interface ScriptRequest {
  a: TrackTiming;
  b: TrackTiming;
  /** The move from the mix's seam settings; 'blend' when none is named. */
  move?: string | null;
  bars?: number | null;
  /** Bars into A where the overlap starts, and into B where it enters (the seam settings). */
  exitBar?: number | null;
  entryBar?: number | null;
  abilities: SeamAbilities;
  leaveAfterSeconds?: number;
}

const DEFAULT_BARS: Record<string, number> = { bass_swap_blend: 16, filter_sweep: 8, blend: 4 };
const NEEDS: Partial<Record<SeamMove, { ability: keyof SeamAbilities; wanted: string }>> = {
  tempo_ramp: { ability: 'stretch', wanted: 'stretch' },
  echo_out: { ability: 'echo', wanted: 'echo' },
  reverb_wash: { ability: 'echo', wanted: 'wash' },
  delay_throw: { ability: 'stems', wanted: 'stems' },
};

function known(move: string | null | undefined): SeamMove | null {
  const name = move || 'blend';
  return ['blend', 'bass_swap_blend', 'filter_sweep', 'tempo_ramp', 'cut_on_one', 'echo_out', 'reverb_wash', 'delay_throw']
    .includes(name) ? name as SeamMove : null;
}

function beatAtBar(timing: TrackTiming, bar: number | null | undefined): number | null {
  if (bar === null || bar === undefined || !(bar >= 0)) return null;
  return timing.beats[Math.round(bar) * BEATS_PER_BAR] ?? null;
}

function withDegrades(schedule: SeamSchedule, style: string, degraded: SeamDegrade[]): SeamSchedule {
  return {
    ...schedule,
    implementation: `${schedule.implementation}+${SEAM_SCRIPT_IMPLEMENTATION}`,
    style,
    ...(degraded.length ? { degraded } : {}),
  };
}

/** The largest bar count that fits the window bound and the no-stretch drift bound. */
export function barsThatFit(wanted: number, beatSeconds: number, tempoGap: number): number {
  const byWindow = MAX_WINDOW_SECONDS / (BEATS_PER_BAR * beatSeconds);
  const byDrift = tempoGap > 0 ? MAX_DRIFT_BEATS / (BEATS_PER_BAR * tempoGap) : Infinity;
  const limit = Math.min(wanted, byWindow, byDrift);
  return BAR_CHOICES.find((bars) => bars <= limit) ?? 0;
}

/** Build the schedule for the seam from A into B, playing the asked-for move as far as this
 * device honestly can. Times are on A's own timeline, as the scheduler expects. */
export function scriptSeam(request: ScriptRequest): SeamSchedule {
  const { a, b, abilities } = request;
  const degraded: SeamDegrade[] = [];
  const leaveAfter = Math.max(request.leaveAfterSeconds ?? LEAVE_AFTER_SECONDS, LEAVE_AFTER_SECONDS);
  let move = known(request.move);
  if (!move) {
    degraded.push({ wanted: String(request.move), instead: 'blend', reason: 'SelectaDJ in the browser does not know this move' });
    move = 'blend';
  }
  const entryWanted = beatAtBar(b, request.entryBar) ?? 0;
  const fade = (at: number, wanted: string, reason: string) => {
    degraded.push({ wanted, instead: 'fade', reason });
    return withDegrades(fadeSchedule(at, entryWanted, `no ${move}: ${reason}`), move as string, degraded);
  };
  const defaultExit = (window: number) => Math.max(leaveAfter, a.durationSeconds - window - TAIL_GUARD_SECONDS);
  const exitAsked = beatAtBar(a, request.exitBar);
  const exitWanted = (window: number) => Math.max(exitAsked ?? defaultExit(window), leaveAfter);

  const needs = NEEDS[move];
  if (needs) {
    const ability = abilities[needs.ability];
    if (!ability.ok) return fade(exitWanted(3), needs.wanted, ability.reason);
  }
  if (!abilities.beatmatch.ok) return fade(exitWanted(3), 'beatmatch', abilities.beatmatch.reason);
  if (!confident(a) || !confident(b)) {
    const side = !confident(a) ? 'the outgoing song' : 'the incoming song';
    const why = (!confident(a) ? a : b).tempo.ambiguous ? 'its tempo is half/double-time ambiguous' : 'its tempo confidence is low';
    return fade(exitWanted(3), 'beatmatch', `${why} on ${side}`);
  }
  const beat = 60 / a.tempo.bpm;
  const gap = Math.abs(a.tempo.bpm / b.tempo.bpm - 1);

  if (move === 'cut_on_one') {
    const cut = firstBeatAtOrAfter(a.beats, exitWanted(0));
    const entry = firstBeatAtOrAfter(b.beats, entryWanted);
    if (cut === null || entry === null) return fade(exitWanted(3), 'beatmatch', 'no usable beat near the seam');
    const d = CUT_DECLICK_SECONDS;
    const events: SeamEvent[] = [
      { deck: 'b', kind: 'start', at: cut - d, sourceAt: Math.max(0, entry - d) },
      { deck: 'a', kind: 'gain', at: cut - d * 0.25, value: 1 },
      { deck: 'a', kind: 'gain', at: cut + d, value: 0 },
      { deck: 'b', kind: 'gain', at: cut - d, value: 0 },
      { deck: 'b', kind: 'gain', at: cut - d * 0.25, value: 1 },
      { deck: 'a', kind: 'stop', at: cut + d + 1e-6 },
    ];
    return finish(events, cut - d, d * 1.25, move, degraded, false);
  }

  let style: SeamMove = move;
  if ((style === 'bass_swap_blend' || style === 'filter_sweep') && !abilities.eqFilters.ok) {
    degraded.push({ wanted: 'eq', instead: 'blend', reason: abilities.eqFilters.reason });
    style = 'blend';
  }
  const wantedBars = Math.max(1, Math.round(request.bars ?? DEFAULT_BARS[style] ?? 8));
  const bars = barsThatFit(wantedBars, beat, gap);
  if (bars === 0) {
    const percent = (gap * 100).toFixed(1);
    return fade(exitWanted(3), 'stretch', `the tempos are ${percent} percent apart and this browser has no time-stretch to close the gap`);
  }
  if (bars < wantedBars) {
    const why = bars < barsThatFit(wantedBars, beat, 0)
      ? 'without a time-stretch a longer overlap would drift off the beat'
      : `a browser seam window is at most ${MAX_WINDOW_SECONDS} s`;
    degraded.push({ wanted: `${wantedBars} bars`, instead: `${bars} bars`, reason: why });
  }
  const window = bars * BEATS_PER_BAR * beat;
  const start = firstBeatAtOrAfter(a.beats, exitWanted(window));
  const entry = firstBeatAtOrAfter(b.beats, entryWanted);
  if (start === null || entry === null) return fade(exitWanted(3), 'beatmatch', 'no usable beat near the seam');
  const end = start + window;
  const events: SeamEvent[] = [{ deck: 'b', kind: 'start', at: start, sourceAt: entry }];
  if (style === 'blend') {
    events.push(...gainEvents('a', fadeOutPoints(start, end, SCHEDULE_CURVE_STEPS)));
    events.push(...gainEvents('b', fadeInPoints(start, end, SCHEDULE_CURVE_STEPS)));
  } else {
    const share = style === 'filter_sweep' ? SWEEP_FADE_SHARE : BLEND_FADE_SHARE;
    const span = window * share;
    events.push(...gainEvents('a', fadeOutPoints(end - span, end, SCHEDULE_CURVE_STEPS)));
    events.push(...gainEvents('b', fadeInPoints(start, start + span, SCHEDULE_CURVE_STEPS)));
    // one low end at a time, traded on a bar line near the middle across one beat
    const swap = start + Math.max(1, Math.round(bars * 0.5)) * (window / bars);
    events.push(
      { deck: 'a', kind: 'eq', band: 'low', at: swap - beat / 2, value: 1 },
      { deck: 'a', kind: 'eq', band: 'low', at: swap + beat / 2, value: 0 },
      { deck: 'b', kind: 'eq', band: 'low', at: start - 1e-6, value: 0 },
      { deck: 'b', kind: 'eq', band: 'low', at: swap - beat / 2, value: 0 },
      { deck: 'b', kind: 'eq', band: 'low', at: swap + beat / 2, value: 1 },
    );
    if (style === 'filter_sweep') {
      events.push(
        { deck: 'a', kind: 'filter', filter: 'highpass', at: start, hz: 30 },
        { deck: 'a', kind: 'filter', filter: 'highpass', at: end, hz: 2000 },
        { deck: 'b', kind: 'filter', filter: 'lowpass', at: start - 1e-6, hz: 300 },
        { deck: 'b', kind: 'filter', filter: 'lowpass', at: end, hz: 20000 },
      );
    }
  }
  events.push({ deck: 'a', kind: 'stop', at: end + 1e-6 });
  return finish(events, start, window, style, degraded, style !== 'blend');
}

function finish(events: SeamEvent[], start: number, window: number, style: string, degraded: SeamDegrade[], moves: boolean): SeamSchedule {
  events.sort((left, right) => left.at - right.at);
  const implementation = `${SEAMS_IMPLEMENTATION}+${SEAM_SCRIPT_IMPLEMENTATION}${moves ? `+${SEAM_MOVES_IMPLEMENTATION}` : ''}`;
  return {
    implementation,
    kind: 'beatmatch',
    startSeconds: start,
    windowSeconds: window,
    events,
    style,
    ...(degraded.length ? { degraded } : {}),
  };
}
