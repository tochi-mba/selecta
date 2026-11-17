import { createEngineContext, EngineContext, EngineContextOptions, isUnsupported } from './context';
import { probeCapability } from './probe';
import { BrowserSpeaker, BrowserSpeakerOptions } from './speakerAdapter';
import { createEngineStore, EngineState, EngineStore, UnsupportedHere } from './state';

/** The public surface of the browser audio runtime (ADR-0457).
 *
 * The engine itself is flag-agnostic: whether anything here loads at all is decided by the
 * caller behind `devices.browser_player` (and exports behind `cloud.local_export`), so with the
 * flag off nothing imports this directory. Nothing in the engine reads a flag, the network, or
 * a user agent.
 */

export type { EngineContext, EngineContextOptions } from './context';
export { createEngineContext, isUnsupported, WAKE_WAIT_MS, ENGINE_SAMPLE_RATE } from './context';
export type { EngineGraph } from './graph';
export { buildGraph } from './graph';
export type { DecodeFailure, DecodeOk, DecodeResult, Loader, LoaderStats, TrackId } from './loader';
export { createLoader, KEEP_DECODED } from './loader';
export type { ProbeFailure, ProbeOk, ProbeOptions, ProbeResult } from './probe';
export { probeCapability, PROBE_PROCESSOR, PROBE_WAIT_MS } from './probe';
export type { RenderFailure, RenderOptions, RenderProgress, RenderResult, RenderSuccess, RenderTrack } from './render';
export { renderMix, RENDER_CHUNK_SECONDS } from './render';
export type { LoadedTrack, Scheduler, SchedulerDeps, SchedulerPosition, SchedulerTimers } from './scheduler';
export { createScheduler, SEAM_FADE, END_FADE } from './scheduler';
export type { BrowserSpeakerOptions, ResolveTrack, SpeakerAudio, TrackSource } from './speakerAdapter';
export { BrowserSpeaker } from './speakerAdapter';
export type { EnginePhase, EngineState, EngineStore, OutputDowngrade, OutputStatus, UnsupportedHere } from './state';
export { createEngineStore } from './state';
export type { EncodedWav, PcmChunk, WavBits, WavDetails, WavProblem } from './wav';
export { encodeWav, flacSupported, validateWav } from './wav';

export type Engine = {
  store: EngineStore;
  state(): EngineState;
  /** Open the AudioContext; `fromUserGesture` must be set inside a real event handler. */
  openContext(options: Omit<EngineContextOptions, 'store'>): EngineContext | UnsupportedHere;
  probe: typeof probeCapability;
  /** Make the ADR-0415 speaker on this engine's store. */
  createSpeaker(options: Omit<BrowserSpeakerOptions, 'store'>): BrowserSpeaker;
  dispose(): void;
};

/** One engine with one truthful state stream. Everything else can be used piecemeal too. */
export function createEngine(options: { onState?: (state: EngineState) => void } = {}): Engine {
  const store = createEngineStore();
  const unsubscribe = options.onState ? store.subscribe(options.onState) : null;
  return {
    store,
    state: () => store.get(),
    openContext: (opened) => createEngineContext({ ...opened, store }),
    probe: probeCapability,
    createSpeaker: (made) => new BrowserSpeaker({ ...made, store }),
    dispose() {
      unsubscribe?.();
    },
  };
}
