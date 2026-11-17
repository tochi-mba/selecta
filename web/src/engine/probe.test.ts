import { describe, expect, it } from 'vitest';
import { probeCapability } from './probe';
import { FakeAudioContext, FakeWorkletNode } from './testAudio';

const report = { type: 'probe-report', blocks: 32, misses: 1, sampleRate: 44100 };

const probeWith = (context: FakeAudioContext, emit?: (node: FakeWorkletNode) => void) => {
  const node = new FakeWorkletNode();
  const asked = probeCapability(context as unknown as AudioContext, {
    moduleUrl: 'probe-module-stub',
    makeNode: () => node,
    waitMs: 50,
  });
  // The probe attaches its port listener in microtasks after addModule; emit after them.
  if (emit) setTimeout(() => emit(node), 0);
  return { node, asked };
};

describe('the capability probe', () => {
  it('reports unsupported_here with the reason where there is no AudioWorklet', async () => {
    const context = new FakeAudioContext(); // no audioWorklet property at all
    const result = await probeCapability(context as unknown as AudioContext);
    expect(result).toEqual({
      ok: false,
      state: 'unsupported_here',
      reason: expect.stringMatching(/no AudioWorklet/),
    });
  });

  it('feature-detects on the instance, never through the prototype accessor', async () => {
    // Chromium throws "Illegal invocation" when audioWorklet is read unbound off the prototype.
    // This context does the same, so the probe only passes if it stays on the instance.
    const worklet = { addModule: async () => {} };
    class GuardedContext extends FakeAudioContext {
      get audioWorklet() {
        if (!(this instanceof GuardedContext)) throw new TypeError('Illegal invocation');
        return worklet;
      }
    }
    expect(() => (Object.getOwnPropertyDescriptor(GuardedContext.prototype, 'audioWorklet')!
      .get as () => unknown).call(GuardedContext.prototype)).toThrow(/Illegal invocation/);
    const context = new GuardedContext();
    const { asked } = probeWith(context, (node) => node.emit(report));
    const result = await asked;
    expect(result.ok).toBe(true);
  });

  it('fails with the load error where the worklet module will not load', async () => {
    const context = new FakeAudioContext();
    context.audioWorklet = { addModule: async () => { throw new Error('404 on module'); } };
    const result = await probeCapability(context as unknown as AudioContext, { moduleUrl: 'x', waitMs: 20 });
    expect(result).toMatchObject({ ok: false, state: 'unsupported_here', reason: expect.stringMatching(/404 on module/) });
  });

  it('fails where process() never runs: a loaded worklet is not a working one', async () => {
    const context = new FakeAudioContext();
    context.audioWorklet = { addModule: async () => {} };
    const { asked } = probeWith(context); // nothing ever posts a report
    const result = await asked;
    expect(result).toMatchObject({ ok: false, state: 'unsupported_here', reason: expect.stringMatching(/never processed/) });
  });

  it('fails where the report says zero blocks ran', async () => {
    const context = new FakeAudioContext();
    context.audioWorklet = { addModule: async () => {} };
    const { asked } = probeWith(context, (node) => node.emit({ ...report, blocks: 0 }));
    const result = await asked;
    expect(result.ok).toBe(false);
  });

  it('passes with measured numbers, pulled through a muted tap', async () => {
    const context = new FakeAudioContext();
    context.audioWorklet = { addModule: async () => {} };
    const { node, asked } = probeWith(context, (made) => made.emit(report));
    const result = await asked;
    expect(result).toEqual({ ok: true, sampleRate: 44100, schedulingMisses: 1, blocks: 32 });
    // The probe never makes sound: its tap into the destination is a zero gain.
    const mute = context.madeGains[0];
    expect(node.connections).toEqual([]); // disconnected again after the probe
    expect(mute.gain.value).toBe(0);
  });

  it('ignores unrelated port messages while waiting', async () => {
    const context = new FakeAudioContext();
    context.audioWorklet = { addModule: async () => {} };
    const { asked } = probeWith(context, (node) => {
      node.emit({ type: 'something-else' });
      node.emit(report);
    });
    const result = await asked;
    expect(result.ok).toBe(true);
  });

  it('makes no audibility claim: a pass carries numbers, not a verified output', async () => {
    const context = new FakeAudioContext();
    context.audioWorklet = { addModule: async () => {} };
    const { asked } = probeWith(context, (node) => node.emit(report));
    const result = await asked;
    // The shape itself has no output status; only a person can verify audibility (ADR-0460).
    expect(Object.keys(result)).toEqual(['ok', 'sampleRate', 'schedulingMisses', 'blocks']);
  });
});
