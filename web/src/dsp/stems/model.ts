/** The stem splitter's model artefact: what it is, and getting it onto this device (ADR-0459 Tier 3).
 *
 * The model is htdemucs converted to ONNX by `tools/stems_onnx_export.py`. Until that conversion
 * has run and its artefact is published, `STEM_MODEL_ARTEFACT` is null and a download honestly
 * fails with `not_published`; nothing here invents a hash or a size.
 *
 * The file lives in OPFS under the derived-cache prefix, so "clear everything on this device"
 * (`cacheClearAll`) removes it with the rest. The same prefix means quota pressure from a stem
 * cache write may evict it; the splitter then reads as absent and asks to download again.
 */

import { fileSha256 } from '../../media/identity';
import { observable, type Observable } from './observable';

export type StemName = 'drums' | 'bass' | 'other' | 'vocals';

/** What the model computes. Stem order is htdemucs's own source order. */
export interface StemModelSpec {
  implementation: string;
  sampleRate: 44100;
  stems: readonly StemName[];
  channels: 2;
  /** htdemucs's training segment, the length every inference call sees. */
  segmentS: number;
  /** Fraction of each segment shared with its neighbour, crossfaded linearly (demucs default). */
  overlap: number;
}

export const STEM_MODEL: StemModelSpec = {
  implementation: 'htdemucs-onnx-v1',
  sampleRate: 44100,
  stems: ['drums', 'bass', 'other', 'vocals'],
  channels: 2,
  segmentS: 7.8,
  overlap: 0.25,
};

export const STEM_SEGMENT_SAMPLES = Math.round(STEM_MODEL.segmentS * STEM_MODEL.sampleRate);

/** One published, immutable build of the model. The URL path carries the hash, so a cached
 * response can never be a different file. */
export interface StemModelArtefact {
  implementation: string;
  url: string;
  sha256: string;
  bytes: number;
}

/** Pending: the conversion has not run, so there is no artefact to fetch
 * (docs/verification/bf-tier3-htdemucs-2026-11-19.md). */
export const STEM_MODEL_ARTEFACT: StemModelArtefact | null = null;

/** The content-hashed path an artefact is published under. */
export function stemArtefactUrl(base: string, implementation: string, sha256: string): string {
  return `${base.replace(/\/+$/, '')}/${implementation}/${sha256}.onnx`;
}

export type StemModelFailure = 'not_published' | 'checksum' | 'storage_full' | 'network' | 'unavailable';

export type StemModelState =
  | { kind: 'absent'; partialBytes?: number }
  | { kind: 'downloading'; received: number; total: number }
  | { kind: 'ready' }
  | { kind: 'failed'; why: StemModelFailure; detail?: string };

const SHA256 = /^[0-9a-f]{64}$/;
const MARKER_KEY = 'selecta.dsp.stems.model';
/** Commit the partial file this often, so a closed tab resumes near where it stopped. */
const COMMIT_EVERY_BYTES = 8 * 1024 * 1024;

export function stemModelFileName(sha256: string): string {
  return `cache-stems-model-${sha256}.onnx`;
}

type Writable = {
  write: (data: Uint8Array | ArrayBuffer | Blob) => Promise<void>;
  seek?: (position: number) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
};
type FileHandle = {
  getFile: () => Promise<File>;
  createWritable: (options?: { keepExistingData?: boolean }) => Promise<Writable>;
};
export type ModelDirectory = {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileHandle>;
  removeEntry: (name: string) => Promise<void>;
};

async function defaultRoot(): Promise<ModelDirectory | null> {
  try {
    const storage = typeof navigator !== 'undefined'
      ? (navigator.storage as (StorageManager & { getDirectory?: () => Promise<unknown> }) | undefined)
      : undefined;
    if (!storage?.getDirectory) return null;
    return await storage.getDirectory() as unknown as ModelDirectory;
  } catch {
    return null;
  }
}

