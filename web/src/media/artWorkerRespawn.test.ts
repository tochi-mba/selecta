import { afterEach, describe, expect, it, vi } from 'vitest';

const pageArt = vi.fn(async () => null);
vi.mock('./artWorker', async (original) => ({ ...(await original<typeof import('./artWorker')>()), makeArt: pageArt }));

const { makeArtOffPage, resetArtWorker, WORKER_FAILURE_LIMIT } = await import('./art');

/** A worker that never answers, so every picture waits out the time limit. */
class SilentWorker {
  static made = 0;
  terminated = false;
  constructor() { SilentWorker.made += 1; }
  addEventListener() {}
  removeEventListener() {}
  postMessage() {}
  terminate() { this.terminated = true; }
}

const picture = () => ({ mime: 'image/jpeg' as const, bytes: new Uint8Array([1, 2, 3]) });

afterEach(() => {
  resetArtWorker();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a cover worker that times out (T-20261125-6d33)', () => {
  it('is made again a few times, then covers are skipped rather than drawn on the page', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', SilentWorker);
    SilentWorker.made = 0;
    for (let tries = 0; tries < WORKER_FAILURE_LIMIT; tries += 1) {
      const made = makeArtOffPage(picture());
      await vi.advanceTimersByTimeAsync(20_001);
      expect(await made).toBeNull();
    }
    expect(SilentWorker.made).toBe(WORKER_FAILURE_LIMIT);
    expect(await makeArtOffPage(picture())).toBeNull();
    expect(SilentWorker.made).toBe(WORKER_FAILURE_LIMIT);
    expect(pageArt).not.toHaveBeenCalled();
  });
});
