/** Plays a TransitionScript into a clip: the browser's twin of `render` and `in_context` in
 * src/selecta/render/engine.py, stage for stage (docs/engineering/device-render.md).
 *
 * Pure functions with no DOM or Web Audio, so they run in a worker and under a test runner. Audio
 * comes from a `SourceProvider` the caller writes; the time-stretch is injected (warpStretch.ts).
 */

import type { StretchUnsupported } from '../stretch';
import { echoTail, reverbTail } from './effects';
import { fineWarp, monoOf, onsetOffset } from './envelope';
import { type Channels, splitBands, sweepFilter } from './filters';
import { RENDER_IMPLEMENTATION } from './ids';
import { f32, interp, pyRound, roundHalfEven } from './npy';
import { limit } from './peakLimit';
import { aSourceStart, bSourceEnd, heardWarp, linearGain, type Part, SAMPLE_RATE, type SourceRef, type TransitionScript } from './script';
import { stretchToWarp, type Stretcher } from './warpStretch';

/** Decoded audio for one source reference, at 44,100 Hz. `offset` is the source sample where
 * `channels[0][0]` sits, so a caller may pass only the window a part reads; `length` is the whole
 * source's length in samples (the song's, or the stem window's), when the window ends early. */
export interface SourceAudio {
  channels: Float32Array[];
  sampleRate: number;
  offset?: number;
  length?: number;
}

export interface SourceProvider {
  samples(ref: SourceRef): SourceAudio;
}

export interface Rendered {
  script: TransitionScript;
  audio: Channels;
  /** What the audit hears as each side (with `meta.stem_lanes`, all of a side's lanes). */
  aDry: Channels;
  bDry: Channels;
  /** Rounded to 2 places as Python's `drift_ms`: the stretch drift of A and B, and the nudge. */
  driftMs: { a: number; b: number; nudge: number };
  nudgeSeconds: number;
  implementation: string;
}

export type RenderResult = ({ status: 'ready' } & Rendered) | StretchUnsupported;

export type StageName = 'placed_a' | 'placed_b' | 'dry_a' | 'tails_a' | 'dry_b' | 'tails_b' | 'mixed';

export interface RenderOptions {
  /** Called with each intermediate signal, for the golden stage tests. */
  onStage?: (name: StageName, audio: Channels) => void;
}

const SEAM_SECONDS = 0.03;
const intRound = roundHalfEven;

function checked(source: SourceAudio): { channels: Channels; offset: number; length: number } {
  if (source.sampleRate !== SAMPLE_RATE) throw new Error(`the renderer works at ${SAMPLE_RATE} Hz, not ${source.sampleRate}`);
  if (source.channels.length !== 2) throw new Error('the renderer works on stereo audio');
  const offset = source.offset ?? 0;
  return { channels: source.channels, offset, length: source.length ?? offset + source.channels[0].length };
}

const zeros = (count: number): Channels => [new Float32Array(count), new Float32Array(count)];

/** `_part_audio`: the part's song placed on the output timeline, before any mixing moves. */
export function partAudio(part: Part, source: SourceAudio, count: number, stretcher: Stretcher): { status: 'ready'; audio: Channels; drift: number } | StretchUnsupported {
  const { channels, offset, length: sourceLength } = checked(source);
  const output = zeros(count);
  const warp = heardWarp(part);
  const startSample = intRound(warp.output[0] * SAMPLE_RATE);
  if (startSample < 0) throw new Error('a part starts before the clip');
  if (warp.isIdentity) {
    const begin = intRound((warp.source[0] - part.windowOrigin) * SAMPLE_RATE);
    const length = Math.min(count - startSample, sourceLength - begin, intRound((warp.output[warp.output.length - 1] - warp.output[0]) * SAMPLE_RATE));
    if (length > 0 && begin >= 0) {
      if (begin < offset || begin + length > offset + channels[0].length) throw new Error('the source window does not hold the audio this part reads');
      output.forEach((channel, c) => channel.set(channels[c].subarray(begin - offset, begin - offset + length), startSample));
    }
    return { status: 'ready', audio: output, drift: 0 };
  }
  const stretched = stretchToWarp(channels, offset, warp.output, warp.source, part.windowOrigin, stretcher);
  if (stretched.status !== 'ready') return stretched;
  const length = Math.min(stretched.audio[0].length, count - startSample);
  if (length > 0) output.forEach((channel, c) => channel.set(stretched.audio[c].subarray(0, length), startSample));
  return { status: 'ready', audio: output, drift: stretched.drift };
}

