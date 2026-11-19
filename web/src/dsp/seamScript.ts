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
 *  - echo_out: A's last beat sent into an in-time echo whose repeats ring on past A's fader as B
 *    lands, and reverb_wash: A's last two beats into a room as A fades over one beat
 *    (`exits.py`, with the returns of seamEffects.ts). Both need only A's beat, as in local mode;
 *  - blend: the plain equal-power beatmatched blend of seams.ts;
 *  - auto: SelectaDJ picks, in local mode's preference order (chooseMove), and says why.
 * Exits sit on an 8-bar phrase line of A's grid unless the seam names a bar, as local mode
 * leaves on a cue rather than wherever the song happens to end.
 *
 * What the browser cannot do honestly is degraded to a documented fallback and recorded on the
 * schedule's `degraded` list, never silently swapped:
 *  - tempo_ramp needs a pitch-preserving stretch (stretch.ts reports it unsupported) -> a fade;
 *  - echo_out and reverb_wash need the echo and wash returns (seamEffects.ts) -> a fade;
 *  - delay_throw needs vocal timing and stems (Tier 3, unsupported) -> a fade;
 *  - a beatmatched blend between songs whose tempos differ needs a stretch, so the overlap is
 *    shortened until the beats drift by at most an eighth of a beat, or becomes a fade. Only with
 *    `cloud.browser_varispeed` (off: BF-0459-05 rules out playbackRate for musical stretch) is B's
 *    speed nudged to A's tempo within 3 percent instead, a small pitch change as on a turntable;
 *  - EQ and filter moves need the move chain (seamMoves.ts) -> the plain blend without them;
 *  - low or ambiguous tempo confidence, or no beatmatch capability -> a fade (seams.ts rule).
 * The 30 s `leave_after` settle rule and the 16 s window bound of seams.ts hold for every move.
 */

import { fadeInPoints, fadeOutPoints } from './crossfade';
import { SEAM_EFFECTS_IMPLEMENTATION, type EchoSpec, type WashSpec } from './seamEffects';
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
/** An overlap ends at least this long before A's own end. */
export const SEAM_ROOM_GUARD_SECONDS = 0.5;
const BAR_CHOICES = [32, 16, 8, 4, 2, 1];

/** Every move a recipe can name (src/selecta/styles/__init__.py all_recipes), plus 'blend'. */
export type SeamMove =
  | 'auto' | 'blend' | 'bass_swap_blend' | 'filter_sweep' | 'tempo_ramp'
  | 'cut_on_one' | 'echo_out' | 'reverb_wash' | 'delay_throw';

