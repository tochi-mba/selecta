import { describe, expect, it } from 'vitest';
import { echoTailSeconds, washImpulse } from './seamEffects';

function fakeContext() {
  return {
    sampleRate: 8000,
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, getChannelData: (channel: number) => data[channel] };
    },
  } as unknown as BaseAudioContext;
}

describe('the seam echo and wash returns', () => {
  it('rings an echo until its repeats fall below -60 dB, and never for ever', () => {
    expect(echoTailSeconds({ delaySeconds: 0.5, feedback: 0.5, wet: 0.2, returnHighpassHz: 300, dampLowpassHz: 6000 })).toBeCloseTo(5, 6);
    expect(echoTailSeconds({ delaySeconds: 2, feedback: 0.99, wet: 0.2, returnHighpassHz: 300, dampLowpassHz: 6000 })).toBe(12);
  });

  it('builds the same decaying room every time, quieter at the end than the start', () => {
    const spec = { wet: 0.2, decaySeconds: 1, damping: 0.45, returnHighpassHz: 350 };
    const one = washImpulse(fakeContext(), spec).getChannelData(0);
    const two = washImpulse(fakeContext(), spec).getChannelData(0);
    expect(one.length).toBe(8000);
    expect([...one.slice(0, 50)]).toEqual([...two.slice(0, 50)]);
    const energy = (from: number, to: number) => one.slice(from, to).reduce((sum, value) => sum + value * value, 0);
    expect(energy(7000, 8000)).toBeLessThan(energy(0, 1000) / 100);
  });
});
