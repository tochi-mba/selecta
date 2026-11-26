/** The device studio's loop for one transition (cloud.device_render, ADR-0479): the Desktop's
 * `planner/choose.py choose_transition` over the account planner's ranked options, with the second
 * take of `seam_making.tighten_beats` and the near-miss rule of `seams._best_move`, rendering and
 * auditing each take in the render worker (docs/engineering/device-studio-playback.md).
 *
 * - `repair.nextStep` says which option to try; each take is rendered and audited, its facts fed
 *   back; ACCEPT plays it, FALLBACK ends on the planner's fallback cut, itself rendered and checked.
 * - A take whose beats missed by a steady amount gets one second take with B moved by the measured
 *   gap (`takeStep` TIGHTEN, then KEEP the closer); only the kept take is counted, as on Desktop.
 * - An option this device cannot render (a stem source, more than a minute of stretched song, a move
 *   that needs word timing, a plan naming other songs, a plan that never came) is stepped over as
 *   the rule steps over a recipe that built no script: not rendered, not counted.
 * - A near miss (`goodEnough`) is held, and plays only when not even the cut comes out clean.
 * - Everything is bounded by `deadline`; past it, or when abandoned, there is no clip.
 *
 * Every take is rendered at the level each song really plays at here (engine/level.ts on the same
 * decode), not the account's loudness number, so the clip's edges meet the native songs level.
 * Pure apart from the injected renderer and script fetch, so it is tested with doubles.
 */

import type { RenderedClip } from '../seams';
import { STRETCH_MAX_WINDOW_SECONDS } from '../stretchLimits';
import type { RenderSeamResponse, RenderSeamSource } from '../workers/renderWorker';
import { RENDER_IMPLEMENTATION } from './ids';
import { roundHalfEven } from './npy';
import { ACCEPT, type Attempted, type AuditFacts, goodEnough, MAX_REPAIRS, nextStep, type Option, takeStep, TIGHTEN, TRY } from './repair';
import { aSourceStart, bSourceEnd, heardWarp, type Part, SAMPLE_RATE, type TransitionScript, Warp } from './script';
import { scriptFromJson, scriptToJson, writeSourceRef } from './scriptJson';
import { neededWindows } from './windows';

/** Planner moves that need the timing of sung words, which a device's facts do not carry
 * (cloud/plannerMoves.ts: exits.py throws A's last sung word into a delay). */
export const NEEDS_WORDS: ReadonlySet<string> = new Set(['delay_throw']);
/** A clip may be at most this much louder than the louder of the songs around it. */
export const LOUDER_ALLOWED_DB = 2;
/** ...and at least this much as loud as the quieter, or it is close to silence. */
export const QUIETER_ALLOWED_DB = 20;
/** How much native song either side of the clip its loudness is compared with. */
const NEIGHBOUR_SECONDS = 10;

/** A decoded song as the maker reads it: an AudioBuffer, or a double in tests. */
export type SongAudio = {
  songId: number;
  audio: { length: number; sampleRate: number; numberOfChannels: number; getChannelData(channel: number): Float32Array };
  /** The linear level it plays at here (1 when unmeasured). */
  level: number;
};

/** One of the planner's ranked options; `script` undefined when the answer did not carry it (it
 * is fetched by index), null when the recipe built none there. */
export type RankedOption = { index: number; option: Option; script?: string | null };

export type MakerRender = (script: string, sources: RenderSeamSource[], options: { signal?: AbortSignal; timeoutMs: number }) => Promise<RenderSeamResponse>;

export type MakerInput = {
  options: readonly RankedOption[];
  fallback: { option: Option; script: string | null } | null;
  maxRepairs?: number;
  a: SongAudio;
  b: SongAudio;
  render: MakerRender;
  fetchScript(index: number): Promise<string | null>;
  /** Epoch milliseconds by which a clip must be made. */
  deadline: number;
  now?: () => number;
  signal?: AbortSignal;
};

/** One option as it went: rendered (its kept take's facts), or stepped over and why. */
export type TakeRecord = { option: number | 'fallback'; move: string; facts: AuditFacts | null; skipped?: string; tightened?: boolean; ms: number };

export type MadeSeam = {
  status: 'clip';
  rendered: RenderedClip;
  move: string;
  option: number | 'fallback';
  facts: AuditFacts;
  passed: boolean;
  nearMiss: boolean;
  fellBack: boolean;
  attempts: TakeRecord[];
  tookMs: number;
  implementation: string;
};
export type NoSeam = { status: 'none'; reason: string; attempts: TakeRecord[]; tookMs: number; implementation: string };

type Ready = { kind: 'ready'; script: TransitionScript; clip: Float32Array[]; facts: AuditFacts; implementation: string; tightened: boolean };
type Take = Ready | { kind: 'skipped'; reason: string } | { kind: 'stopped'; reason: string };

const dbOf = (level: number): number => (level > 0 && Number.isFinite(level) ? 20 * Math.log10(level) : 0);

