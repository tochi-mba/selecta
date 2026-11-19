/** Worker scheduling budget (ADR-0459, BF-0459-06).
 *
 * Analysis and seam preparation run in workers under a benchmark-calibrated budget that never
 * steals audio-callback time. The budget says how many milliseconds one work block may take
 * and how many seconds of material should be prepared ahead. When blocks start missing their
 * deadline (thermal collapse mid-set), `shrinkHorizon` steps the prepared horizon down before
 * the callback starves: the member sees the simplified state, audio never glitches as the
 * first symptom. Deadline misses are counted so the state can be surfaced truthfully.
 */

export interface ScheduleBudget {
  /** The longest one worker block may take, in milliseconds. */
  msPerBlock: number;
  /** How many seconds of material to keep prepared ahead of playback. */
  horizonS: number;
}

export const DEFAULT_HORIZON_S = 30;
export const MIN_HORIZON_S = 5;
/** Each shrink step halves the horizon until the floor. */
export const SHRINK_FACTOR = 0.5;
/** Headroom applied over the benchmarked block time. */
export const CALIBRATION_MARGIN = 1.5;
/** A worker calibration is device evidence, not a process-wide default. */
export const WORKER_CALIBRATION_IMPLEMENTATION = 'analysis-worker-roundtrip-v1';
/** Recalibrate after 30 days; older measurements are not evidence for this device today. */
export const WORKER_CALIBRATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface WorkerCalibration {
  implementation: typeof WORKER_CALIBRATION_IMPLEMENTATION;
  /** Stable, locally derived device identity supplied by the capability probe. */
  deviceId: string;
  calibratedAt: number;
  samples: number;
  msPerBlock: number;
  horizonS: number;
}

/** Runtime evidence combines immutable calibration with the live budget's degradation state. */
export interface WorkerBudgetEvidence {
  calibration: WorkerCalibration;
  deviceId: string;
  atFloor: boolean;
  deadlineMisses: number;
}

export type WorkerCalibrationState =
  | { supported: true; reason?: undefined }
  | { supported: false; reason: string };

/** Validate device binding and age every time evidence is consumed. Future timestamps fail closed. */
export function workerCalibrationState(
  calibration: WorkerCalibration | null | undefined,
  deviceId: string | null | undefined,
  now = Date.now(),
  maxAgeMs = WORKER_CALIBRATION_MAX_AGE_MS,
): WorkerCalibrationState {
  if (!calibration) return { supported: false, reason: 'this device has not been measured yet, so lightweight analysis stays off' };
  if (!deviceId?.trim() || calibration.deviceId !== deviceId) {
    return { supported: false, reason: 'the worker calibration belongs to a different device' };
  }
  if (calibration.implementation !== WORKER_CALIBRATION_IMPLEMENTATION ||
      !Number.isFinite(calibration.calibratedAt) || calibration.calibratedAt > now ||
      now - calibration.calibratedAt > maxAgeMs) {
    return { supported: false, reason: 'the worker calibration is missing, stale, or invalid; measure this device again' };
  }
  if (!Number.isInteger(calibration.samples) || calibration.samples < 1 ||
      !Number.isFinite(calibration.msPerBlock) || calibration.msPerBlock <= 0 ||
      !Number.isFinite(calibration.horizonS) || calibration.horizonS <= MIN_HORIZON_S) {
    return { supported: false, reason: 'the worker calibration is invalid; measure this device again' };
  }
  return { supported: true };
}

export function workerBudgetEvidenceState(
  evidence: WorkerBudgetEvidence | null | undefined,
  now = Date.now(),
): WorkerCalibrationState {
  if (!evidence) return workerCalibrationState(null, null, now);
  const calibration = workerCalibrationState(evidence.calibration, evidence.deviceId, now);
  if (!calibration.supported) return calibration;
  if (typeof evidence.atFloor !== 'boolean' || !Number.isInteger(evidence.deadlineMisses) || evidence.deadlineMisses < 0) {
    return { supported: false, reason: 'the worker budget state is invalid; measure this device again' };
  }
  if (evidence.atFloor) return { supported: false, reason: 'this device is out of headroom, so lightweight analysis is paused' };
  return { supported: true };
}

export class WorkerBudget implements ScheduleBudget {
  msPerBlock: number;
  horizonS: number;
  readonly minHorizonS: number;
  deadlineMisses = 0;
  shrinks = 0;

  constructor(budget: ScheduleBudget, minHorizonS = MIN_HORIZON_S) {
    if (!(budget.msPerBlock > 0) || !(budget.horizonS > 0)) {
      throw new Error('A budget needs positive msPerBlock and horizonS.');
    }
    this.msPerBlock = budget.msPerBlock;
    this.horizonS = budget.horizonS;
    this.minHorizonS = Math.min(minHorizonS, budget.horizonS);
  }

  /** Calibrate from benchmark samples: the worst observed block time plus headroom. */
  static fromBenchmark(blockTimesMs: number[], horizonS = DEFAULT_HORIZON_S): WorkerBudget {
    const finite = blockTimesMs.filter((ms) => Number.isFinite(ms) && ms >= 0);
    if (finite.length === 0) {
      throw new Error('Calibration needs at least one benchmark sample.');
    }
    const worst = Math.max(...finite);
    return new WorkerBudget({ msPerBlock: Math.max(worst * CALIBRATION_MARGIN, 1), horizonS });
  }

  /** Rehydrate only a calibration that was checked against this exact device and current time. */
  static fromCalibration(calibration: WorkerCalibration, deviceId: string, now = Date.now()): WorkerBudget | null {
    if (!workerCalibrationState(calibration, deviceId, now).supported) return null;
    return new WorkerBudget({ msPerBlock: calibration.msPerBlock, horizonS: calibration.horizonS });
  }

  /** Record one finished block; returns true when it missed its deadline. */
  recordBlock(tookMs: number): boolean {
    const missed = tookMs > this.msPerBlock;
    if (missed) {
      this.deadlineMisses += 1;
    }
    return missed;
  }

  /** Step the prepared horizon down toward the floor; returns the new horizon. */
  shrinkHorizon(): number {
    const next = Math.max(this.horizonS * SHRINK_FACTOR, this.minHorizonS);
    if (next < this.horizonS) {
      this.shrinks += 1;
      this.horizonS = next;
    }
    return this.horizonS;
  }

  /** True once the horizon can shrink no further: the surfaced "simplified" state. */
  get atFloor(): boolean {
    return this.horizonS <= this.minHorizonS;
  }

  snapshot(): ScheduleBudget & { deadlineMisses: number; shrinks: number; atFloor: boolean } {
    return {
      msPerBlock: this.msPerBlock,
      horizonS: this.horizonS,
      deadlineMisses: this.deadlineMisses,
      shrinks: this.shrinks,
      atFloor: this.atFloor,
    };
  }
}
