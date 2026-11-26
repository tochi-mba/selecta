/** Measure a rendered transition before anyone hears it: the ten checks of
 * src/selecta/audit/checks.py `audit()`, in its order, with its thresholds, rounding and fixes,
 * and `audit_facts` for the repair rule (docs/engineering/device-render.md).
 *
 * Vocal spans: a script from JSON carries no lyrics, so the studio passes the singing it sensed
 * (`{a: [[start, end], ...], b: [...]}` in song seconds). Without spans for both sides the check
 * takes the careful path, exactly as the Desktop's audit does for a script with no file to hear.
 */

import { excessRoughness, HARMONY_LIMIT } from './auditHarmony';
import type { Rendered } from './engine';
import { monoOf, transientEnvelope } from './envelope';
import { type Channels, LOW_SPLIT_HZ, zeroPhaseLowpass } from './filters';
import { arange, argmax, f32, interp, meanF32, percentile, pyRound } from './npy';
import { truePeakDb } from './peakLimit';
import type { AuditFacts } from './repair';
import { Curve, type Part, SAMPLE_RATE, type TransitionScript } from './script';

export const BEAT_LIMIT_MS = 20.0;
export const MIN_BEATS_MEASURED = 4;
export const MIN_NUDGE_MS = 5.0;
export const MAX_NUDGE_SPREAD_MS = 30.0;
export const VOCAL_OVERLAP_LIMIT = 2.0;
export const QUIET_LIMIT_SECONDS = 1.2;
export const MIN_ENERGY_RATIO = 0.22;
export const ENTRY_LEVEL_LIMIT_DB = 2.5;
export const LEVEL_FALL_LIMIT_DB = 3.5;
export const TRUE_PEAK_LIMIT_DB = -1.0;
export const LOW_CLASH_LIMIT = 0.15;
export const STRETCH_LIMIT = 0.08;

export interface Check {
  name: string;
  passed: boolean;
  value: number;
  limit: number;
  unit: string;
  fix: string | null;
  detail: string;
}

export interface AuditReport {
  checks: Check[];
}

export type VocalSpans = { a?: ReadonlyArray<readonly [number, number]>; b?: ReadonlyArray<readonly [number, number]> };

const check = (name: string, passed: boolean, value: number, limit: number, unit = '', fix: string | null = null, detail = ''): Check => ({
  name,
  passed,
  value,
  limit,
  unit,
  fix,
  detail,
});

export const reportPassed = (report: AuditReport): boolean => report.checks.every((item) => item.passed);

/** `audit_facts`: whether it passed, and each failed check's name, value, limit and fix. */
export function auditFacts(report: AuditReport): AuditFacts {
  return {
    passed: reportPassed(report),
    failures: report.checks.filter((item) => !item.passed).map((item) => ({ name: item.name, value: item.value, limit: item.limit, fix: item.fix })),
  };
}

/** `_audible_window`: fader samples at or above the threshold (compared in float32). */
function audible(part: Part, count: number, threshold: number): Uint8Array {
  const gain = part.gain.sample(count);
  const bar = f32(threshold);
  return Uint8Array.from(gain, (value) => (value >= bar ? 1 : 0));
}

function sliceMax(values: Float32Array, from: number, to: number): number {
  let largest = -Infinity;
  for (let index = from; index < Math.min(to, values.length); index += 1) if (values[index] > largest) largest = values[index];
  return largest;
}

/** `_beat_differences`: how many ms later A's beats land than B's, beat by beat. */
export function beatDifferences(rendered: Rendered): number[] {
  const script = rendered.script;
  const period = script.meta.period as number;
  const [start, end] = script.overlap;
  const count = rendered.audio[0].length;
  const audibleA = audible(script.a, count, 0.2);
  const audibleB = audible(script.b, count, 0.2);
  const envA = transientEnvelope(monoOf(rendered.aDry));
  const envB = transientEnvelope(monoOf(rendered.bDry));
  const hop = 128 / SAMPLE_RATE;
  const reach = Math.trunc(0.045 / hop);
  const topA = percentile(envA, 92, true);
  const topB = percentile(envB, 92, true);
  const differences: number[] = [];
  for (const beatTime of arange(start, end, period)) {
    const sample = Math.trunc(beatTime * SAMPLE_RATE);
    const frame = Math.trunc(beatTime / hop);
    if (sample >= count || !(audibleA[sample] && audibleB[sample]) || frame + reach >= Math.min(envA.length, envB.length)) continue;
    const lo = Math.max(frame - reach, 0);
    const hi = frame + reach + 1;
    if (sliceMax(envA, lo, hi) < topA || sliceMax(envB, lo, hi) < topB) continue;
    differences.push((argmax(envA, lo, hi) - lo - (argmax(envB, lo, hi) - lo)) * hop * 1000.0);
  }
  return differences;
}

