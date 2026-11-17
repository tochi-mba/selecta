import { describe, expect, it } from 'vitest';
import type { ResolvedTrack } from '../media/resolve';
import type { ProbeResult } from './probe';
import { BrowserSpeaker, TrackSource } from './speakerAdapter';
import { createEngineStore } from './state';
import { bufferOfSeconds, FakeAudioContext, FakeNode, manualTimers, settle } from './testAudio';

const passed: ProbeResult = { ok: true, sampleRate: 44100, schedulingMisses: 0, blocks: 32 };
const failed: ProbeResult = { ok: false, state: 'unsupported_here', reason: 'This browser has no AudioWorklet, so SelectaDJ cannot mix audio here.' };

/** A speaker over fakes whose queue holds tracks of the given seconds each. A fake "file" of
 * n bytes decodes to n milliseconds, so the resolver hands out second-sized ArrayBuffers. */
const rig = (tracks: number[], probe: ProbeResult = passed) => {
  const context = new FakeAudioContext();
  const store = createEngineStore();
  const timers = manualTimers();
  const resolved: number[] = [];
  const resolve = async (index: number): Promise<TrackSource | null> => {
    resolved.push(index);
    const seconds = tracks[index];
    if (seconds === undefined) return null;
    return { id: `song-${index}`, data: async () => new ArrayBuffer(seconds * 1000) };
  };
  const speaker = new BrowserSpeaker({
    audio: {
      context: context as unknown as AudioContext,
      wake: async () => {
        await context.resume();
        return true;
      },
      hold: () => context.suspend(),
    },
    probe,
    resolve,
    store,
    timers,
  });
  return { context, store, timers, speaker, resolved };
};

describe('refusing honestly', () => {
  it('start() refuses with the probe reason and schedules nothing', async () => {
    const { context, speaker, store } = rig([10], failed);
    await speaker.start(0, 0, true);
    expect(context.madeSources).toHaveLength(0);
    expect(store.get().phase).toBe('idle');
    expect(store.get().notice).toMatch(/no AudioWorklet/);
    expect(speaker.refusal()).toEqual({ state: 'unsupported_here', reason: expect.stringMatching(/no AudioWorklet/) });
    expect(speaker.active()).toBe(false);
    expect(speaker.position()).toBeNull();
  });

  it('a passing probe carries no audibility: playing still shows output_unverified', async () => {
    const { speaker, store } = rig([10]);
    await speaker.start(0, 0, true);
    expect(store.get().phase).toBe('playing');
    expect(store.get().output).toEqual({ status: 'output_unverified' });
    expect(speaker.refusal()).toBeNull();
  });
});

describe('the Speaker contract', () => {
  it('answers position truthfully while playing and through a pause', async () => {
    const { context, speaker } = rig([30]);
    await speaker.start(0, 4000, true);
    context.advance(0.05);
    context.advance(1.5);
    expect(speaker.position()).toEqual({ song_index: 0, offset_ms: 5500, state: 'playing' });
    speaker.pause();
    await settle();
    expect(speaker.position()).toEqual({ song_index: 0, offset_ms: 5500, state: 'paused' });
    expect(speaker.active()).toBe(false); // paused is not actively sounding
    speaker.resume();
    await settle();
    expect(speaker.active()).toBe(true);
  });

  it('plays song_index through the injected resolver, nothing else', async () => {
    const { context, speaker, resolved } = rig([10, 10]);
    await speaker.start(1, 0, true);
    expect(resolved[0]).toBe(1);
    expect(context.madeSources).toHaveLength(1);
  });

  it('comes to rest idle past the end of the queue', async () => {
    const { speaker, store } = rig([10]);
    await speaker.start(5, 0, true);
    expect(store.get().phase).toBe('idle');
    expect(speaker.position()).toBeNull();
    expect(speaker.active()).toBe(false);
  });

  it('goes quiet on stop, as a device that lost the lease must', async () => {
    const { speaker } = rig([10]);
    await speaker.start(0, 0, true);
    expect(speaker.active()).toBe(true);
    speaker.stop(1000);
    expect(speaker.active()).toBe(false);
    expect(speaker.position()).toBeNull();
  });

  it('answers nothing at all after dispose', async () => {
    const { speaker } = rig([10]);
    await speaker.start(0, 0, true);
    speaker.dispose();
    expect(speaker.position()).toBeNull();
    expect(speaker.active()).toBe(false);
    // a start after dispose is a no-op, never a resurrection
    await speaker.start(0, 0, true);
    expect(speaker.position()).toBeNull();
  });

  it('reports a file that cannot be decoded and plays on, never silence in its place', async () => {
    const { context, speaker, store } = rig([3, 8]);
    context.decode = async (bytes) => {
      if (bytes.byteLength === 3000) throw new Error('corrupt stream');
      return bufferOfSeconds(bytes.byteLength / 1000);
    };
    await speaker.start(0, 0, true);
    expect(store.get().notice).toMatch(/skipped/);
    expect(store.get().phase).toBe('playing');
    expect(speaker.position()?.song_index).toBe(1);
  });
});

describe('the media resolver contract', () => {
  it('accepts media/resolve.ts ResolvedTrack as a TrackSource (checked by the compiler)', () => {
    const resolved: ResolvedTrack = { id: 7, data: async () => new ArrayBuffer(8) };
    const source: TrackSource = resolved;
    expect(source.id).toBe(7);
  });

  it('skips an unavailable song inside the queue with a notice, instead of ending the set', async () => {
    const context = new FakeAudioContext();
    const store = createEngineStore();
    const tracks: (number | null)[] = [null, 8];
    const speaker = new BrowserSpeaker({
      audio: { context: context as unknown as AudioContext, wake: async () => { await context.resume(); return true; }, hold: () => context.suspend() },
      probe: passed,
      resolve: async (index) => {
        const seconds = tracks[index];
        return seconds === null || seconds === undefined ? null : { id: index, data: async () => new ArrayBuffer(seconds * 1000) };
      },
      queueLength: () => tracks.length,
      store,
      timers: manualTimers(),
    });
    await speaker.start(0, 0, true);
    expect(store.get().notice).toMatch(/not on this device/);
    expect(speaker.position()?.song_index).toBe(1);
    // Past the queue a null is still the end of the set.
    await speaker.start(2, 0, true);
    expect(store.get().phase).toBe('idle');
  });
});

describe('the limiter stage', () => {
  it('installs the worklet limiter before the first note and reports position net of its lookahead', async () => {
    const context = new FakeAudioContext();
    const node = new FakeNode();
    const speaker = new BrowserSpeaker({
      audio: { context: context as unknown as AudioContext, wake: async () => { await context.resume(); return true; }, hold: () => context.suspend() },
      probe: passed,
      resolve: async () => ({ id: 1, data: async () => new ArrayBuffer(30000) }),
      timers: manualTimers(),
      limiter: { load: async () => {}, makeNode: () => node as unknown as AudioNode },
    });
    await speaker.start(0, 5000, true);
    const installed = await speaker.limiter();
    expect(installed.kind).toBe('worklet');
    expect(node.connections).toHaveLength(1); // wired into the analyser before playback began
    context.advance(0.05 + 1);
    const latencyMs = Math.round(installed.latencySeconds * 1000);
    expect(latencyMs).toBeGreaterThan(0);
    expect(speaker.position()).toEqual({ song_index: 0, offset_ms: 6000 - latencyMs, state: 'playing' });
  });

  it('names the compressor fallback when the probe failed', async () => {
    const { speaker } = rig([10], failed);
    expect(await speaker.limiter()).toMatchObject({ kind: 'compressor_fallback' });
  });
});

