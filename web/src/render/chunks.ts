import { type RenderChunk, type RenderInput, validateRecipe, RenderFailure } from './contracts';

const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const equalPowerIn = (progress: number) => Math.sin(Math.PI * progress / 2);
const equalPowerOut = (progress: number) => Math.cos(Math.PI * progress / 2);

/**
 * Bounded-memory overlapping-clip renderer. All clip intersections use absolute
 * integer output-frame boundaries, avoiding float-time seam drift.
 * DSP adapters can implement their own overlap/save state; not guessed here.
 */
export async function* renderChunks(input: RenderInput): AsyncGenerator<RenderChunk> {
  const { recipe, sources, signal } = input;
  validateRecipe(recipe, sources);
  const chunkFrames = input.chunkFrames ?? 4096;
  if (!Number.isSafeInteger(chunkFrames) || chunkFrames < 16 || chunkFrames > 65536) throw new Error('Unsafe chunk size');
  for (let start = 0; start < recipe.totalFrames; start += chunkFrames) {
    if (signal.aborted) throw new RenderFailure('cancelled', 'Render cancelled');
    const frames = Math.min(chunkFrames, recipe.totalFrames - start);
    const channels = Array.from({ length: recipe.channels }, () => new Float32Array(frames));
    for (const clip of recipe.clips) {
      const from = Math.max(start, clip.startFrame);
      const to = Math.min(start + frames, clip.startFrame + clip.durationFrames);
      if (from >= to) continue;
      const source = sources.get(clip.recordingId)!;
      const decoded = await source.read(clip.sourceStartFrame + from - clip.startFrame, to - from, recipe.sampleRate, signal);
      if (signal.aborted) throw new RenderFailure('cancelled', 'Render cancelled');
      if ((decoded.length !== 1 && decoded.length !== 2) || decoded.some(c => c.length !== to - from)) {
        throw new Error('Decoder returned wrong channel count or frame length');
      }
      for (let f = from; f < to; f++) {
        const relative = f - clip.startFrame;
        let gain = clip.gain ?? 1;
        if ((clip.fadeInFrames ?? 0) > 0 && relative < clip.fadeInFrames!) {
          gain *= equalPowerIn(relative / clip.fadeInFrames!);
        }
        const remaining = clip.durationFrames - relative - 1;
        if ((clip.fadeOutFrames ?? 0) > 0 && remaining < clip.fadeOutFrames!) {
          gain *= equalPowerOut((clip.fadeOutFrames! - 1 - remaining) / clip.fadeOutFrames!);
        }
        const index = f - start;
        const sourceIndex = f - from;
        for (let channel = 0; channel < recipe.channels; channel++) {
          // Mono -> stereo duplication, stereo -> mono arithmetic downmix.
          const value = recipe.channels === 1 && decoded.length === 2
            ? (decoded[0][sourceIndex] + decoded[1][sourceIndex]) * 0.5
            : decoded[Math.min(channel, decoded.length - 1)][sourceIndex];
          channels[channel][index] += value * gain;
        }
      }
    }
    let processed = channels;
    for (const processor of input.processors ?? []) {
      processed = await processor.process(processed, start, signal);
      if (processed.length !== recipe.channels || processed.some(ch => ch.length !== frames)) {
        throw new Error(`DSP adapter ${processor.id} changed output shape`);
      }
    }
    for (const channel of processed) {
      for (let i = 0; i < frames; i++) {
        if (!Number.isFinite(channel[i])) throw new Error('Non-finite audio sample');
        // Clip only at codec boundary: preserves headroom for subsequent processors.
      }
    }
    yield { startFrame: start, frames, channels: processed };
    await yieldToBrowser(); // Fair scheduling: foreground playback must not starve.
  }
}

/** Bounded source adapter for decoded AudioBuffer. Large recordings should instead
 * be supplied by Agent 02's on-demand windowed decoder; AudioBuffer itself is RAM-backed. */
export function audioBufferSource(recordingId: string, sourceRevision: string, buffer: AudioBuffer) {
  return {
    recordingId, sourceRevision, durationFrames: buffer.length,
    async read(startFrame: number, frames: number, outputRate: number, signal: AbortSignal) {
      if (signal.aborted) throw new RenderFailure('cancelled', 'Cancelled');
      if (buffer.sampleRate !== outputRate) throw new Error('Resampler adapter required');
      if (startFrame < 0 || startFrame + frames > buffer.length) throw new Error('Invalid decoder window');
      return Array.from({ length: buffer.numberOfChannels }, (_, index) =>
        buffer.getChannelData(index).slice(startFrame, startFrame + frames));
    },
  };
}
