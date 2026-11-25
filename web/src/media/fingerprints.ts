import { TONAL_PROFILE_IMPLEMENTATION } from '../dsp/analysis/tonalProfile';
import { derivedStore, MEMO_VERSION, withHashLock, type DerivedStore } from './derived';
import { beginFingerprintRun, finishFingerprintRun, logFingerprint, logRegistered, logSampleCheck, type HashHow } from './fingerprintLog';
import { fileIdentity } from './audioIdentity';
import { bytesSha256, fileSha256 } from './identity';
import type { MediaStore } from './store';

// Fingerprint reuse at import (ADR-0469 amendment, flag `cloud.content_cache`).
//
// Hashing every byte of a 2,900-song folder is the slow part of an import. This browser keeps a
// memo from a file's identity on disk to the SHA-256 it once computed from that file's bytes, so
// the same folder picked again, by this account or another one signed in here, is recognised
// without being read in full.
//
// THE MEMO RULE. The memo is a hint, never proof.
// - Its key is the file's place inside the folder that was picked (folder name and relative
//   path), its size and its last-modified time. A different size or time is always a miss.
// - A hit is trusted for registration and listing only: the song is registered under the
//   remembered hash, with the account's OWN tags read from its own file, and its index row is
//   marked `fingerprint: 'remembered'`.
// - Before the bytes of a remembered song are first played, and before any shared analysis is
//   read for it (tonal profile, waveform), its file is hashed and compared; a match clears the
//   mark, a mismatch marks the song changed (the existing "changed file" path). Shared
//   derivations are only ever written under a hash computed from bytes in hand.
// - After each import, a random sample of the remembered files is hashed again in the
//   background; a mismatch drops that memo entry and marks the song changed.
// - The residual risk (a file rewritten in place with the same size and the same modified time,
//   as a tag editor told to keep timestamps can do) registers the song under its old hash until
//   the first play or analysis, which then catches it. The catalogue's title is the account's
//   own either way; nothing another account typed is ever involved.

/** Remembered files re-hashed after an import, in the background. */
const SAMPLE_MIN = 3;
const SAMPLE_MAX = 24;
/** Gap between sample checks, so the background check never competes with the page. */
const SAMPLE_GAP_MS = 400;

export const FACTS_VERSION = 'facts-v1';
/** Waveform peaks as `dsp/waveform.ts` draws them (400 bins). */
export const WAVEFORM_VERSION = 'waveform-v1-400';

export type Identified = {
  sha: string; how: HashHow; ms: number; bytesRead: number;
  /** `library.audio_identity`: the file's audio id, null for a file that has none, absent when
   * it wasn't asked for or isn't known from bytes in hand. */
  audioId?: string | null;
};

/** The audio id rules' version (docs/engineering/audio-identity.md); kept beside the file hash. */
export const AUDIO_ID_VERSION = 'a1';
type AudioRecord = { audio_id: string | null };

export type ImportReuse = {
  /** Songs recognised from this browser: fingerprint not read again. */
  recognised: number;
  /** Songs whose files were read and fingerprinted. */
  analysed: number;
  /** False where this browser keeps nothing between visits: nothing could be remembered. */
  kept: boolean;
};

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

/** The memo key: a hash of the file's place, size and time, so the store never holds a name or
 * a path in the clear. */
