import { readLocalIndex, writeLocalIndex } from './localIndex';
import type {
  BrowserAvailabilitySummary, ExpectedRecording, LocalRecording, LocalSource,
  MediaOrigin, MediaReadiness, MediaResolution, MediaScanProgress,
} from './types';

const EXTENSIONS: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac',
  wav: 'audio/wav', wave: 'audio/wav', flac: 'audio/flac',
  aif: 'audio/aiff', aiff: 'audio/aiff', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg', webm: 'audio/webm',
};
const MAX_EXACT_FILE_BYTES = 1024 * 1024 * 1024; // bounded validation
const MAX_FILES = 20000;
const MAX_DIRECTORY_DEPTH = 12;
const YIELD_EVERY = 12;
const registry = new Map<string, BrowserLocalCatalogue>();

export type LocalFileHandle = {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
  queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState>;
};
export type LocalDirectoryHandle = {
  kind: 'directory';
  name: string;
  values: () => AsyncIterable<LocalFileHandle | LocalDirectoryHandle>;
};
type Importable = File | LocalFileHandle;
type Binding = { file?: File; handle?: LocalFileHandle; lastSeen: number };

export function safeMediaLabel(value: string): string {
  const last = value.replace(/\\/g, '/').split('/').pop() || '';
  return last.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 140) || 'Unnamed audio';
}
export function mediaMime(file: Pick<File, 'name' | 'type'>): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  return EXTENSIONS[extension] || (file.type.startsWith('audio/') ? file.type : null);
}
export function describeRecording(name: string): { title: string; artist: string | null; version: string | null } {
  const stem = safeMediaLabel(name).replace(/\.[^.]+$/, '').trim();
  const parts = stem.split(/\s+-\s+/, 2);
  const title = parts.length > 1 ? parts[1] : stem;
  const match = title.match(/\b(live|radio edit|clean|explicit|remaster(?:ed)?|instrumental|acoustic|extended mix)\b/i);
  return { title, artist: parts.length > 1 ? parts[0] : null, version: match ? match[1].toLowerCase() : null };
}
function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') throw new Error('Secure browser context required');
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
}
async function exactDigest(file: File, signal?: AbortSignal): Promise<string | null> {
  if (file.size > MAX_EXACT_FILE_BYTES) return null;
  if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const hash = sha256.create();
  const CHUNK = 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    hash.update(new Uint8Array(await file.slice(offset, Math.min(offset + CHUNK, file.size)).arrayBuffer()));
    if (offset % (8 * CHUNK) === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
  return Array.from(hash.digest(), (x) => x.toString(16).padStart(2, '0')).join('');
}
async function durationOf(file: File, mime: string, signal?: AbortSignal): Promise<{ duration: number | null; state: MediaReadiness }> {
  if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return { duration: null, state: 'unknown' };
  }
  const audio = document.createElement('audio');
  // canPlayType is advisory, not a guarantee of decodability.
  if (audio.canPlayType && audio.canPlayType(mime) === '') return { duration: null, state: 'unsupported_codec' };
  let url: string;
  try { url = URL.createObjectURL(file); } catch { return { duration: null, state: 'unknown' }; }
  try {
    return await new Promise((resolve, reject) => {
      let finished = false;
      const finish = (result?: { duration: number | null; state: MediaReadiness }, err?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        audio.removeAttribute('src');
        audio.load();
        if (err) reject(err); else resolve(result || { duration: null, state: 'unknown' });
      };
      const onAbort = () => finish(undefined, new DOMException('Scan cancelled', 'AbortError'));
      const timer = setTimeout(() => finish({ duration: null, state: 'unknown' }), 1800);
      signal?.addEventListener('abort', onAbort, { once: true });
      audio.onloadedmetadata = () => finish({
        duration: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null,
        state: Number.isFinite(audio.duration) && audio.duration > 0 ? 'ready' : 'unknown',
      });
      audio.onerror = () => finish({ duration: null, state: 'unsupported_codec' });
      audio.preload = 'metadata';
      audio.src = url;
      audio.load();
    });
  } finally { URL.revokeObjectURL(url); }
}
export function resolveRecording(expected: ExpectedRecording, records: readonly LocalRecording[]): MediaResolution {
  // Canonical Cloud IDs must never be mistaken for an exact local recording identity.
  const eligible = records.filter((r) => r.readiness === 'ready');
  if (expected.exactSha256) {
    const exact = eligible.find((r) => r.identity.exactSha256 === expected.exactSha256 && (expected.bytes == null || expected.bytes === r.identity.bytes));
    if (exact) return { canonicalTrackId: expected.canonicalTrackId, localRecordingId: exact.id, state: 'ready', reason: 'Exact complete-content recording locally verified' };
  }
  const title = expected.title?.trim().toLocaleLowerCase();
  const similar = title ? records.filter((r) => r.title.toLocaleLowerCase() === title) : [];
  const version = expected.version?.trim().toLocaleLowerCase();
  if (similar.length && version && similar.every((r) => r.version && r.version !== version)) {
    return { canonicalTrackId: expected.canonicalTrackId, localRecordingId: null, state: 'version_mismatch', reason: 'Only a different recording or master was found' };
  }
  if (similar.some((r) => r.readiness === 'permission_required')) return { canonicalTrackId: expected.canonicalTrackId, localRecordingId: null, state: 'permission_required', reason: 'Reauthorise local file access' };
  if (similar.some((r) => r.readiness === 'source_disconnected')) return { canonicalTrackId: expected.canonicalTrackId, localRecordingId: null, state: 'source_disconnected', reason: 'Reconnect local storage' };
  if (similar.some((r) => r.readiness === 'unsupported_codec')) return { canonicalTrackId: expected.canonicalTrackId, localRecordingId: null, state: 'unsupported_codec', reason: 'Browser cannot decode this recording' };
  if (similar.length) return { canonicalTrackId: expected.canonicalTrackId, localRecordingId: null, state: 'candidate', reason: 'Same title is not proof of the same master; review locally' };
  return { canonicalTrackId: expected.canonicalTrackId, localRecordingId: null, state: 'missing', reason: 'No accessible local recording' };
}
export function availabilitySummary(records: readonly LocalRecording[], browserSessionActive: boolean): BrowserAvailabilitySummary {
  const states: BrowserAvailabilitySummary['states'] = {
    ready: 0, candidate: 0, missing: 0, version_mismatch: 0,
    permission_required: 0, unsupported_codec: 0, source_disconnected: 0, unknown: 0,
  };
  for (const record of records) states[record.readiness] += 1;
  // Never include paths, file names, source IDs, raw digests, actual bytes or a speaker "verified" claim.
  return { schema_version: 1, device_role: 'browser_player', checked_at: new Date().toISOString(),
    total: records.length, states, browser_session_active: browserSessionActive, audio_output_verified: false };
}
/**
 * Private, memory-scoped browser source registry. Re-select files after browser restart unless
 * a caller separately implements permission-based handle restoration with user consent.
 * It NEVER posts files, hashes or paths to Cloud.
 */
