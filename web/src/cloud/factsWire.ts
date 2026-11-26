import { DEVICE_ANALYSIS_IMPLEMENTATION } from '../dsp/analysis/deviceAnalysisIds';
import type { SongFacts } from '../dsp/analysis/song';

/** One song's measurements as the account's `PUT /api/song-facts/{song_id}` takes them
 * (src/selecta/cloud_brain/facts_routes.py `FactsRequest`, engine_store/facts.py
 * `decode_arrays`; docs/engineering/device-to-account.md).
 *
 * Exactly the schema's fields and nothing else: the analysis row's scalars, the sections, and the
 * seven planner arrays as base64 of little-endian values with their declared shapes. The raw
 * beats, the raw downbeats, the waveform peaks and the timbre stay on this device. The song is
 * named by its content hash (the hash this device computed from the bytes it holds), never by
 * a path, a folder or a file name.
 */

export type WireArray = { dtype: '<f8' | '<f4' | '<i4'; shape: number[]; data: string };

export type FactsBody = {
  content_sha256: string;
  implementation: string;
  bpm: number;
  constant_tempo: boolean;
  grid_confidence: number;
  beats_per_bar: number;
  key: string;
  camelot: string;
  key_confidence: number;
  key_agrees_chroma: boolean;
  lufs: number;
  peak_db: number;
  energy: number;
  sections: { start_bar: number; end_bar: number; label: string; energy: number; group: number; chorus_prob: number }[];
  arrays: Record<'beats' | 'bar_starts' | 'energy_bars' | 'low_share_bars' | 'rms_db_bars' | 'chroma_bars' | 'mfcc_bars', WireArray>;
};

/** The body's top-level keys, in the schema's order. A test holds every request to this list. */
export const FACTS_FIELDS = [
  'content_sha256', 'implementation', 'bpm', 'constant_tempo', 'grid_confidence', 'beats_per_bar', 'key', 'camelot',
  'key_confidence', 'key_agrees_chroma', 'lufs', 'peak_db', 'energy', 'sections', 'arrays',
] as const;
export const FACTS_ARRAYS = ['beats', 'bar_starts', 'energy_bars', 'low_share_bars', 'rms_db_bars', 'chroma_bars', 'mfcc_bars'] as const;

const SHA256 = /^[0-9a-f]{64}$/;

/** Little-endian bytes of `values` in one wire type, whatever this machine's own byte order. */
function littleEndian(values: ArrayLike<number>, dtype: WireArray['dtype']): Uint8Array {
  const size = dtype === '<f8' ? 8 : 4;
  const bytes = new Uint8Array(values.length * size);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    if (dtype === '<f8') view.setFloat64(index * 8, values[index], true);
    else if (dtype === '<f4') view.setFloat32(index * 4, values[index], true);
    else view.setInt32(index * 4, values[index], true);
  }
  return bytes;
}

export function base64Of(bytes: Uint8Array): string {
  let text = '';
  // in slices, so a long song never passes a huge argument list
  for (let start = 0; start < bytes.length; start += 0x8000) text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(text);
}

function wire(values: ArrayLike<number>, dtype: WireArray['dtype'], shape: number[]): WireArray {
  return { dtype, shape, data: base64Of(littleEndian(values, dtype)) };
}

const finite = (...values: number[]) => values.every((value) => Number.isFinite(value));

/** The request body for one song, or null when there is nothing honest to send: no steady beat
 * (no row), a number the account can't hold (silence measures minus infinity), or arrays whose
 * lengths disagree. The account refuses rather than clamps, and so does this. */
export function factsBody(sha: string, facts: SongFacts): FactsBody | null {
  const row = facts.row;
  const arrays = facts.arrays;
  if (!row || !arrays || !SHA256.test(sha)) return null;
  if (!finite(row.bpm, row.grid_confidence, row.key_confidence, row.lufs, row.peak_db, row.energy)) return null;
  const bars = arrays.bar_starts.length;
  if (!bars || arrays.chroma_bars.length !== bars * 12 || arrays.mfcc_bars.length % bars !== 0) return null;
  for (const name of ['energy_bars', 'low_share_bars', 'rms_db_bars'] as const) if (arrays[name].length !== bars) return null;
  return {
    content_sha256: sha,
    // the account's allowlist names the analysis port; the beat source is in this device's own version
    implementation: DEVICE_ANALYSIS_IMPLEMENTATION,
    bpm: row.bpm,
    constant_tempo: row.constant_tempo === 1,
    grid_confidence: row.grid_confidence,
    beats_per_bar: row.beats_per_bar,
    key: row.key,
    camelot: row.camelot,
    key_confidence: row.key_confidence,
    key_agrees_chroma: row.key_agrees_chroma === 1,
    lufs: row.lufs,
    peak_db: row.peak_db,
    energy: row.energy,
    sections: row.sections.map(({ start_bar, end_bar, label, energy, group, chorus_prob }) => ({ start_bar, end_bar, label, energy, group, chorus_prob })),
    arrays: {
      beats: wire(arrays.beats, '<f8', [arrays.beats.length]),
      bar_starts: wire(arrays.bar_starts, '<i4', [bars]),
      energy_bars: wire(arrays.energy_bars, '<f4', [bars]),
      low_share_bars: wire(arrays.low_share_bars, '<f4', [bars]),
      rms_db_bars: wire(arrays.rms_db_bars, '<f4', [bars]),
      chroma_bars: wire(arrays.chroma_bars, '<f4', [bars, 12]),
      mfcc_bars: wire(arrays.mfcc_bars, '<f4', [bars, arrays.mfcc_bars.length / bars]),
    },
  };
}
