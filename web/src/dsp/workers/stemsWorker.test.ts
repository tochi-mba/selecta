import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleStemRequest, resetStemWorkerForTests, trustedStemRequest, type StemWorkerDeps, type StemWorkerResponse } from './stemsWorker';
import { separateInWorker } from './stemsSpawn';
import { STEM_SEGMENT_SAMPLES } from '../stems/model';
import type { StemRuntime } from '../stems/runtime';

const SHA = 'aa'.repeat(32);

function deps(overrides: Partial<StemWorkerDeps> = {}) {
  const posted: { message: StemWorkerResponse; transfer?: Transferable[] }[] = [];
  const runtime: StemRuntime = {
    backend: 'wasm',
    implementation: 'htdemucs-onnx-v1',
    runSegment: async (left, right) => Array.from({ length: 8 }, (_, plane) => (plane % 2 ? right : left).slice()),
    release: async () => undefined,
  };
  const loadRuntime = vi.fn(async () => runtime);
  const value: StemWorkerDeps = {
    readModel: async () => new Uint8Array([1, 2, 3]).buffer,
    hash: async () => SHA,
    loadRuntime,
    post: (message, transfer) => posted.push({ message, transfer }),
    ...overrides,
  };
  return { value, posted, loadRuntime };
}

const request = (id: number, length = STEM_SEGMENT_SAMPLES + 1000) => ({
  type: 'separate' as const,
  id,
  sampleRate: 44100,
  channels: [new Float32Array(length).fill(0.1), new Float32Array(length).fill(-0.1)],
  model: { sha256: SHA },
});

describe('stem worker', () => {
  beforeEach(() => resetStemWorkerForTests());

  it('separates in segments, reports progress and transfers eight channels back', async () => {
    const { value, posted, loadRuntime } = deps();
    await handleStemRequest(request(1), value);
    await handleStemRequest(request(2), value);
    expect(loadRuntime).toHaveBeenCalledTimes(1); // one model load per hash
    const progress = posted.filter((entry) => entry.message.type === 'progress' && entry.message.id === 1);
    expect(progress.length).toBeGreaterThan(2);
    const result = posted.find((entry) => entry.message.type === 'result' && entry.message.id === 1);
    expect(result?.message).toMatchObject({ backend: 'wasm', implementation: 'htdemucs-onnx-v1' });
    const stems = (result?.message as { stems: Float32Array[] }).stems;
    expect(stems).toHaveLength(8);
    expect(stems[7][5]).toBeCloseTo(-0.1, 5);
    expect(result?.transfer).toHaveLength(8);
  });

  it('refuses a model whose bytes do not match the fingerprint, and a missing model', async () => {
    const wrong = deps({ hash: async () => 'bb'.repeat(32) });
    await handleStemRequest(request(1), wrong.value);
    expect(wrong.posted.at(-1)?.message).toMatchObject({ type: 'error', cancelled: false, error: expect.stringMatching(/fingerprint/) });
    resetStemWorkerForTests();
    const missing = deps({ readModel: async () => null });
    await handleStemRequest(request(2), missing.value);
    expect(missing.posted.at(-1)?.message).toMatchObject({ type: 'error', error: expect.stringMatching(/not downloaded/) });
  });

  it('stops at the next segment when cancelled', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { value, posted } = deps({
      loadRuntime: async () => ({
        backend: 'wasm',
        implementation: 'htdemucs-onnx-v1',
        runSegment: async (left, right) => { await gate; return Array.from({ length: 8 }, (_, plane) => (plane % 2 ? right : left)); },
        release: async () => undefined,
      }),
    });
    const running = handleStemRequest(request(5, STEM_SEGMENT_SAMPLES * 3), value);
    await handleStemRequest({ type: 'cancel', id: 5 }, value);
    release();
    await running;
    expect(posted.at(-1)?.message).toMatchObject({ type: 'error', id: 5, cancelled: true });
  });

  it('only accepts well-formed requests', () => {
    const event = (data: unknown) => new MessageEvent('message', { data });
    expect(trustedStemRequest(event(request(1)))).not.toBeNull();
    expect(trustedStemRequest(event({ type: 'cancel', id: 3 }))).toEqual({ type: 'cancel', id: 3 });
    expect(trustedStemRequest(event({ ...request(1), channels: [new Float32Array(2)] }))).toBeNull();
    expect(trustedStemRequest(event({ ...request(1), channels: [new Float32Array(2), new Float32Array(3)] }))).toBeNull();
    expect(trustedStemRequest(event({ ...request(1), model: { sha256: 5 } }))).toBeNull();
    expect(trustedStemRequest(event('separate'))).toBeNull();
  });
});

class FakeWorker extends EventTarget {
  readonly sent: { message: unknown; transfer: Transferable[] }[] = [];
  postMessage(message: unknown, transfer: Transferable[] = []) {
    this.sent.push({ message, transfer });
  }
  answer(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

describe('stem worker client', () => {
  it('copies borrowed channels, relays progress and settles on its own answer', async () => {
    const worker = new FakeWorker();
    const left = new Float32Array(8);
    const right = new Float32Array(8);
    const progress: number[] = [];
    const asked = separateInWorker(worker as unknown as Worker, [left, right], { sha256: SHA }, { onProgress: (p) => progress.push(p) });
    const { message, transfer } = worker.sent[0] as { message: { id: number; channels: Float32Array[] }; transfer: Transferable[] };
    expect(message.channels[0]).not.toBe(left);
    expect(transfer).toHaveLength(2);
    worker.answer({ type: 'progress', id: message.id, done: 1, total: 4 });
    worker.answer({ type: 'result', id: message.id + 99, backend: 'wasm', implementation: 'x', stems: [] });
    worker.answer({ type: 'result', id: message.id, backend: 'webgpu', implementation: 'htdemucs-onnx-v1', stems: [new Float32Array(1)] });
    await expect(asked).resolves.toMatchObject({ backend: 'webgpu' });
    expect(progress).toEqual([0.25]);
  });

  it('aborting tells the worker to cancel and rejects with AbortError', async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const asked = separateInWorker(worker as unknown as Worker, [new Float32Array(4), new Float32Array(4)], { sha256: SHA }, { signal: controller.signal });
    const id = (worker.sent[0].message as { id: number }).id;
    controller.abort();
    await expect(asked).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.sent[1].message).toEqual({ type: 'cancel', id });
  });

  it('turns a cancelled worker answer into AbortError and a failure into its message', async () => {
    const worker = new FakeWorker();
    const first = separateInWorker(worker as unknown as Worker, [new Float32Array(1), new Float32Array(1)], { sha256: SHA });
    worker.answer({ type: 'error', id: (worker.sent[0].message as { id: number }).id, error: 'x', cancelled: true });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = separateInWorker(worker as unknown as Worker, [new Float32Array(1), new Float32Array(1)], { sha256: SHA });
    worker.answer({ type: 'error', id: (worker.sent[1].message as { id: number }).id, error: 'out of memory', cancelled: false });
    await expect(second).rejects.toThrow('out of memory');
  });
});
