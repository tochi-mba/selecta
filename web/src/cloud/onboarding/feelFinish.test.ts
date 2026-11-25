import { describe, expect, it } from 'vitest';
import { toneLevelOf } from './deps';
import { songName } from './OnboardingSpine';

describe('onboarding feel (ADR-0477)', () => {
  it('measures the check tone from its own samples: silence is 0, the full tone is 1', () => {
    expect(toneLevelOf(new Float32Array(0))).toBe(0);
    expect(toneLevelOf(new Float32Array(256))).toBe(0);
    const tone = Float32Array.from({ length: 512 }, (_, index) => 0.15 * Math.sin((2 * Math.PI * index) / 64));
    expect(toneLevelOf(tone)).toBeCloseTo(1, 1);
    const half = tone.map((sample) => sample / 2);
    expect(toneLevelOf(half)).toBeCloseTo(0.5, 1);
  });

  it('names a song by its file, without the folder or the extension', () => {
    expect(songName('Music/House/Night Drive.mp3')).toBe('Night Drive');
    expect(songName('C:\\Songs\\Track 01.flac')).toBe('Track 01');
    expect(songName('A very long song title that keeps going on.m4a').length).toBeLessThanOrEqual(28);
  });
});