export async function memoIdentity(place: string, size: number, lastModified: number): Promise<string> {
  const text = `${MEMO_VERSION}\u0000${place}\u0000${size}\u0000${lastModified}`;
  if (!encoder) return text;
  const bytes = encoder.encode(text);
  return bytesSha256(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

type Remembered = { name: string; identity: string; sha: string; open: () => Promise<File>; songId?: number };

/** One import's use of the device memo and derived store, for one workspace. */
export class ImportFingerprints {
  readonly workspaceId: string;
  private derived: DerivedStore;
  private computed = new Set<string>();
  private remembered = new Map<string, Remembered[]>();
  private recognisedCount = 0;
  private analysedCount = 0;

  private constructor(workspaceId: string, derived: DerivedStore) {
    this.workspaceId = workspaceId;
    this.derived = derived;
  }

  static async start(workspaceId: string, open: () => Promise<DerivedStore> = derivedStore): Promise<ImportFingerprints> {
    const derived = await open();
    beginFingerprintRun(workspaceId, !derived.degraded);
    return new ImportFingerprints(workspaceId, derived);
  }

  /** The file's SHA-256: remembered where this browser hashed the same file before, else read
   * and remembered now. One tab at a time per file, so two tabs importing the same folder hash
   * each file once. */
  async identify(file: File, place: string, name: string, open: () => Promise<File>, signal?: AbortSignal, audio = false): Promise<Identified> {
    const identity = await memoIdentity(place, file.size, file.lastModified);
    return withHashLock('fp', identity, async () => {
      const started = now();
      const hit = await this.derived.memoGet(identity);
      if (hit) {
        const list = this.remembered.get(hit.sha) ?? [];
        list.push({ name, identity, sha: hit.sha, open });
        this.remembered.set(hit.sha, list);
        this.recognisedCount += 1;
        const found = { sha: hit.sha, how: 'memo' as const, ms: Math.round(now() - started), bytesRead: 0 };
        return audio ? { ...found, ...(await this.rememberedAudio(file, hit.sha, signal)) } : found;
      }
      if (audio) {
        // one read gives both, where the file fits in memory (audioIdentity.fileIdentity)
        const both = await fileIdentity(file, { signal });
        this.computed.add(both.sha);
        this.analysedCount += 1;
        await this.derived.memoPut(identity, both.sha);
        await this.derived.put('audio', AUDIO_ID_VERSION, both.sha, { audio_id: both.audioId } satisfies AudioRecord);
        return { sha: both.sha, how: 'computed' as const, ms: Math.round(now() - started), bytesRead: file.size, audioId: both.audioId };
      }
      const sha = await fileSha256(file, { signal });
      const ms = Math.round(now() - started);
      this.computed.add(sha);
      this.analysedCount += 1;
      await this.derived.memoPut(identity, sha);
      return { sha, how: 'computed' as const, ms, bytesRead: file.size };
    });
  }

  /** The audio id of a remembered file: kept beside its hash if this browser read it before;
   * else read now, once, and kept only when the file's bytes still hash to the remembered sha
   * (the memo rule: nothing is kept under a hash these bytes were not just hashed to). */
  private async rememberedAudio(file: File, sha: string, signal?: AbortSignal): Promise<{ audioId?: string | null; bytesRead?: number }> {
    const kept = await this.derived.get<AudioRecord>('audio', AUDIO_ID_VERSION, sha);
    if (kept) return { audioId: kept.audio_id };
    const both = await fileIdentity(file, { signal });
    if (both.sha !== sha) return { bytesRead: file.size };
    this.computed.add(sha);
    await this.derived.put('audio', AUDIO_ID_VERSION, sha, { audio_id: both.audioId } satisfies AudioRecord);
    return { audioId: both.audioId, bytesRead: file.size };
  }

  /** True when this run only has the memo's word for `sha` (no file with these bytes was read). */
  isRemembered(sha: string): boolean {
    return this.remembered.has(sha) && !this.computed.has(sha);
  }

  /** A duration this browser measured before for these bytes. Listing data only, so a memo hint
   * is enough to use it (the memo rule). */
  async knownDuration(sha: string): Promise<number | undefined> {
    const facts = await this.derived.get<{ duration_s?: number }>('facts', FACTS_VERSION, sha);
    return facts?.duration_s && facts.duration_s > 0 ? facts.duration_s : undefined;
  }

  /** Keep a measured duration, only under a hash computed from these bytes in this run. */
  async keepDuration(sha: string, duration: number | undefined): Promise<void> {
    if (!this.computed.has(sha) || !duration || !(duration > 0)) return;
    await this.derived.put('facts', FACTS_VERSION, sha, { duration_s: duration });
  }

  private async stateOf(kind: 'tonal' | 'waveform', version: string, sha: string, how: HashHow) {
    const present = (await this.derived.get(kind, version, sha)) !== null;
    if (!present) return 'not_yet' as const;
    return how === 'memo' && !this.computed.has(sha) ? 'after_check' as const : 'reusable' as const;
  }

  /** One log line for a file, once it is fingerprinted and its tags read. */
  async log(name: string, file: File, found: Identified, tagsMs: number, duration: 'reused' | 'measured' | 'unknown'): Promise<void> {
    const [tonal, waveform] = await Promise.all([
      this.stateOf('tonal', TONAL_PROFILE_IMPLEMENTATION, found.sha, found.how),
      this.stateOf('waveform', WAVEFORM_VERSION, found.sha, found.how),
    ]);
    logFingerprint(this.workspaceId, {
      name, hash: found.sha.slice(0, 8), hashHow: found.how, hashMs: found.ms, bytesRead: found.bytesRead, tagsMs, duration, tonal, waveform,
    }, file.size);
  }

  /** The import registered (or failed to register) these bytes as `songId`. */
  landed(sha: string, songId: number | null, known: boolean): void {
    logRegistered(this.workspaceId, sha, songId === null ? 'failed' : known ? 'known' : 'new');
    if (songId === null) return;
    for (const item of this.remembered.get(sha) ?? []) item.songId ??= songId;
  }

  reuse(): ImportReuse {
    return { recognised: this.recognisedCount, analysed: this.analysedCount, kept: !this.derived.degraded };
  }

  finish(): void {
    finishFingerprintRun(this.workspaceId);
  }

  /** Hash a random sample of the remembered files again, in the background (the memo rule). */
  async sampleCheck(store: MediaStore, options: { gapMs?: number; random?: () => number } = {}): Promise<void> {
    const pool = [...this.remembered.values()].flat().filter((item) => item.songId !== undefined && !this.computed.has(item.sha));
    if (!pool.length) return;
    const random = options.random ?? Math.random;
    const size = Math.min(pool.length, Math.max(SAMPLE_MIN, Math.min(SAMPLE_MAX, Math.ceil(pool.length / 100))));
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [pool[index], pool[swap]] = [pool[swap], pool[index]];
    }
    for (const item of pool.slice(0, size)) {
      await new Promise((resolve) => setTimeout(resolve, options.gapMs ?? SAMPLE_GAP_MS));
      try {
        const digest = await fileSha256(await item.open());
        const matched = digest === item.sha;
        if (matched) await store.confirmFingerprint(item.songId!);
        else {
          await this.derived.memoDrop(item.identity);
          await store.markChanged(item.songId!);
        }
        logSampleCheck(this.workspaceId, item.name, matched);
      } catch {
        // unreadable now (a lapsed permission): the play-time check covers it later
      }
    }
  }
}
