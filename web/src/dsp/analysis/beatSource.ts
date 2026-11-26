/** Where a song's beats come from before the grid is built.
 *
 * On the Desktop the beats come from the neural tracker, Beat This (`beats.py::BeatTracker`),
 * and everything after it is deterministic and ported (`grid.ts`). The browser runs the same
 * tracker (`beatThis/source.ts`, `web-beatthis-small0-1`) where its model is on this device and
 * fast enough; elsewhere its own lightweight estimate below stands in. Every measurement records
 * which source gave its beats, so the account can rank them and a song measured with the
 * lighter source is measured again once the tracker is here.
 */

import { BROWSER_BEATS_IMPLEMENTATION } from './deviceAnalysisIds';
import { onsetEnvelope, ONSET_HOP_TIME, ONSET_SR } from './onsetEnvelope';
import { resample } from './resample';
import { estimateTempo } from './tempo';

export interface BeatEstimate {
  /** Beat times in seconds, ascending. */
  beats: Float64Array;
  /** Downbeat times in seconds, a subset of the beats. */
  downbeats: Float64Array;
  /** In [0, 1]: how much the source trusts its own beats. */
  confidence: number;
  implementation: string;
}

export interface BeatSource {
  implementation: string;
  /** Beats of a mono signal. `hints.onsetEnvelope`, when given, is the onset envelope of the
   * same signal at 22,050 Hz, so a source that reads it need not compute it again. A neural
   * source answers later (its model runs asynchronously). */
  beats(samples: Float32Array, sampleRate: number, hints?: { onsetEnvelope?: Float32Array }): BeatEstimate | Promise<BeatEstimate>;
}

/** A source that answers at once, which `measureSong` needs. */
export interface SyncBeatSource extends BeatSource {
  beats(samples: Float32Array, sampleRate: number, hints?: { onsetEnvelope?: Float32Array }): BeatEstimate;
}

export { BROWSER_BEATS_IMPLEMENTATION };

const PHASE_STEP = 0.25;

function envelopeAt(env: Float32Array, frame: number): number {
  const lower = Math.floor(frame);
  if (lower < 0 || lower >= env.length) return 0;
  const upper = Math.min(lower + 1, env.length - 1);
  const fraction = frame - lower;
  return env[lower] * (1 - fraction) + env[upper] * fraction;
}

/** The browser's tempo estimate (`tempo.ts`, the same autocorrelation the transition planner
 * uses on a minute of audio) over the whole song's onset envelope, then the phase that puts the
 * most onset strength on the beats, and downbeats every fourth beat from the strongest of the
 * four bar phases. It assumes four beats to the bar; `grid.ts::fitBars` reads a 3/4 song's
 * meter only from downbeats, so a waltz measured this way reads as 4/4 (Beat This reads 3/4). */
export const browserBeatSource: SyncBeatSource = {
  implementation: BROWSER_BEATS_IMPLEMENTATION,
  beats(samples, sampleRate, hints) {
    const env = hints?.onsetEnvelope ?? onsetEnvelope(sampleRate === ONSET_SR ? samples : resample(samples, sampleRate, ONSET_SR));
    const none = { beats: new Float64Array(0), downbeats: new Float64Array(0), confidence: 0, implementation: BROWSER_BEATS_IMPLEMENTATION };
    let largest = 0;
    for (let frame = 0; frame < env.length; frame += 1) largest = Math.max(largest, env[frame]);
    if (largest <= 0) return none;
    const flux = new Float32Array(env.length);
    for (let frame = 0; frame < env.length; frame += 1) flux[frame] = env[frame] / largest;
    const tempo = estimateTempo({ flux, hopSeconds: ONSET_HOP_TIME });
    if (!(tempo.bpm > 0)) return none;
    const period = 60 / tempo.bpm / ONSET_HOP_TIME;

    let bestPhase = 0;
    let bestScore = -Infinity;
    for (let phase = 0; phase < period; phase += PHASE_STEP) {
      let score = 0;
      for (let frame = phase; frame < env.length; frame += period) score += envelopeAt(env, frame);
      if (score > bestScore) {
        bestScore = score;
        bestPhase = phase;
      }
    }
    const frames: number[] = [];
    for (let frame = bestPhase; frame < env.length; frame += period) frames.push(frame);
    const beats = Float64Array.from(frames, (frame) => frame * ONSET_HOP_TIME);

    const barScores = [0, 0, 0, 0];
    frames.forEach((frame, index) => { barScores[index % 4] += envelopeAt(env, frame); });
    const first = barScores.indexOf(Math.max(...barScores));
    const downbeats = beats.filter((_, index) => index % 4 === first);
    return { beats, downbeats, confidence: tempo.confidence, implementation: BROWSER_BEATS_IMPLEMENTATION };
  },
};
