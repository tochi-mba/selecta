/** The capability probe's processor (ADR-0457, BF-0457-02).
 *
 * It does nothing musical: it counts the render quanta it is actually given, watches the frame
 * counter for gaps (a jump means the engine skipped scheduling it), and posts one report. The
 * main thread treats a missing report as a failed probe. Writing silence is enough work; the
 * point is proving that process() runs at all on this device, which some browsers claim and
 * then fail to do.
 *
 * The name 'selecta-probe' is repeated in probe.ts; worklet files load in their own scope, so
 * they share no imports with the page.
 */

const REPORT_AFTER_BLOCKS = 32;

class ProbeProcessor extends AudioWorkletProcessor {
  private blocks = 0;
  private misses = 0;
  private expectedFrame: number | null = null;
  private reported = false;

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    this.blocks += 1;
    const quantum = outputs[0]?.[0]?.length ?? 128;
    if (this.expectedFrame !== null && currentFrame !== this.expectedFrame) this.misses += 1;
    this.expectedFrame = currentFrame + quantum;
    if (!this.reported && this.blocks >= REPORT_AFTER_BLOCKS) {
      this.reported = true;
      this.port.postMessage({
        type: 'probe-report',
        blocks: this.blocks,
        misses: this.misses,
        sampleRate,
      });
    }
    // Keep running until the report is away, then let the node be collected.
    return !this.reported;
  }
}

registerProcessor('selecta-probe', ProbeProcessor);