/** What the device can do, from its capability record; a reason whenever it cannot. */
export type Ability = { ok: true } | { ok: false; reason: string };
export type SeamAbilities = {
  beatmatch: Ability;
  eqFilters: Ability;
  stretch: Ability;
  stems: Ability;
  echo: Ability;
  /** Nudging B's playback speed to lock the beats (cloud.browser_varispeed); off when absent. */
  varispeed?: Ability;
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
  /** The moves this account has on (the `move.*` flags); 'auto' picks only among these, and a
   * named move that is off is picked for instead. Every move when absent. */
  allowed?: readonly string[];
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
  return ['auto', 'blend', 'bass_swap_blend', 'filter_sweep', 'tempo_ramp', 'cut_on_one', 'echo_out', 'reverb_wash', 'delay_throw']
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
export function barsThatFit(wanted: number, beatSeconds: number, tempoGap: number, roomSeconds = MAX_WINDOW_SECONDS): number {
  const byWindow = Math.min(MAX_WINDOW_SECONDS, roomSeconds) / (BEATS_PER_BAR * beatSeconds);
  const byDrift = tempoGap > 0 ? MAX_DRIFT_BEATS / (BEATS_PER_BAR * tempoGap) : Infinity;
  const limit = Math.min(wanted, byWindow, byDrift);
  return BAR_CHOICES.find((bars) => bars <= limit) ?? 0;
}

/** Local mode's universal fallback and its tempo-free moves need only A's beat: B lands on its
 * chosen entry, on its own beat when that is known. */
const TEMPO_FREE: readonly SeamMove[] = ['cut_on_one', 'echo_out', 'reverb_wash'];
/** No family in local mode gets an overlap shorter than this: every rated 4-bar one was disliked. */
export const AUTO_MIN_BARS = 8;
/** Local mode lets B alone absorb a tempo gap up to this (styles/timing.py A_NATIVE_MAX_GAP). The
 * browser has no pitch-preserving stretch, so it nudges B's playback speed instead, as a
 * turntable's pitch fader does: the beats lock, and the pitch moves by the same small amount. */
export const MAX_VARISPEED = 0.03;
/** After the overlap, B eases back to its own speed over this many beats (timing.py RAMP_BEATS). */
export const VARISPEED_RAMP_BEATS = 16;
/** Exits sit on a phrase line of the beat grid, this many bars apart. */
export const PHRASE_BARS = 8;
/** `_next_vocal_room_beats` with vocals unknown (the browser has none) is half a beat, halved. */
const VOCAL_ROOM = 0.25;

/** The echo_out tail of src/selecta/styles/exits.py `_tail_echo`, with vocals unknown. */
export function echoFor(beat: number): EchoSpec {
  return { delaySeconds: beat, feedback: 0.22 + 0.28 * VOCAL_ROOM, wet: 0.16 + 0.24 * VOCAL_ROOM, returnHighpassHz: 300, dampLowpassHz: 6000 };
}

/** The reverb_wash room of exits.py, with vocals unknown. */
export function washFor(): WashSpec {
  return { wet: 0.18 + 0.18 * VOCAL_ROOM, decaySeconds: 1.2 + 0.8 * VOCAL_ROOM, damping: 0.45, returnHighpassHz: 350 };
}

/** The latest phrase line of A's grid where a seam of `window` seconds still fits before the
 * tail guard, never before the settle rule; the plain end-of-song point when A has no grid. */
export function phraseExit(a: TrackTiming, window: number, leaveAfter: number): number {
  const latest = a.durationSeconds - window - TAIL_GUARD_SECONDS;
  const fallback = Math.max(leaveAfter, latest);
  if (!a.beats.length || !confident(a)) return fallback;
  let best: number | null = null;
  for (let index = 0; index < a.beats.length; index += PHRASE_BARS * BEATS_PER_BAR) {
    const time = a.beats[index];
    if (time >= leaveAfter && time <= latest) best = time;
  }
  return best ?? fallback;
}

const percent = (gap: number) => (gap * 100).toFixed(1);

type Choice = { move: SeamMove; bars?: number; why: string } | { fade: string; wanted: string };

/** What SelectaDJ plays when the seam asks it to pick: local mode's preference order
 * (src/selecta/planner/choose.py `_style_fit`: a beatmatched bass swap first, a filter sweep
 * next, then the tempo-free moves with echo out as the universal fallback), limited to what this
 * device measured and can do, and to the moves this account has on. */
export function chooseMove(request: ScriptRequest, room: number): Choice {
  const { a, b, abilities } = request;
  const may = (move: SeamMove) => !request.allowed || request.allowed.includes(move);
  if (!abilities.beatmatch.ok) return { fade: abilities.beatmatch.reason, wanted: 'beatmatch' };
  if (!confident(a)) {
    // local mode still plays a tempo-free move when it can't lock the beat; a room forgives an
    // unsure beat where an echo would repeat off it
    const unsure = 'The first song’s beat isn’t clear enough to blend or echo in time';
    if (abilities.echo.ok && may('reverb_wash')) return { move: 'reverb_wash', why: `${unsure}, so it washes out into a room as the next song arrives.` };
    if (may('cut_on_one')) return { move: 'cut_on_one', why: `${unsure}, so it cuts across to the next song.` };
    return { fade: a.tempo.ambiguous ? 'its tempo is half/double-time ambiguous on the outgoing song' : 'its tempo confidence is low on the outgoing song', wanted: 'beatmatch' };
  }
  const tempoFree = (why: string): Choice => {
    if (abilities.echo.ok && may('echo_out')) return { move: 'echo_out', why: `${why}, so the last beat echoes out as the next song lands.` };
    if (may('cut_on_one')) return { move: 'cut_on_one', why: `${why}, so it cuts on the beat.` };
    return { fade: `${why}, and no tempo-free move is on`, wanted: 'auto' };
  };
  if (!confident(b)) return tempoFree('The next song’s beat isn’t clear enough to blend in time');
  const beat = 60 / a.tempo.bpm;
  const gap = Math.abs(a.tempo.bpm / b.tempo.bpm - 1);
  const nudged = !!abilities.varispeed?.ok && gap <= MAX_VARISPEED;
  const bars = barsThatFit(16, beat, nudged ? 0 : gap, room);
  if (bars >= AUTO_MIN_BARS) {
    const close = gap < 0.0005
      ? 'The tempos match'
      : nudged
        ? `The tempos are ${percent(gap)} percent apart, close enough to nudge the next song’s speed to match`
        : `The tempos are ${percent(gap)} percent apart`;
    if (abilities.eqFilters.ok && may('bass_swap_blend')) return { move: 'bass_swap_blend', bars, why: `${close}, so both play in time for ${bars} bars and trade the bass on a bar line.` };
    if (abilities.eqFilters.ok && may('filter_sweep')) return { move: 'filter_sweep', bars: Math.min(bars, 8), why: `${close}, so the first song filters away as the next opens up.` };
    return { move: 'blend', bars, why: `${close}, so both play in time for ${bars} bars.` };
  }
  const tooFar = barsThatFit(16, beat, gap) < AUTO_MIN_BARS;
  return tempoFree(tooFar
    ? `The tempos are ${percent(gap)} percent apart and this browser can’t stretch them`
    : 'There isn’t room left in the song for a long blend');
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
  if (move !== 'auto' && move !== 'blend' && request.allowed && !request.allowed.includes(move)) {
    degraded.push({ wanted: move, instead: 'auto', reason: 'that move is off for this account' });
    move = 'auto';
  }
  const entryWanted = beatAtBar(b, request.entryBar) ?? 0;
  const exitAsked = beatAtBar(a, request.exitBar);
  const exitWanted = (window: number) => Math.max(exitAsked ?? phraseExit(a, window, leaveAfter), leaveAfter);
  const fade = (at: number, wanted: string, reason: string) => {
    degraded.push({ wanted, instead: 'fade', reason });
    return withDegrades(fadeSchedule(at, entryWanted, `no ${move}: ${reason}`), move as string, degraded);
  };
  const roomAfter = (beat: number) => a.durationSeconds - Math.max(exitAsked ?? leaveAfter, leaveAfter) - beat - SEAM_ROOM_GUARD_SECONDS;

  let why: string | undefined;
  let bars = request.bars ?? null;
  if (move === 'auto') {
    const beat = a.tempo.bpm > 0 ? 60 / a.tempo.bpm : 0.5;
    const picked = chooseMove(request, roomAfter(beat));
    if ('fade' in picked) return fade(exitWanted(3), picked.wanted, picked.fade);
    move = picked.move;
    why = picked.why;
    bars = picked.bars ?? bars;
  }
  const done = (schedule: SeamSchedule): SeamSchedule => (why ? { ...schedule, why } : schedule);

  const needs = NEEDS[move];
  if (needs) {
    const ability = abilities[needs.ability] ?? { ok: false as const, reason: `this device can't do ${needs.wanted}` };
    if (!ability.ok) return fade(exitWanted(3), needs.wanted, ability.reason);
  }
  if (!abilities.beatmatch.ok) return fade(exitWanted(3), 'beatmatch', abilities.beatmatch.reason);
  const unsure = (track: TrackTiming, side: string) => `${track.tempo.ambiguous ? 'its tempo is half/double-time ambiguous' : 'its tempo confidence is low'} on ${side}`;
  const aSure = confident(a);
  // a wash or a cut can land without a sure beat (not on it); everything else needs one
  if (!aSure && move !== 'reverb_wash' && move !== 'cut_on_one') return fade(exitWanted(3), 'beatmatch', unsure(a, 'the outgoing song'));
  const beat = aSure ? 60 / a.tempo.bpm : Math.min(1, Math.max(0.3, a.tempo.bpm > 0 ? 60 / a.tempo.bpm : 0.5));

  if (TEMPO_FREE.includes(move)) {
    const exitAt = exitWanted(move === 'reverb_wash' ? beat : 0);
    const cut = aSure ? firstBeatAtOrAfter(a.beats, exitAt) : exitAt;
    const entry = confident(b) ? firstBeatAtOrAfter(b.beats, entryWanted) ?? entryWanted : entryWanted;
    if (cut === null) return fade(exitWanted(3), 'beatmatch', 'no usable beat near the seam');
    if (move === 'cut_on_one') {
      const d = CUT_DECLICK_SECONDS;
      const events: SeamEvent[] = [
        { deck: 'b', kind: 'start', at: cut - d, sourceAt: Math.max(0, entry - d) },
        { deck: 'a', kind: 'gain', at: cut - d * 0.25, value: 1 },
        { deck: 'a', kind: 'gain', at: cut + d, value: 0 },
        { deck: 'b', kind: 'gain', at: cut - d, value: 0 },
        { deck: 'b', kind: 'gain', at: cut - d * 0.25, value: 1 },
        { deck: 'a', kind: 'stop', at: cut + d + 1e-6 },
      ];
      return done(finish(events, cut - d, d * 1.25, move, degraded, false));
    }
    if (move === 'echo_out') {
      // A's last beat rings on in time while B lands under it; there is no gap
      const sendFrom = cut - beat;
      const events: SeamEvent[] = [
        { deck: 'b', kind: 'start', at: cut, sourceAt: entry },
        { deck: 'a', kind: 'gain', at: cut - 0.005, value: 1 },
        { deck: 'a', kind: 'gain', at: cut + 0.02, value: 0 },
        ...gainEvents('b', fadeInPoints(cut, cut + 0.02, 8)),
        { deck: 'a', kind: 'send', effect: 'echo', at: sendFrom - 0.02, value: 0 },
        { deck: 'a', kind: 'send', effect: 'echo', at: sendFrom, value: 1 },
        { deck: 'a', kind: 'send', effect: 'echo', at: cut, value: 1 },
        { deck: 'a', kind: 'send', effect: 'echo', at: cut + 0.02, value: 0 },
        { deck: 'a', kind: 'stop', at: cut + 0.05 },
      ];
      return done({ ...finish(events, cut, 0.02, move, degraded, false, true), effects: { echo: echoFor(beat) } });
    }
    // reverb_wash: only A's last two beats go into the room, and A fades over one beat
    const events: SeamEvent[] = [
      { deck: 'b', kind: 'start', at: cut, sourceAt: entry },
      { deck: 'a', kind: 'gain', at: cut - 0.01, value: 1 },
      { deck: 'a', kind: 'gain', at: cut + beat, value: 0 },
      ...gainEvents('b', fadeInPoints(cut, cut + beat / 2, SCHEDULE_CURVE_STEPS)),
      { deck: 'a', kind: 'send', effect: 'wash', at: cut - beat * 2, value: 0 },
      { deck: 'a', kind: 'send', effect: 'wash', at: cut, value: 1 },
      { deck: 'a', kind: 'send', effect: 'wash', at: cut + beat, value: 1 },
      { deck: 'a', kind: 'send', effect: 'wash', at: cut + beat + 0.05, value: 0 },
      { deck: 'a', kind: 'stop', at: cut + beat + 0.05 },
    ];
    return done({ ...finish(events, cut, beat, move, degraded, false, true), effects: { wash: washFor() } });
  }

  if (!confident(b)) return fade(exitWanted(3), 'beatmatch', unsure(b, 'the incoming song'));
  const gap = Math.abs(a.tempo.bpm / b.tempo.bpm - 1);
  // within local mode's B-only absorb, B's speed is nudged to A's tempo, so the grids don't drift
  const nudge = abilities.varispeed?.ok && gap >= 0.0005 && gap <= MAX_VARISPEED ? a.tempo.bpm / b.tempo.bpm : 1;
  const drift = nudge === 1 ? gap : 0;

  let style: SeamMove = move;
  if ((style === 'bass_swap_blend' || style === 'filter_sweep') && !abilities.eqFilters.ok) {
    degraded.push({ wanted: 'eq', instead: 'blend', reason: abilities.eqFilters.reason });
    style = 'blend';
  }
  const wantedBars = Math.max(1, Math.round(bars ?? DEFAULT_BARS[style] ?? 8));
  // the overlap has to end inside A, after the settle rule and a snap of up to one beat
  const room = roomAfter(beat);
  const fitted = barsThatFit(wantedBars, beat, drift, room);
  if (fitted === 0 && barsThatFit(wantedBars, beat, drift) > 0) {
    return fade(exitWanted(3), 'overlap', 'the song is too short after the 30 s settle rule for a beatmatched overlap');
  }
  if (fitted === 0) {
    return fade(exitWanted(3), 'stretch', `the tempos are ${percent(gap)} percent apart and this browser has no time-stretch to close the gap`);
  }
  if (fitted < wantedBars) {
    const reason = fitted < barsThatFit(wantedBars, beat, drift)
      ? 'the song ends too soon after the 30 s settle rule for a longer overlap'
      : fitted < barsThatFit(wantedBars, beat, 0)
        ? `the tempos are ${percent(gap)} percent apart, more than a speed nudge should cover, so a longer overlap would drift off the beat`
        : `a browser seam window is at most ${MAX_WINDOW_SECONDS} s`;
    degraded.push({ wanted: `${wantedBars} bars`, instead: `${fitted} bars`, reason });
  }
  const window = fitted * BEATS_PER_BAR * beat;
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
    const swap = start + Math.max(1, Math.round(fitted * 0.5)) * (window / fitted);
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
  const scheduled: SeamSchedule = { ...finish(events, start, window, style, degraded, style !== 'blend'), bars: fitted };
  if (nudge !== 1) scheduled.rate = { value: nudge, holdUntil: end, rampUntil: end + VARISPEED_RAMP_BEATS * beat };
  return done(scheduled);
}

function finish(events: SeamEvent[], start: number, window: number, style: string, degraded: SeamDegrade[], moves: boolean, effects = false): SeamSchedule {
  events.sort((left, right) => left.at - right.at);
  const implementation = `${SEAMS_IMPLEMENTATION}+${SEAM_SCRIPT_IMPLEMENTATION}${moves ? `+${SEAM_MOVES_IMPLEMENTATION}` : ''}${effects ? `+${SEAM_EFFECTS_IMPLEMENTATION}` : ''}`;
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
