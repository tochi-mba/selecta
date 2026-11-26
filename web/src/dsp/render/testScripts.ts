import type { RenderSeamResponse } from '../workers/renderWorker';
import type { SongAudio } from './seamMaker';
import type { AuditFacts, Option } from './repair';

/** Test doubles for the seam maker and the device studio: transition scripts as the planner sends
 * them, decoded songs, and a render worker's answers, all small and made by hand. */

export const RATE = 44_100;

/** One part of a script's JSON: `song` heard from `sourceStart` for `duration` seconds at real speed. */
function part(song: number, sourceStart: number, duration: number, gain: [number, number][], role: 'mix' | 'stem' = 'mix', rate = 1) {
  return {
    source: role === 'mix' ? { song, role: 'mix' } : { song, role: 'stem', stem: 'drums', window: { start: 0, duration: 120 } },
    window_origin: 0,
    facts: { gain_db: -3 },
    warp: { output: [0, duration], source: [sourceStart, sourceStart + duration * rate] },
    gain, low: [[0, 1]], mid: [[0, 1]], high: [[0, 1]],
    highpass: null, lowpass: null, echo: null, echo_send: null, wash: null, wash_send: null,
    render_from: null, render_until: null, follows_b: false,
  };
}

export type ScriptShape = {
  a?: number;
  b?: number;
  duration?: number;
  /** Where in A the clip begins, and where in B it starts reading. */
  aStart?: number;
  bStart?: number;
  beats?: boolean;
  style?: string;
  stem?: boolean;
  /** B's speed through the clip; 1 is real time. */
  bRate?: number;
  wordplay?: boolean;
};

/** A cut half way through the clip, as JSON text (schema 1). */
export function scriptText(shape: ScriptShape = {}): string {
  const { a = 1, b = 2, duration = 4, aStart = 10, bStart = 0, beats = false, style = 'cut_on_one', stem = false, bRate = 1, wordplay = false } = shape;
  const half = duration / 2;
  return JSON.stringify({
    schema: 1, facts_version: 1, style, duration, overlap: [half, half], expects_beats_aligned: beats, quiet_allowed: 0,
    a: part(a, aStart, duration, [[0, 1], [half, 1], [half + 0.01, 0]], stem ? 'stem' : 'mix'),
    b: part(b, bStart, duration, [[0, 0], [half, 0], [half + 0.01, 1]], 'mix', bRate),
    extras: [],
    meta: wordplay ? { wordplay: true } : {},
  });
}

export const option = (move: string, bars: number, exitBar: number, entryBar = 0): Option => ({
  move, bars, exitCue: [exitBar, exitBar * 2, 'phrase', 0.8, 0], entryCue: [entryBar, entryBar * 2, 'phrase', 0.8, 0],
});

/** A song of `seconds` at `value` in both channels, at its level. */
export function song(songId: number, seconds = 60, value = 0.1, level = 1, sampleRate = RATE): SongAudio {
  const length = Math.round(seconds * sampleRate);
  const left = new Float32Array(length).fill(value);
  const right = new Float32Array(length).fill(value);
  return { songId, level, audio: { length, sampleRate, numberOfChannels: 2, getChannelData: (channel) => (channel === 0 ? left : right) } };
}

export const PASSED: AuditFacts = { passed: true, failures: [] };
export const failed = (name: string, value: number, limit: number, fix: string | null): AuditFacts => ({ passed: false, failures: [{ name, value, limit, fix }] });

/** A worker's answer for a script: a clip of exactly the script's length at `value`. */
export function ready(script: string, facts: AuditFacts, options: { value?: number; beatOffset?: number | null; length?: number } = {}): RenderSeamResponse {
  const duration = JSON.parse(script).duration as number;
  const length = options.length ?? Math.round(duration * RATE);
  return {
    id: 1, status: 'ready', implementation: 'web-render-1+wsola-stretch-v1', sampleRate: RATE,
    clip: [new Float32Array(length).fill(options.value ?? 0.1), new Float32Array(length).fill(options.value ?? 0.1)],
    report: { checks: [] }, facts, driftMs: { a: 0, b: 0, nudge: 0 }, beatOffset: options.beatOffset ?? null,
  };
}
