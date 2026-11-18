import { CURVE_STEPS, equalPowerIn, equalPowerOut } from '../dsp/crossfade';
import { LIMITER_IMPLEMENTATION, limiterCoefficients, process as limit } from '../dsp/limiter';
import { interpolatorPhases } from '../dsp/loudness';
import { SEAM_FADE } from './scheduler';
import type { PcmChunk } from './wav';

/** Offline render for local export (ADR-0457, BF-0457-06; behind cloud.local_export at the
 * caller).
 *
 * The mix renders in chunks, each its own OfflineAudioContext, so a long set reports progress
 * and can be cancelled between chunks instead of blocking to the end. Tracks lie end to end
 * with a short equal-power crossfade on every boundary, and are decoded lazily: only the songs
 * the current chunk needs are held, never the whole set. Every rendered chunk then goes through
 * the dsp/limiter.ts true-peak limiter before anything is encoded; the limiter streams across
 * chunk edges with enough overlap that the result is the same as limiting the whole mix at once.
 *
 * On completion the output is validated (duration within tolerance, no NaN or infinity, peak at
 * or below the ceiling) before anyone is told it succeeded. Every failure, including one thrown
 * while scheduling, decoding or reporting progress, resolves to a typed failure that carries no
 * audio at all, and a cancel observed at any point (even after the last chunk) wins over
 * success: partial state is discarded, never presented as a complete file.
 */

export type RenderTrack = { id: number | string; data: () => Promise<ArrayBuffer> };

export type RenderProgress = {
  /** Chunks rendered so far. */
  chunk: number;
  /** All chunks, once the last song has been decoded and the length is known; else null. */
  chunks: number | null;
  renderedSeconds: number;
  /** The mix length, once known; else null. */
  totalSeconds: number | null;
};

export type RenderFailure = {
  ok: false;
  reason: 'cancelled' | 'empty' | 'unsupported_here' | 'decode_failed' | 'render_failed' | 'invalid_output' | 'too_long';
  detail: string;
};

export type RenderSuccess = {
  ok: true;
  /** The limited audio in order; wav.ts encodeWav encodes straight from these. */
  chunks: PcmChunk[];
  sampleRate: number;
  channels: number;
  durationSeconds: number;
  /** Sample peak after limiting. */
  peak: number;
  /** The limiter that processed the audio, named by implementation id (ADR-0459). */
  limiter: string;
};

export type RenderResult = RenderSuccess | RenderFailure;

export type RenderOptions = {
  tracks: RenderTrack[];
  /** Decode one file's bytes to PCM; a bound context.decodeAudioData, or a fake in tests. */
  decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
  sampleRate?: number;
  channels?: number;
  chunkSeconds?: number;
  crossfadeSeconds?: number;
  /** The longest mix this device will hold in memory (seconds); longer fails as too_long. */
  maxSeconds?: number;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
  /** The real OfflineAudioContext by default; a fake in tests. */
  createOfflineContext?: (channels: number, frames: number, sampleRate: number) => OfflineAudioContext;
  /** Hands control back to the event loop between limiter blocks; a resolved promise in tests. */
  yieldToLoop?: () => Promise<void>;
};

export const RENDER_CHUNK_SECONDS = 30;
/** The rendered mix is held as 32-bit float until it is encoded: 90 minutes of stereo at
 * 44.1 kHz is about 1.9 GB. Longer sets are refused rather than crashing the tab. */
export const MAX_RENDER_SECONDS = 90 * 60;
/** Rounding each chunk to whole frames can drift by up to a frame per chunk. */
const FRAME_TOLERANCE_PER_CHUNK = 1;
/** The interpolator's reach either side of a sample (12 taps per phase). */
const TRUE_PEAK_REACH = 8;
/** The limiter runs over each rendered chunk in blocks of about this length, yielding between
 * them, so a 30 s chunk never holds the page for the whole limiter pass. */
