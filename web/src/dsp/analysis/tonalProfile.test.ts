import { describe, expect, it } from 'vitest';
import { analyse } from '../workers/analysisWorker';
import { PITCH_NAMES } from './key';
import { camelotOf, EDGE_WINDOW_S, tonalProfile, TONAL_PROFILE_IMPLEMENTATION } from './tonalProfile';

// cloud.browser_harmonic: the whole-song tonal profile the browser measures for Harmonic matches.

const SR = 22050;
const C_MAJOR = [261.6256, 329.6276, 391.9954, 523.2511];
const F_SHARP_MAJOR = [369.9944, 466.1638, 554.3653];

function tones(freqsHz: number[], seconds: number): Float32Array {
  const output = new Float32Array(Math.round(seconds * SR));
  for (const freqHz of freqsHz) {
    for (let index = 0; index < output.length; index += 1) output[index] += 0.15 * Math.sin((2 * Math.PI * freqHz * index) / SR);
  }
  return output;
}

const loudest = (chroma: number[], count: number) => chroma.map((value, index) => [value, index]).sort((a, b) => b[0] - a[0]).slice(0, count).map(([, index]) => index).sort((a, b) => a - b);

describe('the Camelot code of a key', () => {
  it('names the wheel position of major and minor keys', () => {
    expect(camelotOf('C', 'major')).toBe('8B');
    expect(camelotOf('A', 'minor')).toBe('8A');
    expect(camelotOf('G', 'major')).toBe('9B');
    expect(camelotOf('E', 'minor')).toBe('9A');
    expect(camelotOf('B', 'major')).toBe('1B');
  });

  it('gives every key its own position, and nothing for a name it does not know', () => {
    for (const mode of ['major', 'minor'] as const) {
      const codes = PITCH_NAMES.map((name) => camelotOf(name, mode));
      expect(new Set(codes).size).toBe(12);
      for (const code of codes) expect(code).toMatch(mode === 'major' ? /^(1[0-2]|[1-9])B$/ : /^(1[0-2]|[1-9])A$/);
    }
    expect(camelotOf('H', 'major')).toBe('');
  });
});

describe('a whole-song tonal profile', () => {
  it('reads a C major song as C major at 8B, with twelve-bin profiles', () => {
    const profile = tonalProfile(tones(C_MAJOR, 3), SR);
    expect(profile.implementation).toBe(TONAL_PROFILE_IMPLEMENTATION);
    expect(profile.key).toBe('C');
    expect(profile.mode).toBe('major');
    expect(profile.camelot).toBe('8B');
    expect(profile.durationS).toBeCloseTo(3, 3);
    expect(profile.confidence).toBeGreaterThan(0);
    expect(profile.confidence).toBeLessThanOrEqual(1);
    for (const chroma of [profile.chroma, profile.intro, profile.outro]) expect(chroma).toHaveLength(12);
    expect(loudest(profile.chroma, 3)).toEqual([0, 4, 7]);
  });

  it('uses the whole song for its opening and closing when it is shorter than the edge window', () => {
    const profile = tonalProfile(tones(C_MAJOR, 3), SR);
    expect(profile.intro).toEqual(profile.chroma);
    expect(profile.outro).toEqual(profile.chroma);
  });

  it('profiles the opening and the closing stretch separately on a longer song', () => {
    const opening = tones(C_MAJOR, EDGE_WINDOW_S + 1);
    const closing = tones(F_SHARP_MAJOR, EDGE_WINDOW_S + 1);
    const song = new Float32Array(opening.length + closing.length);
    song.set(opening, 0);
    song.set(closing, opening.length);
    const profile = tonalProfile(song, SR);
    expect(loudest(profile.intro, 3)).toEqual([0, 4, 7]);
    expect(loudest(profile.outro, 3)).toEqual([1, 6, 10]);
    expect(profile.durationS).toBeCloseTo(2 * (EDGE_WINDOW_S + 1), 2);
  });

  it('is the same every time for the same audio', () => {
    const song = tones(C_MAJOR, 2);
    expect(tonalProfile(song, SR)).toEqual(tonalProfile(song, SR));
  });

  it('is measured by the analysis worker only when asked for', () => {
    const asked = analyse({ id: 1, sampleRate: SR, pcm: tones(C_MAJOR, 2), tasks: ['profile'] });
    expect(asked.profile?.camelot).toBe('8B');
    expect(asked.key).toBeUndefined();
    expect(asked.tempo).toBeUndefined();
    expect(analyse({ id: 2, sampleRate: SR, pcm: tones(C_MAJOR, 2) }).profile).toBeUndefined();
  });
});
