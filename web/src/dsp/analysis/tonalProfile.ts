/** Whole-song tonal profile for browser harmonic matches (cloud.browser_harmonic).
 *
 * Implementation 'tonal-profile-v1'. Three averaged 12-bin chroma profiles: the whole song, its
 * opening and its closing stretch, plus the whole song's key from the same Krumhansl-Schmuckler
 * match `estimateKey` uses. Averaging discards the order of notes, so a profile supports a broad
 * tonal resemblance between two songs and nothing more: it is not local mode's bar-by-bar chord
 * sequence search (`src/selecta/discovery/sequence.py`), and must never be presented as one.
 *
 * Frames are 4096-sample Hann frames like the key estimate, but with a 4096-sample hop: a whole
 * song is profiled, so overlap buys little and would quadruple the work.
 */

import { chromaProfile, KEY_FRAME_SIZE, matchKey, PITCH_NAMES } from './key';

export const TONAL_PROFILE_IMPLEMENTATION = 'tonal-profile-v1';
/** How long the opening and closing windows are. */
export const EDGE_WINDOW_S = 30;
const HOP = KEY_FRAME_SIZE;

export interface TonalProfile {
  implementation: string;
  /** Whole-song chroma, each bin over the loudest (index 0 = C). */
  chroma: number[];
  /** The first EDGE_WINDOW_S seconds, or the whole song when it is shorter. */
  intro: number[];
  /** The last EDGE_WINDOW_S seconds, or the whole song when it is shorter. */
  outro: number[];
  key: string;
  mode: 'major' | 'minor';
  /** In [0, 1], as `matchKey` reports it. */
  confidence: number;
  /** Camelot code of the key, e.g. '8B'. */
  camelot: string;
  durationS: number;
}

/** Camelot wheel numbers by pitch class (index 0 = C), major ('B') and minor ('A'). */
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

export function camelotOf(key: string, mode: 'major' | 'minor'): string {
  const index = (PITCH_NAMES as readonly string[]).indexOf(key);
  if (index < 0) return '';
  return mode === 'major' ? `${CAMELOT_MAJOR[index]}B` : `${CAMELOT_MINOR[index]}A`;
}

/** Profile one mono channel. Pure and deterministic. */
export function tonalProfile(channel: Float32Array, sampleRate: number): TonalProfile {
  const edge = Math.min(channel.length, Math.round(EDGE_WINDOW_S * sampleRate));
  const chroma = chromaProfile(channel, sampleRate, KEY_FRAME_SIZE, HOP);
  const intro = chromaProfile(channel.subarray(0, edge), sampleRate, KEY_FRAME_SIZE, HOP);
  const outro = chromaProfile(channel.subarray(channel.length - edge), sampleRate, KEY_FRAME_SIZE, HOP);
  const key = matchKey(chroma);
  return {
    implementation: TONAL_PROFILE_IMPLEMENTATION,
    chroma, intro, outro,
    key: key.key, mode: key.mode, confidence: key.confidence,
    camelot: camelotOf(key.key, key.mode),
    durationS: channel.length / sampleRate,
  };
}
