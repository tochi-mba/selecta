import { describe, expect, it } from 'vitest';
import {
  WorkerBudget,
  MIN_HORIZON_S,
  CALIBRATION_MARGIN,
  WORKER_CALIBRATION_IMPLEMENTATION,
  WORKER_CALIBRATION_MAX_AGE_MS,
  workerBudgetEvidenceState,
  workerCalibrationState,
  type WorkerBudgetEvidence,
  type WorkerCalibration,
} from './budget';

const NOW = 1_700_000_000_000;
const DEVICE = 'budget-test-device';
const calibration = (overrides: Partial<WorkerCalibration> = {}): WorkerCalibration => ({
  implementation: WORKER_CALIBRATION_IMPLEMENTATION,
  deviceId: DEVICE,
  calibratedAt: NOW,
  samples: 3,
  msPerBlock: 12,
  horizonS: 30,
  ...overrides,
});
const evidence = (overrides: Partial<WorkerBudgetEvidence> = {}): WorkerBudgetEvidence => ({
  calibration: calibration(),
  deviceId: DEVICE,
  atFloor: false,
  deadlineMisses: 0,
  ...overrides,
});

describe('worker scheduling budget', () => {
  it('calibrates from benchmark samples with headroom', () => {
    const budget = WorkerBudget.fromBenchmark([2, 3, 8, 4]);
    expect(budget.msPerBlock).toBeCloseTo(8 * CALIBRATION_MARGIN, 9);
    expect(budget.horizonS).toBeGreaterThan(0);
  });

  it('counts deadline misses', () => {
    const budget = new WorkerBudget({ msPerBlock: 5, horizonS: 30 });
    expect(budget.recordBlock(4)).toBe(false);
    expect(budget.recordBlock(6)).toBe(true);
    expect(budget.recordBlock(50)).toBe(true);
    expect(budget.deadlineMisses).toBe(2);
  });

  it('shrinks the horizon in steps down to the floor, never below', () => {
    const budget = new WorkerBudget({ msPerBlock: 5, horizonS: 40 });
    expect(budget.shrinkHorizon()).toBe(20);
    expect(budget.shrinkHorizon()).toBe(10);
    expect(budget.shrinkHorizon()).toBe(MIN_HORIZON_S);
    expect(budget.shrinkHorizon()).toBe(MIN_HORIZON_S); // at the floor it stays put
    expect(budget.atFloor).toBe(true);
    expect(budget.shrinks).toBe(3);
  });

  it('refuses a nonsensical budget', () => {
    expect(() => new WorkerBudget({ msPerBlock: 0, horizonS: 30 })).toThrow();
    expect(() => WorkerBudget.fromBenchmark([])).toThrow();
  });

  it('accepts only a fresh calibration bound to this device', () => {
    expect(workerCalibrationState(calibration(), DEVICE, NOW).supported).toBe(true);
    expect(workerCalibrationState(calibration(), 'other-device', NOW)).toMatchObject({ supported: false, reason: expect.stringMatching(/different device/) });
    expect(workerCalibrationState(calibration({ calibratedAt: NOW - WORKER_CALIBRATION_MAX_AGE_MS - 1 }), DEVICE, NOW)).toMatchObject({ supported: false, reason: expect.stringMatching(/stale/) });
    expect(workerCalibrationState(calibration({ calibratedAt: NOW + 1 }), DEVICE, NOW)).toMatchObject({ supported: false, reason: expect.stringMatching(/invalid/) });
    expect(workerCalibrationState(calibration({ samples: 0 }), DEVICE, NOW)).toMatchObject({ supported: false, reason: expect.stringMatching(/invalid/) });
  });

  it('rejects missing, mismatched and exhausted runtime evidence', () => {
    expect(workerBudgetEvidenceState(null, NOW).supported).toBe(false);
    expect(workerBudgetEvidenceState(evidence({ deviceId: 'other-device' }), NOW)).toMatchObject({ supported: false, reason: expect.stringMatching(/different device/) });
    expect(workerBudgetEvidenceState(evidence({ atFloor: true }), NOW)).toMatchObject({ supported: false, reason: expect.stringMatching(/out of headroom/) });
    expect(workerBudgetEvidenceState(evidence({ deadlineMisses: -1 }), NOW)).toMatchObject({ supported: false, reason: expect.stringMatching(/invalid/) });
  });
});
