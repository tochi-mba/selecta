import { describe, expect, it, vi } from 'vitest';
import type { StemCacheIo } from './cache';
import { HIDDEN_MESSAGE, StemPrefetcher, type StemPrefetcherOptions } from './prefetch';
import type { StemSongRef } from './windows';
import type { StemSeparator } from '../workers/stemsSpawn';

const songs: StemSongRef[] = [
  { songId: 1, durationS: 2 },
  { songId: 2, durationS: 2 },
  { songId: 3, durationS: 2 },
];

function memoryIo(behaviour: { full?: boolean } = {}) {
  const entries = new Map<string, ArrayBuffer>();
  const io: StemCacheIo = {
    write: async (key, bytes) => {
      if (behaviour.full) return { ok: false, why: 'storage_full' };
      entries.set(key, bytes.slice().buffer);
      return { ok: true };
    },
    read: async (key) => entries.get(key) ?? null,
    evict: async (key) => { entries.delete(key); },
  };
  return { entries, io };
}

const audio = (seconds = 2) => {
  const data = new Float32Array(44100 * seconds).fill(0.25);
  return { sampleRate: 44100, numberOfChannels: 1, length: data.length, getChannelData: () => data };
};

const passThrough: StemSeparator = async (channels, options) => {
  options?.onProgress?.(0.5);
  return { backend: 'wasm', implementation: 'htdemucs-onnx-v1', stems: Array.from({ length: 8 }, (_, plane) => channels[plane % 2].slice()) };
};

function fakeDocument(hidden = false) {
  const target = new EventTarget();
  const doc = Object.assign(target, { hidden });
  return doc as unknown as Document & { hidden: boolean };
}

async function settle(prefetcher: StemPrefetcher, count: number): Promise<void> {
  await vi.waitFor(() => {
    const done = prefetcher.state.get().windows.filter((entry) => !['queued', 'running'].includes(entry.status.state));
    expect(done.length).toBeGreaterThanOrEqual(count);
  });
}

function make(overrides: Partial<StemPrefetcherOptions> = {}) {
  const memory = memoryIo();
  const guard = { arm: vi.fn(), disarm: vi.fn() };
  const prefetcher = new StemPrefetcher({
    separate: passThrough,
    getAudio: async () => audio(),
    scope: { workspaceId: 'ws', shared: false },
    io: memory.io,
    guard,
    document: fakeDocument(),
    transitions: 1,
    ...overrides,
  });
  return { prefetcher, memory, guard };
}

