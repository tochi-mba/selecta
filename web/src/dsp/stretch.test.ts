import { describe, expect, it } from 'vitest';
import { fft } from './fft';
import {
  STRETCH_IMPLEMENTATION,
  STRETCH_MAX_TEMPO_RATIO,
  STRETCH_MIN_TEMPO_RATIO,
  stretchGeometry,
  StretchReady,
  timeStretch,
} from './stretch';
import { stretchRefusal } from './stretchLimits';

const RATE = 44100;

const sine = (seconds: number, frequency: number, amplitude = 0.5, rate = RATE) => {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let index = 0; index < out.length; index += 1) out[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / rate);
  return out;
};

const ready = (result: ReturnType<typeof timeStretch>): StretchReady => {
  if (result.status !== 'ready') throw new Error(`stretch refused: ${result.reason}`);
  return result;
};

/** Dominant frequency of the middle 16384 samples: Hann window, FFT, parabolic peak. */
function dominantFrequency(signal: Float32Array, rate = RATE): number {
  const size = 16384;
  const start = Math.floor((signal.length - size) / 2);
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  for (let index = 0; index < size; index += 1) real[index] = signal[start + index] * (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size));
  fft(real, imag);
  const magnitude = (bin: number) => Math.hypot(real[bin], imag[bin]);
  let peak = 1;
  for (let bin = 2; bin < size / 2; bin += 1) if (magnitude(bin) > magnitude(peak)) peak = bin;
  const [a, b, c] = [Math.log(magnitude(peak - 1)), Math.log(magnitude(peak)), Math.log(magnitude(peak + 1))];
  const offset = (0.5 * (a - c)) / (a - 2 * b + c);
  return ((peak + offset) * rate) / size;
}

const maxStep = (signal: Float32Array, from = 0, to = signal.length) => {
  let largest = 0;
  for (let index = Math.max(1, from); index < to; index += 1) largest = Math.max(largest, Math.abs(signal[index] - signal[index - 1]));
  return largest;
};

const rms = (signal: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += signal[index] * signal[index];
  return Math.sqrt(sum / (to - from));
};

/** 1 ms RMS envelope. */
function envelope(signal: Float32Array, rate = RATE): Float32Array {
  const width = Math.round(rate / 1000);
  const out = new Float32Array(Math.floor(signal.length / width));
  for (let block = 0; block < out.length; block += 1) out[block] = rms(signal, block * width, (block + 1) * width);
  return out;
}

/** Deterministic noise bursts (a stand-in for drum hits): instant attack, 30 ms decay. */
function hits(seconds: number, every: number, rate = RATE): { signal: Float32Array; onsets: number[] } {
  const signal = new Float32Array(Math.round(seconds * rate));
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };
  const onsets: number[] = [];
  for (let at = 0.25; at < seconds - 0.2; at += every) {
    const start = Math.round(at * rate);
    onsets.push(at);
    for (let index = 0; index < rate * 0.15; index += 1) signal[start + index] += 1.6 * random() * Math.exp(-index / (rate * 0.03));
  }
  return { signal, onsets };
}

/** Per-hit transient measurements on a 1 ms envelope: how long the attack takes to rise from
 * 10 to 90 percent of the hit's peak, and the largest later bump (20 to 60 ms after the peak)
 * relative to the decay the input would have there: a doubled transient shows up as a bump. */
function transientStats(signal: Float32Array, expectedOnsets: number[]) {
  const env = envelope(signal);
  return expectedOnsets.map((onset) => {
    const from = Math.max(0, Math.round(onset * 1000) - 30);
    const to = Math.min(env.length, from + 120);
    let peakAt = from;
    for (let ms = from; ms < to; ms += 1) if (env[ms] > env[peakAt]) peakAt = ms;
    const peak = env[peakAt];
    let low = peakAt;
    while (low > from && env[low - 1] > 0.1 * peak) low -= 1;
    let high = low;
    while (high < peakAt && env[high] < 0.9 * peak) high += 1;
    let bump = 0;
    for (let ms = peakAt + 20; ms < Math.min(env.length, peakAt + 60); ms += 1) {
      const expected = peak * Math.exp(-(ms - peakAt) / 30);
      bump = Math.max(bump, env[ms] / expected);
    }
    return { attackMs: high - low, bump };
  });
}

