/** `beatThisSource`: the Desktop's neural beat tracker as a browser beat source.
 *
 * The same steps as `beats.py::BeatTracker.raw` on the 22,050 Hz mono the Desktop gives it:
 * log-mel spectrogram, Beat This chunk by chunk, minimal peak picking. Its beats then go
 * through the same grid as every source (`grid.ts::buildGrid`), and the bar length comes from
 * its downbeats (`grid.ts::fitBars`, three or four beats), so a waltz reads as 3/4.
 */

import type { BeatSource } from '../beatSource';
import { resample } from '../resample';
import { BEAT_MODEL_IMPLEMENTATION } from './model';
import { BEAT_FPS, BEAT_SR } from './spectrogram';
import { beatConfidence, minimalPostprocess, songLogits, type RunChunk } from './track';

export { BEAT_MODEL_IMPLEMENTATION };

/** A beat source over a loaded runtime. `between` runs after each chunk (a breath for the
 * worker, a timer in a benchmark). */
export function beatThisSource(run: RunChunk, between?: () => Promise<void>): BeatSource {
  return {
    implementation: BEAT_MODEL_IMPLEMENTATION,
    async beats(samples, sampleRate) {
      const mono = sampleRate === BEAT_SR ? samples : resample(samples, sampleRate, BEAT_SR);
      const logits = await songLogits(mono, run, between);
      const { beats, downbeats } = minimalPostprocess(logits.beat, logits.downbeat);
      return { beats, downbeats, confidence: beatConfidence(logits.beat, beats, BEAT_FPS), implementation: BEAT_MODEL_IMPLEMENTATION };
    },
  };
}
