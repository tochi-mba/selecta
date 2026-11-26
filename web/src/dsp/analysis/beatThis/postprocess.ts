/** From frame logits to beat and downbeat times: Beat This's minimal postprocessor
 * (`beat_this.model.postprocessor.Postprocessor(type="minimal")`), which is what the Desktop
 * runs (`beats.py::BeatTracker` builds `Audio2Beats(..., dbn=False)`).
 *
 * A frame is a peak when it is the largest within 3 frames either side (a max-pool of 7) and
 * its logit is above 0 (probability over a half). Runs of adjacent peaks become their mean
 * frame. Each downbeat then moves to its nearest beat, and duplicates go.
 */

import { BEAT_FPS } from './spectrogram';

const POOL_REACH = 3;

/** Peak frames of one logit track, before deduplication. */
export function peakFrames(logits: Float32Array): number[] {
  const peaks: number[] = [];
  for (let frame = 0; frame < logits.length; frame += 1) {
    const value = logits[frame];
    if (!(value > 0)) continue;
    let top = -Infinity;
    const from = Math.max(0, frame - POOL_REACH);
    const to = Math.min(logits.length - 1, frame + POOL_REACH);
    for (let k = from; k <= to; k += 1) if (logits[k] > top) top = logits[k];
    if (value === top) peaks.push(frame);
  }
  return peaks;
}

/** `deduplicate_peaks(peaks, width=1)`: adjacent peaks merge into their running mean. */
export function deduplicatePeaks(peaks: number[], width = 1): number[] {
  const result: number[] = [];
  if (!peaks.length) return result;
  let p = peaks[0];
  let count = 1;
  for (let index = 1; index < peaks.length; index += 1) {
    const next = peaks[index];
    if (next - p <= width) {
      count += 1;
      p += (next - p) / count;
    } else {
      result.push(p);
      p = next;
      count = 1;
    }
  }
  result.push(p);
  return result;
}

/** Beat and downbeat times in seconds from the whole song's logits. */
export function minimalPostprocess(beatLogits: Float32Array, downbeatLogits: Float32Array, fps = BEAT_FPS): { beats: Float64Array; downbeats: Float64Array } {
  const beats = Float64Array.from(deduplicatePeaks(peakFrames(beatLogits)), (frame) => frame / fps);
  const moved = deduplicatePeaks(peakFrames(downbeatLogits)).map((frame) => frame / fps);
  if (beats.length) {
    for (let index = 0; index < moved.length; index += 1) {
      // np.argmin: the first of equally near beats
      let best = 0;
      let distance = Infinity;
      for (let b = 0; b < beats.length; b += 1) {
        const gap = Math.abs(beats[b] - moved[index]);
        if (gap < distance) {
          distance = gap;
          best = b;
        }
      }
      moved[index] = beats[best];
    }
  }
  const downbeats = Float64Array.from(new Set(moved)).sort();
  return { beats, downbeats };
}
