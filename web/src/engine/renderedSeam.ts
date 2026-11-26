import { SEAM_FADE_SECONDS } from '../dsp/crossfade';
import type { RenderedClip } from '../dsp/seams';

/** The third kind of seam: a clip rendered ahead of time (cloud.device_render, ADR-0479), played
 * the way the Desktop's `in_context` joins one (src/selecta/render/engine.py, render/engine.ts).
 *
 * Native A plays up to the clip's first sample, the clip plays, native B carries on from the
 * sample after the clip's last. Each join is a linear crossfade of `trunc(0.03 * rate)` samples,
 * the gains of `linspace(0, 1, n)`: the outgoing side is at 1 on the join's first sample and 0 on
 * its last. Every time here is counted in whole samples from the playing song's own origin, so the
 * three parts line up sample for sample on the sound card's clock, never on a timer.
 *
 * Pure arithmetic and checks, so the join maths is tested without any audio.
 */

/** Samples in one join at this rate: 1,323 at 44.1 kHz, 1,440 at 48 kHz (in_context's `seam`). */
export const joinSamples = (rate: number): number => Math.trunc(SEAM_FADE_SECONDS * rate);
/** A join whose clip side differs from the native side by more than this share of the native
 * level is not the same audio: a different decode, or a clip placed in the wrong spot. */
export const JOIN_TOLERANCE = 0.5;
/** Below this level a join is quiet enough that nothing can click there. */
const QUIET = 1e-4;

/** Context times of everything a rendered seam schedules, from A's origin (`base`: the time A's
 * sample 0 plays, `startedAt - offset`). */
export type RenderedJoins = {
  /** The clip's first sample plays here, over A's sample `aStartSample`. */
  clipAt: number;
  /** A fades from 1 here to 0 at `clipAt + ramp`, and stops just after. */
  ramp: number;
  aStopAt: number;
  /** The clip's last join starts here: native B starts under it, the clip fades out. */
  tailAt: number;
  /** Native B starts at `tailAt` reading from this second of B. */
  bOffset: number;
  /** B's sample `bEndSample` plays here; native B's own clock runs from it. */
  bStartedAt: number;
  /** The clip ends here. */
  clipEndAt: number;
  /** "Now playing" moves to B here. */
  switchAt: number;
};

export function renderedJoins(base: number, rendered: RenderedClip): RenderedJoins {
  const rate = rendered.sampleRate;
  const seam = joinSamples(rate);
  const length = rendered.channels[0].length;
  const clipAt = base + rendered.aStartSample / rate;
  return {
    clipAt,
    ramp: (seam - 1) / rate,
    aStopAt: clipAt + seam / rate + 0.02,
    tailAt: clipAt + (length - seam) / rate,
    bOffset: (rendered.bEndSample - seam) / rate,
    bStartedAt: clipAt + length / rate,
    clipEndAt: clipAt + length / rate,
    switchAt: clipAt + Math.min(Math.max(rendered.switchAt, 0), length / rate),
  };
}

/** B's own second at a clip second, along B's warp (np.interp's rules: held at either end). */
export function bSecondAt(rendered: RenderedClip, clipSeconds: number): number {
  const { output, source } = rendered.bWarp;
  if (clipSeconds <= output[0]) return source[0];
  for (let index = 1; index < output.length; index += 1) {
    if (clipSeconds <= output[index]) {
      const span = output[index] - output[index - 1];
      return span > 0 ? source[index - 1] + ((clipSeconds - output[index - 1]) / span) * (source[index] - source[index - 1]) : source[index];
    }
  }
  return source[source.length - 1];
}

type Song = { length: number; sampleRate: number; numberOfChannels: number; getChannelData(channel: number): Float32Array };

/** How far the clip's side of a join is from the native song's side, as a share of the native
 * level; 0 for two quiet sides, Infinity for a quiet native side under a loud clip. */
export function joinMismatch(clip: readonly Float32Array[], clipFrom: number, song: Song, songFrom: number, level: number, count: number): number {
  let error = 0;
  let native = 0;
  let loud = 0;
  for (let channel = 0; channel < clip.length; channel += 1) {
    const ours = clip[channel];
    const theirs = song.getChannelData(Math.min(channel, song.numberOfChannels - 1));
    for (let index = 0; index < count; index += 1) {
      const want = Math.fround(theirs[songFrom + index] * level);
      const got = ours[clipFrom + index];
      error += (got - want) ** 2;
      native += want * want;
      loud += got * got;
    }
  }
  const samples = clip.length * count;
  const nativeLevel = Math.sqrt(native / samples);
  if (nativeLevel < QUIET) return Math.sqrt(loud / samples) < QUIET * 10 ? 0 : Infinity;
  return Math.sqrt(error / samples) / nativeLevel;
}

/** Why a rendered clip cannot be played between these two decoded songs at these levels, or null.
 * Anything in doubt refuses: the seam then plays the way it would have without the clip. */
export function renderedProblem(rendered: RenderedClip, from: Song, to: Song, levels: { a: number; b: number }, contextRate: number): string | null {
  const { channels, sampleRate, aStartSample, bEndSample } = rendered;
  const length = channels?.[0]?.length ?? 0;
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2 || channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== length)) {
    return 'the prepared transition is malformed';
  }
  if (!(sampleRate > 0) || sampleRate !== contextRate || sampleRate !== from.sampleRate || sampleRate !== to.sampleRate) {
    return 'the prepared transition was made at another sample rate than the songs play at';
  }
  const seam = joinSamples(sampleRate);
  if (length <= 2 * seam) return 'the prepared transition is too short to join';
  for (const channel of channels) {
    for (let index = 0; index < length; index += 1) {
      const value = channel[index];
      if (!Number.isFinite(value) || Math.abs(value) > 1) return 'the prepared transition has a sample that is not sound';
    }
  }
  if (!Number.isSafeInteger(aStartSample) || !Number.isSafeInteger(bEndSample)) return 'the prepared transition does not start or end on a sample';
  if (aStartSample < 0 || aStartSample + seam > from.length) return 'the prepared transition starts outside the first song';
  if (bEndSample - seam < 0 || bEndSample >= to.length) return 'the prepared transition ends outside the next song';
  if (!(rendered.switchAt >= 0) || rendered.switchAt > length / sampleRate) return 'the prepared transition hands over outside itself';
  const { output, source } = rendered.bWarp ?? { output: [], source: [] };
  if (!Array.isArray(output) || output.length < 2 || output.length !== source?.length || ![...output, ...source].every(Number.isFinite)) {
    return 'the prepared transition has no usable timing for the next song';
  }
  // the level must not step at either join: the clip was rendered at the level each song plays at
  if (Math.fround(rendered.levels?.a) !== Math.fround(levels.a) || Math.fround(rendered.levels?.b) !== Math.fround(levels.b)) {
    return 'the prepared transition was made at another level than the songs play at';
  }
  if (joinMismatch(channels, 0, from, aStartSample, levels.a, seam) > JOIN_TOLERANCE) return 'the prepared transition does not line up with the first song';
  if (joinMismatch(channels, length - seam, to, bEndSample - seam, levels.b, seam) > JOIN_TOLERANCE) return 'the prepared transition does not line up with the next song';
  return null;
}
