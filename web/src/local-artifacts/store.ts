import { type ByteSink } from '../export-codecs/pcm';
import { type RenderStatus, RenderFailure } from '../render/contracts';

export interface LocalArtifactRecord {
  identity: string;
  codec: 'wav' | 'flac';
  createdAt: string;
  bytes: number;
  frames: number;
  sampleRate: number;
  channels: 1 | 2;
  checksum: number;
  validated: true;
}

const CACHE = 'selecta-render-cache-v1';
const TEMP = 'selecta-render-staging-v1';
const nameFor = (identity: string, codec: string) => {
  if (!/^[a-f0-9]{64}$/.test(identity) || !['flac', 'wav'].includes(codec)) throw new Error('Unsafe artifact key');
  return identity + '.' + codec;
};
function interrupted(signal: AbortSignal): void {
  if (signal.aborted) throw new RenderFailure('cancelled', 'Render cancelled');
}
async function root(): Promise<FileSystemDirectoryHandle> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new RenderFailure('storage_pressure', 'Origin Private File System unavailable; use a supported browser');
  }
  return navigator.storage.getDirectory();
}
async function directory(name: string): Promise<FileSystemDirectoryHandle> {
  return (await root()).getDirectoryHandle(name, { create: true });
}
async function optionalFile(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try { return await (await dir.getFileHandle(name)).getFile(); } catch (error) {
    if ((error as Error).name === 'NotFoundError') return null;
    throw error;
  }
}

/** The browser quota is an estimate, not permanent storage. A two-copy staging
 * reserve is needed because OPFS has no portable atomic rename. */
export async function storagePreflight(expectedBytes: number): Promise<{ available: number | null; needed: number; persistent: boolean }> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1) throw new Error('Invalid size estimate');
  const estimate = await navigator.storage.estimate();
  const available = estimate.quota === undefined || estimate.usage === undefined
    ? null : Math.max(0, estimate.quota - estimate.usage);
  const needed = Math.ceil(expectedBytes * 2.2 + 4 * 1024 * 1024);
  if (available !== null && available < needed) {
    throw new RenderFailure('storage_pressure', `Need approximately ${Math.ceil(needed / 1048576)} MiB temporary storage`);
  }
  return { available, needed, persistent: navigator.storage.persisted ? await navigator.storage.persisted() : false };
}

export class ArtifactStage implements ByteSink {
  private closed = false;
  private constructor(
    private readonly dir: FileSystemDirectoryHandle,
    readonly temporaryName: string,
    private readonly writer: FileSystemWritableFileStream,
  ) {}
  static async open(): Promise<ArtifactStage> {
    const dir = await directory(TEMP);
    const name = 'partial-' + crypto.randomUUID();
    const handle = await dir.getFileHandle(name, { create: true });
    return new ArtifactStage(dir, name, await handle.createWritable());
  }
  async write(bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('Artifact stage closed');
    await this.writer.write(bytes);
  }
  async finish(): Promise<File> {
    if (this.closed) throw new Error('Artifact stage already closed');
    this.closed = true;
    await this.writer.close();
    return (await this.dir.getFileHandle(this.temporaryName)).getFile();
  }
  async dispose(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      try { await this.writer.abort(); } catch { /* user storage may have been evicted */ }
    }
    try { await this.dir.removeEntry(this.temporaryName); } catch { /* best effort only for our own temporary file */ }
  }
}

/** Never touches local originals, picker handles, or downloaded/user-saved exports.
 * The completion marker is written last, after read-back validation. */
export class LocalArtifactStore {
  async get(identity: string, codec: 'wav' | 'flac'): Promise<{ file: File; record: LocalArtifactRecord } | null> {
    const dir = await directory(CACHE);
    const name = nameFor(identity, codec);
    const manifest = await optionalFile(dir, name + '.json');
    const file = await optionalFile(dir, name);
    if (!manifest || !file) return null; // interrupted copy is never usable
    try {
      const record = JSON.parse(await manifest.text()) as LocalArtifactRecord;
      if (record.identity !== identity || record.codec !== codec || record.bytes !== file.size || record.validated !== true) return null;
      return { file, record };
    } catch { return null; }
  }
  async publish(
    stage: ArtifactStage,
    identity: string,
    codec: 'wav' | 'flac',
    result: Omit<LocalArtifactRecord, 'identity' | 'codec' | 'createdAt' | 'validated'>,
    validate: (file: File) => Promise<void>,
    signal: AbortSignal,
  ): Promise<{ file: File; record: LocalArtifactRecord }> {
    interrupted(signal);
    const existing = await this.get(identity, codec);
    if (existing) {
      await validate(existing.file); // no trust in stale/corrupted cache
      return existing;
    }
    const stagedFile = await stage.finish();
    if (stagedFile.size !== result.bytes) throw new Error('Rendered artifact size mismatch');
    await validate(stagedFile);
    interrupted(signal);
    const dir = await directory(CACHE), name = nameFor(identity, codec);
    // Never overwrite a completed export, or a completed cache entry.
    if (await optionalFile(dir, name + '.json')) throw new Error('Artifact identity already reserved');
    const target = await dir.getFileHandle(name, { create: true });
    const writer = await target.createWritable();
    try {
      const blockSize = 65536;
      for (let pos = 0; pos < stagedFile.size; pos += blockSize) {
        interrupted(signal);
        await writer.write(new Uint8Array(await stagedFile.slice(pos, pos + blockSize).arrayBuffer()));
      }
      await writer.close();
    } catch (error) {
      try { await writer.abort(); } catch { /* browser may be closing */ }
      throw error;
    }
    const file = await target.getFile();
    await validate(file);
    interrupted(signal);
    const record: LocalArtifactRecord = {
      identity, codec, createdAt: new Date().toISOString(),
      bytes: file.size, frames: result.frames, sampleRate: result.sampleRate,
      channels: result.channels, checksum: result.checksum, validated: true,
    };
    const marker = await (await dir.getFileHandle(name + '.json', { create: true })).createWritable();
    try { await marker.write(JSON.stringify(record)); await marker.close(); }
    catch (error) { try { await marker.abort(); } catch { /* aborted */ } throw error; }
    return { file, record };
  }
  /** Only complete, explicitly chosen cache artifacts may be evicted. */
  async evict(identity: string, codec: 'wav' | 'flac'): Promise<void> {
    const dir = await directory(CACHE);
    const name = nameFor(identity, codec);
    const existing = await this.get(identity, codec);
    if (!existing) return;
    await dir.removeEntry(name + '.json');
    await dir.removeEntry(name);
  }
  /** Retry/cleanup never deletes originals, saved downloads or unrelated OPFS content. */
  async cleanupIncomplete(identity: string, codec: 'wav' | 'flac'): Promise<void> {
    const dir = await directory(CACHE);
    const name = nameFor(identity, codec);
    if (await optionalFile(dir, name + '.json')) return;
    if (await optionalFile(dir, name)) await dir.removeEntry(name);
  }
}
export type { RenderStatus };
