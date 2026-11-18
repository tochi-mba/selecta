import { ENGINE_VERSION } from '../../engine';
import type { ProbeResult } from '../../engine';
import { WorkerBudget } from '../../dsp/budget';
import { directoryInput, dirPicker, opfs, storageSpace } from '../../media';
import type { OutputRoute } from '../onboarding/state';
import { BenchmarkResult, buildRecord, CapabilityRecord, CodecAnswer, MediaSourceKind, Probes, workletEvidence } from './capabilityRecord';
import { deviceIdentity, DeviceIdentity } from './deviceIdentity';

/** The probe suite (ADR-0460, BF-0460-01): every probe this device can run without a person,
 * gathered into one capability record. Each probe is feature detection or a measurement; none of
 * them asks who the device is. The worklet probe needs a running AudioContext, so the caller runs
 * it from a press (the venue flow's "Check this tablet") and passes the answer in. */

/** The common formats a music library holds, with the MIME type the browser is asked about. */
export const CODECS: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  flac: 'audio/flac',
  opus: 'audio/ogg; codecs="opus"',
  wav: 'audio/wav',
};

type CanPlay = { canPlayType(type: string): string };

export function codecAnswers(element: CanPlay | null = typeof Audio === 'undefined' ? null : new Audio()): Record<string, CodecAnswer> {
  const answers: Record<string, CodecAnswer> = {};
  for (const [name, mime] of Object.entries(CODECS)) {
    let said = '';
    try {
      said = element?.canPlayType(mime) ?? '';
    } catch {
      said = '';
    }
    answers[name] = said === 'probably' || said === 'maybe' ? said : '';
  }
  return answers;
}

export const BENCHMARK_IMPLEMENTATION = 'synthetic-biquad-main-thread-v1';
const BLOCK = 128;

/** A calibrated-shape synthetic DSP benchmark: a stereo biquad over 128-frame blocks, timed per
 * batch. It runs on the main thread, so it measures this device's general headroom, not the audio
 * thread itself; the record names the implementation so nobody mistakes one for the other. */
export function runBenchmark(options: { batches?: number; blocksPerBatch?: number; now?: () => number } = {}): BenchmarkResult {
  const now = options.now ?? (typeof performance !== 'undefined' ? () => performance.now() : null);
  if (!now) return { ran: false, reason: 'this browser has no high-resolution clock.' };
  const batches = options.batches ?? 12;
  const perBatch = options.blocksPerBatch ?? 64;
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  for (let i = 0; i < BLOCK; i += 1) { left[i] = Math.sin(i / 7); right[i] = Math.cos(i / 5); }
  // A low-pass biquad's coefficients; the numbers matter less than doing real per-sample work.
  const b0 = 0.0675, b1 = 0.135, b2 = 0.0675, a1 = -1.143, a2 = 0.4128;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, sink = 0;
  const times: number[] = [];
  for (let batch = 0; batch < batches; batch += 1) {
    const start = now();
    for (let block = 0; block < perBatch; block += 1) {
      for (const channel of [left, right]) {
        for (let i = 0; i < BLOCK; i += 1) {
          const x = channel[i];
          const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
          x2 = x1; x1 = x; y2 = y1; y1 = y;
          channel[i] = y;
          sink += y;
        }
      }
    }
    times.push((now() - start) / perBatch);
  }
  if (!Number.isFinite(sink)) return { ran: false, reason: 'the benchmark produced no usable numbers.' };
  const sorted = [...times].sort((a, b) => a - b);
  const budget = WorkerBudget.fromBenchmark(times);
  return {
    ran: true,
    implementation: BENCHMARK_IMPLEMENTATION,
    blocks: batches * perBatch,
    worstBlockMs: sorted[sorted.length - 1],
    medianBlockMs: sorted[Math.floor(sorted.length / 2)],
    budgetMsPerBlock: budget.msPerBlock,
  };
}

/** Whether output selection exists here (`setSinkId`), by feature detection. Its presence is not a
 * tested route: ADR-0460 uses it only on tuples where the route test passed. */
export function outputSelectionApi(): boolean {
  try {
    return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
  } catch {
    return false;
  }
}

export function wakeLockApi(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export type SuiteInput = {
  worklet: ProbeResult;
  output?: OutputRoute;
  codec?: string;
  mediaSource?: MediaSourceKind;
  /** Injectable for tests; the real probes by default. */
  identity?: () => Promise<DeviceIdentity>;
  codecs?: () => Record<string, CodecAnswer>;
  benchmark?: () => BenchmarkResult;
  now?: () => number;
};

/** Run every probe and file the answers as one record under the full tuple. */
export async function runProbeSuite(input: SuiteInput): Promise<CapabilityRecord> {
  const codecs = (input.codecs ?? codecAnswers)();
  const probes: Probes = {
    worklet: workletEvidence(input.worklet),
    storage: { opfs: opfs(), space: await storageSpace() },
    pickers: { directoryInput: directoryInput(), dirPicker: dirPicker() },
    codecs,
    benchmark: (input.benchmark ?? runBenchmark)(),
    outputSelection: outputSelectionApi(),
    wakeLockApi: wakeLockApi(),
  };
  // The record's codec is the one the member's music uses, where known; otherwise the first the
  // browser says it can play, so the tuple names something this device really answered for.
  const codec = input.codec ?? Object.keys(codecs).find((name) => codecs[name] === 'probably') ?? Object.keys(codecs).find((name) => codecs[name] !== '') ?? 'unknown';
  return buildRecord({
    identity: await (input.identity ?? deviceIdentity)(),
    engineVersion: ENGINE_VERSION,
    codec,
    mediaSource: input.mediaSource ?? 'local_file',
    output: input.output ?? 'unknown',
    probes,
    measuredAt: (input.now ?? (() => Date.now() / 1000))(),
  });
}