/** Why this device cannot render this script, or null. */
export function cannotRender(script: TransitionScript, move: string, a: SongAudio, b: SongAudio): string | null {
  const parts = [script.a, script.b, ...script.extras];
  if (parts.some((part) => part.source.role === 'stem')) return 'it needs a stem this device does not have';
  if (NEEDS_WORDS.has(move) || script.meta.wordplay === true) return 'it needs the timing of sung words';
  if (script.a.source.song !== a.songId || script.b.source.song !== b.songId || parts.some((part) => part.source.song !== a.songId && part.source.song !== b.songId)) {
    return 'its plan names other songs';
  }
  for (const part of parts) {
    const warp = heardWarp(part);
    if (!warp.isIdentity && warp.source[warp.source.length - 1] - warp.source[0] + 1 > STRETCH_MAX_WINDOW_SECONDS) {
      return 'it changes the speed of more than a minute of a song';
    }
  }
  return null;
}

/** The script with each part at the level its song plays at here. */
export function atLevels(script: TransitionScript, a: SongAudio, b: SongAudio): TransitionScript {
  const level = (part: Part): Part => ({ ...part, facts: { ...part.facts, gainDb: dbOf(part.source.song === a.songId ? a.level : b.level) } });
  return { ...script, a: level(script.a), b: level(script.b), extras: script.extras.map(level) };
}

/** `tighten_beats`' second take: every part of B's song read `offset` seconds earlier, so B plays
 * that much later (`Warp(part.warp.output, part.warp.source - offset)`). */
export function tightened(script: TransitionScript, offset: number): TransitionScript {
  const song = script.b.source.song;
  const later = (part: Part): Part => (part.source.song !== song ? part : { ...part, warp: new Warp(part.warp.output, part.warp.source.map((time) => time - offset)) });
  return { ...script, b: later(script.b), extras: script.extras.map(later) };
}

/** The windows of the two decoded songs this script reads, stereo, made for this call alone. */
export function sourcesFor(script: TransitionScript, a: SongAudio, b: SongAudio): RenderSeamSource[] {
  return neededWindows(script).map(({ ref, from, to }) => {
    const song = ref.song === a.songId ? a.audio : b.audio;
    const end = Math.min(Math.max(to, from), song.length);
    const left = song.getChannelData(0).slice(from, end);
    const right = song.numberOfChannels > 1 ? song.getChannelData(1).slice(from, end) : left.slice();
    return { ref: writeSourceRef(ref), channels: [left, right], offset: from, length: song.length };
  });
}

function rms(channels: readonly Float32Array[], from: number, to: number, scale = 1): number {
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    for (let index = Math.max(0, from); index < Math.min(to, channel.length); index += 1) {
      const value = channel[index] * scale;
      sum += value * value;
      count += 1;
    }
  }
  return count ? Math.sqrt(sum / count) : 0;
}

const songChannels = (song: SongAudio['audio']): Float32Array[] => Array.from({ length: Math.min(2, song.numberOfChannels) }, (_, channel) => song.getChannelData(channel));
const decibels = (value: number): number => 20 * Math.log10(Math.max(value, 1e-9));

/** Whether the clip is much louder or quieter than the native songs it joins, at their levels. */
export function loudnessProblem(clip: readonly Float32Array[], a: SongAudio, aStart: number, b: SongAudio, bEnd: number): string | null {
  const span = Math.round(NEIGHBOUR_SECONDS * SAMPLE_RATE);
  const before = decibels(rms(songChannels(a.audio), aStart - span, aStart, a.level));
  const after = decibels(rms(songChannels(b.audio), bEnd, bEnd + span, b.level));
  const level = decibels(rms(clip, 0, clip[0].length));
  if (level > Math.max(before, after) + LOUDER_ALLOWED_DB) return 'it came out louder than the songs around it';
  if (level < Math.min(before, after) - QUIETER_ALLOWED_DB) return 'it came out close to silent';
  return null;
}