export const LIMIT_BLOCK_SECONDS = 1;

const cancelled = (): RenderFailure => ({ ok: false, reason: 'cancelled', detail: 'The export was cancelled, so no file was made.' });
const why = (error: unknown) => (error as Error | null)?.message || 'unknown reason';

/** One limited chunk, in the PcmChunk shape wav.ts reads. */
const pcmChunk = (data: Float32Array[], sampleRate: number): PcmChunk => ({
  numberOfChannels: data.length,
  length: data[0]?.length ?? 0,
  sampleRate,
  getChannelData: (channel: number) => data[channel],
});

/** The gain of a track `u` seconds in, given its fades: equal-power, as at every live seam. */
const envelope = (u: number, duration: number, fadeIn: number, fadeOut: number): number => {
  if (fadeIn > 0 && u < fadeIn) return equalPowerIn(Math.max(0, u / fadeIn));
  if (fadeOut > 0 && duration - u < fadeOut) return equalPowerOut(1 - Math.max(0, (duration - u) / fadeOut));
  return 1;
};

type Placed = { index: number; buffer: AudioBuffer; start: number; end: number };

class Stop extends Error {
  constructor(readonly failure: RenderFailure) {
    super(failure.detail);
  }
}

export async function renderMix(options: RenderOptions): Promise<RenderResult> {
  try {
    return await renderInside(options);
  } catch (error) {
    if (error instanceof Stop) return error.failure;
    if (options.signal?.aborted) return cancelled();
    return { ok: false, reason: 'render_failed', detail: `The export stopped: ${why(error)}.` };
  }
}

