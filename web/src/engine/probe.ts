import type { UnsupportedHere } from './state';
import { PROBE_PROCESSOR, PROBE_PROCESSOR_SOURCE } from './worklet/probeProcessor';
import { loadWorkletModule, MODULE_WAIT_MS } from './worklet/scope';

/** The capability probe (ADR-0457, BF-0457-02; ADR-0460 "capability by measured probe").
 *
 * Before this device may present itself as a player, the probe loads a test worklet and proves
 * that process() actually executes: a counter comes back over the port, with the sample rate and
 * any scheduling gaps it saw. A device that cannot do this gets `unsupported_here` with the
 * reason, and the interface shows controller and library surfaces instead (ADR-0460).
 *
 * A passing probe is still not an audibility claim. The graph can run with signal while nothing
 * is audible (the WebKit 2026 failure class); only a person confirming the sound check upgrades
 * the output status, and that lives in state.ts, deliberately out of reach from here.
 */

export { PROBE_PROCESSOR } from './worklet/probeProcessor';
/** Which browser engine produced a capability record (ADR-0460 tuple field `engine_version`).
 * Bump it when the engine's DSP, scheduling or probe changes: a record measured on an older
 * engine is a different tuple and proves nothing about this one. */
export const ENGINE_VERSION = 'selecta-browser-engine/1';
/** How long to wait for the processor's report before calling the device unable. */
export const PROBE_WAIT_MS = 2000;

export type ProbeOk = { ok: true; sampleRate: number; schedulingMisses: number; blocks: number };
export type ProbeFailure = { ok: false } & UnsupportedHere;
export type ProbeResult = ProbeOk | ProbeFailure;

type ProbeReport = { type: 'probe-report'; blocks: number; misses: number; sampleRate: number };

type ProbePort = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  close?(): void;
};
type ProbeNode = {
  port: ProbePort;
  connect(target: AudioNode): void;
  disconnect(): void;
};

export type ProbeOptions = {
  /** A module URL to load instead of the bundled processor source (a stub in tests). */
  moduleUrl?: string | URL;
  /** The real AudioWorkletNode by default; a fake in tests. */
  makeNode?: (context: AudioContext, name: string) => ProbeNode;
  waitMs?: number;
  /** How long the module load may take (MODULE_WAIT_MS by default). */
  moduleWaitMs?: number;
};

const refuse = (reason: string): ProbeFailure => ({ ok: false, state: 'unsupported_here', reason });

export async function probeCapability(context: AudioContext, options: ProbeOptions = {}): Promise<ProbeResult> {
  // Feature-detect on the instance, never through AudioContext.prototype.audioWorklet: that
  // accessor is unbound there and Chromium throws "Illegal invocation" when it is read.
  if (!('audioWorklet' in context) || !context.audioWorklet) {
    return refuse('This browser has no AudioWorklet, so SelectaDJ cannot mix audio here.');
  }
  // A processor only runs on a running context; one that is suspended would fail the probe for
  // the wrong reason. The caller wakes it inside the gesture; nudge once more, never forever.
  if (context.state !== 'running') {
    await Promise.race([
      context.resume().catch(() => undefined),
      new Promise((settled) => setTimeout(settled, options.waitMs ?? PROBE_WAIT_MS)),
    ]);
    if ((context.state as AudioContextState) !== 'running') {
      return refuse('Sound has not been allowed to start yet, so SelectaDJ could not check this device. Press play to try again.');
    }
  }
  const worklet = context.audioWorklet;
  try {
    if (options.moduleUrl !== undefined) {
      // Some browsers never settle addModule; bound the wait either way.
      let wait: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          worklet.addModule(String(options.moduleUrl)),
          new Promise<never>((_, reject) => {
            wait = setTimeout(() => reject(new Error('the module did not load in time')), options.moduleWaitMs ?? MODULE_WAIT_MS);
          }),
        ]);
      } finally {
        clearTimeout(wait);
      }
    } else {
      await loadWorkletModule(worklet, PROBE_PROCESSOR_SOURCE, options.moduleWaitMs ?? MODULE_WAIT_MS);
    }
  } catch (error) {
    return refuse(`The audio worklet would not load: ${(error as Error).message ?? 'unknown reason'}.`);
  }

  let node: ProbeNode;
  try {
    if (options.makeNode) {
      node = options.makeNode(context, PROBE_PROCESSOR);
    } else if (typeof AudioWorkletNode === 'undefined') {
      return refuse('This browser has no AudioWorkletNode, so SelectaDJ cannot mix audio here.');
    } else {
      node = new AudioWorkletNode(context, PROBE_PROCESSOR);
    }
  } catch (error) {
    return refuse(`The probe worklet could not start: ${(error as Error).message ?? 'unknown reason'}.`);
  }

  // Connected through a muted gain so the graph pulls the processor without making any sound.
  const mute = context.createGain();
  mute.gain.value = 0;
  node.connect(mute as unknown as AudioNode);
  mute.connect(context.destination);

  const report = await new Promise<ProbeReport | null>((settle) => {
    const wait = window.setTimeout(() => settle(null), options.waitMs ?? PROBE_WAIT_MS);
    node.port.onmessage = (event) => {
      const data = event.data as ProbeReport | null;
      if (data?.type !== 'probe-report') return;
      window.clearTimeout(wait);
      settle(data);
    };
  });

  node.port.onmessage = null;
  node.port.close?.();
  try {
    node.disconnect();
    mute.disconnect();
  } catch {
    // already gone with its context
  }

  if (!report || report.blocks <= 0) {
    return refuse('The audio worklet loaded but never processed audio, so SelectaDJ cannot trust playback here.');
  }
  return {
    ok: true,
    sampleRate: report.sampleRate,
    schedulingMisses: report.misses,
    blocks: report.blocks,
  };
}
