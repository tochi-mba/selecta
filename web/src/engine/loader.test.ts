import { describe, expect, it, vi } from 'vitest';
import { createLoader } from './loader';
import { bufferOfSeconds } from './testAudio';

const bytes = () => Promise.resolve(new ArrayBuffer(8));
const decoded = () => bufferOfSeconds(1) as unknown as AudioBuffer;

describe('the decoded-PCM loader', () => {
  it('decodes once and reuses the result by id', async () => {
    const decode = vi.fn(async () => decoded());
    const loader = createLoader(decode);
    const first = await loader.load('a', bytes);
    const again = await loader.load('a', bytes);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(first.ok && again.ok && first.buffer === again.buffer).toBe(true);
  });

  it('evicts the least recently used song past the cap and counts it', async () => {
    const decode = vi.fn(async () => decoded());
    const loader = createLoader(decode, { keep: 2 });
    await loader.load('a', bytes);
    await loader.load('b', bytes);
    await loader.load('c', bytes); // a goes
    expect(loader.stats()).toMatchObject({ held: 2, evictions: 1 });
    await loader.load('a', bytes); // decodes again, b goes
    expect(decode).toHaveBeenCalledTimes(4);
    expect(loader.stats().evictions).toBe(2);
  });

  it('refreshes recency on a read, so the song still in use is not the one evicted', async () => {
    const decode = vi.fn(async () => decoded());
    const loader = createLoader(decode, { keep: 2 });
    await loader.load('a', bytes);
    await loader.load('b', bytes);
    await loader.load('a', bytes); // touch a, so b is now the stalest
    await loader.load('c', bytes);
    await loader.load('a', bytes);
    expect(decode).toHaveBeenCalledTimes(3); // a was never re-decoded
  });

  it('captures a decode failure as a value, never an exception', async () => {
    const loader = createLoader(async () => { throw new Error('bad frame header'); });
    const result = await loader.load(7, bytes);
    expect(result).toEqual({ ok: false, id: 7, error: 'bad frame header' });
    expect(loader.stats().failures).toBe(1);
  });

  it('gives a failure without a message a plain sentence', async () => {
    const loader = createLoader(async () => { throw new Error(''); });
    const result = await loader.load('x', bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/could not be read/);
  });

  it('captures a bytes-reading failure the same way', async () => {
    const loader = createLoader(async () => decoded());
    const result = await loader.load('gone', () => Promise.reject(new Error('download lost')));
    expect(result).toEqual({ ok: false, id: 'gone', error: 'download lost' });
  });

  it('does not cache failures: a corrupt download may succeed on the next try', async () => {
    let calls = 0;
    const loader = createLoader(async () => {
      calls += 1;
      if (calls === 1) throw new Error('flaky');
      return decoded();
    });
    const first = await loader.load('a', bytes);
    const second = await loader.load('a', bytes);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('forgets a song on request and clears whole', async () => {
    const decode = vi.fn(async () => decoded());
    const loader = createLoader(decode);
    await loader.load('a', bytes);
    loader.forget('a');
    await loader.load('a', bytes);
    expect(decode).toHaveBeenCalledTimes(2);
    loader.clear();
    expect(loader.stats().held).toBe(0);
  });
});
