import { describe, expect, it } from 'vitest';
import {
  armCrashGuard,
  BATTERY_REASON,
  batteryPauseReason,
  CRASH_REASON,
  crashGuardState,
  disarmCrashGuard,
  measureStemCalibration,
  noticeCrashOnLoad,
  recallStemCalibration,
  rememberStemCalibration,
  retryAfterCrash,
  STEM_CALIBRATION_IMPLEMENTATION,
  STEM_CALIBRATION_MAX_AGE_MS,
  stemCalibrationState,
  THERMAL_REASON,
  ThermalWatch,
  watchBattery,
  type KeyValueStore,
  type StemCalibration,
} from './gate';

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: (key) => { map.delete(key); } };
}

const NOW = 1_800_000_000_000;
const SHA = 'cd'.repeat(32);
const calibration = (overrides: Partial<StemCalibration> = {}): StemCalibration => ({
  implementation: STEM_CALIBRATION_IMPLEMENTATION,
  deviceId: 'dev',
  modelImplementation: 'htdemucs-onnx-v1',
  modelSha256: SHA,
  backend: 'webgpu',
  calibratedAt: NOW,
  audioSeconds: 7.8,
  secondsPerAudioSecond: 0.2,
  ...overrides,
});

describe('crash guard', () => {
  it('a normal close (pagehide) mid-split clears the marker, so only a real crash trips the guard', () => {
    const store = memoryStore();
    armCrashGuard(store, NOW);
    expect(store.map.size).toBe(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(store.map.size).toBe(0);
    expect(noticeCrashOnLoad(store, NOW)).toEqual({ clear: true });
  });

  it('pagehide leaves alone a store whose split already ended, and a page that died keeps its marker', () => {
    const ended = memoryStore();
    armCrashGuard(ended, NOW);
    disarmCrashGuard(ended);
    ended.setItem('unrelated', 'kept');
    window.dispatchEvent(new Event('pagehide'));
    expect(ended.map.get('unrelated')).toBe('kept');
    // no pagehide: the browser killed the page mid-separation
    const killed = memoryStore();
    armCrashGuard(killed, NOW);
    expect(noticeCrashOnLoad(killed, NOW)).toMatchObject({ clear: false, reason: CRASH_REASON });
  });

  it('a marker left by a page that died trips the guard until the member retries', () => {
    const store = memoryStore();
    expect(noticeCrashOnLoad(store, NOW)).toEqual({ clear: true });
    armCrashGuard(store, NOW);
    disarmCrashGuard(store);
    expect(noticeCrashOnLoad(store, NOW)).toEqual({ clear: true });
    armCrashGuard(store, NOW); // the page dies here
    expect(noticeCrashOnLoad(store, NOW + 5)).toEqual({ clear: false, reason: CRASH_REASON, at: NOW + 5 });
    expect(crashGuardState(store).clear).toBe(false);
    retryAfterCrash(store);
    expect(crashGuardState(store)).toEqual({ clear: true });
  });

  it('works without storage rather than throwing', () => {
    expect(noticeCrashOnLoad(null)).toEqual({ clear: true });
    expect(() => armCrashGuard(null)).not.toThrow();
  });
});

describe('stem benchmark', () => {
  it('passes only a fresh, faster than half-realtime measurement of this device and model', () => {
    expect(stemCalibrationState(calibration(), 'dev', SHA, NOW)).toEqual({ supported: true });
    expect(stemCalibrationState(null, 'dev', SHA, NOW)).toMatchObject({ supported: false, reason: expect.stringMatching(/not been measured/) });
    expect(stemCalibrationState(calibration(), 'other', SHA, NOW)).toMatchObject({ supported: false, reason: expect.stringMatching(/different device/) });
    expect(stemCalibrationState(calibration(), 'dev', 'ef'.repeat(32), NOW)).toMatchObject({ supported: false, reason: expect.stringMatching(/different splitter/) });
    expect(stemCalibrationState(calibration({ calibratedAt: NOW - STEM_CALIBRATION_MAX_AGE_MS - 1 }), 'dev', SHA, NOW)).toMatchObject({ supported: false, reason: expect.stringMatching(/stale/) });
    expect(stemCalibrationState(calibration({ secondsPerAudioSecond: 0.51 }), 'dev', SHA, NOW)).toMatchObject({ supported: false, reason: expect.stringMatching(/too slowly/) });
  });

  it('times a synthetic window through the separator, guarded, and remembers it per device', async () => {
    const store = memoryStore();
    let tick = 0;
    let guardedDuringRun = false;
    const made = await measureStemCalibration({
      separate: async ([left]) => {
        guardedDuringRun = store.map.has('selecta.dsp.stems.crashGuard');
        expect(left.length).toBe(44100);
        return { backend: 'wasm' };
      },
      deviceId: 'dev',
      modelSha256: SHA,
      clock: () => (tick += 300),
      now: NOW,
      samples: 44100,
    }, store);
    expect(guardedDuringRun).toBe(true);
    expect(store.map.has('selecta.dsp.stems.crashGuard')).toBe(false);
    expect(made).toMatchObject({ backend: 'wasm', audioSeconds: 1, deviceId: 'dev' });
    expect(made.secondsPerAudioSecond).toBeCloseTo(0.3, 6);
    rememberStemCalibration(made, store);
    expect(recallStemCalibration('dev', SHA, store, NOW)).toEqual(made);
    expect(recallStemCalibration('dev', 'ef'.repeat(32), store, NOW)).toBeNull();
  });
});

describe('power', () => {
  it('pauses on battery below 20 % only', () => {
    expect(batteryPauseReason({ charging: false, level: 0.1 })).toBe(BATTERY_REASON);
    expect(batteryPauseReason({ charging: true, level: 0.1 })).toBeNull();
    expect(batteryPauseReason({ charging: false, level: 0.5 })).toBeNull();
    expect(batteryPauseReason(null)).toBeNull();
  });

  it('follows battery changes where the browser reports them', async () => {
    const listeners = new Map<string, () => void>();
    const battery = { charging: false, level: 0.5, addEventListener: (type: string, fn: () => void) => listeners.set(type, fn), removeEventListener: (type: string) => listeners.delete(type) };
    const seen: (string | null)[] = [];
    const stop = await watchBattery((reason) => seen.push(reason), { getBattery: async () => battery });
    battery.level = 0.1;
    listeners.get('levelchange')?.();
    expect(seen).toEqual([null, BATTERY_REASON]);
    stop();
    expect(listeners.size).toBe(0);
    expect(await watchBattery(() => undefined, {})).toBeTypeOf('function');
  });

  it('a run of slow jobs reads as a thermal slowdown', () => {
    const watch = new ThermalWatch(0.2);
    expect(watch.record(10, 2)).toBeNull();
    expect(watch.record(10, 4)).toBeNull();
    expect(watch.record(10, 4)).toBeNull();
    expect(watch.record(10, 4)).toBe(THERMAL_REASON);
    expect(watch.misses).toBe(3);
    expect(watch.record(10, 1)).toBeNull();
  });
});
