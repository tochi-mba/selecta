import { describe, expect, it } from 'vitest';
import { analyse } from './analysisWorker';

const SR = 22050;

function clickTrack(bpm: number, seconds: number): Float32Array {
  const output = new Float32Array(Math.round(seconds * SR));
  const burst = Math.round(0.01 * SR);
  const period = 60 / bpm;
  for (let click = 0; click * period < seconds; click += 1) {
    const first = Math.round(click * period * SR);
    for (let index = 0; index < burst && first + index < output.length; index += 1) {
      const hann = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (burst - 1)));
      output[first + index] += 0.8 * hann * Math.sin((2 * Math.PI * 1000 * index) / SR);
    }
  }
  return output;
}

describe('analysis worker body', () => {
  it('runs the requested estimates and echoes the request id', () => {
    const response = analyse({
      id: 7,
      sampleRate: SR,
      pcm: clickTrack(120, 8),
      tasks: ['onsets', 'tempo'],
    });
    expect(response.id).toBe(7);
    expect(response.tempo).toBeDefined();
    expect(Math.abs((response.tempo?.bpm ?? 0) - 120)).toBeLessThan(3);
    expect(response.onsetTimes?.length).toBeGreaterThan(10);
    expect(response.key).toBeUndefined(); // not asked for
    expect(response.error).toBeUndefined();
  });

  it('reports a failure as data instead of crashing the worker', () => {
    const response = analyse({
      id: 8,
      sampleRate: Number.NaN,
      pcm: new Float32Array(16),
      tasks: ['tempo'],
    });
    expect(response.id).toBe(8);
    // Either a degenerate zero-confidence estimate or a recorded error; never a throw.
    expect(response.error !== undefined || response.tempo !== undefined).toBe(true);
  });
});
