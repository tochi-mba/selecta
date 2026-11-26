import { describe, expect, it } from 'vitest';
import type { MadeSeam } from '../dsp/render/seamMaker';
import { assertMachineDerived, type DerivedStore } from '../media/derived';
import { CLIP_VERSION, createClipStore, type ClipKey } from './clipStore';

// Clips made ahead are kept on the device under a key of everything that changes them, found again
// on the next visit, and kept within their own byte budget, least recently used out first.

function fakeStore() {
  const rows = new Map<string, unknown>();
  const key = (kind: string, version: string, sha: string) => `${kind}|${version}|${sha}`;
  const store = {
    get: async (kind: string, version: string, sha: string) => (rows.has(key(kind, version, sha)) ? structuredClone(rows.get(key(kind, version, sha))) : null),
    put: async (kind: string, version: string, sha: string, value: unknown) => { rows.set(key(kind, version, sha), structuredClone(value)); return true; },
    delete: async (kind: string, version: string, sha: string) => { rows.delete(key(kind, version, sha)); },
  };
  return { rows, open: async () => store as unknown as DerivedStore };
}

const SAMPLES = 1000;
const BYTES = SAMPLES * 4 * 2;

function made(mark: number): MadeSeam {
  return {
    status: 'clip',
    rendered: {
      channels: [new Float32Array(SAMPLES).fill(mark / 10), new Float32Array(SAMPLES).fill(mark / 10)], sampleRate: 44_100,
      aStartSample: 441_000, bEndSample: 88_200, levels: { a: 0.5, b: 0.8 }, switchAt: 0.01,
      bWarp: { output: [0, 0.02], source: [1.98, 2] }, implementation: 'web-render-1+wsola-stretch-v1',
    },
    move: 'bass_swap_blend', option: 0, facts: { passed: false, failures: [{ name: 'level fall', value: 4, limit: 3.5, fix: 'move_cue' }] },
    passed: false, nearMiss: true, fellBack: false, beatsAligned: true, attempts: [], tookMs: 900, implementation: 'web-render-1+wsola-stretch-v1',
  };
}

const keyOf = (mark: number, levels = { a: 0.5, b: 0.8 }): ClipKey => ({
  shaA: mark.toString(16).padStart(64, '0'), shaB: 'b'.repeat(64), fingerprint: 'f'.repeat(64), levels, implementation: 'web-render-1+wsola-stretch-v1',
});

describe('clips kept on the device', () => {
  it('finds a clip again under the same key, with how its checks went', async () => {
    const { open } = fakeStore();
    const clips = createClipStore(open);
    await clips.put(keyOf(1), made(1));
    const found = await clips.get(keyOf(1));
    expect(found).toMatchObject({ status: 'clip', move: 'bass_swap_blend', nearMiss: true, beatsAligned: true, facts: { passed: false, failures: [{ name: 'level fall', value: 4, limit: 3.5, fix: 'move_cue' }] } });
    expect(Array.from(found!.rendered.channels[0].slice(0, 3))).toEqual([0.1, 0.1, 0.1].map(Math.fround));
  });

  it('misses when anything that changes the clip differs: another level, another plan', async () => {
    const { open } = fakeStore();
    const clips = createClipStore(open);
    await clips.put(keyOf(1), made(1));
    expect(await clips.get(keyOf(1, { a: 0.5, b: 0.9 }))).toBeNull();
    expect(await clips.get({ ...keyOf(1), fingerprint: 'e'.repeat(64) })).toBeNull();
    expect(await clips.get({ ...keyOf(1), implementation: 'web-render-2+wsola-stretch-v1' })).toBeNull();
  });

  it('keeps within its budget, the least recently used out first', async () => {
    const { open } = fakeStore();
    const clips = createClipStore(open, BYTES * 2);
    await clips.put(keyOf(1), made(1));
    await clips.put(keyOf(2), made(2));
    await clips.put(keyOf(3), made(3));
    expect(await clips.get(keyOf(1))).toBeNull();
    expect(await clips.get(keyOf(2))).not.toBeNull();
    expect(await clips.get(keyOf(3))).not.toBeNull();
  });

  it('stores only machine-made values, nothing a person typed or chose', async () => {
    const { open, rows } = fakeStore();
    await createClipStore(open).put(keyOf(1), made(1));
    const clips = [...rows.entries()].filter(([key]) => key.startsWith(`clip|${CLIP_VERSION}|`));
    expect(clips).toHaveLength(1);
    for (const [, value] of rows) expect(() => assertMachineDerived(value)).not.toThrow();
  });
});
