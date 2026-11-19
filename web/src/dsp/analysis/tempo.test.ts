import { describe, expect, it } from 'vitest';
import { detectOnsets } from './onsets';
import { estimateTempo, AMBIGUOUS_CONFIDENCE_CAP, TEMPO_IMPLEMENTATION } from './tempo';

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

describe('onset detection', () => {
  it('finds roughly one onset per click on a 120 BPM track', () => {
    const onsets = detectOnsets(clickTrack(120, 10), SR);
    // 10 s at 120 BPM holds 20 clicks; the first frame has no flux reference.
    expect(onsets.onsetTimes.length).toBeGreaterThan(15);
    expect(onsets.onsetTimes.length).toBeLessThan(25);
    expect(onsets.implementation).toContain('spectral-flux');
  });
});

describe('tempo estimation', () => {
  it('finds a 120 BPM click track confidently and unambiguously', () => {
    const tempo = estimateTempo(detectOnsets(clickTrack(120, 10), SR));
    expect(Math.abs(tempo.bpm - 120)).toBeLessThan(2.5);
    expect(tempo.ambiguous).toBe(false);
    expect(tempo.confidence).toBeGreaterThan(0.4);
    expect(tempo.implementation).toBe(TEMPO_IMPLEMENTATION);
  });

  it('flags the half-time trap: a uniform 170 BPM click reads equally as 85 BPM', () => {
    const tempo = estimateTempo(detectOnsets(clickTrack(170, 10), SR));
    expect(tempo.ambiguous).toBe(true);
    expect(tempo.confidence).toBeLessThanOrEqual(AMBIGUOUS_CONFIDENCE_CAP);
    // The number it does report is one of the two honest octave readings.
    const near = (target: number) => Math.abs(tempo.bpm - target) < 4;
    expect(near(170) || near(85)).toBe(true);
  });

  it('returns a zero-confidence estimate for silence instead of inventing a tempo', () => {
    const tempo = estimateTempo(detectOnsets(new Float32Array(SR * 2), SR));
    expect(tempo.confidence).toBe(0);
  });
});
