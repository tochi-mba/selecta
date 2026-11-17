import { describe, expect, it } from 'vitest';
import { WorkerBudget, MIN_HORIZON_S, CALIBRATION_MARGIN } from './budget';

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
});
