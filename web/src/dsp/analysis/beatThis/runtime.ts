/** Beat This on onnxruntime-web, in the analysis worker.
 *
 * The portable WASM build (SIMD), single-threaded, as the stem splitter runs: threads need the
 * site to be cross-origin isolated, which it is not, and the WebGPU build is too large for the
 * static host (stems/runtime.ts). One session per worker, made on first use and kept; one
 * chunk (at most 1500 frames) is run at a time.
 */

import type { OrtLike, OrtSessionLike } from '../../stems/adapter';
import { importOrtWasm } from '../../stems/runtime';
import { BEAT_MELS } from './spectrogram';
import type { RunChunk } from './track';

export type BeatBackend = 'wasm';

export interface BeatRuntime {
  backend: BeatBackend;
  run: RunChunk;
  release(): Promise<void>;
}

/** The session over `model`, the verified file's bytes. Throws when the runtime can't load. */
export async function loadBeatRuntime(model: Uint8Array, importOrt: () => Promise<OrtLike> = importOrtWasm): Promise<BeatRuntime> {
  const ort = await importOrt();
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const session: OrtSessionLike = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return {
    backend: 'wasm',
    run: async (spect, frames) => {
      const out = await session.run({ spect: new ort.Tensor('float32', spect, [1, frames, BEAT_MELS]) });
      const beat = out.beat;
      const downbeat = out.downbeat;
      // the contract is [1, T] for both; anything else is refused rather than reinterpreted
      if (!beat || !downbeat || beat.dims.join() !== `1,${frames}` || downbeat.dims.join() !== `1,${frames}`) {
        throw new Error('The beat model answered in an unexpected shape.');
      }
      return { beat: beat.data as Float32Array, downbeat: downbeat.data as Float32Array };
    },
    release: async () => {
      await session.release?.();
    },
  };
}