describe('stem prefetch', () => {
  it('prepares the current tail then the next head, one at a time, and the seam path reads them', async () => {
    const order: number[] = [];
    let concurrent = 0;
    let most = 0;
    const separate: StemSeparator = async (channels, options) => {
      concurrent += 1;
      most = Math.max(most, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
      return passThrough(channels, options);
    };
    const { prefetcher, guard } = make({ separate, getAudio: async (songId) => { order.push(songId); return audio(); } });
    prefetcher.plan(songs, 0);
    expect(prefetcher.state.get().windows.map((entry) => `${entry.songId}:${entry.window.role}`)).toEqual(['1:tail', '2:head']);
    await settle(prefetcher, 2);
    expect(order).toEqual([1, 2]);
    expect(most).toBe(1);
    expect(prefetcher.state.get().windows.every((entry) => entry.status.state === 'ready')).toBe(true);
    expect(guard.arm).toHaveBeenCalledTimes(2);
    expect(guard.disarm).toHaveBeenCalledTimes(2);
    const stems = await prefetcher.readStems(1, prefetcher.state.get().windows[0].window);
    expect(stems?.stems.vocals[0][10]).toBeCloseTo(0.25, 4);
  });

  it('readStems never separates: a miss is null', async () => {
    const separate = vi.fn(passThrough);
    const { prefetcher } = make({ separate });
    expect(await prefetcher.readStems(9, { startMs: 0, endMs: 1000 })).toBeNull();
    expect(separate).not.toHaveBeenCalled();
  });

  it('serves cached windows without running inference again', async () => {
    const shared = memoryIo();
    const first = make({ io: shared.io });
    first.prefetcher.plan(songs, 0);
    await settle(first.prefetcher, 2);
    const separate = vi.fn(passThrough);
    const second = make({ io: shared.io, separate });
    second.prefetcher.plan(songs, 0);
    await settle(second.prefetcher, 2);
    expect(separate).not.toHaveBeenCalled();
  });

  it('says plainly when a song is not connected or splitting fails or storage is full', async () => {
    const { prefetcher } = make({ getAudio: async (songId) => (songId === 1 ? null : audio()), separate: async () => { throw new Error('out of memory'); } });
    prefetcher.plan(songs, 0);
    await settle(prefetcher, 2);
    const [tail, head] = prefetcher.state.get().windows;
    expect(tail.status).toMatchObject({ state: 'failed', why: 'not_connected' });
    expect(head.status).toEqual({ state: 'failed', why: 'separation_failed', detail: 'out of memory' });
    const full = make({ io: memoryIo({ full: true }).io });
    full.prefetcher.plan(songs, 0);
    await settle(full.prefetcher, 1);
    expect(full.prefetcher.state.get().windows[0].status).toMatchObject({ state: 'failed', why: 'storage_full' });
  });

  it('skips with the device reason when the gate says no', async () => {
    const separate = vi.fn(passThrough);
    const { prefetcher } = make({ separate, canRun: () => ({ ok: false, why: "the stem model's licence is still under review" }) });
    prefetcher.plan(songs, 0);
    await settle(prefetcher, 2);
    expect(prefetcher.state.get().windows[0].status).toEqual({ state: 'skipped', why: "the stem model's licence is still under review" });
    expect(separate).not.toHaveBeenCalled();
  });

  it('waits while the tab is hidden and resumes when it is shown', async () => {
    const doc = fakeDocument(true);
    const separate = vi.fn(passThrough);
    const { prefetcher } = make({ separate, document: doc });
    prefetcher.plan(songs, 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(separate).not.toHaveBeenCalled();
    expect(prefetcher.state.get().paused).toEqual([{ reason: 'hidden', message: HIDDEN_MESSAGE }]);
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    await settle(prefetcher, 2);
    expect(prefetcher.state.get().paused).toEqual([]);
  });

  it('cancels a running window that a new plan no longer needs', async () => {
    let seenSignal: AbortSignal | undefined;
    const separate: StemSeparator = (channels, options) => new Promise((resolve, reject) => {
      seenSignal = options?.signal;
      options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('stop'), { name: 'AbortError' })));
      void channels;
    });
    const { prefetcher } = make({ separate });
    prefetcher.plan(songs, 0);
    await vi.waitFor(() => expect(seenSignal).toBeDefined());
    prefetcher.plan(songs, 1);
    expect(seenSignal?.aborted).toBe(true);
    expect(prefetcher.state.get().windows.map((entry) => `${entry.songId}:${entry.window.role}`)).toEqual(['2:tail', '3:head']);
    prefetcher.dispose();
  });

  it('pauses itself when jobs keep running far slower than the benchmark', async () => {
    let now = 0;
    const separate: StemSeparator = async (channels, options) => {
      now += 100_000; // 100 s for 2 s of audio
      return passThrough(channels, options);
    };
    const { prefetcher } = make({ separate, clock: () => now, expectedSecondsPerAudioSecond: 0.2, transitions: 3 });
    // Two-second songs: each song's head and tail are the same window, so four songs, four jobs.
    prefetcher.plan([...songs, { songId: 4, durationS: 2 }], 0);
    expect(prefetcher.state.get().windows).toHaveLength(4);
    await vi.waitFor(() => expect(prefetcher.state.get().paused.map((pause) => pause.reason)).toContain('thermal'));
    expect(prefetcher.state.get().windows.filter((entry) => entry.status.state === 'ready')).toHaveLength(3);
    expect(prefetcher.state.get().windows[3].status.state).toBe('queued');
  });
});
