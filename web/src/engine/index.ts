import { CapabilityRegistry, registerBrowserDspCapabilities } from '../dsp/capability';
import { createEngineContext, EngineContext, EngineContextOptions, isUnsupported } from './context';
import { COMPRESSOR_FALLBACK_IMPLEMENTATION, LimiterInstall } from './limiter';
import { probeCapability, ProbeResult } from './probe';
import { BrowserSpeaker, BrowserSpeakerOptions } from './speakerAdapter';
import { createEngineStore, EngineState, EngineStore, UnsupportedHere } from './state';

/** The public surface of the browser audio runtime (ADR-0457), as the interface uses it.
 *
 * The engine itself is flag-agnostic: whether anything here loads at all is decided by the
 * caller behind `devices.browser_player` (and exports behind `cloud.local_export`), so with the
 * flag off nothing imports this directory. Nothing in the engine reads a flag, the network, or
 * a user agent.
 *
 * The usual path: in a press handler, `engine.openContext({ fromUserGesture: true })`, wake it,
 * `await engine.probe(context.context)`, then `engine.createSpeaker({ audio, probe, resolve,
 * queueLength })` for usePlaybackDevice, and `engine.roster({ probe, limiter })` for what the
 * device may honestly claim. Exports go through `exportWav` (or renderMix plus encodeWav).
 */

export type { EngineContext, EngineContextOptions } from './context';
export { createEngineContext, isUnsupported, WAKE_WAIT_MS, ENGINE_SAMPLE_RATE } from './context';
export type { EngineGraph } from './graph';
export { buildGraph } from './graph';
export type { InstallLimiterOptions, LimiterInstall } from './limiter';
export { COMPRESSOR_FALLBACK_IMPLEMENTATION, installLimiter, limiterProcessorOptions } from './limiter';
export type { DecodeFailure, DecodeOk, DecodeResult, Loader, LoaderStats, TrackId } from './loader';
export { createLoader, KEEP_DECODED } from './loader';
export type { ProbeFailure, ProbeOk, ProbeOptions, ProbeResult } from './probe';
export { probeCapability, PROBE_PROCESSOR, PROBE_WAIT_MS } from './probe';
export type { RenderFailure, RenderOptions, RenderProgress, RenderResult, RenderSuccess, RenderTrack } from './render';
export { MAX_RENDER_SECONDS, renderMix, RENDER_CHUNK_SECONDS } from './render';
export type { ExportResult, ExportSuccess } from './export';
export { exportWav } from './export';
export type {
  LoadedTrack,
  Scheduler,
  SchedulerDeps,
  SchedulerPosition,
  SchedulerTimers,
  SeamProvider,
  SeamRequest,
  Transition,
  TransitionKind,
} from './scheduler';
export { createScheduler, SEAM_FADE, END_FADE } from './scheduler';
export type { BrowserSpeakerOptions, ResolveTrack, SpeakerAudio, TrackSource } from './speakerAdapter';
export { BrowserSpeaker } from './speakerAdapter';
export type { EnginePhase, EngineState, EngineStore, OutputDowngrade, OutputStatus, UnsupportedHere } from './state';
export { createEngineStore } from './state';
export type { EncodedWav, PcmChunk, WavBits, WavDetails, WavProblem } from './wav';
export { encodeWav, flacSupported, validateWav } from './wav';
export type { Capability, CapabilityStatus, DspEvidence, Tier } from '../dsp/capability';
export { CapabilityRegistry } from '../dsp/capability';

/** What the roster is built from: the probe, the limiter that went in, and (for Tier 2) a
 * benchmark-calibrated worker budget from dsp/budget.ts. */
export type RosterEvidence = {
  probe: ProbeResult;
  limiter?: LimiterInstall | null;
  workerBudget?: { atFloor: boolean } | null;
};

/** The device's capability roster (ADR-0459): Tier 1 ready only when the probe passed, the
 * limiter named by the implementation actually installed, Tier 2 only on a measured device,
 * Tier 3 never. */
export function buildCapabilityRoster(evidence: RosterEvidence, registry = new CapabilityRegistry()): CapabilityRegistry {
  const limiter = evidence.limiter;
  return registerBrowserDspCapabilities(registry, {
    probe: evidence.probe.ok ? { ok: true } : { ok: false, reason: evidence.probe.reason },
    // Until the worklet limiter is known to be installed, the graph runs the compressor.
    limiter: limiter?.kind === 'worklet'
      ? { kind: 'worklet' }
      : { kind: 'compressor_fallback', implementation: COMPRESSOR_FALLBACK_IMPLEMENTATION },
    workerBudget: evidence.workerBudget ?? null,
  });
}

export type Engine = {
  store: EngineStore;
  state(): EngineState;
  /** Open the AudioContext; `fromUserGesture` must be set inside a real event handler. */
  openContext(options: Omit<EngineContextOptions, 'store'>): EngineContext | UnsupportedHere;
  probe: typeof probeCapability;
  /** Make the ADR-0415 speaker on this engine's store. */
  createSpeaker(options: Omit<BrowserSpeakerOptions, 'store'>): BrowserSpeaker;
  /** The honest capability roster for this device. */
  roster(evidence: RosterEvidence): CapabilityRegistry;
  dispose(): void;
};

/** One engine with one truthful state stream. Everything else can be used piecemeal too. */
export function createEngine(options: { onState?: (state: EngineState) => void } = {}): Engine {
  const store = createEngineStore();
  const unsubscribe = options.onState ? store.subscribe(options.onState) : null;
  const contexts = new Set<EngineContext>();
  const speakers = new Set<BrowserSpeaker>();
  let disposed = false;
  return {
    store,
    state: () => store.get(),
    openContext: (opened) => {
      if (disposed) return { state: 'unsupported_here', reason: 'SelectaDJ has closed this audio engine.' };
      const made = createEngineContext({ ...opened, store });
      if (!isUnsupported(made)) contexts.add(made);
      return made;
    },
    probe: probeCapability,
    createSpeaker: (made) => {
      const speaker = new BrowserSpeaker({ ...made, store });
      if (disposed) speaker.dispose();
      else speakers.add(speaker);
      return speaker;
    },
    roster: (evidence) => buildCapabilityRoster(evidence),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const speaker of speakers) speaker.dispose();
      speakers.clear();
      for (const context of contexts) context.dispose();
      contexts.clear();
      unsubscribe?.();
    },
  };
}
