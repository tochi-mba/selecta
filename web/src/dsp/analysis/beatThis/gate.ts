/** Which beat source this device measures songs with, and why (ADR-0459 Tier 3).
 *
 * The neural tracker runs only when all of these hold, checked in this order:
 * - its Tier 3 record has passed (`BEATS_LICENCE_RECORD`, model.ts);
 * - the model file is on this device and matches its published fingerprint (fetched once from
 *   SelectaDJ's own site; a failed fetch waits a day before the next try, and data saver skips it);
 * - this device is fast enough: the first song measured with it is timed, and a device that
 *   takes more than half a second of work per second of audio (`BEAT_MAX_MS_PER_AUDIO_SECOND`)
 *   keeps the lighter beat finder. The benchmark is kept 30 days, as the stem splitter's is.
 * Otherwise the interim source measures, exactly as before, and the reason is a plain sentence
 * the capability roster shows.
 */

import { BROWSER_BEATS_IMPLEMENTATION, NEURAL_BEATS_IMPLEMENTATION } from '../deviceAnalysisIds';
import type { StemModelManager } from '../../stems/model';
import { BEAT_MODEL_ARTEFACT, BEATS_LICENCE_RECORD, beatModelManager, beatModelVerifiedHere } from './model';

export const BEAT_CALIBRATION_IMPLEMENTATION = 'beat-model-song-v1';
/** Work per second of audio this device must stay under. */
export const BEAT_MAX_MS_PER_AUDIO_SECOND = 500;
export const BEAT_CALIBRATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** After a failed fetch or a failed run, wait this long before trying the model again. */
export const BEAT_RETRY_MS = 24 * 60 * 60 * 1000;

const CALIBRATION_KEY = 'selecta.dsp.beats.calibration';
const FAILURE_KEY = 'selecta.dsp.beats.failure';

export const BEATS_NOT_SIGNED_REASON = "the neural beat tracker's licence and device review is open, so SelectaDJ uses its lighter beat finder";
export const BEATS_TOO_SLOW_REASON = 'this device measures beats too slowly for the neural tracker, so SelectaDJ uses its lighter beat finder here';
export const BEATS_NOT_HERE_REASON = 'the neural beat tracker is not on this device, so SelectaDJ uses its lighter beat finder here';
export const BEATS_FAILED_REASON = 'the neural beat tracker could not be fetched or run here, so SelectaDJ tries again tomorrow';
export const BEATS_SAVE_DATA_REASON = 'data saver is on, so SelectaDJ does not fetch the neural beat tracker';

export interface BeatCalibration {
  implementation: typeof BEAT_CALIBRATION_IMPLEMENTATION;
  sha256: string;
  msPerAudioSecond: number;
  measuredAt: number;
}

export type BeatSourceChoice =
  | { kind: 'neural'; implementation: string; sha256: string; calibrated: boolean }
  | { kind: 'interim'; implementation: string; reason: string };

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): KeyValue | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(store: KeyValue | null, key: string): T | null {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(store: KeyValue | null, key: string, value: unknown): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the device is measured again next visit.
  }
}

export function readBeatCalibration(store = storage()): BeatCalibration | null {
  return readJson<BeatCalibration>(store, CALIBRATION_KEY);
}

/** Supported, unsupported with a reason, or not measured yet (the next song measures it). */
export function beatCalibrationState(
  calibration: BeatCalibration | null,
  sha256 = BEAT_MODEL_ARTEFACT.sha256,
  now = Date.now(),
): { supported: true } | { supported: false; reason: string } | { supported: 'unknown' } {
  if (!calibration || calibration.implementation !== BEAT_CALIBRATION_IMPLEMENTATION || calibration.sha256 !== sha256 ||
      !Number.isFinite(calibration.measuredAt) || calibration.measuredAt > now || now - calibration.measuredAt > BEAT_CALIBRATION_MAX_AGE_MS ||
      !(calibration.msPerAudioSecond >= 0)) {
    return { supported: 'unknown' };
  }
  return calibration.msPerAudioSecond <= BEAT_MAX_MS_PER_AUDIO_SECOND ? { supported: true } : { supported: false, reason: BEATS_TOO_SLOW_REASON };
}