describe('bounded time-stretch (WSOLA)', () => {
  it('refuses tempo changes beyond 8 percent and windows beyond 60 s, with reasons', () => {
    const tone = sine(1, 440);
    for (const ratio of [0.9, 1.1, 2, 0.5, Number.NaN]) {
      const result = timeStretch([tone], RATE, ratio);
      expect(result.status).toBe('unsupported_here');
      if (result.status === 'unsupported_here') {
        expect(result.reason).toMatch(/8 percent stretch limit/);
        expect(result.implementation).toBe(STRETCH_IMPLEMENTATION);
      }
    }
    expect(stretchRefusal(1.05, 61)).toMatch(/up to 60 seconds/);
    expect(timeStretch([], RATE, 1)).toMatchObject({ status: 'unsupported_here', reason: 'there is no audio to stretch' });
    expect(timeStretch([tone, sine(0.5, 440)], RATE, 1)).toMatchObject({ status: 'unsupported_here', reason: expect.stringMatching(/same length/) });
    expect(ready(timeStretch([tone], RATE, STRETCH_MIN_TEMPO_RATIO)).outputFrames).toBe(Math.round(RATE / 0.92));
    expect(ready(timeStretch([tone], RATE, STRETCH_MAX_TEMPO_RATIO)).outputFrames).toBe(Math.round(RATE / 1.08));
  });

  it('lands on the requested duration to the sample', () => {
    for (const ratio of [0.92, 0.97, 1, 1.03, 1.08]) {
      for (const seconds of [0.3, 2, 7.77]) {
        const input = sine(seconds, 220);
        const result = ready(timeStretch([input, input], RATE, ratio));
        expect(result.outputFrames).toBe(Math.round(input.length / ratio));
        expect(result.channels.map((channel) => channel.length)).toEqual([result.outputFrames, result.outputFrames]);
      }
    }
  });

  it('keeps the pitch: a stretched sine keeps its dominant frequency within 0.5 percent', () => {
    for (const frequency of [110, 440, 2500]) {
      for (const ratio of [0.92, 1.05, 1.08]) {
        const out = ready(timeStretch([sine(3, frequency)], RATE, ratio)).channels[0];
        const found = dominantFrequency(out);
        expect(Math.abs(found - frequency) / frequency).toBeLessThan(0.005);
      }
    }
    // The naive playbackRate alternative would have moved 440 Hz to 475 Hz at 1.08.
    expect(Math.abs(dominantFrequency(sine(3, 440 * 1.08)) - 440)).toBeGreaterThan(30);
  });

  it('adds no clicks at frame boundaries: sample-to-sample steps stay within the tone\'s own slope', () => {
    for (const frequency of [110, 440, 1000]) {
      for (const ratio of [0.92, 1.04, 1.08]) {
        const amplitude = 0.5;
        const out = ready(timeStretch([sine(4, frequency, amplitude)], RATE, ratio)).channels[0];
        const slope = (2 * Math.PI * frequency * amplitude) / RATE;
        // Skip the first and last frame, where the input itself starts and stops.
        const { frame } = stretchGeometry(RATE);
        expect(maxStep(out, frame, out.length - frame)).toBeLessThan(slope * 1.1);
        // And the level holds: no comb-filter dips where frames overlap.
        const level = rms(out, frame, out.length - frame);
        expect(Math.abs(level - amplitude / Math.SQRT2) / (amplitude / Math.SQRT2)).toBeLessThan(0.03);
      }
    }
  });

  it('keeps stereo channels locked together (one shift per frame)', () => {
    const left = sine(2, 330);
    const right = sine(2, 330, 0.25);
    const [outLeft, outRight] = ready(timeStretch([left, right], RATE, 1.06)).channels;
    for (let index = 0; index < outLeft.length; index += 97) expect(outRight[index]).toBeCloseTo(outLeft[index] / 2, 5);
  });

  it('measures transient smearing on drum-like hits and keeps it bounded', () => {
    const { signal, onsets } = hits(6, 0.37);
    const baseline = transientStats(signal, onsets);
    const baseAttack = Math.max(...baseline.map((stat) => stat.attackMs));
    const report: Record<string, { attackMs: number; worstBump: number }> = {
      input: { attackMs: baseAttack, worstBump: Number(Math.max(...baseline.map((stat) => stat.bump)).toFixed(2)) },
    };
    for (const ratio of [0.92, 1.08]) {
      const out = ready(timeStretch([signal], RATE, ratio)).channels[0];
      const stats = transientStats(out, onsets.map((onset) => onset / ratio));
      const attackMs = Math.max(...stats.map((stat) => stat.attackMs));
      const worstBump = Math.max(...stats.map((stat) => stat.bump));
      report[String(ratio)] = { attackMs, worstBump: Number(worstBump.toFixed(2)) };
      console.info('stretch transient smearing', JSON.stringify(report));
      // Attacks stay sharp: at most 8 ms slower from 10 to 90 percent than the input's.
      expect(attackMs).toBeLessThanOrEqual(baseAttack + 8);
      // No hit comes back doubled at anything near full strength.
      expect(worstBump).toBeLessThan(2.5);
    }
  });

  it('runs well inside a CPU budget: under 60 ms of work per second of stereo audio', () => {
    const seconds = 20;
    const left = sine(seconds, 440);
    const right = sine(seconds, 660, 0.3);
    ready(timeStretch([left.subarray(0, RATE), right.subarray(0, RATE)], RATE, 1.04)); // warm up
    // Best of three: the cost of the algorithm, not of whatever else the machine is running.
    let best = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      ready(timeStretch([left, right], RATE, 1.04));
      best = Math.min(best, performance.now() - started);
    }
    const perSecond = best / seconds;
    console.info(`stretch cost ${perSecond.toFixed(1)} ms per second of stereo audio`);
    expect(perSecond).toBeLessThan(60);
  });

  it('never resamples: there is no playbackRate path in the module', () => {
    // Same disk access as importBoundaries.test.ts: the app's tsconfig has no Node types.
    const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
    const fs = node.getBuiltinModule('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string };
    const source = fs.readFileSync(`${node.cwd()}/src/dsp/stretch.ts`, 'utf8');
    expect(source.replace(/\/\*\*[\s\S]*?\*\//g, '')).not.toMatch(/playbackRate/);
  });
});
