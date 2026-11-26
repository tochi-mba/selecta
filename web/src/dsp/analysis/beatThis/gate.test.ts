import { describe, expect, it } from 'vitest';
import type { StemModelManager, StemModelState } from '../../stems/model';
import { BROWSER_BEATS_IMPLEMENTATION, NEURAL_BEATS_IMPLEMENTATION } from '../deviceAnalysisIds';
import {
  BEAT_CALIBRATION_IMPLEMENTATION,
  BEAT_MAX_MS_PER_AUDIO_SECOND,
  BEAT_RETRY_MS,
  beatCalibrationState,
  BEATS_FAILED_REASON,
  BEATS_NOT_SIGNED_REASON,
  BEATS_SAVE_DATA_REASON,
  BEATS_TOO_SLOW_REASON,
  chooseBeatSource,
  readBeatCalibration,
  recordBeatBenchmark,
  type KeyValue,
} from './gate';
import { BEAT_MODEL_ARTEFACT, BEATS_TIER3_RECORD_ID, beatModelFileName } from './model';
import artefact from './artefact.json';

// Which beat source a device measures with (docs/engineering/device-beats.md): the neural tracker
// only with a passed record, the verified file and a fast enough device; otherwise the interim
// source, with a plain reason, exactly as before.

const NOW = 1_800_000_000_000;

function memoryStore(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
}

function manager(states: { refresh: StemModelState; download?: StemModelState }): StemModelManager & { downloads: number } {
  const fake = {
    downloads: 0,
    refresh: async () => states.refresh,
    download: async () => {
      fake.downloads += 1;
      return states.download ?? { kind: 'failed', why: 'network', detail: 'the server answered 404' };
    },
  };
  return fake as unknown as StemModelManager & { downloads: number };
}

const signed = { licenceRecord: BEATS_TIER3_RECORD_ID, now: NOW };

describe('choosing the beat source', () => {
  it('keeps the interim source while the Tier 3 record is open, and fetches nothing', async () => {
    const fake = manager({ refresh: { kind: 'absent' } });
    const choice = await chooseBeatSource({ manager: fake, store: memoryStore(), now: NOW, licenceRecord: null, fetch: true });
    expect(choice).toEqual({ kind: 'interim', implementation: BROWSER_BEATS_IMPLEMENTATION, reason: BEATS_NOT_SIGNED_REASON });
    expect(fake.downloads).toBe(0);
  });

  it('uses the tracker once the verified file is here, uncalibrated until a song is timed', async () => {
    const choice = await chooseBeatSource({ ...signed, manager: manager({ refresh: { kind: 'ready' } }), store: memoryStore() });
    expect(choice).toEqual({ kind: 'neural', implementation: NEURAL_BEATS_IMPLEMENTATION, sha256: BEAT_MODEL_ARTEFACT.sha256, calibrated: false });
  });

  it('fetches a missing file when asked, and not with data saver on', async () => {
    const fetching = manager({ refresh: { kind: 'absent' }, download: { kind: 'ready' } });
    expect((await chooseBeatSource({ ...signed, manager: fetching, store: memoryStore(), fetch: true, saveData: false })).kind).toBe('neural');
    expect(fetching.downloads).toBe(1);
    const saving = manager({ refresh: { kind: 'absent' }, download: { kind: 'ready' } });
    expect(await chooseBeatSource({ ...signed, manager: saving, store: memoryStore(), fetch: true, saveData: true }))
      .toMatchObject({ kind: 'interim', reason: BEATS_SAVE_DATA_REASON });
    expect(saving.downloads).toBe(0);
  });

  it('keeps the interim source for a day when the file is not published or fails its fingerprint', async () => {
    const store = memoryStore();
    for (const failed of [{ kind: 'failed', why: 'network', detail: 'the server answered 404' }, { kind: 'failed', why: 'checksum' }] as StemModelState[]) {
      store.data.clear();
      const fake = manager({ refresh: { kind: 'absent' }, download: failed });
      expect(await chooseBeatSource({ ...signed, manager: fake, store, fetch: true, saveData: false })).toMatchObject({ kind: 'interim', reason: BEATS_FAILED_REASON });
      // asked again within the day: no second fetch
      const again = manager({ refresh: { kind: 'absent' }, download: { kind: 'ready' } });
      expect(await chooseBeatSource({ ...signed, manager: again, store, now: NOW + BEAT_RETRY_MS - 1, fetch: true, saveData: false })).toMatchObject({ kind: 'interim' });
      expect(again.downloads).toBe(0);
      // a day later it tries again
      expect((await chooseBeatSource({ ...signed, manager: again, store, now: NOW + BEAT_RETRY_MS, fetch: true, saveData: false })).kind).toBe('neural');
    }
  });

  it('keeps the interim source on a device too slow for the tracker, and says so', async () => {
    const store = memoryStore();
    recordBeatBenchmark(BEAT_MAX_MS_PER_AUDIO_SECOND * 1.2 * 180, 180, store, NOW);
    expect(await chooseBeatSource({ ...signed, manager: manager({ refresh: { kind: 'ready' } }), store }))
      .toEqual({ kind: 'interim', implementation: BROWSER_BEATS_IMPLEMENTATION, reason: BEATS_TOO_SLOW_REASON });
  });

  it('keeps a fast device on the tracker, calibrated', async () => {
    const store = memoryStore();
    const calibration = recordBeatBenchmark(200 * 240, 240, store, NOW);
    expect(calibration).toMatchObject({ implementation: BEAT_CALIBRATION_IMPLEMENTATION, msPerAudioSecond: 200, sha256: artefact.sha256 });
    expect(readBeatCalibration(store)).toEqual(calibration);
    expect(await chooseBeatSource({ ...signed, manager: manager({ refresh: { kind: 'ready' } }), store })).toMatchObject({ kind: 'neural', calibrated: true });
  });

  it('measures the device again after 30 days, or for another model', () => {
    const calibration = recordBeatBenchmark(9_000, 10, memoryStore(), NOW)!;
    expect(beatCalibrationState(calibration, artefact.sha256, NOW)).toEqual({ supported: false, reason: BEATS_TOO_SLOW_REASON });
    expect(beatCalibrationState(calibration, artefact.sha256, NOW + 31 * 24 * 3600 * 1000)).toEqual({ supported: 'unknown' });
    expect(beatCalibrationState(calibration, 'f'.repeat(64), NOW)).toEqual({ supported: 'unknown' });
    expect(beatCalibrationState(calibration, artefact.sha256, NOW - 1)).toEqual({ supported: 'unknown' });
  });
});

describe('the model artefact', () => {
  it('names a content-hashed path on SelectaDJ\'s own site and its own private file', () => {
    expect(BEAT_MODEL_ARTEFACT.url).toBe(`/models/beat-this/web-beatthis-small0-1/${artefact.sha256}.onnx`);
    expect(BEAT_MODEL_ARTEFACT.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(BEAT_MODEL_ARTEFACT.bytes).toBe(10_527_297);
    expect(beatModelFileName(artefact.sha256)).toBe(`cache-beats-model-${artefact.sha256}.onnx`);
  });
});
