import { describe, expect, it } from 'vitest';
import { chromaProfile, estimateKey, matchKey, KEY_IMPLEMENTATION } from './key';

const SR = 22050;

function toneStack(freqsHz: number[], seconds: number): Float32Array {
  const output = new Float32Array(Math.round(seconds * SR));
  for (const freqHz of freqsHz) {
    for (let index = 0; index < output.length; index += 1) {
      output[index] += 0.15 * Math.sin((2 * Math.PI * freqHz * index) / SR);
    }
  }
  return output;
}

describe('lightweight chroma key estimate', () => {
  it('hears a C major triad stack as C major', () => {
    // C4, E4, G4, C5.
    const estimate = estimateKey(toneStack([261.6256, 329.6276, 391.9954, 523.2511], 3), SR);
    expect(estimate.key).toBe('C');
    expect(estimate.mode).toBe('major');
    expect(estimate.confidence).toBeGreaterThan(0);
  });

  it('hears an A minor triad stack as A minor', () => {
    // A3, C4, E4, A4.
    const estimate = estimateKey(toneStack([220, 261.6256, 329.6276, 440], 3), SR);
    expect(estimate.key).toBe('A');
    expect(estimate.mode).toBe('minor');
  });

  it('puts the chroma energy in the sounded pitch classes', () => {
    const chroma = chromaProfile(toneStack([261.6256, 329.6276, 391.9954], 3), SR);
    const sounded = [0, 4, 7]; // C, E, G
    for (const pitchClass of sounded) {
      expect(chroma[pitchClass]).toBeGreaterThan(0.3);
    }
    expect(Math.max(chroma[1], chroma[6], chroma[10])).toBeLessThan(0.3);
  });

  it('is marked as the lightweight implementation, never the neural engine', () => {
    const estimate = matchKey([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]);
    expect(estimate.implementation).toBe('lightweight-chroma-v1');
    expect(KEY_IMPLEMENTATION).not.toMatch(/neural|skey|s-key/i);
  });
});
