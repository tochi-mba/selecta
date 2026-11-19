import { afterEach, describe, expect, it, vi } from 'vitest';
import { process as limit } from '../../dsp/limiter';
import { limiterProcessorOptions } from '../limiter';
import { LIMITER_PROCESSOR, LIMITER_PROCESSOR_SOURCE, limiterDelaySamples, LimiterStats } from './limiterProcessor';
import { PROBE_PROCESSOR, PROBE_PROCESSOR_SOURCE, PROBE_REPORT_AFTER_BLOCKS } from './probeProcessor';
import { loadProcessorSource } from './testScope';

afterEach(() => {
  vi.unstubAllGlobals();
});

const QUANTUM = 128;

describe('the shipped worklet sources', () => {
  it('are self-contained module text that reaches the scope only through globalThis', () => {
    for (const source of [PROBE_PROCESSOR_SOURCE, LIMITER_PROCESSOR_SOURCE]) {
      expect(source).not.toMatch(/\bimport\b|\brequire\(/);
      expect(source).toMatch(/globalThis/);
    }
  });
});

describe('the probe processor', () => {
  it('reports after its blocks with the sample rate, then lets itself be collected', () => {
    const { registered, setFrame } = loadProcessorSource(PROBE_PROCESSOR_SOURCE, 48000);
    const Probe = registered.get(PROBE_PROCESSOR)!;
    const node = new Probe();
    const outputs = [[new Float32Array(QUANTUM)]];
    let alive = true;
    for (let block = 0; block < PROBE_REPORT_AFTER_BLOCKS; block += 1) {
      setFrame(block * QUANTUM);
      alive = node.process([], outputs);
    }
    expect(alive).toBe(false);
    expect(node.port.posted).toEqual([{ type: 'probe-report', blocks: PROBE_REPORT_AFTER_BLOCKS, misses: 0, sampleRate: 48000 }]);
  });

  it('counts a jump in the frame counter as a scheduling miss', () => {
    const { registered, setFrame } = loadProcessorSource(PROBE_PROCESSOR_SOURCE);
    const node = new (registered.get(PROBE_PROCESSOR)!)();
    const outputs = [[new Float32Array(QUANTUM)]];
    let frame = 0;
    for (let block = 0; block < PROBE_REPORT_AFTER_BLOCKS; block += 1) {
      setFrame(frame);
      node.process([], outputs);
      frame += block === 5 ? QUANTUM * 3 : QUANTUM;
    }
    expect(node.port.posted[0]).toMatchObject({ misses: 1 });
  });
});

/** Drive a limiter node over whole channels, one render quantum at a time. */
const stream = (node: { process(i: Float32Array[][], o: Float32Array[][]): boolean }, input: Float32Array[], outChannels = 2) => {
  const length = input[0]?.length ?? 0;
  const out = Array.from({ length: outChannels }, () => new Float32Array(length));
  for (let at = 0; at < length; at += QUANTUM) {
    const size = Math.min(QUANTUM, length - at);
    const inputs = [input.map((lane) => lane.subarray(at, at + size))];
    const outputs = [Array.from({ length: outChannels }, () => new Float32Array(size))];
    expect(node.process(inputs, outputs)).toBe(true);
    outputs[0].forEach((lane, channel) => out[channel].set(lane, at));
  }
  return out;
};

const burst = (length: number) => {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const loud = index > length / 3 && index < length / 2 ? 3 : 0.3;
    left[index] = loud * Math.sin(index / 5);
    right[index] = loud * Math.sin(index / 9 + 1);
  }
  return [left, right];
};

describe('the limiter processor', () => {
  const sampleRate = 44100;
  const options = limiterProcessorOptions(sampleRate);
  const make = () => {
    const { registered } = loadProcessorSource(LIMITER_PROCESSOR_SOURCE, sampleRate);
    return new (registered.get(LIMITER_PROCESSOR)!)({ processorOptions: options });
  };

  it('matches the offline dsp/limiter.ts process() sample for sample, delayed by its lookahead', () => {
    const node = make();
    const input = burst(40000);
    const streamed = stream(node, input);
    const reference = limit(input, { sampleRate });
    const delay = limiterDelaySamples(options);
    let worst = 0;
    // Skip the warm-up, where the offline reference pads with its first sample instead of silence.
    for (let channel = 0; channel < 2; channel += 1) {
      for (let k = 2 * options.windowSamples; k < input[0].length - delay; k += 1) {
        worst = Math.max(worst, Math.abs(streamed[channel][k + delay] - reference[channel][k]));
      }
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it('never lets a sample past the ceiling', () => {
    const node = make();
    const streamed = stream(node, burst(30000));
    const peak = Math.max(...streamed.map((lane) => lane.reduce((most, value) => Math.max(most, Math.abs(value)), 0)));
    expect(peak).toBeLessThanOrEqual(options.ceilingLinear + 1e-6);
  });

  it('answers stats with processing evidence only', () => {
    const node = make();
    stream(node, burst(4096));
    node.port.send({ type: 'stats' });
    const stats = node.port.posted.at(-1) as LimiterStats;
    expect(stats).toMatchObject({ type: 'limiter-stats', blocks: 32, frames: 4096, sampleRate, delaySamples: limiterDelaySamples(options) });
    expect(stats.peakIn).toBeGreaterThan(1);
    expect(stats.peakOut).toBeLessThanOrEqual(options.ceilingLinear + 1e-6);
    expect(Object.keys(stats)).not.toContain('audible');
  });

  it('copies a mono input to both outputs and treats no input as silence', () => {
    const node = make();
    const mono = burst(2048)[0];
    const out = stream(node, [mono]);
    expect(Array.from(out[0])).toEqual(Array.from(out[1]));
    const quiet = make();
    const outputs = [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]];
    expect(quiet.process([[]], outputs)).toBe(true);
    expect(outputs[0][0].every((value) => value === 0)).toBe(true);
  });

  it('refuses to start without the coefficients from limiterCoefficients', () => {
    const { registered } = loadProcessorSource(LIMITER_PROCESSOR_SOURCE, sampleRate);
    const Limiter = registered.get(LIMITER_PROCESSOR)!;
    expect(() => new Limiter({})).toThrow(/needs ceilingLinear/);
  });
});
