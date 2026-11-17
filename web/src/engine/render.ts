import { SEAM_FADE } from './scheduler';

/** Offline render for local export (ADR-0457, BF-0457-06; behind cloud.local_export at the
 * caller).
 *
 * The mix renders in chunks, each its own OfflineAudioContext, so a long set reports progress
 * and can be cancelled between chunks instead of blocking to the end. Tracks lie end to end
 * with a short crossfade on every boundary. On completion the output is validated (duration
 * within tolerance, no NaN, peak at or below full scale) before anyone is told it succeeded. A
 * cancelled or failed render resolves to a typed failure that carries no audio at all: partial
 * state is discarded, never presented as a complete file.
 */

export type RenderTrack = { id: number | string; data: () => Promise<ArrayBuffer> };

export type RenderProgress = {
  chunk: number;
  chunks: number;
  renderedSeconds: number;
  totalSeconds: number;
};

export type RenderFailure = {
  ok: false;
  reason: 'cancelled' | 'empty' | 'unsupported_here' | 'decode_failed' | 'render_failed' | 'invalid_output';
  detail: string;
};

export type RenderSuccess = {
  ok: true;
  /** The rendered audio in order; wav.ts encodes straight from these. */
  chunks: AudioBuffer[];
  sampleRate: number;
  channels: number;
  durationSeconds: number;
  peak: number;
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
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
  /** The real OfflineAudioContext by default; a fake in tests. */
  createOfflineContext?: (channels: number, frames: number, sampleRate: number) => OfflineAudioContext;
};

export const RENDER_CHUNK_SECONDS = 30;
/** Rounding each chunk to whole frames can drift by up to a frame per chunk. */
const FRAME_TOLERANCE_PER_CHUNK = 1;
const PEAK_LIMIT = 1.0 + 1e-6;

const cancelled = (): RenderFailure => ({ ok: false, reason: 'cancelled', detail: 'The export was cancelled, so no file was made.' });

/** The gain of a track `u` seconds in, given its fades. */
const envelope = (u: number, duration: number, fadeIn: number, fadeOut: number): number => {
  if (fadeIn > 0 && u < fadeIn) return Math.max(0, u / fadeIn);
  if (fadeOut > 0 && duration - u < fadeOut) return Math.max(0, (duration - u) / fadeOut);
  return 1;
};

export async function renderMix(options: RenderOptions): Promise<RenderResult> {
  const { tracks, decode, signal, onProgress } = options;
  if (tracks.length === 0) return { ok: false, reason: 'empty', detail: 'There is nothing to export.' };
  if (signal?.aborted) return cancelled();
  const sampleRate = options.sampleRate ?? 44100;
  const channels = options.channels ?? 2;
  const chunkSeconds = Math.max(1, options.chunkSeconds ?? RENDER_CHUNK_SECONDS);
  const crossfade = Math.max(0, options.crossfadeSeconds ?? SEAM_FADE);
  const makeOffline = options.createOfflineContext
    ?? (typeof OfflineAudioContext === 'undefined'
      ? null
      : (c: number, frames: number, rate: number) => new OfflineAudioContext(c, frames, rate));
  if (!makeOffline) {
    return { ok: false, reason: 'unsupported_here', detail: 'This browser has no OfflineAudioContext, so SelectaDJ cannot export here.' };
  }

  // Decode everything first: a file that cannot be read fails the whole export with its name,
  // rather than rendering a mix with a silent hole in it.
  const buffers: AudioBuffer[] = [];
  for (const track of tracks) {
    if (signal?.aborted) return cancelled();
    try {
      buffers.push(await decode(await track.data()));
    } catch (error) {
      return {
        ok: false,
        reason: 'decode_failed',
        detail: `Track ${track.id} could not be read: ${(error as Error).message ?? 'unknown reason'}.`,
      };
    }
  }

  // Lay the tracks end to end, each one starting a crossfade before the last ends.
  const starts: number[] = [];
  let total = 0;
  buffers.forEach((buffer, index) => {
    starts.push(index === 0 ? 0 : Math.max(0, total - crossfade));
    total = starts[index] + buffer.duration;
  });

  const chunks = Math.max(1, Math.ceil(total / chunkSeconds));
  const rendered: AudioBuffer[] = [];
  let renderedFrames = 0;
  let peak = 0;

  for (let chunk = 0; chunk < chunks; chunk += 1) {
    if (signal?.aborted) return cancelled();
    const t0 = chunk * chunkSeconds;
    const t1 = Math.min(total, t0 + chunkSeconds);
    const frames = Math.max(1, Math.round((t1 - t0) * sampleRate));
    let made: AudioBuffer;
    try {
      const offline = makeOffline(channels, frames, sampleRate);
      buffers.forEach((buffer, index) => {
        const trackStart = starts[index];
        const duration = buffer.duration;
        const from = Math.max(trackStart, t0);
        const to = Math.min(trackStart + duration, t1);
        if (to <= from) return;
        const fadeIn = index === 0 ? 0 : crossfade;
        const fadeOut = index === buffers.length - 1 ? 0 : crossfade;
        const source = offline.createBufferSource();
        source.buffer = buffer;
        const gain = offline.createGain();
        source.connect(gain);
        gain.connect(offline.destination);
        // The envelope's corners that land inside this chunk become ramp points.
        const points = [from];
        for (const corner of [trackStart + fadeIn, trackStart + duration - fadeOut]) {
          if (corner > from && corner < to) points.push(corner);
        }
        points.push(to);
        points.sort((a, b) => a - b);
        gain.gain.setValueAtTime(envelope(from - trackStart, duration, fadeIn, fadeOut), from - t0);
        for (const point of points.slice(1)) {
          gain.gain.linearRampToValueAtTime(envelope(point - trackStart, duration, fadeIn, fadeOut), point - t0);
        }
        source.start(from - t0, from - trackStart, to - from);
      });
      made = await offline.startRendering();
    } catch (error) {
      return {
        ok: false,
        reason: 'render_failed',
        detail: `Rendering stopped in part ${chunk + 1} of ${chunks}: ${(error as Error).message ?? 'unknown reason'}.`,
      };
    }
    if (signal?.aborted) return cancelled();

    // Validate as we go: a broken chunk fails now, and nothing half-made survives.
    for (let channel = 0; channel < made.numberOfChannels; channel += 1) {
      const data = made.getChannelData(channel);
      for (let frame = 0; frame < data.length; frame += 1) {
        const sample = data[frame];
        if (Number.isNaN(sample)) {
          return { ok: false, reason: 'invalid_output', detail: `The render produced invalid audio in part ${chunk + 1}.` };
        }
        const size = Math.abs(sample);
        if (size > peak) peak = size;
      }
    }
    rendered.push(made);
    renderedFrames += made.length;
    onProgress?.({ chunk: chunk + 1, chunks, renderedSeconds: renderedFrames / sampleRate, totalSeconds: total });
  }

  if (peak > PEAK_LIMIT) {
    return { ok: false, reason: 'invalid_output', detail: `The render peaked above full scale (${peak.toFixed(3)}), so the file was not made.` };
  }
  const expectedFrames = Math.round(total * sampleRate);
  if (Math.abs(renderedFrames - expectedFrames) > chunks * FRAME_TOLERANCE_PER_CHUNK + 1) {
    return { ok: false, reason: 'invalid_output', detail: 'The rendered length does not match the mix, so the file was not made.' };
  }

  return { ok: true, chunks: rendered, sampleRate, channels, durationSeconds: renderedFrames / sampleRate, peak };
}
