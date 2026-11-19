import { describe, expect, it } from 'vitest';
import { buildGraph } from './graph';
import { FakeAudioContext, FakeCompressorNode, FakeGainNode, FakeNode } from './testAudio';

const build = () => {
  const context = new FakeAudioContext();
  const graph = buildGraph(context as unknown as BaseAudioContext);
  return { context, graph };
};

describe('the engine graph', () => {
  it('wires decks into the master, then limiter, analyser, volume, destination', () => {
    const { context, graph } = build();
    const deckA = graph.deckA as unknown as FakeGainNode;
    const deckB = graph.deckB as unknown as FakeGainNode;
    const master = graph.master as unknown as FakeGainNode;
    const volume = graph.volume as unknown as FakeGainNode;
    expect(deckA.connections).toEqual([graph.master]);
    expect(deckB.connections).toEqual([graph.master]);
    expect(master.connections).toEqual([graph.limiter]);
    expect((graph.limiter as unknown as FakeNode).connections).toEqual([graph.analyser]);
    expect(volume.connections).toEqual([context.destination]);
  });

  it('sets the compressor up as a safety limiter, not a musical one', () => {
    const { graph } = build();
    const limiter = graph.limiter as unknown as FakeCompressorNode;
    expect(limiter.threshold.value).toBe(-1);
    expect(limiter.knee.value).toBe(0);
    expect(limiter.ratio.value).toBe(20);
  });

  it('swaps the limiter stage through insertLimiter, the seam for the worklet limiter', () => {
    const { graph } = build();
    const better = new FakeNode();
    graph.insertLimiter(better as unknown as AudioNode);
    const master = graph.master as unknown as FakeGainNode;
    expect(master.connections).toEqual([better]);
    expect(better.connections).toEqual([graph.analyser]);
    expect(graph.limiter).toBe(better as unknown as AudioNode);
  });

  it('keeps volume after the analyser so turning it down does not flatten the visualizer', () => {
    const { graph } = build();
    const volume = graph.volume as unknown as FakeGainNode;
    graph.setVolume(0.4);
    expect(volume.gain.value).toBe(0.4);
    graph.setMuted(true);
    expect(volume.gain.value).toBe(0);
    graph.setMuted(false);
    expect(volume.gain.value).toBe(0.4);
    expect((graph.analyser as unknown as FakeNode).connections).toEqual([graph.volume]);
  });

  it('clamps volume into 0..1', () => {
    const { graph } = build();
    const volume = graph.volume as unknown as FakeGainNode;
    graph.setVolume(7);
    expect(volume.gain.value).toBe(1);
    graph.setVolume(-1);
    expect(volume.gain.value).toBe(0);
  });

  it('disconnects everything on dispose', () => {
    const { graph } = build();
    graph.dispose();
    for (const node of [graph.deckA, graph.deckB, graph.master, graph.volume]) {
      expect((node as unknown as FakeNode).connections).toEqual([]);
    }
  });
});
