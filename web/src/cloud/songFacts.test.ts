import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeIndexedDb } from '../media/fakeIndexedDb';
import { assertMachineDerived, DerivedStore, resetDerivedStoreForTests } from '../media/derived';
import { BROWSER_BEATS_IMPLEMENTATION, DEVICE_ANALYSIS_IMPLEMENTATION, factsVersion } from '../dsp/analysis/deviceAnalysisIds';
import type { SongFacts } from '../dsp/analysis/song';
import { deviceFactsStore, songFacts } from './songFacts';

// Song facts measured on this device (cloud.device_analysis): kept in the device-wide derived
// store under kind `analysis`, keyed by content hash and by the analysis and beat-source ids.

const sha = 'c'.repeat(64);

function facts(): SongFacts {
  return {
    implementation: DEVICE_ANALYSIS_IMPLEMENTATION,
    analysis_version: 3,
    beat_source: BROWSER_BEATS_IMPLEMENTATION,
    beat_confidence: 0.8,
    sample_rate: 44100,
    duration_s: 180,
    row: {
      bpm: 124, constant_tempo: 1, grid_confidence: 0.9, beats_per_bar: 4, key: 'A minor', camelot: '8A',
      key_confidence: 0.2, key_agrees_chroma: 1, lufs: -9.5, peak_db: -0.3, energy: 0.61,
      sections: [{ start_bar: 0, end_bar: 16, label: 'verse', energy: 0.6, group: 0, chorus_prob: 0.2 }],
      timbre: new Array(29).fill(0.5),
    },
    arrays: {
      beats: Float64Array.from([0.5, 1, 1.5, 2]),
      bar_starts: Int32Array.from([0]),
      energy_bars: Float32Array.from([0.6]),
      low_share_bars: Float32Array.from([0.3]),
      rms_db_bars: Float32Array.from([-20]),
      chroma_bars: new Float32Array(12).fill(0.5),
      mfcc_bars: new Float32Array(20).fill(1),
      raw_beats: Float32Array.from([0.5, 1, 1.5, 2]),
      raw_downbeats: Float32Array.from([0.5]),
      peaks: Uint8Array.from([0, 128, 255]),
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', fakeIndexedDb());
  resetDerivedStoreForTests();
});

afterEach(() => {
  resetDerivedStoreForTests();
  vi.unstubAllGlobals();
});

describe('song facts in the derived store', () => {
  it('names the version by the analysis and the beat source together', () => {
    expect(factsVersion()).toBe('web-dsp-1+web-onset-comb-beats-1');
    expect(factsVersion('beat-this-onnx-1')).toBe('web-dsp-1+beat-this-onnx-1');
  });

  it('holds only machine-derived values', () => {
    expect(() => assertMachineDerived({ sha, version: factsVersion(), facts: facts() })).not.toThrow();
  });

  it('stores the facts and reads them back, arrays and all', async () => {
    const store = deviceFactsStore();
    expect(await store.has(sha)).toBe(false);
    expect(await songFacts(sha)).toBeNull();
    await store.put({ sha, version: factsVersion(), facts: facts() });
    expect(await store.has(sha)).toBe(true);
    const read = await songFacts(sha);
    expect(read?.row?.key).toBe('A minor');
    expect(read?.implementation).toBe('web-dsp-1');
    expect(Array.from(read!.arrays!.beats)).toEqual([0.5, 1, 1.5, 2]);
    expect(read!.arrays!.bar_starts).toBeInstanceOf(Int32Array);
  });

  it('skips nothing measured at the current version and measures an older one again', async () => {
    const derived = await DerivedStore.open();
    await derived.put('analysis', 'web-dsp-0+web-onset-comb-beats-1', sha, { sha, version: 'web-dsp-0+web-onset-comb-beats-1', facts: facts() });
    const store = deviceFactsStore();
    expect(await store.has(sha)).toBe(false);
    expect(await songFacts(sha)).toBeNull();
    await store.put({ sha, version: factsVersion(), facts: facts() });
    expect(await store.has(sha)).toBe(true);
  });

  it('remembers an unreadable song so it is not measured again, with no facts to read', async () => {
    const store = deviceFactsStore();
    await store.put({ sha, version: factsVersion(), unreadable: 'undecodable' });
    expect(await store.has(sha)).toBe(true);
    expect(await songFacts(sha)).toBeNull();
  });

  it('answers only a well-formed content hash', async () => {
    expect(await songFacts('not-a-hash')).toBeNull();
  });
});
