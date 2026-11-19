import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bytesSha256 } from '../../media/identity';
import { readStemModelBytes, StemModelManager, stemArtefactUrl, stemModelFileName, type ModelDirectory, type StemModelArtefact } from './model';

/** An OPFS directory with real write positions, keepExistingData and commit-on-close. */
function fakeOpfs(behaviour: { fullAfter?: number } = {}) {
  const files = new Map<string, Uint8Array>();
  const root: ModelDirectory = {
    getFileHandle: async (name, options) => {
      if (!options?.create && !files.has(name)) throw new DOMException('absent', 'NotFoundError');
      if (!files.has(name)) files.set(name, new Uint8Array(0));
      return {
        getFile: async () => new File([(files.get(name) ?? new Uint8Array(0)).slice()], name),
        createWritable: async (opts) => {
          let draft = opts?.keepExistingData ? (files.get(name) ?? new Uint8Array(0)).slice() : new Uint8Array(0);
          let position = 0;
          return {
            seek: async (at: number) => { position = at; },
            write: async (data) => {
              const chunk = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
              if (behaviour.fullAfter !== undefined && position + chunk.length > behaviour.fullAfter) {
                throw new DOMException('no room', 'QuotaExceededError');
              }
              const next = new Uint8Array(Math.max(draft.length, position + chunk.length));
              next.set(draft);
              next.set(chunk, position);
              draft = next;
              position += chunk.length;
            },
            close: async () => { files.set(name, draft); },
            abort: async () => undefined,
          };
        },
      };
    },
    removeEntry: async (name) => {
      if (!files.delete(name)) throw new DOMException('absent', 'NotFoundError');
    },
  };
  return { files, root: async () => root };
}

type FakeResponseOptions = { ignoreRange?: boolean; status?: number; abortAfter?: { bytes: number; controller: () => void } };