function multiply(audio: Channels, curve: Float32Array): Channels {
  return audio.map((channel) => {
    const out = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) out[index] = f32(channel[index] * curve[index]);
    return out;
  });
}

function addInto(target: Channels, other: Channels): void {
  target.forEach((channel, c) => {
    const add = other[c];
    for (let index = 0; index < channel.length; index += 1) channel[index] = f32(channel[index] + add[index]);
  });
}

/** `_apply_moves`: loudness gain, EQ, filters, sends, then the fader. */
export function applyMoves(part: Part, placed: Channels): { dry: Channels; tails: Channels } {
  const count = placed[0].length;
  const scale = linearGain(part.facts.gainDb);
  let signal: Channels = placed.map((channel) => {
    const out = new Float32Array(count);
    for (let index = 0; index < count; index += 1) out[index] = f32(channel[index] * scale);
    return out;
  });
  if (!(part.low.isConstant(1) && part.mid.isConstant(1) && part.high.isConstant(1))) {
    const [low, mid, high] = splitBands(signal);
    const lowGain = part.low.sample(count);
    const midGain = part.mid.sample(count);
    const highGain = part.high.sample(count);
    signal = low.map((channel, c) => {
      const out = new Float32Array(count);
      for (let index = 0; index < count; index += 1) {
        out[index] = f32(f32(f32(channel[index] * lowGain[index]) + f32(mid[c][index] * midGain[index])) + f32(high[c][index] * highGain[index]));
      }
      return out;
    });
  }
  if (part.highpass) signal = sweepFilter(signal, part.highpass.sample(count), true);
  if (part.lowpass) signal = sweepFilter(signal, part.lowpass.sample(count), false);
  const tails = zeros(count);
  if (part.echo && part.echoSend) {
    const { delaySeconds, feedback, wet, returnHighpassHz, dampLowpassHz } = part.echo;
    addInto(tails, echoTail(multiply(signal, part.echoSend.sample(count)), delaySeconds, feedback, wet, returnHighpassHz, dampLowpassHz, count));
  }
  if (part.wash && part.washSend) {
    const { decaySeconds, damping, wet, returnHighpassHz } = part.wash;
    addInto(tails, reverbTail(multiply(signal, part.washSend.sample(count)), decaySeconds, damping, wet, returnHighpassHz));
  }
  return { dry: multiply(signal, part.gain.sample(count)), tails };
}

/** `_pocket_lag`: the last few milliseconds between the two grids, heard over the overlap. */
export function pocketLag(script: TransitionScript, placedA: Channels, placedB: Channels): number {
  const lo = Math.trunc(script.overlap[0] * SAMPLE_RATE);
  const hi = Math.trunc(script.overlap[1] * SAMPLE_RATE);
  const count = placedB[0].length;
  if (!script.expectsBeatsAligned || hi - lo < 4 * SAMPLE_RATE || count - hi < SAMPLE_RATE) return 0;
  const end = Math.min(hi, count);
  const lag = onsetOffset(monoOf(placedA, lo, end), monoOf(placedB, lo, end));
  return lag === null || Math.abs(lag) < 0.001 ? 0 : lag;
}

/** `_slide`: B moved by the lag, the move fading out after the overlap so B still meets its own
 * audio at the clip's end. */
