/** The fixed node graph for the browser runtime (ADR-0457).
 *
 * Two deck gains feed a master, the master feeds a safety limiter, then an analyser for the
 * interface, then the volume gain, then the destination. The volume comes after the analyser so
 * turning it down does not flatten the visualizer (mirrors player.ts). The limiter here is a
 * DynamicsCompressorNode set up as a hard safety stage; the DSP agent replaces it with a
 * worklet-based true-peak limiter later through `insertLimiter`, which is the seam for that.
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
  const applySound = () => { volume.gain.value = muted ? 0 : level; };

  return {
    context,
    deckA,
    deckB,
    master,
    analyser,
    volume,
    get limiter() { return limiter; },
    insertLimiter(node) {
      master.disconnect();
      limiter.disconnect();
      master.connect(node);
      node.connect(analyser);
      limiter = node;
    },
    setVolume(next) {
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
