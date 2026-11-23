/** Whether this device may split stems right now (ADR-0459 Tier 3).
 *
 * Three device checks, each with a plain reason:
 * - Crash guard: a marker is written before inference and removed after, and
 *   also on `pagehide` when the page closes normally. A page that loads and finds it still
 *   there knows the last attempt took the page down, and stems stay off here until the member
 *   chooses to try again.
 * - Benchmark ('stem-worker-roundtrip-v1'): a short synthetic window through the real worker.
 *   Supported only when separation runs at most 0.5 s per second of audio (twice realtime), on
 *   this device, with this model, within 30 days.
 * - Power: on battery below 20 % separation pauses; a run of jobs well over the benchmark (a
 *   device slowing down to stay cool) pauses it too.
 */

import { STEM_MODEL, STEM_SEGMENT_SAMPLES } from './model';
import type { StemBackend } from './runtime';

export const STEM_CALIBRATION_IMPLEMENTATION = 'stem-worker-roundtrip-v1';
/** Seconds of compute per second of audio this device must beat. */
export const STEM_MAX_SECONDS_PER_AUDIO_SECOND = 0.5;
export const STEM_CALIBRATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const LOW_BATTERY_LEVEL = 0.2;
/** A job counts as slow at this multiple of the benchmarked speed. */
export const THERMAL_SLOW_FACTOR = 1.5;
/** This many slow jobs in a row pause separation. */
export const THERMAL_SLOW_RUN = 3;

const GUARD_KEY = 'selecta.dsp.stems.crashGuard';
const TRIPPED_KEY = 'selecta.dsp.stems.crashTripped';
const CALIBRATION_KEY = (deviceId: string) => `selecta.dsp.stems.calibration.${deviceId}`;
export const CRASH_REASON = 'the last attempt to split stems on this device stopped the page';

export interface KeyValueStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function safely<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

export type CrashGuardState = { clear: true } | { clear: false; reason: string; at: number | null };

/** Call once per page load, before any inference: a marker left behind means the previous page
 * died mid-separation. */
export function noticeCrashOnLoad(store: KeyValueStore | null = defaultStore(), now = Date.now()): CrashGuardState {
  if (!store) return { clear: true };
  const left = safely(() => store.getItem(GUARD_KEY), null);
  if (left !== null) {
    safely(() => store.setItem(TRIPPED_KEY, JSON.stringify({ at: now })), undefined);
    safely(() => store.removeItem(GUARD_KEY), undefined);
  }
  return crashGuardState(store);
}

export function crashGuardState(store: KeyValueStore | null = defaultStore()): CrashGuardState {
  if (!store) return { clear: true };
  const tripped = safely(() => store.getItem(TRIPPED_KEY), null);
  if (tripped === null) return { clear: true };
  const at = safely(() => (JSON.parse(tripped) as { at?: unknown }).at, null);
  return { clear: false, reason: CRASH_REASON, at: typeof at === 'number' ? at : null };
}

/** The stores whose marker a normal page close should clear. */
const armedStores = new Set<KeyValueStore>();
let pageHideWatched = false;

/** A normal close (tab closed, reload, navigating away) fires `pagehide`; a page the browser
 * killed mid-separation does not. Clearing the marker there means only a real crash trips the
 * guard, so closing the tab during a split never turns stems off on this device. */