/** A server for one artefact: honours Range unless told not to; streams in small chunks. */
function fakeServer(body: Uint8Array, options: FakeResponseOptions = {}) {
  const requests: { range: string | null }[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const range = headers.get('Range');
    requests.push({ range });
    if (options.status) return { status: options.status, ok: false, headers: new Headers(), body: null };
    let start = 0;
    let status = 200;
    const responseHeaders = new Headers();
    if (range && !options.ignoreRange) {
      start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
      status = 206;
      responseHeaders.set('Content-Range', `bytes ${start}-${body.length - 1}/${body.length}`);
    }
    let offset = start;
    let sent = 0;
    const signal = init?.signal;
    return {
      status,
      ok: true,
      headers: responseHeaders,
      body: {
        getReader: () => ({
          read: async () => {
            if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
            if (options.abortAfter && sent >= options.abortAfter.bytes) {
              options.abortAfter.controller();
              throw new DOMException('aborted', 'AbortError');
            }
            if (offset >= body.length) return { done: true, value: undefined };
            const value = body.slice(offset, offset + 10);
            offset += value.length;
            sent += value.length;
            return { done: false, value };
          },
        }),
      },
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

const payload = new Uint8Array(64).map((_, index) => (index * 7) % 251);

async function artefactFor(bytes: Uint8Array): Promise<StemModelArtefact> {
  const sha256 = await bytesSha256(bytes.slice().buffer);
  return { implementation: 'htdemucs-onnx-v1', url: stemArtefactUrl('/models/stems/', 'htdemucs-onnx-v1', sha256), sha256, bytes: bytes.length };
}

describe('stem model artefact on this device', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('refuses to download when no artefact has been published (the honest state of this build)', async () => {
    const manager = new StemModelManager();
    expect(manager.artefact).toBeNull();
    await expect(manager.download()).resolves.toEqual({ kind: 'failed', why: 'not_published' });
    expect(manager.state.get()).toEqual({ kind: 'failed', why: 'not_published' });
  });

  it('builds an immutable, content-hashed URL', () => {
    expect(stemArtefactUrl('/m/', 'htdemucs-onnx-v1', 'a'.repeat(64))).toBe(`/m/htdemucs-onnx-v1/${'a'.repeat(64)}.onnx`);
  });

  it('downloads, reports progress, verifies the hash and becomes ready', async () => {
    const artefact = await artefactFor(payload);
    const opfs = fakeOpfs();
    const server = fakeServer(payload);
    const manager = new StemModelManager({ artefact, root: opfs.root, fetchImpl: server.fetchImpl });
    const seen: string[] = [];
    manager.state.subscribe(() => {
      const state = manager.state.get();
      seen.push(state.kind === 'downloading' ? `${state.received}/${state.total}` : state.kind);
    });
    await expect(manager.download()).resolves.toEqual({ kind: 'ready' });
    expect(seen).toContain('30/64');
    expect(seen[seen.length - 1]).toBe('ready');
    expect(Array.from(opfs.files.get(stemModelFileName(artefact.sha256)) ?? [])).toEqual(Array.from(payload));
    expect(await new StemModelManager({ artefact, root: opfs.root }).refresh()).toEqual({ kind: 'ready' });
    const bytes = await readStemModelBytes(artefact.sha256, opfs.root);
    expect(bytes?.byteLength).toBe(64);
  });

  it('pauses keeping the partial file, then resumes with an HTTP Range request', async () => {
    const artefact = await artefactFor(payload);
    const opfs = fakeOpfs();
    const pausing: StemModelManager = new StemModelManager({
      artefact,
      root: opfs.root,
      fetchImpl: fakeServer(payload, { abortAfter: { bytes: 30, controller: () => pausing.pause() } }).fetchImpl,
    });
    await expect(pausing.download()).resolves.toEqual({ kind: 'absent', partialBytes: 30 });
    const second = fakeServer(payload);
    const resumed = new StemModelManager({ artefact, root: opfs.root, fetchImpl: second.fetchImpl });
    expect(await resumed.refresh()).toEqual({ kind: 'absent', partialBytes: 30 });
    await expect(resumed.download()).resolves.toEqual({ kind: 'ready' });
    expect(second.requests[0].range).toBe('bytes=30-');
  });

  it('starts over when the server ignores the range', async () => {
    const artefact = await artefactFor(payload);
    const opfs = fakeOpfs();
    opfs.files.set(stemModelFileName(artefact.sha256), payload.slice(0, 20));
    const server = fakeServer(payload, { ignoreRange: true });
    const manager = new StemModelManager({ artefact, root: opfs.root, fetchImpl: server.fetchImpl });
    await expect(manager.download()).resolves.toEqual({ kind: 'ready' });
    expect(server.requests[0].range).toBe('bytes=20-');
    expect(opfs.files.get(stemModelFileName(artefact.sha256))?.length).toBe(64);
  });

  it('deletes a file that does not match its fingerprint and says checksum', async () => {
    const artefact = await artefactFor(payload);
    const tampered = payload.slice();
    tampered[5] ^= 0xff;
    const opfs = fakeOpfs();
    const manager = new StemModelManager({ artefact, root: opfs.root, fetchImpl: fakeServer(tampered).fetchImpl });
    await expect(manager.download()).resolves.toMatchObject({ kind: 'failed', why: 'checksum' });
    expect(opfs.files.has(stemModelFileName(artefact.sha256))).toBe(false);
  });

  it('reports storage_full when the browser runs out of room', async () => {
    const artefact = await artefactFor(payload);
    const opfs = fakeOpfs({ fullAfter: 25 });
    const manager = new StemModelManager({ artefact, root: opfs.root, fetchImpl: fakeServer(payload).fetchImpl });
    await expect(manager.download()).resolves.toMatchObject({ kind: 'failed', why: 'storage_full' });
  });

  it('cancel throws the partial file away; remove frees the space', async () => {
    const artefact = await artefactFor(payload);
    const opfs = fakeOpfs();
    const manager: StemModelManager = new StemModelManager({
      artefact,
      root: opfs.root,
      fetchImpl: fakeServer(payload, { abortAfter: { bytes: 20, controller: () => manager.cancel() } }).fetchImpl,
    });
    await expect(manager.download()).resolves.toEqual({ kind: 'absent' });
    expect(opfs.files.has(stemModelFileName(artefact.sha256))).toBe(false);

    const again = new StemModelManager({ artefact, root: opfs.root, fetchImpl: fakeServer(payload).fetchImpl });
    await again.download();
    await expect(again.remove()).resolves.toEqual({ kind: 'absent' });
    expect(opfs.files.size).toBe(0);
    expect(await again.refresh()).toEqual({ kind: 'absent' });
  });

  it('a server error is a network failure with the status, never ready', async () => {
    const artefact = await artefactFor(payload);
    const manager = new StemModelManager({ artefact, root: fakeOpfs().root, fetchImpl: fakeServer(payload, { status: 503 }).fetchImpl });
    await expect(manager.download()).resolves.toEqual({ kind: 'failed', why: 'network', detail: 'the server answered 503' });
  });

  it('says unavailable where the browser has no private file storage', async () => {
    const artefact = await artefactFor(payload);
    const manager = new StemModelManager({ artefact, root: async () => null });
    await expect(manager.refresh()).resolves.toMatchObject({ kind: 'failed', why: 'unavailable' });
  });
});
