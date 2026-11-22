/** The inference runtime for the stem splitter: onnxruntime-web, loaded only when needed.
 *
 * WebGPU is tried first when the browser exposes `navigator.gpu`; otherwise, or when the WebGPU
 * session cannot be created, WASM runs single-threaded. Single-threaded WASM needs no
 * SharedArrayBuffer, so the site needs no cross-origin isolation (COOP/COEP) for stems. The
 * backend actually used is reported, because device evidence is per backend.
 */

import { htdemucsFeeds, htdemucsOutputs, type OrtLike, type OrtSessionLike } from './adapter';
import { STEM_MODEL } from './model';

export type StemBackend = 'webgpu' | 'wasm';

export interface StemRuntime {
  backend: StemBackend;
  implementation: string;
  /** Run one normalised stereo segment; returns stem-major planar channels. */
  runSegment: (left: Float32Array, right: Float32Array) => Promise<Float32Array[]>;
  release: () => Promise<void>;
}

export interface StemRuntimeOptions {
  importOrt?: () => Promise<OrtLike>;
  /** Defaults to whether `navigator.gpu` exists in this context. */
  webgpu?: boolean;
}

export function hasWebGpu(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu;
}

async function defaultImport(): Promise<OrtLike> {
  // Cloudflare Pages rejects the WebGPU/JSEP and Asyncify binaries because each exceeds its
  // 25 MiB per-file limit. The portable WASM build is 14 MiB and keeps local stem splitting
  // available; callers can still inject a WebGPU-capable runtime when hosted elsewhere.
  return (await import('onnxruntime-web/wasm')) as unknown as OrtLike;
}

export async function loadStemRuntime(model: Uint8Array, options: StemRuntimeOptions = {}): Promise<StemRuntime> {
  const ort = await (options.importOrt ?? defaultImport)();
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const tryWebGpu = options.webgpu ?? hasWebGpu();
  let session: OrtSessionLike | null = null;
  let backend: StemBackend = 'wasm';
  if (tryWebGpu) {
    try {
      session = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
      backend = 'webgpu';
    } catch {
      session = null;
    }
  }
  if (!session) {
    session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    backend = 'wasm';
  }
  const live = session;
  return {
    backend,
    implementation: STEM_MODEL.implementation,
    runSegment: async (left, right) => htdemucsOutputs(await live.run(htdemucsFeeds(ort, left, right)), left.length),
    release: async () => {
      await live.release?.();
    },
  };
}