function watchPageHide(): void {
  if (pageHideWatched || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  pageHideWatched = true;
  window.addEventListener('pagehide', () => {
    for (const store of armedStores) safely(() => store.removeItem(GUARD_KEY), undefined);
    armedStores.clear();
  });
}

/** Set just before inference starts. */
export function armCrashGuard(store: KeyValueStore | null = defaultStore(), now = Date.now()): void {
  if (!store) return;
  safely(() => store.setItem(GUARD_KEY, JSON.stringify({ at: now, implementation: STEM_MODEL.implementation })), undefined);
  armedStores.add(store);
  watchPageHide();
}

/** Cleared as soon as inference ends, whether it succeeded, failed or was cancelled. */
export function disarmCrashGuard(store: KeyValueStore | null = defaultStore()): void {
  if (!store) return;
  safely(() => store.removeItem(GUARD_KEY), undefined);
  armedStores.delete(store);
}

/** The member chose "try again" in the UI. */
export function retryAfterCrash(store: KeyValueStore | null = defaultStore()): void {
  if (store) {
    safely(() => store.removeItem(TRIPPED_KEY), undefined);
    safely(() => store.removeItem(GUARD_KEY), undefined);
  }
}

export interface StemCalibration {
  implementation: typeof STEM_CALIBRATION_IMPLEMENTATION;
  deviceId: string;
  modelImplementation: string;
  modelSha256: string;
  backend: StemBackend;
  calibratedAt: number;
  audioSeconds: number;
  secondsPerAudioSecond: number;
}

export type StemCalibrationState = { supported: true } | { supported: false; reason: string };

export function stemCalibrationState(
  calibration: StemCalibration | null | undefined,
  deviceId: string | null | undefined,
  modelSha256: string | null | undefined,
  now = Date.now(),
): StemCalibrationState {
  if (!calibration) return { supported: false, reason: 'this device has not been measured for stem splitting yet' };
  if (!deviceId?.trim() || calibration.deviceId !== deviceId) {
    return { supported: false, reason: 'the stem measurement belongs to a different device' };
  }
  if (calibration.implementation !== STEM_CALIBRATION_IMPLEMENTATION || !modelSha256 ||
      calibration.modelSha256 !== modelSha256 || calibration.modelImplementation !== STEM_MODEL.implementation) {
    return { supported: false, reason: 'the stem measurement was made with a different splitter; measure again' };
  }
  if (!Number.isFinite(calibration.calibratedAt) || calibration.calibratedAt > now ||
      now - calibration.calibratedAt > STEM_CALIBRATION_MAX_AGE_MS ||
      !(calibration.audioSeconds > 0) || !Number.isFinite(calibration.secondsPerAudioSecond) ||
      calibration.secondsPerAudioSecond <= 0) {
    return { supported: false, reason: 'the stem measurement is missing, stale or invalid; measure this device again' };
  }
  if (calibration.secondsPerAudioSecond > STEM_MAX_SECONDS_PER_AUDIO_SECOND) {
    return { supported: false, reason: 'this device splits stems too slowly to have them ready in time' };
  }
  return { supported: true };
}

/** A short synthetic stereo window: tones plus noise, so every stem path does real work. */
export function syntheticStemWindow(samples = STEM_SEGMENT_SAMPLES, sampleRate = STEM_MODEL.sampleRate): [Float32Array, Float32Array] {
  const left = new Float32Array(samples);
  const right = new Float32Array(samples);
  let seed = 12345;
  for (let index = 0; index < samples; index += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const noise = (seed / 0xffffffff - 0.5) * 0.05;
    const t = index / sampleRate;
    const tone = 0.3 * Math.sin(2 * Math.PI * 55 * t) + 0.2 * Math.sin(2 * Math.PI * 440 * t);
    left[index] = tone + noise;
    right[index] = tone - noise;
  }
  return [left, right];
}

export interface MeasureOptions {
  separate: (channels: [Float32Array, Float32Array]) => Promise<{ backend: StemBackend }>;
  deviceId: string;
  modelSha256: string;
  clock?: () => number;
  now?: number;
  samples?: number;
}

/** Time one synthetic window through the real separator. Guarded like any inference. */
export async function measureStemCalibration(options: MeasureOptions, store: KeyValueStore | null = defaultStore()): Promise<StemCalibration> {
  const clock = options.clock ?? (() => performance.now());
  const samples = options.samples ?? STEM_SEGMENT_SAMPLES;
  const window = syntheticStemWindow(samples);
  armCrashGuard(store);
  const started = clock();
  try {
    const { backend } = await options.separate(window);
    const tookS = Math.max(0, clock() - started) / 1000;
    const audioSeconds = samples / STEM_MODEL.sampleRate;
    return {
      implementation: STEM_CALIBRATION_IMPLEMENTATION,
      deviceId: options.deviceId,
      modelImplementation: STEM_MODEL.implementation,
      modelSha256: options.modelSha256,
      backend,
      calibratedAt: options.now ?? Date.now(),
      audioSeconds,
      secondsPerAudioSecond: tookS / audioSeconds,
    };
  } finally {
    disarmCrashGuard(store);
  }
}

export function recallStemCalibration(deviceId: string, modelSha256: string | null, store: KeyValueStore | null = defaultStore(), now = Date.now()): StemCalibration | null {
  if (!store) return null;
  const raw = safely(() => store.getItem(CALIBRATION_KEY(deviceId)), null);
  if (!raw) return null;
  const kept = safely(() => JSON.parse(raw) as StemCalibration, null);
  // A slow measurement is still kept: it is the honest reason stems stay off here.
  if (!kept) return null;
  const state = stemCalibrationState(kept, deviceId, modelSha256, now);
  return state.supported || /too slowly/.test(state.reason) ? kept : null;
}

export function rememberStemCalibration(calibration: StemCalibration, store: KeyValueStore | null = defaultStore()): void {
  if (store) safely(() => store.setItem(CALIBRATION_KEY(calibration.deviceId), JSON.stringify(calibration)), undefined);
}

export interface BatteryLike {
  charging: boolean;
  level: number;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

export const BATTERY_REASON = 'the battery is low, so stem splitting waits for the charger';
export const THERMAL_REASON = 'this device is slowing down to stay cool, so stem splitting is paused';

export function batteryPauseReason(battery: BatteryLike | null | undefined): string | null {
  if (!battery) return null;
  return !battery.charging && Number.isFinite(battery.level) && battery.level < LOW_BATTERY_LEVEL ? BATTERY_REASON : null;
}

/** Follow the battery where the browser reports it; resolves to an unsubscribe. */
export async function watchBattery(
  onChange: (reason: string | null) => void,
  nav: { getBattery?: () => Promise<BatteryLike> } | undefined = typeof navigator !== 'undefined' ? (navigator as unknown as { getBattery?: () => Promise<BatteryLike> }) : undefined,
): Promise<() => void> {
  if (!nav?.getBattery) return () => undefined;
  let battery: BatteryLike;
  try {
    battery = await nav.getBattery();
  } catch {
    return () => undefined;
  }
  const report = () => onChange(batteryPauseReason(battery));
  report();
  battery.addEventListener?.('levelchange', report);
  battery.addEventListener?.('chargingchange', report);
  return () => {
    battery.removeEventListener?.('levelchange', report);
    battery.removeEventListener?.('chargingchange', report);
  };
}

/** Counts jobs that ran well over the benchmarked speed; a run of them is a thermal slowdown. */
export class ThermalWatch {
  private slowRun = 0;
  misses = 0;

  constructor(private readonly expectedSecondsPerAudioSecond: number) {}

  /** Record one finished job; returns the pause reason once slow jobs keep coming. */
  record(audioSeconds: number, tookSeconds: number): string | null {
    if (!(audioSeconds > 0) || !(this.expectedSecondsPerAudioSecond > 0)) return null;
    const slow = tookSeconds / audioSeconds > this.expectedSecondsPerAudioSecond * THERMAL_SLOW_FACTOR;
    if (slow) {
      this.misses += 1;
      this.slowRun += 1;
    } else {
      this.slowRun = 0;
    }
    return this.slowRun >= THERMAL_SLOW_RUN ? THERMAL_REASON : null;
  }

  reset(): void {
    this.slowRun = 0;
  }
}