async function existingFile(root: ModelDirectory, name: string): Promise<File | null> {
  try {
    return await (await root.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

type Marker = { implementation: string; sha256: string; bytes: number; verifiedAt: number };

function readMarker(): Marker | null {
  try {
    const raw = localStorage.getItem(MARKER_KEY);
    return raw ? (JSON.parse(raw) as Marker) : null;
  } catch {
    return null;
  }
}

function writeMarker(marker: Marker | null): void {
  try {
    if (marker) localStorage.setItem(MARKER_KEY, JSON.stringify(marker));
    else localStorage.removeItem(MARKER_KEY);
  } catch {
    // Without storage the file is re-hashed on the next check instead of trusted.
  }
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

function isQuota(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'QuotaExceededError';
}

function validArtefact(artefact: StemModelArtefact | null): artefact is StemModelArtefact {
  return !!artefact && !!artefact.url && SHA256.test(artefact.sha256) &&
    Number.isInteger(artefact.bytes) && artefact.bytes > 0;
}

export interface StemModelManagerOptions {
  artefact?: StemModelArtefact | null;
  root?: () => Promise<ModelDirectory | null>;
  fetchImpl?: typeof fetch;
  hash?: (file: Blob) => Promise<string>;
  now?: () => number;
}

/** Owns the model file on this device. One download runs at a time; `state` is for the UI. */
export class StemModelManager {
  private readonly current = observable<StemModelState>({ kind: 'absent' });
  readonly state: Observable<StemModelState> = this.current;
  readonly artefact: StemModelArtefact | null;
  private readonly root: () => Promise<ModelDirectory | null>;
  private readonly fetchImpl: typeof fetch;
  private readonly hash: (file: Blob) => Promise<string>;
  private readonly now: () => number;
  private running: { controller: AbortController; discard: boolean } | null = null;

  constructor(options: StemModelManagerOptions = {}) {
    this.artefact = options.artefact === undefined ? STEM_MODEL_ARTEFACT : options.artefact;
    this.root = options.root ?? defaultRoot;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.hash = options.hash ?? ((file) => fileSha256(file));
    this.now = options.now ?? Date.now;
  }

  /** Look at what is on disk now. A file whose size matches but has no verified marker is
   * hashed again before it is called ready. */
  async refresh(): Promise<StemModelState> {
    if (this.running) return this.current.get();
    const artefact = this.artefact;
    if (!validArtefact(artefact)) return this.settle({ kind: 'failed', why: 'not_published' });
    const root = await this.root();
    if (!root) return this.settle({ kind: 'failed', why: 'unavailable', detail: 'this browser gives no private file storage' });
    const file = await existingFile(root, stemModelFileName(artefact.sha256));
    if (!file || file.size === 0) return this.settle({ kind: 'absent' });
    if (file.size < artefact.bytes) return this.settle({ kind: 'absent', partialBytes: file.size });
    return this.verify(root, artefact, file);
  }

  /** Start or resume the download. Resolves with the final state; never throws. */
  async download(signal?: AbortSignal): Promise<StemModelState> {
    if (this.running) return this.current.get();
    const artefact = this.artefact;
    if (!validArtefact(artefact)) return this.settle({ kind: 'failed', why: 'not_published' });
    const root = await this.root();
    if (!root) return this.settle({ kind: 'failed', why: 'unavailable', detail: 'this browser gives no private file storage' });
    const controller = new AbortController();
    const run = { controller, discard: false };
    this.running = run;
    const forward = () => controller.abort();
    signal?.addEventListener('abort', forward);
    if (signal?.aborted) controller.abort();
    try {
      return await this.transfer(root, artefact, controller.signal, run);
    } finally {
      signal?.removeEventListener('abort', forward);
      this.running = null;
    }
  }

  /** Stop, keeping what arrived so the next download resumes. */
  pause(): void {
    this.running?.controller.abort();
  }

  /** Stop and throw away the partial file. */
  cancel(): void {
    if (this.running) {
      this.running.discard = true;
      this.running.controller.abort();
    }
  }

  /** Delete the model from this device ("remove the splitter"). */
  async remove(): Promise<StemModelState> {
    this.cancel();
    writeMarker(null);
    const artefact = this.artefact;
    const root = await this.root();
    if (root && validArtefact(artefact)) {
      try {
        await root.removeEntry(stemModelFileName(artefact.sha256));
      } catch {
        // Already gone.
      }
    }
    return this.settle(validArtefact(artefact) ? { kind: 'absent' } : { kind: 'failed', why: 'not_published' });
  }

  private settle(state: StemModelState): StemModelState {
    this.current.set(state);
    return state;
  }

  private async verify(root: ModelDirectory, artefact: StemModelArtefact, file: File): Promise<StemModelState> {
    const marker = readMarker();
    if (marker && marker.sha256 === artefact.sha256 && marker.bytes === file.size &&
        marker.implementation === artefact.implementation && file.size === artefact.bytes) {
      return this.settle({ kind: 'ready' });
    }
    let digest = '';
    try {
      digest = file.size === artefact.bytes ? await this.hash(file) : '';
    } catch {
      digest = '';
    }
    if (digest !== artefact.sha256) {
      writeMarker(null);
      try {
        await root.removeEntry(stemModelFileName(artefact.sha256));
      } catch {
        // Nothing to remove.
      }
      return this.settle({ kind: 'failed', why: 'checksum', detail: 'the downloaded splitter did not match its published fingerprint' });
    }
    writeMarker({ implementation: artefact.implementation, sha256: artefact.sha256, bytes: artefact.bytes, verifiedAt: this.now() });
    return this.settle({ kind: 'ready' });
  }

  private async transfer(
    root: ModelDirectory,
    artefact: StemModelArtefact,
    signal: AbortSignal,
    run: { discard: boolean },
  ): Promise<StemModelState> {
    const name = stemModelFileName(artefact.sha256);
    const total = artefact.bytes;
    let existing = (await existingFile(root, name))?.size ?? 0;
    if (existing >= total) {
      const whole = await existingFile(root, name);
      if (whole && whole.size === total) return this.verify(root, artefact, whole);
      existing = 0;
    }
    let received = existing;
    this.settle({ kind: 'downloading', received, total });
    let writable: Writable | null = null;
    try {
      const response = await this.fetchImpl(artefact.url, {
        signal,
        headers: received > 0 ? { Range: `bytes=${received}-` } : undefined,
      });
      if (response.status === 206) {
        const range = response.headers.get('Content-Range') ?? '';
        const start = Number(/bytes\s+(\d+)-/.exec(range)?.[1] ?? NaN);
        if (start !== received) throw Object.assign(new Error('the server resumed at the wrong place'), { name: 'RangeMismatch' });
      } else if (response.ok) {
        received = 0; // the server ignored the range: start over
      } else {
        return this.settle({ kind: 'failed', why: 'network', detail: `the server answered ${response.status}` });
      }
      if (!response.body) return this.settle({ kind: 'failed', why: 'network', detail: 'the download had no body' });
      const handle = await root.getFileHandle(name, { create: true });
      const open = async () => {
        const next = await handle.createWritable({ keepExistingData: received > 0 });
        if (received > 0) await next.seek?.(received);
        return next;
      };
      writable = await open();
      this.settle({ kind: 'downloading', received, total });
      const reader = response.body.getReader();
      let sinceCommit = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.byteLength > total) {
          await writable.abort?.();
          writable = null;
          return this.discardAs(root, name, { kind: 'failed', why: 'checksum', detail: 'the download is larger than the published splitter' });
        }
        await writable.write(value);
        received += value.byteLength;
        sinceCommit += value.byteLength;
        if (sinceCommit >= COMMIT_EVERY_BYTES) {
          await writable.close();
          writable = await open();
          sinceCommit = 0;
        }
        this.settle({ kind: 'downloading', received, total });
      }
      await writable.close();
      writable = null;
      const file = await existingFile(root, name);
      if (!file) return this.settle({ kind: 'failed', why: 'unavailable', detail: 'the downloaded file could not be read back' });
      if (file.size !== total) return this.discardAs(root, name, { kind: 'failed', why: 'checksum', detail: 'the download ended at the wrong size' });
      return this.verify(root, artefact, file);
    } catch (error) {
      if (isQuota(error)) {
        await writable?.abort?.().catch(() => undefined);
        return this.settle({ kind: 'failed', why: 'storage_full', detail: 'this browser has no room left for the splitter' });
      }
      // Commit what arrived, so a resume does not fetch it twice.
      try {
        await writable?.close();
      } catch {
        // The stream was already closed or broken.
      }
      if (isAbort(error)) {
        if (run.discard) return this.discardAs(root, name, { kind: 'absent' });
        const kept = (await existingFile(root, name))?.size ?? 0;
        return this.settle(kept > 0 ? { kind: 'absent', partialBytes: kept } : { kind: 'absent' });
      }
      const detail = error instanceof Error ? error.message : String(error);
      return this.settle({ kind: 'failed', why: 'network', detail });
    }
  }

  private async discardAs(root: ModelDirectory, name: string, state: StemModelState): Promise<StemModelState> {
    writeMarker(null);
    try {
      await root.removeEntry(name);
    } catch {
      // Nothing to remove.
    }
    return this.settle(state);
  }
}

/** Read the verified model into memory for inference. Works in a worker as well as the page. */
export async function readStemModelBytes(
  sha256: string,
  root: () => Promise<ModelDirectory | null> = defaultRoot,
): Promise<ArrayBuffer | null> {
  if (!SHA256.test(sha256)) return null;
  const directory = await root();
  if (!directory) return null;
  const file = await existingFile(directory, stemModelFileName(sha256));
  return file ? file.arrayBuffer() : null;
}
