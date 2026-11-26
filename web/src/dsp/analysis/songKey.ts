/** The song's key from its averaged chroma: an exact port of `analysis/key.py::chroma_key` and
 * `camelot`, the Desktop's own fallback when the neural key model is unavailable
 * (`pipeline.analyse_audio`: the chroma key with confidence 0.2). The neural model (S-KEY) is
 * not available in Cloud (ADR-0479, "Not decided here"), so this is the key the device reports.
 *
 * It scores by the plain dot product of the centred profile with each centred, rotated
 * Krumhansl-Schmuckler template, as Python does; `key.ts::matchKey` (the lightweight estimate)
 * uses a normalised correlation instead and can pick differently, so it is not used here.
 */

import { KS_MAJOR, KS_MINOR, PITCH_NAMES } from './key';

const f32 = Math.fround;

/** Camelot numbers by pitch class, from `_CAMELOT_MAJOR` and `_CAMELOT_MINOR`. */
const CAMELOT_MAJOR: Record<number, number> = { 0: 8, 7: 9, 2: 10, 9: 11, 4: 12, 11: 1, 6: 2, 1: 3, 8: 4, 3: 5, 10: 6, 5: 7 };
const CAMELOT_MINOR: Record<number, number> = { 9: 8, 4: 9, 11: 10, 6: 11, 1: 12, 8: 1, 3: 2, 10: 3, 5: 4, 0: 5, 7: 6, 2: 7 };

/** The confidence the Desktop gives a chroma-only key. */
export const CHROMA_KEY_CONFIDENCE = 0.2;

function centredTemplate(template: readonly number[]): number[] {
  let total = 0;
  for (const value of template) total += value;
  const centre = total / template.length;
  return template.map((value) => value - centre);
}

/** `chroma_key(chroma_profile)` for a float32 profile: e.g. 'A minor'. */
export function chromaKey(profile: Float32Array): string {
  let total = 0;
  for (let k = 0; k < 12; k += 1) total += profile[k];
  const centre = f32(total / 12);
  const centred = Array.from(profile, (value) => f32(value - centre));
  let bestScore = -Infinity;
  let bestName = 'C major';
  const templates: Array<[number[], string]> = [[centredTemplate(KS_MAJOR), 'major'], [centredTemplate(KS_MINOR), 'minor']];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const [template, label] of templates) {
      let score = 0;
      // np.roll(template, tonic): element k comes from k - tonic
      for (let k = 0; k < 12; k += 1) score += centred[k] * template[(k - tonic + 12) % 12];
      if (score > bestScore) {
        bestScore = score;
        bestName = `${PITCH_NAMES[tonic]} ${label}`;
      }
    }
  }
  return bestName;
}

/** `camelot(name)`: '8B' for C major, '8A' for A minor. */
export function camelotOfKey(name: string): string {
  const [note, mode] = name.split(' ');
  const pitch = (PITCH_NAMES as readonly string[]).indexOf(note);
  return mode.toLowerCase() === 'major' ? `${CAMELOT_MAJOR[pitch]}B` : `${CAMELOT_MINOR[pitch]}A`;
}
