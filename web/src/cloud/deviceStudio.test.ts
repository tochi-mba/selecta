import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PASSED, ready, scriptText, song } from '../dsp/render/testScripts';
import { setFlags } from '../flags';
import { DeviceStudio, type CandidatesAnswer, type StudioDeps, type StudioSong } from './deviceStudio';

// Render-ahead in play order: the next seam first, then the one after, one at a time; work for a
// seam that no longer comes is dropped; a skip never waits.

const sha = (n: number) => n.toString(16).padStart(64, '0');
const at = (n: number): StudioSong => ({ songId: n, sha: sha(n) });
const FINGERPRINT = 'f'.repeat(64);

const answer = (a: number, b: number): CandidatesAnswer => ({
  max_repairs: 4, fingerprint: FINGERPRINT,
  options: [{ index: 0, option: { move: 'bass_swap_blend', bars: 16, exit_cue: [40, 80, 'phrase', 0.8, 0], entry_cue: [0, 0, 'phrase', 0.8, 0] }, script: JSON.parse(scriptText({ a, b })), has_script: true }],
  fallback: null,
});

type Render = { a: number; b: number; signal?: AbortSignal; release(): void };

function rig(order: number[]) {
  const renders: Render[] = [];
  const decoded = new Map(order.map((songId, index) => [index, song(songId).audio as unknown as AudioBuffer]));
  const deps: StudioDeps = {
    candidates: vi.fn(async (a: number, b: number) => answer(a, b)),
    script: vi.fn(async () => null),
    measured: vi.fn(async () => true),
    audio: vi.fn(async (index: number) => decoded.get(index) ?? null),
    level: async () => 1,
    render: (script, _sources, options) => new Promise((resolve, reject) => {
      const parsed = JSON.parse(script);
      renders.push({ a: parsed.a.source.song, b: parsed.b.source.song, signal: options.signal, release: () => resolve(ready(script, PASSED)) });
      options.signal?.addEventListener('abort', () => reject(new DOMException('The render was abandoned.', 'AbortError')));
    }),
    store: null,
  };
  return { studio: new DeviceStudio(deps), deps, renders, decoded };
}

const ON = { 'cloud.brain': true, 'cloud.device_analysis': true, 'cloud.device_render': true };

beforeEach(() => setFlags(ON));
afterEach(() => setFlags(null));

describe('rendering ahead in play order', () => {
  it('prepares the next seam first, then the one after, one at a time', async () => {
    const { studio, renders } = rig([1, 2, 3, 4]);
    studio.follow([at(1), at(2), at(3), at(4)], 0);
    await vi.waitFor(() => expect(renders).toHaveLength(1));
    expect(renders[0]).toMatchObject({ a: 1, b: 2 });
    // nothing else renders while that one does
    await new Promise((done) => setTimeout(done, 20));
    expect(renders).toHaveLength(1);
    renders[0].release();
    await vi.waitFor(() => expect(renders).toHaveLength(2));
    expect(renders[1]).toMatchObject({ a: 2, b: 3 });
    renders[1].release();
    // two ahead at most: the seam into the fourth song waits for the play head
    await new Promise((done) => setTimeout(done, 20));
    expect(renders).toHaveLength(2);
  });

  it('hands over a finished clip made from these songs at these levels', async () => {
    const { studio, renders, decoded } = rig([1, 2, 3]);
    studio.follow([at(1), at(2), at(3)], 0);
    await vi.waitFor(() => expect(renders).toHaveLength(1));
    renders[0].release();
    const ask = { a: at(1), b: at(2), from: decoded.get(0)!, to: decoded.get(1)!, levels: { a: 1, b: 1 } };
    await vi.waitFor(async () => expect(await studio.clipFor(ask, 0)).toMatchObject({ status: 'clip', move: 'bass_swap_blend' }));
  });

  it('drops the work for a seam the new order no longer has, abandoning its render', async () => {
    const { studio, renders } = rig([1, 2, 3, 4]);
    studio.follow([at(1), at(2), at(3), at(4)], 0);
    await vi.waitFor(() => expect(renders).toHaveLength(1));
    // song 2 removed: the seam 1 > 2 no longer comes
    studio.follow([at(1), at(3), at(4)], 0);
    expect(renders[0].signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(renders).toHaveLength(2));
    expect(renders[1]).toMatchObject({ a: 1, b: 3 });
  });

  it('never makes a skip wait: a seam with nothing prepared answers at once', async () => {
    const { studio, decoded } = rig([1, 2, 3, 4]);
    const ask = { a: at(3), b: at(4), from: decoded.get(2)!, to: decoded.get(3)!, levels: { a: 1, b: 1 } };
    const began = Date.now();
    expect(await studio.clipFor(ask, 0)).toBeNull();
    expect(Date.now() - began).toBeLessThan(50);
  });

  it('stops waiting when the wait runs out, while the render goes on', async () => {
    const { studio, renders, decoded } = rig([1, 2]);
    const ask = { a: at(1), b: at(2), from: decoded.get(0)!, to: decoded.get(1)!, levels: { a: 1, b: 1 } };
    expect(await studio.clipFor(ask, 30)).toBeNull();
    await vi.waitFor(() => expect(renders).toHaveLength(1));
    expect(renders[0].signal?.aborted).toBe(false);
  });

  it('makes a seam asked for now ahead of one further on, with the songs it was handed', async () => {
    const { studio, renders, decoded } = rig([1, 2, 3, 4]);
    studio.follow([at(1), at(2), at(3), at(4)], 1);
    await vi.waitFor(() => expect(renders).toHaveLength(1));
    expect(renders[0]).toMatchObject({ a: 2, b: 3 });
    const ask = { a: at(1), b: at(2), from: decoded.get(0)!, to: decoded.get(1)!, levels: { a: 1, b: 1 } };
    const asked = studio.clipFor(ask, 5_000);
    expect(renders[0].signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(renders).toHaveLength(2));
    expect(renders[1]).toMatchObject({ a: 1, b: 2 });
    renders[1].release();
    expect(await asked).toMatchObject({ status: 'clip' });
  });

  it('does nothing with the flag off or not named by the server: playback stays as it is', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true });
    const { studio, renders, deps, decoded } = rig([1, 2, 3]);
    studio.follow([at(1), at(2), at(3)], 0);
    await new Promise((done) => setTimeout(done, 20));
    expect(renders).toHaveLength(0);
    expect(deps.candidates).not.toHaveBeenCalled();
    expect(await studio.clipFor({ a: at(1), b: at(2), from: decoded.get(0)!, to: decoded.get(1)!, levels: { a: 1, b: 1 } }, 1000)).toBeNull();
    setFlags({ ...ON, 'cloud.device_render': false });
    studio.follow([at(1), at(2), at(3)], 0);
    await new Promise((done) => setTimeout(done, 20));
    expect(renders).toHaveLength(0);
  });

  it('skips a pair that is not measured here and in the account, without rendering', async () => {
    const { studio, renders, deps, decoded } = rig([1, 2]);
    vi.mocked(deps.measured).mockResolvedValue(false);
    const outcome = await studio.clipFor({ a: at(1), b: at(2), from: decoded.get(0)!, to: decoded.get(1)!, levels: { a: 1, b: 1 } }, 1000);
    expect(outcome).toMatchObject({ status: 'none' });
    expect(renders).toHaveLength(0);
  });
});
