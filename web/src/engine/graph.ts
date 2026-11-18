/** The fixed node graph for the browser runtime (ADR-0457).
 *
 * Two deck gains feed a master, the master feeds a safety limiter, then an analyser for the
 * interface, then the volume gain, then the destination. The volume comes after the analyser so
 * turning it down does not flatten the visualizer (mirrors player.ts). The graph starts with a
 * DynamicsCompressorNode set up as a hard safety stage. That compressor is only the fallback:
 * engine/limiter.ts `installLimiter` swaps in the worklet true-peak limiter (built from
 * dsp/limiter.ts) through `insertLimiter` whenever the capability probe passed, and keeps the
 * compressor, named as a reduced implementation, only when the probe or the worklet failed.
 */

export type EngineGraph = {
  context: BaseAudioContext;
  deckA: GainNode;
  deckB: GainNode;
  master: GainNode;
  analyser: AnalyserNode;
  volume: GainNode;
  /** The current limiter stage between master and analyser. */
  limiter: AudioNode;
  /** Swap the limiter stage for a better one (a worklet true-peak limiter, ADR-0459 Tier 1). */
  insertLimiter(node: AudioNode): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** The mixed output's frequency bands, sampled only by the interface. */
  spectrum(): Uint8Array | null;
  dispose(): void;
};

/** Keep hard output changes from clicking while still feeling immediate to the operator. */
export const VOLUME_RAMP_SECONDS = 0.035;

export function buildGraph(context: BaseAudioContext): EngineGraph {
  const deckA = context.createGain();
  const deckB = context.createGain();
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  // A safety limiter, not a musical one: high ratio, no knee, just below full scale, fast attack.
  compressor.threshold.value = -1;
  compressor.knee.value = 0;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.1;
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.78;
  const bands = new Uint8Array(analyser.frequencyBinCount);
  const volume = context.createGain();

  deckA.connect(master);
  deckB.connect(master);
  master.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(volume);
  volume.connect(context.destination);

  let limiter: AudioNode = compressor;
  let muted = false;
  let level = 1;
  let appliedLevel = 1;
  let rampFrom = 1;
  let rampStartedAt = context.currentTime;
  const applySound = () => {
    const next = muted ? 0 : level;
    if (next === appliedLevel) return;
    const at = context.currentTime;
    const progress = Math.min(Math.max((at - rampStartedAt) / VOLUME_RAMP_SECONDS, 0), 1);
    const current = rampFrom + (appliedLevel - rampFrom) * progress;
    const param = volume.gain;
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(at);
    } else {
      param.cancelScheduledValues(at);
      param.setValueAtTime(current, at);
    }
    param.linearRampToValueAtTime(next, at + VOLUME_RAMP_SECONDS);
    rampFrom = current;
    rampStartedAt = at;
    appliedLevel = next;
  };

  return {
    context,
    deckA,
    deckB,
    master,
    analyser,
    volume,
    get limiter() { return limiter; },
    insertLimiter(node) {
      if (node === limiter) return;
      const previous = limiter;
      try {
        master.disconnect();
        previous.disconnect();
        master.connect(node);
        node.connect(analyser);
      } catch (error) {
        // A limiter that cannot finish connecting must not leave the graph silent. Restore
        // the already-working safety stage before allowing the caller to name the fallback.
        try {
          master.disconnect();
          node.disconnect();
          master.connect(previous);
          previous.connect(analyser);
        } catch {
          // If the context itself is closing, the caller will report the install failure.
        }
        throw error;
      }
      limiter = node;
    },
    setVolume(next) {
      // A malformed remote command must not put NaN on an AudioParam. Keep the last
      // known-good level until a finite value arrives, and clamp ordinary out-of-range
      // values at the engine boundary.
      if (!Number.isFinite(next)) return;
      level = Math.min(Math.max(next, 0), 1);
      applySound();
    },
    setMuted(next) {
      muted = next;
      applySound();
    },
    spectrum() {
      analyser.getByteFrequencyData(bands);
      return bands;
    },
    dispose() {
      for (const node of [deckA, deckB, master, limiter, analyser, volume]) {
        try {
          node.disconnect();
        } catch {
          // already gone with its context
        }
      }
    },
  };
}