export class BrowserLocalCatalogue {
  private sourcesMap = new Map<string, LocalSource>();
  private recordingsMap = new Map<string, LocalRecording>();
  private bindings = new Map<string, Binding>();
  private listeners = new Set<() => void>();
  readonly workspaceId: string;
  private hydration: Promise<void>;
  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
    this.hydration = this.restore();
  }
  private async restore(): Promise<void> {
    const index = await readLocalIndex(this.workspaceId);
    if (!index || this.sourcesMap.size || this.recordingsMap.size) return;
    for (const source of index.sources) {
      if (!source || typeof source.id !== 'string') continue;
      this.sourcesMap.set(source.id, { ...source, state: 'permission_required' });
    }
    for (const record of index.recordings) {
      if (!record || typeof record.id !== 'string' || !this.sourcesMap.has(record.sourceId)) continue;
      this.recordingsMap.set(record.id, { ...record, readiness: 'permission_required', reason: 'Re-select files after browser restart' });
    }
    this.emit();
  }
  private persist(): void {
    void writeLocalIndex(this.workspaceId, { schema: 1, sources: this.sources, recordings: this.recordings });
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit() { for (const fn of this.listeners) fn(); }
  get sources(): LocalSource[] { return [...this.sourcesMap.values()].map((s) => ({ ...s })); }
  get recordings(): LocalRecording[] { return [...this.recordingsMap.values()].map((r) => ({ ...r, identity: { ...r.identity } })); }
  /** Do not send this output to Cloud: it includes local names and private digests. */
  list(): LocalRecording[] { return this.recordings; }
  summary(active = true): BrowserAvailabilitySummary { return availabilitySummary(this.recordings, active); }
  async scan(files: readonly Importable[], options: {
    origin: MediaOrigin; label?: string; sourceId?: string; signal?: AbortSignal;
    onProgress?: (progress: MediaScanProgress) => void;
  }): Promise<LocalSource> {
    if (files.length > MAX_FILES) throw new Error('Select smaller batches of up to 20,000 files.');
    await this.hydration;
    const reusable = this.sources.find((source) => source.label === safeMediaLabel(options.label || 'Chosen music') && source.origin === options.origin);
    const sourceId = options.sourceId || reusable?.id || makeId();
    const source = this.sourcesMap.get(sourceId) || {
      id: sourceId, label: safeMediaLabel(options.label || 'Chosen music'), origin: options.origin,
      count: 0, state: 'scanning' as const, checkedAt: null,
    };
    source.state = 'scanning'; this.sourcesMap.set(sourceId, source); this.emit();
    let scanned = 0;
    try {
      for (const input of files) {
        if (options.signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
        let file: File;
        try { file = 'getFile' in input ? await input.getFile() : input; }
        catch { scanned += 1; options.onProgress?.({ scanned, total: files.length, sourceId, cancelled: false }); continue; }
        const mime = mediaMime(file);
        if (!mime) { scanned += 1; options.onProgress?.({ scanned, total: files.length, sourceId, cancelled: false }); continue; }
        const description = describeRecording(file.name);
        const existing = [...this.recordingsMap.values()].find((r) => r.sourceId === sourceId && r.displayName === safeMediaLabel(file.name));
        let id = existing?.id || makeId();
        let state: MediaReadiness = 'unknown';
        let duration: number | null = null;
        let digest: string | null = null;
        try {
          const result = await durationOf(file, mime, options.signal);
          state = result.state; duration = result.duration;
          if (state !== 'unsupported_codec') digest = await exactDigest(file, options.signal);
        } catch (e) {
          if ((e as Error).name === 'AbortError') throw e;
          state = 'unknown';
        }
        if (existing && existing.identity.exactSha256 && digest && existing.identity.exactSha256 !== digest) {
          // New content always gets a new local identity. Do not reuse stale canonical bindings.
          existing.readiness = 'version_mismatch';
          existing.canonicalTrackId = null;
          existing.reason = 'File changed; previous recording invalidated';
          this.bindings.delete(existing.id);
          id = makeId();
        }
        this.recordingsMap.set(id, {
          id, sourceId, displayName: safeMediaLabel(file.name), title: description.title, artist: description.artist,
          mime, durationSeconds: duration, identity: { localId: id, exactSha256: digest, bytes: file.size, lastModified: file.lastModified },
          readiness: state, reason: state === 'ready' ? 'Decoded metadata locally; actual playback/output remains unverified'
            : state === 'version_mismatch' ? 'Local file content changed; review identity'
            : state === 'unsupported_codec' ? 'This browser could not read audio metadata'
            : 'Decoder or file access needs validation',
          canonicalTrackId: state === 'version_mismatch' ? null : existing?.canonicalTrackId || null,
          version: description.version,
        });
        this.bindings.set(id, 'getFile' in input ? { handle: input, lastSeen: Date.now() } : { file, lastSeen: Date.now() });
        scanned += 1;
        source.count = [...this.recordingsMap.values()].filter((r) => r.sourceId === sourceId).length;
        options.onProgress?.({ scanned, total: files.length, sourceId, cancelled: false });
        this.emit();
        // Bounded, cancellable cooperative yield for large mobile libraries.
        if (scanned % YIELD_EVERY === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      source.state = 'ready'; source.checkedAt = Date.now();
      source.count = [...this.recordingsMap.values()].filter((r) => r.sourceId === sourceId).length;
      this.emit(); this.persist();
      return { ...source };
    } catch (error) {
      source.state = 'unknown'; source.checkedAt = Date.now(); this.emit(); this.persist();
      options.onProgress?.({ scanned, total: files.length, sourceId, cancelled: true });
      throw error;
    }
  }
  async openRecording(recordingId: string): Promise<File> {
    const binding = this.bindings.get(recordingId);
    const recording = this.recordingsMap.get(recordingId);
    if (!binding || !recording) throw new Error('Recording missing on this browser. Reconnect music.');
    try {
      if (binding.handle) {
        const permission = await binding.handle.queryPermission?.({ mode: 'read' });
        if (permission && permission !== 'granted') {
          recording.readiness = 'permission_required'; this.emit();
          throw new Error('Local file permission required');
        }
      }
      const file = binding.handle ? await binding.handle.getFile() : binding.file;
      if (!file) throw new Error('No local file');
      if (file.size !== recording.identity.bytes || file.lastModified !== recording.identity.lastModified) {
        recording.readiness = 'version_mismatch'; recording.canonicalTrackId = null; this.emit();
        throw new Error('Source content changed; reimport to verify the new recording');
      }
      // Recheck full digest when originally verified; do not accidentally use swapped content.
      if (recording.identity.exactSha256) {
        const digest = await exactDigest(file);
        if (digest !== recording.identity.exactSha256) {
          recording.readiness = 'version_mismatch'; recording.canonicalTrackId = null; this.emit();
          throw new Error('Recording digest changed');
        }
      }
      return file;
    } catch (e) {
      if (recording.readiness !== 'version_mismatch' && recording.readiness !== 'permission_required') {
        recording.readiness = 'source_disconnected'; this.emit();
      }
      throw e;
    }
  }
  /** Agent 01 and Agent 03 can stream a Blob without granting Cloud access. */
  async openBlob(recordingId: string): Promise<Blob> { return this.openRecording(recordingId); }
  markPermissionRequired(sourceId: string): void {
    const source = this.sourcesMap.get(sourceId); if (source) source.state = 'permission_required';
    for (const record of this.recordingsMap.values()) if (record.sourceId === sourceId) record.readiness = 'permission_required';
    this.emit();
  }
  forgetSource(sourceId: string): void {
    this.sourcesMap.delete(sourceId);
    for (const [id, record] of this.recordingsMap) if (record.sourceId === sourceId) {
      this.recordingsMap.delete(id); this.bindings.delete(id);
    }
    this.emit(); this.persist(); // NEVER delete original files; only forget browser bindings.
  }
}
export function localCatalogue(workspaceId: string): BrowserLocalCatalogue {
  let found = registry.get(workspaceId);
  if (!found) { found = new BrowserLocalCatalogue(workspaceId); registry.set(workspaceId, found); }
  return found;
}
export async function directoryFiles(directory: LocalDirectoryHandle, signal?: AbortSignal): Promise<LocalFileHandle[]> {
  const files: LocalFileHandle[] = [];
  const queue: { handle: LocalDirectoryHandle; depth: number }[] = [{ handle: directory, depth: 0 }];
  while (queue.length) {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    const current = queue.shift();
    if (!current) break;
    if (current.depth >= MAX_DIRECTORY_DEPTH) continue;
    for await (const entry of current.handle.values()) {
      if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
      if (entry.kind === 'file') { if (files.length >= MAX_FILES) throw new Error('Folder exceeds 20,000 files. Select smaller batches.'); files.push(entry); }
      else queue.push({ handle: entry, depth: current.depth + 1 });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return files;
}
