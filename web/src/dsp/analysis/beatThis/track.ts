/** A whole song through Beat This, one chunk at a time (`Audio2Beats.__call__` on a 22,050 Hz
 * signal, as `beats.py::BeatTracker.raw` calls it).
 *
 * The network itself is a function handed in (`RunChunk`): onnxruntime-web in the worker
 * (runtime.ts), recorded logits in a test. Only one chunk's spectrogram (1500 x 128 floats, 768
 * kB) exists at a time, and only one chunk is ever handed to the runtime.
 */

import { BEAT_BORDER, placeChunk, splitPiece, UNPREDICTED } from './chunks';
import { minimalPostprocess } from './postprocess';
import { BEAT_MELS, BeatSpectrogram } from './spectrogram';

/** Logits for one chunk: `spect` is `frames` x 128, row-major. */
export type RunChunk = (spect: Float32Array, frames: number) => Promise<{ beat: Float32Array; downbeat: Float32Array }>;

export interface BeatLogits {
  beat: Float32Array;
  downbeat: Float32Array;
}

/** Frame logits for the whole song, assembled from chunks as the package assembles them. */
export async function songLogits(mono22k: Float32Array, run: RunChunk, between?: () => Promise<void>): Promise<BeatLogits> {
  const spectrogram = new BeatSpectrogram(mono22k);
  const total = spectrogram.frames;
  const beat = new Float32Array(total).fill(UNPREDICTED);
  const downbeat = new Float32Array(total).fill(UNPREDICTED);
  const beatWritten = new Uint8Array(total);
  const downbeatWritten = new Uint8Array(total);
  for (const chunk of splitPiece(total)) {
    // zeros where the chunk passes either end of the song, as `zeropad` gives
    const spect = new Float32Array(chunk.length * BEAT_MELS);
    spectrogram.fill(chunk.from, chunk.to - chunk.from, spect, chunk.padLeft * BEAT_MELS);
    const out = await run(spect, chunk.length);
    if (out.beat.length !== chunk.length || out.downbeat.length !== chunk.length) {
      throw new Error('The beat model answered with the wrong number of frames.');
    }
    placeChunk(beat, beatWritten, chunk, out.beat, BEAT_BORDER);
    placeChunk(downbeat, downbeatWritten, chunk, out.downbeat, BEAT_BORDER);
    await between?.();
  }
  return { beat, downbeat };
}

/** How sure the model was of the beats it kept: the mean probability at the beat frames. */
export function beatConfidence(beatLogits: Float32Array, beats: Float64Array, fps: number): number {
  if (!beats.length) return 0;
  let total = 0;
  for (const time of beats) {
    const frame = Math.min(beatLogits.length - 1, Math.round(time * fps));
    total += 1 / (1 + Math.exp(-beatLogits[frame]));
  }
  return total / beats.length;
}

export { minimalPostprocess };