export function slide(script: TransitionScript, placed: Channels, lag: number): Channels {
  if (lag === 0) return placed;
  const count = placed[0].length;
  const hi = Math.trunc(script.overlap[1] * SAMPLE_RATE);
  const xp = [hi, count - 1];
  const fp = [1, 0];
  const positions = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    positions[index] = Math.min(Math.max(index + lag * SAMPLE_RATE * interp(index, xp, fp), 0), count - 1);
  }
  return fineWarp(placed, positions);
}

/** `render(script)`: every part placed, nudged, moved, summed and limited. */
export function renderScript(script: TransitionScript, sources: SourceProvider, stretcher: Stretcher, options: RenderOptions = {}): RenderResult {
  const stage = options.onStage ?? (() => undefined);
  const count = intRound(script.duration * SAMPLE_RATE);
  const implementation = `${RENDER_IMPLEMENTATION}+${stretcher.id}`;
  const placedA = partAudio(script.a, sources.samples(script.a.source), count, stretcher);
  if (placedA.status !== 'ready') return placedA;
  const placedB = partAudio(script.b, sources.samples(script.b.source), count, stretcher);
  if (placedB.status !== 'ready') return placedB;
  const nudge = pocketLag(script, placedA.audio, placedB.audio);
  const nudgedB = slide(script, placedB.audio, nudge);
  stage('placed_a', placedA.audio);
  stage('placed_b', nudgedB);
  const a = applyMoves(script.a, placedA.audio);
  const b = applyMoves(script.b, nudgedB);
  stage('dry_a', a.dry);
  stage('tails_a', a.tails);
  stage('dry_b', b.dry);
  stage('tails_b', b.tails);
  // dry_a + dry_b + tails_a + tails_b, left to right in float32
  const mixed = a.dry.map((channel) => Float32Array.from(channel));
  addInto(mixed, b.dry);
  addInto(mixed, a.tails);
  addInto(mixed, b.tails);
  const lanes = Boolean(script.meta.stem_lanes);
  let sideA = a.dry;
  let sideB = b.dry;
  for (const extra of script.extras) {
    const placed = partAudio(extra, sources.samples(extra.source), count, stretcher);
    if (placed.status !== 'ready') return placed;
    const moved = applyMoves(extra, extra.followsB ? slide(script, placed.audio, nudge) : placed.audio);
    addInto(mixed, moved.dry);
    addInto(mixed, moved.tails);
    if (lanes && extra.followsB) sideB = sum(sideB, moved.dry);
    else if (lanes) sideA = sum(sideA, moved.dry);
  }
  stage('mixed', mixed);
  return {
    status: 'ready',
    script,
    audio: limit(mixed),
    aDry: sideA,
    bDry: sideB,
    driftMs: { a: pyRound(placedA.drift * 1000, 2), b: pyRound(placedB.drift * 1000, 2), nudge: pyRound(nudge * 1000, 2) },
    nudgeSeconds: nudge,
    implementation,
  };
}

function sum(left: Channels, right: Channels): Channels {
  const out = left.map((channel) => Float32Array.from(channel));
  addInto(out, right);
  return out;
}

/** `in_context`: native A, the clip, then native B, joined by 30 ms linear crossfades, limited.
 * Returns the audio and the second where the clip begins. */
