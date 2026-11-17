/** Worker scheduling budget (ADR-0459, BF-0459-06).
 *
 * Analysis and seam preparation run in workers under a benchmark-calibrated budget that never
 * steals audio-callback time. The budget says how many milliseconds one work block may take
 * and how many seconds of material should be prepared ahead. When blocks start missing their
 * deadline (thermal collapse mid-set), `shrinkHorizon` steps the prepared horizon down before
 * the callback starves: the member sees the simplified state, audio never glitches as the
 * first symptom. Deadline misses are counted so the state can be surfaced truthfully.
 */

export const BUDGET_IMPLEMENTATION = 'benchmark-calibrated-worker-budget-v1';

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