/** `beat_offset`: seconds to delay B by to line the beats up, when they are apart by a steady
 * amount; null when they scatter or are already close. */
export function beatOffset(rendered: Rendered): number | null {
  const differences = beatDifferences(rendered);
  if (differences.length < MIN_BEATS_MEASURED) return null;
  const low = percentile(differences, 25);
  const middle = percentile(differences, 50);
  const high = percentile(differences, 75);
  if (Math.abs(middle) < MIN_NUDGE_MS || high - low > MAX_NUDGE_SPREAD_MS) return null;
  return middle / 1000.0;
}

function beatAlignment(rendered: Rendered): Check | null {
  const script = rendered.script;
  if (!script.expectsBeatsAligned) return null;
  const differences = beatDifferences(rendered);
  if (differences.length < MIN_BEATS_MEASURED) return check('beat alignment', true, 0.0, BEAT_LIMIT_MS, 'ms', null, 'too few clean beats to measure');
  const value = percentile(differences.map(Math.abs), 75);
  const limit = typeof script.meta.beat_limit_ms === 'number' ? script.meta.beat_limit_ms : BEAT_LIMIT_MS;
  return check('beat alignment', value <= limit, pyRound(value, 1), limit, 'ms', 'change_recipe', `${differences.length} beats measured`);
}

function vocalGains(script: TransitionScript): Record<string, Curve> {
  const gains = script.meta.vocal_gains;
  const out: Record<string, Curve> = {};
  if (gains && typeof gains === 'object' && !Array.isArray(gains) && !(gains instanceof Curve)) {
    for (const [side, curve] of Object.entries(gains)) if (curve instanceof Curve) out[side] = curve;
  }
  return out;
}

/** `_given_spans`: each named side uses its spans; a side with neither spans nor lyrics leaves
 * nothing, which sends the check down the careful path. */
function givenSpans(script: TransitionScript, spans: VocalSpans): Record<string, ReadonlyArray<readonly [number, number]>> {
  const found: Record<string, ReadonlyArray<readonly [number, number]>> = {};
  for (const side of ['a', 'b'] as const) if (spans[side] !== undefined) found[side] = spans[side] as ReadonlyArray<readonly [number, number]>;
  for (const [side, part] of [['a', script.a], ['b', script.b]] as const) if (!(side in found) && !part.facts.vocalsKnown) return {};
  return found;
}

function vocalOverlap(script: TransitionScript, spans: VocalSpans): Check | null {
  const [start, end] = script.overlap;
  if (end - start < 0.5 || script.meta.wordplay) return null;
  const step = 0.05;
  const times = arange(start, end, step);
  const gains = vocalGains(script);
  const sensed = givenSpans(script, spans);
  const known = script.a.facts.vocalsKnown && script.b.facts.vocalsKnown;
  const anySensed = Object.keys(sensed).length > 0;
  if (!known && !anySensed) {
    return check('vocal overlap', end - start <= 8.0, 0.0, VOCAL_OVERLAP_LIMIT, 's', 'shorten', "vocals unknown for one song, so a long overlap isn't safe");
  }
  const singing = (part: Part, side: 'a' | 'b'): Uint8Array => {
    const gain = gains[side] ?? part.gain;
    const lines = side in sensed ? sensed[side] : part.facts.lines;
    return Uint8Array.from(times, (time) => {
      if (!(interp(time, gain.times, gain.values) >= 0.25)) return 0;
      const source = part.warp.sourceAt(time);
      return lines.some(([from, to]) => source >= from && source <= to) ? 1 : 0;
    });
  };
  const a = singing(script.a, 'a');
  const b = singing(script.b, 'b');
  let both = 0;
  for (let index = 0; index < times.length; index += 1) both += a[index] & b[index];
  const seconds = both * step;
  return check('vocal overlap', seconds <= VOCAL_OVERLAP_LIMIT, pyRound(seconds, 2), VOCAL_OVERLAP_LIMIT, 's', 'shorten', anySensed ? 'measured from the separated voice' : '');
}