export function inContext(rendered: Rendered, before: number, after: number, sources: SourceProvider): { audio: Channels; clipAt: number } {
  const script = rendered.script;
  const mix = (part: Part): SourceRef => ({ song: part.source.song, role: 'mix', stem: null, start: 0, duration: 0 });
  const aNative = checked(sources.samples(mix(script.a)));
  const bNative = checked(sources.samples(mix(script.b)));
  const gainA = linearGain(script.a.facts.gainDb);
  const gainB = linearGain(script.b.facts.gainDb);
  const seam = Math.trunc(SEAM_SECONDS * SAMPLE_RATE);
  const read = (native: ReturnType<typeof checked>, from: number, to: number, gain: number): Channels => {
    const stop = Math.min(to, native.length);
    if (from < native.offset || stop > native.offset + native.channels[0].length) throw new Error('the source window does not hold the native audio around the clip');
    return native.channels.map((channel) => {
      const out = new Float32Array(Math.max(0, stop - from));
      for (let index = 0; index < out.length; index += 1) out[index] = f32(channel[from - native.offset + index] * gain);
      return out;
    });
  };
  const aEnd = intRound(aSourceStart(script) * SAMPLE_RATE);
  const aStart = Math.max(0, aEnd - Math.trunc(before * SAMPLE_RATE));
  const head = read(aNative, aStart, aEnd + seam, gainA);
  const bStart = intRound(bSourceEnd(script) * SAMPLE_RATE);
  const bEnd = Math.min(bNative.length, bStart + Math.trunc(after * SAMPLE_RATE));
  const tail = read(bNative, Math.max(0, bStart - seam), bEnd, gainB);

  const clip = rendered.audio;
  const fadeUp = new Float32Array(seam);
  for (let index = 0; index < seam; index += 1) fadeUp[index] = index === seam - 1 ? 1 : index * (1 / (seam - 1));
  const headLength = head[0].length;
  const clipLength = clip[0].length;
  const tailLength = tail[0].length;
  const total = headLength - seam + clipLength - seam + tailLength;
  const clipAt = headLength - seam;
  const tailAt = clipAt + clipLength - seam;
  const out = zeros(total).map((channel, c) => {
    channel.set(head[c]);
    for (let index = 0; index < seam; index += 1) channel[clipAt + index] = f32(channel[clipAt + index] * f32(1 - fadeUp[index]));
    const faded = Float32Array.from(clip[c]);
    for (let index = 0; index < seam; index += 1) faded[index] = f32(faded[index] * fadeUp[index]);
    for (let index = 0; index < seam; index += 1) faded[clipLength - seam + index] = f32(faded[clipLength - seam + index] * f32(1 - fadeUp[index]));
    for (let index = 0; index < clipLength; index += 1) channel[clipAt + index] = f32(channel[clipAt + index] + faded[index]);
    for (let index = 0; index < tailLength; index += 1) {
      const value = index < seam ? f32(tail[c][index] * fadeUp[index]) : tail[c][index];
      channel[tailAt + index] = f32(channel[tailAt + index] + value);
    }
    return channel;
  });
  return { audio: limit(out), clipAt: clipAt / SAMPLE_RATE };
}

/** The source samples a script reads, one window per source (parts reading the same source share
 * one window covering all of them), so a caller can decode and send only those windows and the
 * worker never holds more. In source samples, end exclusive. */
export function neededWindows(script: TransitionScript): { ref: SourceRef; from: number; to: number }[] {
  const merged = new Map<string, { ref: SourceRef; from: number; to: number }>();
  for (const window of partWindows(script)) {
    const key = JSON.stringify([window.ref.song, window.ref.role, window.ref.stem, window.ref.start, window.ref.duration]);
    const kept = merged.get(key);
    if (kept) {
      kept.from = Math.min(kept.from, window.from);
      kept.to = Math.max(kept.to, window.to);
    } else merged.set(key, { ...window });
  }
  return [...merged.values()];
}

function partWindows(script: TransitionScript): { ref: SourceRef; from: number; to: number }[] {
  const count = intRound(script.duration * SAMPLE_RATE);
  return [script.a, script.b, ...script.extras].map((part) => {
    const warp = heardWarp(part);
    if (warp.isIdentity) {
      const begin = Math.max(0, intRound((warp.source[0] - part.windowOrigin) * SAMPLE_RATE));
      const span = Math.min(count - intRound(warp.output[0] * SAMPLE_RATE), intRound((warp.output[warp.output.length - 1] - warp.output[0]) * SAMPLE_RATE));
      return { ref: part.source, from: begin, to: begin + Math.max(0, span) };
    }
    const first = intRound((warp.source[0] - 0.5 - part.windowOrigin) * SAMPLE_RATE);
    const last = intRound((warp.source[warp.source.length - 1] + 0.5 - part.windowOrigin) * SAMPLE_RATE);
    return { ref: part.source, from: Math.max(0, first), to: Math.max(0, last) };
  });
}
