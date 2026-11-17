import { describe, expect, it } from 'vitest';
import {
  integratedLoudness,
  samplePeakDb,
  truePeakDb,
  LOUDNESS_IMPLEMENTATION,
  TRUE_PEAK_IMPLEMENTATION,
} from './loudness';

const SR = 48000;

function stereoTone(freqHz: number, amplitude: number, seconds: number): Float32Array[] {
  const length = Math.round(seconds * SR);
  const channel = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    channel[index] = amplitude * Math.sin((2 * Math.PI * freqHz * index) / SR);
  }
  return [channel, channel.slice()];
}

describe('integrated loudness (BS.1770 style)', () => {
  it('reads a -23 LUFS stereo 997 Hz tone within tolerance', () => {
    // Loudness of identical stereo channels: -0.691 + 10*log10(2 * a^2 / 2) = -0.691 + 20*log10(a).
    // For -23 LUFS: a = 10 ** ((-23 + 0.691) / 20). K-weighting is ~0 dB at 997 Hz.
    const amplitude = 10 ** ((-23 + 0.691) / 20);
    const lufs = integratedLoudness(stereoTone(997, amplitude, 5), SR);
    expect(lufs).toBeGreaterThan(-23.5);
    expect(lufs).toBeLessThan(-22.5);
  });

  it('a louder tone reads proportionally louder (gain linearity)', () => {
    const quiet = integratedLoudness(stereoTone(997, 0.05, 3), SR);
    const loud = integratedLoudness(stereoTone(997, 0.1, 3), SR);
    expect(loud - quiet).toBeGreaterThan(5.5);
    expect(loud - quiet).toBeLessThan(6.5);
  });

  it('gates out silence: leading silence does not drag the number down', () => {
    const tone = stereoTone(997, 0.1, 3);
    const padded = tone.map((channel) => {
      const output = new Float32Array(channel.length + 3 * SR);
      output.set(channel, 3 * SR);
      return output;
    });
    const plain = integratedLoudness(tone, SR);
    const withSilence = integratedLoudness(padded, SR);
    expect(Math.abs(withSilence - plain)).toBeLessThan(0.3);
  });

  it('returns -Infinity for silence', () => {
    expect(integratedLoudness([new Float32Array(SR)], SR)).toBe(-Infinity);
  });
});

describe('true peak (4x polyphase FIR)', () => {
  it('finds the inter-sample peak a sample reader misses', () => {
    // A sine at fs/4 with a 45 degree phase offset: every sample lands at +-0.7071 while the
    // waveform itself reaches 1.0 between samples.
    const length = 4 * SR;
    const channel = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      channel[index] = Math.sin((Math.PI / 2) * index + Math.PI / 4);
    }
    const samples = samplePeakDb([channel]);
    const truePeak = truePeakDb([channel]);
    expect(samples).toBeLessThan(-2.9); // the sample reader sees -3.01 dB
    expect(truePeak).toBeGreaterThan(-1.0); // the oversampled reader recovers ~0 dBTP
    expect(truePeak).toBeLessThan(0.5);
  });

  it('agrees with the sample peak when samples land on the crest', () => {
    const channel = new Float32Array(SR);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = 0.5 * Math.sin((2 * Math.PI * 100 * index) / SR);
    }
    const truePeak = truePeakDb([channel]);
    expect(Math.abs(truePeak - 20 * Math.log10(0.5))).toBeLessThan(0.2);
  });

  it('implementation ids state the methods honestly', () => {
    expect(LOUDNESS_IMPLEMENTATION).toContain('bs1770');
    expect(TRUE_PEAK_IMPLEMENTATION).toContain('polyphase');
    expect(TRUE_PEAK_IMPLEMENTATION).not.toContain('linear');
  });
});