function phraseIntegrity(script: TransitionScript): Check {
  const [start, end] = script.overlap;
  let exitSource = script.a.warp.sourceAt(end);
  if (end - start < 1.5 && 'cut' in script.meta) exitSource = script.a.warp.sourceAt(script.meta.cut as number);
  if (script.meta.wordplay) return check('phrase integrity', true, 0.0, 0.0, '', null, 'cut on aligned words');
  const gains = vocalGains(script);
  const gainAt = (side: string, time: number): number => (gains[side] === undefined ? 1.0 : gains[side].at(time));
  const midline = (lines: Part['facts']['lines'], at: number): boolean => lines.some(([from, to]) => from + 0.2 < at && at < to - 0.2);
  const aMidline = gainAt('a', end) >= 0.25 && script.a.facts.vocalsKnown && midline(script.a.facts.lines, exitSource);
  const entrySource = script.b.warp.source[0];
  const bMidline = gainAt('b', start) >= 0.25 && script.b.facts.vocalsKnown && midline(script.b.facts.lines, entrySource);
  return check(
    'phrase integrity',
    !(aMidline || bMidline),
    aMidline || bMidline ? 1.0 : 0.0,
    0.0,
    '',
    'move_cue',
    (aMidline ? 'A cut mid-line. ' : '') + (bMidline ? 'B starts mid-line.' : ''),
  );
}

/** RMS of each `frame`-sample block of a mono float32 signal, as numpy's row means. */
function blockRms(mono: Float32Array, frame: number): Float32Array {
  const blocks = Math.floor(mono.length / frame);
  return Float32Array.from({ length: blocks }, (_, block) => f32(Math.sqrt(meanF32(mono, block * frame, frame, true))));
}

function quietTime(rendered: Rendered): Check {
  const mono = monoOf(rendered.audio);
  const rms = blockRms(mono, Math.trunc(0.05 * SAMPLE_RATE));
  const mean = meanF32(rms) || 1e-9;
  const scale = f32(mean);
  const [start, end] = rendered.script.overlap;
  const margin = 2.0;
  const lo = Math.max(Math.trunc((start - margin) / 0.05), 0);
  const hi = Math.min(Math.trunc((end + margin) / 0.05) + 1, rms.length);
  const bar = f32(MIN_ENERGY_RATIO);
  let quietFrames = 0;
  for (let index = lo; index < hi; index += 1) if (f32(rms[index] / scale) < bar) quietFrames += 1;
  const quiet = quietFrames * 0.05;
  const allowed = QUIET_LIMIT_SECONDS + rendered.script.quietAllowed;
  return check('quiet time', quiet <= allowed, pyRound(quiet, 2), allowed, 's', 'close_gap');
}

/** `20 log10(max(rms, 1e-6))` of a stretch of stereo audio, its mean square taken over the
 * interleaved samples as numpy flattens a (samples, 2) array. */
export function levelDb(audio: Channels, from: number, to: number): number {
  const stop = Math.min(to, audio[0].length);
  const count = Math.max(0, stop - from);
  const interleaved = new Float32Array(2 * count);
  for (let index = 0; index < count; index += 1) {
    interleaved[2 * index] = audio[0][from + index];
    interleaved[2 * index + 1] = audio[1][from + index];
  }
  const rms = count === 0 ? NaN : f32(Math.sqrt(meanF32(interleaved, 0, 2 * count, true)));
  return 20.0 * Math.log10(Math.max(rms, 1e-6));
}

const span = (from: number, to: number, length: number): number => Math.max(0, Math.min(to, length) - from);

function entryLevel(rendered: Rendered): Check {
  const [start, end] = rendered.script.overlap;
  const window = Math.trunc(3.0 * SAMPLE_RATE);
  const aEnd = Math.trunc(start * SAMPLE_RATE);
  const bBegin = Math.trunc(end * SAMPLE_RATE);
  const length = rendered.audio[0].length;
  const beforeFrom = Math.max(0, aEnd - window);
  if (span(beforeFrom, aEnd, length) < SAMPLE_RATE || span(bBegin, bBegin + window, length) < SAMPLE_RATE) {
    return check('entry level', true, 0.0, ENTRY_LEVEL_LIMIT_DB, 'dB', null, 'too short');
  }
  const jump = levelDb(rendered.audio, bBegin, bBegin + window) - levelDb(rendered.audio, beforeFrom, aEnd);
  return check('entry level', jump <= ENTRY_LEVEL_LIMIT_DB, pyRound(jump, 2), ENTRY_LEVEL_LIMIT_DB, 'dB', 'move_cue');
}