/** Make the transition from A into B, or say why there is none. Never throws. */
export async function makeSeam(input: MakerInput): Promise<MadeSeam | NoSeam> {
  const now = input.now ?? (() => Date.now());
  const started = now();
  const attempts: TakeRecord[] = [];
  const heard: Attempted[] = [];
  const implementation = RENDER_IMPLEMENTATION;
  const none = (reason: string): NoSeam => ({ status: 'none', reason, attempts, tookMs: now() - started, implementation });
  const { a, b } = input;
  if (a.audio.sampleRate !== SAMPLE_RATE || b.audio.sampleRate !== SAMPLE_RATE) {
    return none(`the songs play at ${a.audio.sampleRate} Hz here, and transitions are made at ${SAMPLE_RATE} Hz`);
  }

  const renderOnce = async (script: TransitionScript): Promise<RenderSeamResponse | { status: 'stopped'; reason: string }> => {
    const left = input.deadline - now();
    if (input.signal?.aborted) return { status: 'stopped', reason: 'it was no longer wanted' };
    if (left <= 0) return { status: 'stopped', reason: 'it ran out of time' };
    try {
      return await input.render(scriptToJson(script), sourcesFor(script, a, b), { signal: input.signal, timeoutMs: left });
    } catch (problem) {
      return { status: 'stopped', reason: input.signal?.aborted ? 'it was no longer wanted' : `it ran out of time (${problem instanceof Error ? problem.message : String(problem)})` };
    }
  };

  /** Render and audit one script, with the beats tightened once when they missed. */
  const take = async (text: string | null, move: string): Promise<Take> => {
    if (!text) return { kind: 'skipped', reason: 'the planner built no transition there' };
    let script: TransitionScript;
    try {
      script = scriptFromJson(text);
    } catch {
      return { kind: 'skipped', reason: 'its plan could not be read' };
    }
    const why = cannotRender(script, move, a, b);
    if (why) return { kind: 'skipped', reason: why };
    script = atLevels(script, a, b);
    const first = await renderOnce(script);
    if (first.status === 'stopped') return { kind: 'stopped', reason: first.reason };
    if (first.status !== 'ready') return { kind: 'skipped', reason: `it could not be made here: ${first.reason}` };
    const kept: Ready = { kind: 'ready', script, clip: first.clip, facts: first.facts, implementation: first.implementation, tightened: false };
    if (takeStep(first.facts).action !== TIGHTEN || first.beatOffset === null) return kept;
    const again = tightened(script, first.beatOffset);
    const second = await renderOnce(again);
    if (second.status === 'stopped') return second.reason === 'it was no longer wanted' ? { kind: 'stopped', reason: second.reason } : kept;
    if (second.status !== 'ready') return kept;
    return takeStep(first.facts, second.facts).take === 1
      ? { kind: 'ready', script: again, clip: second.clip, facts: second.facts, implementation: second.implementation, tightened: true }
      : kept;
  };

  const finish = (made: Ready, option: number | 'fallback', move: string, fellBack: boolean): MadeSeam | NoSeam => {
    const { script, clip } = made;
    if (clip.length !== 2 || clip[0].length !== roundHalfEven(script.duration * SAMPLE_RATE) || clip[1].length !== clip[0].length) {
      return none('the transition came back the wrong length');
    }
    const aStartSample = roundHalfEven(aSourceStart(script) * SAMPLE_RATE);
    const bEndSample = roundHalfEven(bSourceEnd(script) * SAMPLE_RATE);
    const loud = loudnessProblem(clip, a, aStartSample, b, bEndSample);
    if (loud) return none(loud);
    const rendered: RenderedClip = {
      channels: clip,
      sampleRate: SAMPLE_RATE,
      aStartSample,
      bEndSample,
      levels: { a: a.level, b: b.level },
      switchAt: script.overlap[1],
      bWarp: { output: Array.from(script.b.warp.output), source: Array.from(script.b.warp.source) },
      implementation: made.implementation,
    };
    return {
      status: 'clip', rendered, move, option, facts: made.facts, passed: made.facts.passed,
      nearMiss: !made.facts.passed && goodEnough(made.facts), fellBack, attempts, tookMs: now() - started, implementation: made.implementation,
    };
  };

  const options = input.options.map((ranked) => ranked.option);
  let held: { made: Ready; option: number; move: string } | null = null;
  let step = nextStep(options, heard, input.maxRepairs ?? MAX_REPAIRS);
  while (step.action === TRY && step.option !== null) {
    const index = step.option;
    const ranked = input.options[index];
    const move = ranked.option.move;
    const began = now();
    let text = ranked.script;
    if (text === undefined) {
      try {
        text = await input.fetchScript(ranked.index);
      } catch {
        text = null;
      }
    }
    const made = await take(text ?? null, move);
    if (made.kind === 'stopped') return none(made.reason);
    if (made.kind === 'skipped') {
      attempts.push({ option: index, move, facts: null, skipped: made.reason, ms: now() - began });
      heard.push({ option: index, audit: null });
    } else {
      attempts.push({ option: index, move, facts: made.facts, tightened: made.tightened, ms: now() - began });
      heard.push({ option: index, audit: made.facts });
      if (!made.facts.passed && held === null && goodEnough(made.facts)) held = { made, option: index, move };
    }
    step = nextStep(options, heard, input.maxRepairs ?? MAX_REPAIRS);
    if (step.action === ACCEPT && made.kind === 'ready') return finish(made, index, move, false);
  }

  // the cut: a clean one beats a near miss, which plays only when not even the cut is clean
  const began = now();
  const cutMove = input.fallback?.option.move ?? 'cut_on_one';
  const cut = input.fallback ? await take(input.fallback.script, cutMove) : { kind: 'skipped' as const, reason: 'the planner sent no fallback' };
  if (cut.kind === 'stopped') return held ? finish(held.made, held.option, held.move, false) : none(cut.reason);
  attempts.push({ option: 'fallback', move: cutMove, facts: cut.kind === 'ready' ? cut.facts : null, skipped: cut.kind === 'skipped' ? cut.reason : undefined, tightened: cut.kind === 'ready' ? cut.tightened : undefined, ms: now() - began });
  if (cut.kind === 'ready' && (cut.facts.passed || held === null)) return finish(cut, 'fallback', cutMove, true);
  if (held) return finish(held.made, held.option, held.move, false);
  return none(cut.kind === 'skipped' ? `no transition could be made: ${cut.reason}` : 'no transition could be made');
}
