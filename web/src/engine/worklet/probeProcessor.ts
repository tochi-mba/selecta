import { processorSource, WorkletScope } from './scope';

/** The capability probe's processor (ADR-0457, BF-0457-02).
 *
 * It does nothing musical: it counts the render quanta it is actually given, watches the frame
 * counter for gaps (a jump means the engine skipped scheduling it), and posts one report. The
 * main thread treats a missing report as a failed probe. Writing silence is enough work; the
 * point is proving that process() runs at all on this device, which some browsers claim and
 * then fail to do.
 *
 * `defineProbeProcessor` runs inside the worklet scope only, from PROBE_PROCESSOR_SOURCE.
 */

export const PROBE_PROCESSOR = 'selecta-probe';
export const PROBE_REPORT_AFTER_BLOCKS = 32;

function defineProbeProcessor(name: string, reportAfter: number): void {
  const scope = globalThis as unknown as WorkletScope;

  // No class fields: every transpiler (Vite, Vitest, Playwright's Babel) emits this the same
  // way, so the source text the browser gets is plain class syntax.
  type State = { blocks: number; misses: number; expectedFrame: number; reported: boolean; port: MessagePort };

  class ProbeProcessor extends scope.AudioWorkletProcessor {
    constructor() {
      super();
      const initial = { blocks: 0, misses: 0, expectedFrame: -1, reported: false };
      Object.assign(this, initial);
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
      const self = this as unknown as State;
      const frame = scope.currentFrame;
      const quantum = outputs[0] && outputs[0][0] ? outputs[0][0].length : 128;
      self.blocks += 1;
      if (self.expectedFrame >= 0 && frame !== self.expectedFrame) self.misses += 1;
      self.expectedFrame = frame + quantum;
      if (!self.reported && self.blocks >= reportAfter) {
        self.reported = true;
        self.port.postMessage({
          type: 'probe-report',
          blocks: self.blocks,
          misses: self.misses,
          sampleRate: scope.sampleRate,
        });
      }
      // Keep running until the report is away, then let the node be collected.
      return !self.reported;
    }
  }

  scope.registerProcessor(name, ProbeProcessor);
}

export const PROBE_PROCESSOR_SOURCE = processorSource(defineProbeProcessor, PROBE_PROCESSOR, PROBE_REPORT_AFTER_BLOCKS);