function levelFall(rendered: Rendered): Check | null {
  const [start, end] = rendered.script.overlap;
  const length = rendered.audio[0].length;
  const beforeFrom = Math.max(0, Math.trunc((start - 3.0) * SAMPLE_RATE));
  const beforeTo = Math.trunc(start * SAMPLE_RATE);
  const afterFrom = Math.trunc((end + 1.0) * SAMPLE_RATE);
  const afterTo = Math.trunc((end + 8.0) * SAMPLE_RATE);
  if (span(beforeFrom, beforeTo, length) < SAMPLE_RATE || span(afterFrom, afterTo, length) < 2 * SAMPLE_RATE) return null;
  const fall = levelDb(rendered.audio, beforeFrom, beforeTo) - levelDb(rendered.audio, afterFrom, afterTo);
  return check('level fall', fall <= LEVEL_FALL_LIMIT_DB, pyRound(fall, 2), LEVEL_FALL_LIMIT_DB, 'dB', 'move_cue');
}

function lowClash(rendered: Rendered): Check | null {
  const [start, end] = rendered.script.overlap;
  if (end - start < 1.0) return null;
  const lo = Math.trunc(start * SAMPLE_RATE);
  const hi = Math.min(Math.trunc(end * SAMPLE_RATE), rendered.aDry[0].length);
  const lowMono = (audio: Channels): Float32Array =>
    monoOf(zeroPhaseLowpass(audio.map((channel) => channel.slice(lo, hi)), LOW_SPLIT_HZ));
  const frame = Math.trunc(0.1 * SAMPLE_RATE);
  const lowA = lowMono(rendered.aDry);
  const lowB = lowMono(rendered.bDry);
  if (lowA.length - (lowA.length % frame) === 0) return null;
  const rmsA = blockRms(lowA, frame);
  const rmsB = blockRms(lowB, frame);
  const reference = Math.max(Math.max(...rmsA), Math.max(...rmsB), 1e-6);
  const bar = f32(reference * 0.3);
  let fighting = 0;
  for (let index = 0; index < rmsA.length; index += 1) if (rmsA[index] > bar && rmsB[index] > bar) fighting += 1;
  const value = fighting / rmsA.length;
  return check('low end clash', value <= LOW_CLASH_LIMIT, pyRound(value, 3), LOW_CLASH_LIMIT, '', 'change_recipe');
}

function harmony(rendered: Rendered): Check | null {
  const [start, end] = rendered.script.overlap;
  const bars = typeof rendered.script.meta.bars === 'number' ? rendered.script.meta.bars : 0;
  if (end - start < 4.0 || bars < 4) return null;
  const excess = excessRoughness(rendered.aDry, rendered.bDry, Math.trunc(start * SAMPLE_RATE), Math.trunc(end * SAMPLE_RATE));
  const limit = bars >= 8 ? HARMONY_LIMIT : HARMONY_LIMIT * 1.5;
  return check('harmony', excess <= limit, pyRound(excess, 3), pyRound(limit, 3), '', 'shorten');
}

/** `audit(rendered, vocal_spans)`: every check in the Desktop's order. */
export function audit(rendered: Rendered, vocalSpans: VocalSpans = {}): AuditReport {
  const script = rendered.script;
  const report: AuditReport = { checks: [] };
  for (const item of [
    beatAlignment(rendered),
    vocalOverlap(script, vocalSpans),
    phraseIntegrity(script),
    quietTime(rendered),
    entryLevel(rendered),
    levelFall(rendered),
    lowClash(rendered),
    harmony(rendered),
  ]) {
    if (item !== null) report.checks.push(item);
  }
  const peak = truePeakDb(rendered.audio);
  report.checks.push(check('true peak', peak <= TRUE_PEAK_LIMIT_DB + 0.1, pyRound(peak, 2), TRUE_PEAK_LIMIT_DB, 'dBTP', 'change_recipe'));
  const stretch = Math.max(script.a.warp.maxStretch, script.b.warp.maxStretch);
  report.checks.push(check('stretch', stretch <= STRETCH_LIMIT, pyRound(stretch * 100, 2), STRETCH_LIMIT * 100, '%', 'change_recipe'));
  return report;
}