async function renderInside(options: RenderOptions): Promise<RenderResult> {
  const { tracks, decode, signal, onProgress } = options;
  const yieldToLoop = options.yieldToLoop ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  if (tracks.length === 0) return { ok: false, reason: 'empty', detail: 'There is nothing to export.' };
  if (signal?.aborted) return cancelled();
  const checkCancel = () => {
    if (signal?.aborted) throw new Stop(cancelled());
  };
  const sampleRate = options.sampleRate ?? 44100;
  const channels = options.channels ?? 2;
  const crossfade = Math.max(0, options.crossfadeSeconds ?? SEAM_FADE);
  const maxSeconds = options.maxSeconds ?? MAX_RENDER_SECONDS;
  const makeOffline = options.createOfflineContext
    ?? (typeof OfflineAudioContext === 'undefined'
      ? null
      : (c: number, frames: number, rate: number) => new OfflineAudioContext(c, frames, rate));
  if (!makeOffline) {
    return { ok: false, reason: 'unsupported_here', detail: 'This browser has no OfflineAudioContext, so SelectaDJ cannot export here.' };
  }

  // The limiter's dependency reach: a sliding minimum then a moving average over the window,
  // plus the true-peak interpolator. Chunks overlap by this much, so streaming is exact.
  const { windowSamples, ceilingLinear } = limiterCoefficients({ sampleRate });
  const reach = windowSamples + TRUE_PEAK_REACH + interpolatorPhases().length;
  const chunkSeconds = Math.max(1, options.chunkSeconds ?? RENDER_CHUNK_SECONDS, (4 * reach) / sampleRate);

  // Lazy layout: song i starts a crossfade before song i - 1 ends, so its place is known once
  // the previous song has been decoded. Only songs that overlap the chunk in hand are held.
  const held: Placed[] = [];
  let nextTrack = 0;
  let layoutEnd = 0;
  const decodeNext = async (): Promise<void> => {
    checkCancel();
    const index = nextTrack;
    const track = tracks[index];
    let buffer: AudioBuffer;
    try {
      buffer = await decode(await track.data());
    } catch (error) {
      throw new Stop({ ok: false, reason: 'decode_failed', detail: `Track ${track.id} could not be read: ${why(error)}.` });
    }
    checkCancel();
    const start = index === 0 ? 0 : Math.max(0, layoutEnd - crossfade);
    const end = start + buffer.duration;
    if (end > maxSeconds) {
      throw new Stop({
        ok: false,
        reason: 'too_long',
        detail: `The mix runs past ${Math.round(maxSeconds / 60)} minutes, which is more than this device can export at once.`,
      });
    }
    held.push({ index, buffer, start, end });
    layoutEnd = end;
    nextTrack += 1;
  };

  const raw: Float32Array[][] = [];
  const limited: PcmChunk[] = [];
  let renderedFrames = 0;
  let peak = 0;
  let chunk = 0;
  let limitedUpTo = 0;
  let rawStartChunk = 0;

  const blockFrames = Math.max(1, Math.round(LIMIT_BLOCK_SECONDS * sampleRate));

  /** Limit raw chunk `which` using its neighbours' edges, then drop what is no longer needed.
   * The chunk is limited in blocks, each with `reach` samples of context either side (the same
   * overlap argument that makes chunk streaming exact), yielding and checking for a cancel
   * between blocks. */
  const limitChunk = async (which: number, last: boolean) => {
    const at = which - rawStartChunk;
    const middle = raw[at];
    const before = at > 0 ? raw[at - 1] : null;
    const after = !last && raw[at + 1] ? raw[at + 1] : null;
    const take = (lane: Float32Array | undefined, from: number, to: number) => (lane ? lane.subarray(Math.max(0, from), Math.min(lane.length, to)) : new Float32Array(0));
    const left = before ? Math.min(reach, before[0].length) : 0;
    const right = after ? Math.min(reach, after[0].length) : 0;
    const joined = middle.map((lane, channel) => {
      const head = before ? take(before[channel], before[channel].length - left, before[channel].length) : new Float32Array(0);
      const tail = after ? take(after[channel], 0, right) : new Float32Array(0);
      const whole = new Float32Array(head.length + lane.length + tail.length);
      whole.set(head, 0);
      whole.set(lane, head.length);
      whole.set(tail, head.length + lane.length);
      return whole;
    });
    const length = middle[0].length;
    const out = middle.map(() => new Float32Array(length));
    for (let from = 0; from < length; from += blockFrames) {
      const to = Math.min(length, from + blockFrames);
      const start = Math.max(0, left + from - reach);
      const end = Math.min(joined[0].length, left + to + reach);
      const block = limit(joined.map((lane) => lane.subarray(start, end)), { sampleRate });
      block.forEach((lane, channel) => out[channel].set(lane.subarray(left + from - start, left + to - start), from));
      if (to < length) {
        await yieldToLoop();
        checkCancel();
      }
    }
    for (const lane of out) {
      for (let frame = 0; frame < lane.length; frame += 1) {
        const size = Math.abs(lane[frame]);
        if (size > peak) peak = size;
      }
    }
    limited.push(pcmChunk(out, sampleRate));
    // Only the previous chunk's tail is ever needed again.
    while (which - rawStartChunk > 0) {
      raw.shift();
      rawStartChunk += 1;
    }
  };

  await decodeNext();
  for (;;) {
    checkCancel();
    const t0 = chunk * chunkSeconds;
    let t1 = t0 + chunkSeconds;
    // Decode until the layout covers this chunk or the set is fully placed.
    while (nextTrack < tracks.length && layoutEnd - crossfade < t1) await decodeNext();
    const allPlaced = nextTrack >= tracks.length;
    if (allPlaced) t1 = Math.min(t1, layoutEnd);
    if (t1 <= t0) break;
    const frames = Math.max(1, Math.round((t1 - t0) * sampleRate));
    let made: AudioBuffer;
    try {
      const offline = makeOffline(channels, frames, sampleRate);
      const lastIndex = tracks.length - 1;
      for (const placed of held) {
        const { buffer, start, end, index } = placed;
        const from = Math.max(start, t0);
        const to = Math.min(end, t1);
        if (to <= from) continue;
        const duration = buffer.duration;
        const fadeIn = index === 0 ? 0 : crossfade;
        const fadeOut = index === lastIndex ? 0 : crossfade;
        const source = offline.createBufferSource();
        source.buffer = buffer;
        const gain = offline.createGain();
        source.connect(gain);
        gain.connect(offline.destination);
        // The equal-power envelope as gain points: CURVE_STEPS inside each fade, then the
        // chunk edges, all clipped to this chunk.
        const points = new Set<number>([from, to]);
        for (const [fadeFrom, length] of [[start, fadeIn], [end - fadeOut, fadeOut]] as const) {
          if (length <= 0) continue;
          for (let step = 0; step <= CURVE_STEPS; step += 1) {
            const time = fadeFrom + (length * step) / CURVE_STEPS;
            if (time > from && time < to) points.add(time);
          }
        }
        const ordered = [...points].sort((a, b) => a - b);
        gain.gain.setValueAtTime(envelope(from - start, duration, fadeIn, fadeOut), from - t0);
        for (const point of ordered.slice(1)) {
          gain.gain.linearRampToValueAtTime(envelope(point - start, duration, fadeIn, fadeOut), point - t0);
        }
        source.start(from - t0, from - start, to - from);
      }
      made = await offline.startRendering();
    } catch (error) {
      throw new Stop({ ok: false, reason: 'render_failed', detail: `Rendering stopped in part ${chunk + 1}: ${why(error)}.` });
    }
    checkCancel();

    // Validate as we go: a broken chunk fails now, and nothing half-made survives.
    const lanes: Float32Array[] = [];
    for (let channel = 0; channel < made.numberOfChannels; channel += 1) {
      const data = made.getChannelData(channel);
      for (let frame = 0; frame < data.length; frame += 1) {
        if (!Number.isFinite(data[frame])) {
          throw new Stop({ ok: false, reason: 'invalid_output', detail: `The render produced invalid audio in part ${chunk + 1}.` });
        }
      }
      // Copy out of the AudioBuffer, so the context and its buffer can go.
      lanes.push(data.slice());
    }
    raw.push(lanes);
    renderedFrames += made.length;
    chunk += 1;
    // The previous chunk now has its right-hand neighbour: limit it.
    if (chunk - 1 > limitedUpTo) {
      await limitChunk(limitedUpTo, false);
      limitedUpTo += 1;
    }
    // Songs that ended before this chunk are not needed again.
    for (let at = held.length - 1; at >= 0; at -= 1) {
      if (held[at].end <= t1) held.splice(at, 1);
    }
    const totalSeconds = allPlaced ? layoutEnd : null;
    onProgress?.({
      chunk,
      chunks: totalSeconds === null ? null : Math.max(1, Math.ceil(totalSeconds / chunkSeconds)),
      renderedSeconds: renderedFrames / sampleRate,
      totalSeconds,
    });
    if (allPlaced && t1 >= layoutEnd) break;
  }
  checkCancel();
  while (limitedUpTo < chunk) {
    await limitChunk(limitedUpTo, limitedUpTo === chunk - 1);
    limitedUpTo += 1;
  }
  checkCancel();

  if (!(peak <= ceilingLinear + 1e-6)) {
    return { ok: false, reason: 'invalid_output', detail: `The limited render still peaked at ${peak.toFixed(3)}, so the file was not made.` };
  }
  const expectedFrames = Math.round(layoutEnd * sampleRate);
  if (Math.abs(renderedFrames - expectedFrames) > chunk * FRAME_TOLERANCE_PER_CHUNK + 1) {
    return { ok: false, reason: 'invalid_output', detail: 'The rendered length does not match the mix, so the file was not made.' };
  }
  return {
    ok: true,
    chunks: limited,
    sampleRate,
    channels,
    durationSeconds: renderedFrames / sampleRate,
    peak,
    limiter: LIMITER_IMPLEMENTATION,
  };
}
