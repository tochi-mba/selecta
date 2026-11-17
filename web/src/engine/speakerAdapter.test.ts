import { describe, expect, it } from 'vitest';
import type { ProbeResult } from './probe';
import { BrowserSpeaker, TrackSource } from './speakerAdapter';
import { createEngineStore } from './state';
import { bufferOfSeconds, FakeAudioContext, manualTimers, settle } from './testAudio';

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
