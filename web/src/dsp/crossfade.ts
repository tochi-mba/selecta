/** Equal-power crossfade curves and the fade scheduler (ADR-0459 Tier 1, BF-0459-02).
 *
 * The curves match the Python engine (`src/selecta/render/script.py`): a rising gain of
 * sin(x * pi / 2) and a falling gain of cos(x * pi / 2), each sampled at 48 steps and
 * interpolated linearly between points, with a tiny leading zero point so a fade-in is silent
 * until it starts. The two timings match the local player (`web/src/player.ts`): a seam starts
 * on the exact sample its song reaches it with a 30 ms crossfade, and when no seam is ready
 * the next song fades in over 3 seconds so a set is never silent.
 */

export const CROSSFADE_IMPLEMENTATION = 'equal-power-crossfade-v1';

/** The 30 ms seam crossfade of the local player (`SEAM_FADE` in web/src/player.ts). */
export const SEAM_FADE_SECONDS = 0.03;
/** The 3 s fallback fade when a seam is not ready (`END_FADE` in web/src/player.ts). */
export const FALLBACK_FADE_SECONDS = 3;
/** The reference curve resolution (`steps` in src/selecta/render/script.py). */
export const CURVE_STEPS = 48;

/** One scheduled gain point: a time in seconds and the gain to reach there by linear ramp. */
export type GainPoint = readonly [timeSeconds: number, gain: number];

export function equalPowerIn(position: number): number {
  return Math.sin(Math.min(Math.max(position, 0), 1) * (Math.PI / 2));
}

export function equalPowerOut(position: number): number {
  return Math.cos(Math.min(Math.max(position, 0), 1) * (Math.PI / 2));
}

/** Equal-power rise from `start` to `end` seconds, as the Python `fade_in` builds it. */
export function fadeInPoints(start: number, end: number, steps = CURVE_STEPS): GainPoint[] {
  const points: GainPoint[] = [[start - 1e-6, 0]];
  for (let step = 0; step <= steps; step += 1) {
    const x = step / steps;
    points.push([start + (end - start) * x, equalPowerIn(x)]);
  }
  return points;
}

/** Equal-power fall from `start` to `end` seconds, as the Python `fade_out` builds it. */
export function fadeOutPoints(start: number, end: number, steps = CURVE_STEPS): GainPoint[] {
  const points: GainPoint[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const x = step / steps;
    points.push([start + (end - start) * x, equalPowerOut(x)]);
  }
  points.push([end + 1e-6, 0]);
  return points;
}

/** Sample a point list to one gain per audio sample, linear between points, clamped at the
 * ends, matching `Curve.sample` in the Python engine. */
export function sampleCurve(points: GainPoint[], count: number, sampleRate: number): Float32Array {
  const output = new Float32Array(count);
  let segment = 0;
  for (let index = 0; index < count; index += 1) {
    const time = index / sampleRate;
    while (segment < points.length - 1 && points[segment + 1][0] <= time) {
      segment += 1;
    }
    if (segment >= points.length - 1) {
      output[index] = points[points.length - 1][1];
      continue;
    }
    const [leftTime, leftGain] = points[segment];
    const [rightTime, rightGain] = points[segment + 1];
    if (time <= leftTime) {
      output[index] = leftGain;
    } else {
      const span = rightTime - leftTime;
      const mix = span > 0 ? (time - leftTime) / span : 1;
      output[index] = leftGain + (rightGain - leftGain) * mix;
    }
  }
  return output;
}

export interface ScheduledFade {
  implementation: string;
  /** 'seam' is the 30 ms sample-exact handover; 'fallback' is the 3 s never-silent fade. */
  kind: 'seam' | 'fallback';
  startSeconds: number;
  durationSeconds: number;
  outgoingGain: GainPoint[];
  incomingGain: GainPoint[];
}

/** The fade both decks run at a seam, with the local player's semantics: the outgoing and
 * incoming sides cross with equal power over the kind's fixed duration. */
export function scheduleFade(kind: 'seam' | 'fallback', startSeconds: number): ScheduledFade {
  const durationSeconds = kind === 'seam' ? SEAM_FADE_SECONDS : FALLBACK_FADE_SECONDS;
  const end = startSeconds + durationSeconds;
  return {
    implementation: CROSSFADE_IMPLEMENTATION,
    kind,
    startSeconds,
    durationSeconds,
    outgoingGain: fadeOutPoints(startSeconds, end),
    incomingGain: fadeInPoints(startSeconds, end),
  };
}