/** Keep the benchmark from one song measured with the tracker. */
export function recordBeatBenchmark(beatMs: number, audioSeconds: number, store = storage(), now = Date.now()): BeatCalibration | null {
  if (!(audioSeconds > 0) || !(beatMs >= 0)) return null;
  const calibration: BeatCalibration = {
    implementation: BEAT_CALIBRATION_IMPLEMENTATION,
    sha256: BEAT_MODEL_ARTEFACT.sha256,
    msPerAudioSecond: beatMs / audioSeconds,
    measuredAt: now,
  };
  writeJson(store, CALIBRATION_KEY, calibration);
  return calibration;
}

/** The model could not be fetched, verified or run: keep the lighter source for a day. */
export function noteBeatModelFailure(store = storage(), now = Date.now()): void {
  writeJson(store, FAILURE_KEY, { at: now });
}

function recentFailure(store: KeyValue | null, now: number): boolean {
  const failure = readJson<{ at?: number }>(store, FAILURE_KEY);
  return typeof failure?.at === 'number' && failure.at <= now && now - failure.at < BEAT_RETRY_MS;
}

function saveData(): boolean {
  try {
    return Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  } catch {
    return false;
  }
}

const interim = (reason: string): BeatSourceChoice => ({ kind: 'interim', implementation: BROWSER_BEATS_IMPLEMENTATION, reason });

export interface ChooseOptions {
  manager?: StemModelManager;
  store?: KeyValue | null;
  now?: number;
  licenceRecord?: string | null;
  /** Fetch the file when it is missing (the profiler); the roster only looks. */
  fetch?: boolean;
  saveData?: boolean;
}

let shared: StemModelManager | null = null;

/** The source the next song is measured with. Never throws. */
export async function chooseBeatSource(options: ChooseOptions = {}): Promise<BeatSourceChoice> {
  const store = options.store === undefined ? storage() : options.store;
  const now = options.now ?? Date.now();
  const record = options.licenceRecord === undefined ? BEATS_LICENCE_RECORD : options.licenceRecord;
  if (!record) return interim(BEATS_NOT_SIGNED_REASON);
  const speed = beatCalibrationState(readBeatCalibration(store), BEAT_MODEL_ARTEFACT.sha256, now);
  if (speed.supported === false) return interim(speed.reason);
  if (recentFailure(store, now)) return interim(BEATS_FAILED_REASON);
  const manager = options.manager ?? (shared ??= beatModelManager());
  try {
    let state = await manager.refresh();
    if (state.kind === 'absent' && options.fetch) {
      if (options.saveData ?? saveData()) return interim(BEATS_SAVE_DATA_REASON);
      state = await manager.download();
    }
    if (state.kind === 'ready') {
      return { kind: 'neural', implementation: NEURAL_BEATS_IMPLEMENTATION, sha256: BEAT_MODEL_ARTEFACT.sha256, calibrated: speed.supported === true };
    }
    if (state.kind === 'failed') {
      noteBeatModelFailure(store, now);
      return interim(BEATS_FAILED_REASON);
    }
    return interim(BEATS_NOT_HERE_REASON);
  } catch {
    noteBeatModelFailure(store, now);
    return interim(BEATS_FAILED_REASON);
  }
}

/** What the capability roster reads, synchronously: supported, or the reason it is not. */
export function neuralBeatsState(store = storage(), now = Date.now(), licenceRecord = BEATS_LICENCE_RECORD): { supported: true } | { supported: false; reason: string } {
  if (!licenceRecord) return { supported: false, reason: BEATS_NOT_SIGNED_REASON };
  if (!beatModelVerifiedHere()) return { supported: false, reason: recentFailure(store, now) ? BEATS_FAILED_REASON : BEATS_NOT_HERE_REASON };
  const speed = beatCalibrationState(readBeatCalibration(store), BEAT_MODEL_ARTEFACT.sha256, now);
  if (speed.supported === false) return speed;
  if (speed.supported === 'unknown') return { supported: false, reason: 'SelectaDJ times the neural beat tracker on the next song it measures here' };
  return { supported: true };
}
