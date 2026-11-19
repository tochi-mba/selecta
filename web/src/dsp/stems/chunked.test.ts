import { describe, expect, it, vi } from 'vitest';
import { htdemucsFeeds, htdemucsOutputs, type OrtLike, type OrtTensorLike } from './adapter';
import { segmentOffsets, segmentWeights, separateChunked } from './chunked';
import { loadStemRuntime } from './runtime';

class FakeTensor implements OrtTensorLike {
  constructor(readonly type: string, readonly data: Float32Array, readonly dims: readonly number[]) {}
}

/** A fake model whose four "stems" are the input scaled by 0.1, 0.2, 0.3 and 0.4. */
function fakeOrt(options: { webgpuFails?: boolean } = {}) {
  const created: string[][] = [];
  const ort: OrtLike = {
    Tensor: FakeTensor,
    env: { wasm: {} },
    InferenceSession: {
      create: async (_model, opts) => {
        const providers = (opts?.executionProviders as string[]) ?? [];
        created.push(providers);
        if (providers.includes('webgpu') && options.webgpuFails) throw new Error('no adapter');
        return {
          run: async (feeds) => {
            const mix = feeds.mix as FakeTensor;
            const samples = mix.dims[2];
            const out = new Float32Array(4 * 2 * samples);
            for (let stem = 0; stem < 4; stem += 1) {
              for (let channel = 0; channel < 2; channel += 1) {
                for (let index = 0; index < samples; index += 1) {
                  out[(stem * 2 + channel) * samples + index] = mix.data[channel * samples + index] * (stem + 1) * 0.1;
                }
              }
            }
            return { stems: new FakeTensor('float32', out, [1, 4, 2, samples]) };
          },
        };
      },
    },
  };
  return { ort, created };
}

describe('chunked separation with overlap-add', () => {
  it('covers the window with overlapping segments', () => {
    expect(segmentOffsets(100, 40, 0.25)).toEqual([0, 30, 60]);
    expect(segmentOffsets(30, 40, 0.25)).toEqual([0]);
  });

  it('ramps only where a neighbour overlaps', () => {
    const middle = segmentWeights(8, 2, false, false);
    expect(Array.from(middle).map((value) => Number(value.toFixed(3)))).toEqual([0.333, 0.667, 1, 1, 1, 1, 0.667, 0.333]);
    expect(segmentWeights(8, 2, true, true).every((value) => value === 1)).toBe(true);
  });

  it('reassembles exactly when the model passes the audio through', async () => {
    const length = 1000;
    const left = Float32Array.from({ length }, (_, index) => Math.sin(index / 7) * 0.5 + 0.01);
    const right = Float32Array.from({ length }, (_, index) => Math.cos(index / 11) * 0.4);
    const progress: number[] = [];
    const out = await separateChunked(left, right, async (l, r) => [l, r], {
      segmentSamples: 128,
      overlap: 0.25,
      planes: 2,
      onProgress: (done) => progress.push(done),
    });
    for (let index = 0; index < length; index += 1) {
      expect(out[0][index]).toBeCloseTo(left[index], 5);
      expect(out[1][index]).toBeCloseTo(right[index], 5);
    }
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(segmentOffsets(length, 128, 0.25).length);
  });

  it('stops at the next segment when cancelled', async () => {
    let calls = 0;
    const run = vi.fn(async (l: Float32Array, r: Float32Array) => { calls += 1; return [l, r]; });
    await expect(separateChunked(new Float32Array(1000), new Float32Array(1000), run, {
      segmentSamples: 100, overlap: 0.25, planes: 2, isCancelled: () => calls >= 2,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(2);
  });

  it('refuses a model that returns the wrong shape', async () => {
    await expect(separateChunked(new Float32Array(10), new Float32Array(10), async (l) => [l], {
      segmentSamples: 10, overlap: 0, planes: 2,
    })).rejects.toThrow(/wrong number/);
  });
});

describe('the model adapter and runtime', () => {
  it('packs [1, 2, S] in and splits [1, 4, 2, S] out in drums, bass, other, vocals order', async () => {
    const { ort } = fakeOrt();
    const left = Float32Array.from([1, 2, 3]);
    const right = Float32Array.from([4, 5, 6]);
    const feeds = htdemucsFeeds(ort, left, right);
    expect(feeds.mix.dims).toEqual([1, 2, 3]);
    const session = await ort.InferenceSession.create(new Uint8Array(1));
    const planes = htdemucsOutputs(await session.run(feeds), 3);
    expect(planes).toHaveLength(8);
    expect(Array.from(planes[6]).map((v) => Number(v.toFixed(3)))).toEqual([0.4, 0.8, 1.2]); // vocals L
    expect(() => htdemucsOutputs({ stems: new FakeTensor('float32', new Float32Array(6), [1, 1, 2, 3]) }, 3)).toThrow(/expected \[1, 4, 2, 3\]/);
  });

  it('uses WebGPU when present and says so', async () => {
    const { ort, created } = fakeOrt();
    const runtime = await loadStemRuntime(new Uint8Array(1), { importOrt: async () => ort, webgpu: true });
    expect(runtime.backend).toBe('webgpu');
    expect(created).toEqual([['webgpu']]);
    expect(ort.env.wasm).toEqual({ numThreads: 1, proxy: false });
  });

  it('falls back to single-threaded WASM when WebGPU is absent or fails', async () => {
    const failing = fakeOrt({ webgpuFails: true });
    const runtime = await loadStemRuntime(new Uint8Array(1), { importOrt: async () => failing.ort, webgpu: true });
    expect(runtime.backend).toBe('wasm');
    expect(failing.created).toEqual([['webgpu'], ['wasm']]);
    const absent = fakeOrt();
    expect((await loadStemRuntime(new Uint8Array(1), { importOrt: async () => absent.ort, webgpu: false })).backend).toBe('wasm');
    const planes = await runtime.runSegment(Float32Array.from([1]), Float32Array.from([2]));
    expect(planes.map((plane) => Number(plane[0].toFixed(2)))).toEqual([0.1, 0.2, 0.2, 0.4, 0.3, 0.6, 0.4, 0.8]);
  });
});
