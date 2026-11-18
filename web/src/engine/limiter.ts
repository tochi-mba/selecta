import { LIMITER_IMPLEMENTATION, limiterCoefficients } from '../dsp/limiter';
import { interpolatorPhases } from '../dsp/loudness';
import type { EngineGraph } from './graph';
import type { ProbeResult } from './probe';
import {
  LIMITER_PROCESSOR,
  LIMITER_PROCESSOR_SOURCE,
  limiterDelaySamples,
  LimiterProcessorOptions,
} from './worklet/limiterProcessor';
import { loadWorkletModule } from './worklet/scope';

/** Installing the Tier 1 limiter into the playback graph (ADR-0459 Tier 1, BF-0459-02).
 *
 * When the capability probe passed, the graph's `insertLimiter` seam takes the worklet limiter
 * built from dsp/limiter.ts `limiterCoefficients` (the same design render.ts applies offline).
 * The DynamicsCompressor the graph starts with stays only as the fallback: where the probe
 * failed or the limiter worklet will not start, and the result says so with the reason, so
 * the capability roster can name the reduced implementation instead of claiming the real one.
 */

/** The fallback is a different, reduced implementation, and is named as one. */
export const COMPRESSOR_FALLBACK_IMPLEMENTATION = 'dynamics-compressor-safety-v1';

export type LimiterInstall =
  | { kind: 'worklet'; implementation: string; latencySeconds: number }
  | { kind: 'compressor_fallback'; implementation: string; latencySeconds: 0; reason: string };

/** The processor options for one sample rate, from the DSP module's own numbers. */
export function limiterProcessorOptions(sampleRate: number): LimiterProcessorOptions {
  const { ceilingLinear, windowSamples } = limiterCoefficients({ sampleRate });
  return {
    ceilingLinear,
    windowSamples,
    phases: interpolatorPhases().map((taps) => Array.from(taps)),
  };
}

export type InstallLimiterOptions = {
  probe: ProbeResult;
  /** False once the owning speaker is disposed, to avoid installing into a dead graph. */
  isActive?: () => boolean;
  /** Load the processor module; the blob-module loader by default, a stub in tests. */
  load?: (context: BaseAudioContext) => Promise<void>;
  /** Make the node; the real AudioWorkletNode by default, a fake in tests. */
  makeNode?: (context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions) => AudioNode;
};

const fallback = (reason: string): LimiterInstall => ({
  kind: 'compressor_fallback',
  implementation: COMPRESSOR_FALLBACK_IMPLEMENTATION,
  latencySeconds: 0,
  reason,
});

export async function installLimiter(graph: EngineGraph, options: InstallLimiterOptions): Promise<LimiterInstall> {
  if (!options.probe.ok) return fallback(options.probe.reason);
  const context = graph.context;
  const load = options.load ?? (async (made: BaseAudioContext) => {
    // Read audioWorklet on the instance only; the prototype accessor is unbound.
    const worklet = 'audioWorklet' in made ? (made as AudioContext).audioWorklet : undefined;
    if (!worklet) throw new Error('this browser has no AudioWorklet');
    await loadWorkletModule(worklet, LIMITER_PROCESSOR_SOURCE);
  });
  const makeNode = options.makeNode ?? ((made: BaseAudioContext, name: string, nodeOptions: AudioWorkletNodeOptions) => {
    if (typeof AudioWorkletNode === 'undefined') throw new Error('this browser has no AudioWorkletNode');
    return new AudioWorkletNode(made, name, nodeOptions);
  });
  const processorOptions = limiterProcessorOptions(context.sampleRate);
  try {
    await load(context);
    if (options.isActive && !options.isActive()) {
      return fallback('The speaker was closed before the limiter finished loading.');
    }
    const node = makeNode(context, LIMITER_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions,
    });
    graph.insertLimiter(node);
  } catch (error) {
    const why = (error as Error | null)?.message || 'unknown reason';
    return fallback(`The true-peak limiter could not start (${why}), so a simpler safety limiter is used.`);
  }
  return {
    kind: 'worklet',
    implementation: LIMITER_IMPLEMENTATION,
    latencySeconds: limiterDelaySamples(processorOptions) / context.sampleRate,
  };
}
