import { describe, expect, it } from 'vitest';
import { LIMITER_IMPLEMENTATION, limiterCoefficients } from '../dsp/limiter';
import { buildGraph } from './graph';
import { COMPRESSOR_FALLBACK_IMPLEMENTATION, installLimiter, limiterProcessorOptions } from './limiter';
import type { ProbeResult } from './probe';
import { FakeAudioContext, FakeCompressorNode, FakeNode } from './testAudio';
import { LIMITER_PROCESSOR, limiterDelaySamples } from './worklet/limiterProcessor';

const passed: ProbeResult = { ok: true, sampleRate: 44100, schedulingMisses: 0, blocks: 32 };
const failed: ProbeResult = { ok: false, state: 'unsupported_here', reason: 'The audio worklet loaded but never processed audio.' };

const rig = () => {
  const context = new FakeAudioContext();
  const graph = buildGraph(context as unknown as BaseAudioContext);
  return { context, graph };
};

describe('installing the Tier 1 limiter', () => {
  it('puts the worklet limiter into the graph seam when the probe passed, with the dsp coefficients', async () => {
    const { graph } = rig();
    const made: { name: string; options: AudioWorkletNodeOptions }[] = [];
    const node = new FakeNode();
    const installed = await installLimiter(graph, {
      probe: passed,
      load: async () => {},
      makeNode: (_context, name, options) => {
        made.push({ name, options });
        return node as unknown as AudioNode;
      },
    });
    expect(installed).toEqual({
      kind: 'worklet',
      implementation: LIMITER_IMPLEMENTATION,
      latencySeconds: limiterDelaySamples(limiterProcessorOptions(44100)) / 44100,
    });
    expect(made[0].name).toBe(LIMITER_PROCESSOR);
    const { ceilingLinear, windowSamples } = limiterCoefficients({ sampleRate: 44100 });
    expect(made[0].options.processorOptions).toMatchObject({ ceilingLinear, windowSamples });
    expect(made[0].options.outputChannelCount).toEqual([2]);
    expect(graph.limiter).toBe(node as unknown as AudioNode);
    expect(node.connections).toEqual([graph.analyser]);
  });

  it('keeps the compressor only as the named fallback when the probe failed', async () => {
    const { graph } = rig();
    const before = graph.limiter;
    let loaded = false;
    const installed = await installLimiter(graph, { probe: failed, load: async () => { loaded = true; } });
    expect(installed).toMatchObject({ kind: 'compressor_fallback', implementation: COMPRESSOR_FALLBACK_IMPLEMENTATION, reason: expect.stringMatching(/never processed/) });
    expect(loaded).toBe(false);
    expect(graph.limiter).toBe(before);
    expect(graph.limiter).toBeInstanceOf(FakeCompressorNode);
  });

  it('falls back, with the reason, when the worklet will not load', async () => {
    const { graph } = rig();
    const installed = await installLimiter(graph, { probe: passed, load: async () => { throw new Error('blocked by policy'); } });
    expect(installed).toMatchObject({ kind: 'compressor_fallback', latencySeconds: 0, reason: expect.stringMatching(/blocked by policy/) });
    expect(graph.limiter).toBeInstanceOf(FakeCompressorNode);
  });

  it('never reads audioWorklet off the prototype: a context without one falls back cleanly', async () => {
    const { graph } = rig(); // the fake has no worklet set
    const installed = await installLimiter(graph, { probe: passed });
    expect(installed).toMatchObject({ kind: 'compressor_fallback', reason: expect.stringMatching(/no AudioWorklet/) });
  });
});
