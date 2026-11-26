import { deviceRank, factsVersion } from '../dsp/analysis/deviceAnalysisIds';
import type { SongFacts } from '../dsp/analysis/song';
import { seamWorkIdle } from '../dsp/seamWork';
import type { StoredSong } from '../media';
import { accountMeasured, askWithin, noteMeasured, sendingOn, type Measured, type Request } from './accountFacts';
import { isOnline } from './connection';
import { observable, type Observable } from '../dsp/stems/observable';
import { factsBody } from './factsWire';
import { readCached, writeCached } from './offlineCache';
import { backoffMs } from './resilientRequest';
import { songFacts } from './songFacts';
import { provenHashes } from './tonalProfiles';

/** Sending this device's song measurements to the account (docs/engineering/device-to-account.md).
 *
 * With `cloud.brain` and `cloud.device_analysis` both named on by the server, one song at a time
 * in the background: each song this device measured (cloud/songFacts.ts) that the account lacks,
 * or holds from an implementation that ranks lower, is saved with `PUT /api/song-facts/{id}`.
 * The implementation names the beat source too (`web-dsp-1+web-beatthis-small0-1`), so a song
 * measured again with the neural tracker outranks its interim measurement and is sent again.
 * What was sent is remembered here, per song and per measurement version, in this workspace's own
 * store on this device, so nothing is sent twice. A transition being prepared comes first; an error waits longer each time; offline
 * waits for the connection. Nothing here touches playback, and nothing the member sees changes.
 */

/** Look again for newly measured songs this often. */
export const RESWEEP_MS = 5 * 60_000;
/** Between two songs, so a big library never sends in a burst (the account allows 300 a minute). */
export const BETWEEN_SONGS_MS = 1_500;
/** One save may take this long before it counts as failed and waits its turn again. */
export const SAVE_WITHIN_MS = 30_000;
/** Waits after failures grow from this to the ceiling. */
export const BACKOFF_BASE_MS = 10_000;
export const BACKOFF_MAX_MS = 30 * 60_000;
/** A pass that sends this many songs keeps what it sent before carrying on. */
const KEEP_EVERY = 20;
const SENT_KEY = 'song-facts-sent';

/** Song id to `version:sha` for what this device sent (or found already in the account). */
export type SentMemory = {
  read(): Promise<Record<string, string>>;
  write(sent: Record<string, string>): Promise<void>;
};

/** Kept with the workspace's other answers in this browser, so "Forget this account here" forgets
 * it too (deviceData.ts). Nothing that names a file: song ids, hashes and a version. */
export function sentMemory(workspaceId: string): SentMemory {
  return {
    read: async () => (await readCached<Record<string, string>>(workspaceId, SENT_KEY))?.value ?? {},
    write: (sent) => writeCached(workspaceId, SENT_KEY, sent),
  };
}

export type UploaderOptions = {
  /** The Cloud API for this workspace, paths without `/api` (LocalFirstShell's `cloud`). */
  request: Request;
  workspaceId: string;
  /** This workspace's song index on this device. */
  openMedia: () => Promise<{ all(): Promise<StoredSong[]> }>;
  facts?: (sha: string) => Promise<SongFacts | null>;
  memory?: SentMemory;
  /** Test seams: the wait between passes and songs, and a transition in hand. */
  wait?: (ms: number) => Promise<void>;
  idle?: () => Promise<void>;
};

/** What the uploader is doing, for the Activity drawer (T-20261126-36c7): a save in hand, and how
 * many songs' measurements it saved to the account in this visit. */
export type UploadActivity = { saving: boolean; saved: number };
const uploading = observable<UploadActivity>({ saving: false, saved: 0 });
export const uploadActivity: Observable<UploadActivity> = uploading;

/** What a refusal means for one song. */
type Outcome = 'saved' | 'done' | 'later' | 'stop';

const statusOf = (error: unknown) => (error as { status?: number } | null)?.status ?? 0;
const codeOf = (error: unknown) => (error as { code?: string } | null)?.code ?? '';

/** Whether the account's measurement for a song already stands over this device's `implementation`.
 * A worker's beats a device's, a Python analysis ranks above the browser port, and among the
 * browser's the neural tracker ranks above the interim source above plain `web-dsp-1`
 * (engine_store/facts.py `wins` and `RANK`); an implementation this device doesn't know ranks below. */
export function accountHolds(account: Measured | undefined, implementation: string): 'better' | 'same' | 'none' {
  if (!account) return 'none';
  if (account.source !== 'device' || /^python-/.test(account.implementation)) return 'better';
  const theirs = deviceRank(account.implementation);
  const ours = deviceRank(implementation);
  if (theirs > ours) return 'better';
  return theirs === ours ? 'same' : 'none';
}

/** Start sending in the background. Returns the stop function. */
export function startFactsUploader(options: UploaderOptions): () => void {
  let stopped = false;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const idle = options.idle ?? (() => seamWorkIdle());
  const read = options.facts ?? ((sha: string) => songFacts(sha));
  const memory = options.memory ?? sentMemory(options.workspaceId);
  // songs refused for a reason that may pass (not in the catalogue yet, its length unknown): next visit
  const later = new Set<number>();

  const send = async (song: StoredSong, sha: string, facts: SongFacts): Promise<Outcome> => {
    const body = factsBody(sha, facts);
    if (!body) return 'done';
    try {
      const saved = await askWithin<{ implementation: string; source: string }>(options.request, `/song-facts/${song.songId}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }, SAVE_WITHIN_MS);
      noteMeasured(options.workspaceId, song.songId, { implementation: saved?.implementation ?? body.implementation, source: saved?.source ?? 'device' });
      return 'saved';
    } catch (error) {
      const status = statusOf(error);
      const code = codeOf(error);
      // a better measurement is already there: done, as if sent
      if (status === 409 && code === 'outranked') return 'done';
      if (status === 409 && code === 'song_mismatch') return 'done';
      // not in the catalogue yet, or its length not known yet: try on a later visit
      if (status === 404 || (status === 409 && (code === 'duration_unknown' || code === 'too_many'))) return 'later';
      // the account refused these numbers (the interim beat source, say): resending can't change that
      if (status === 422 || status === 413) return 'done';
      // the flag went off, or this account may not write: stop until the next pass
      if (status === 403 || status === 415) return 'stop';
      throw error;
    }
  };

  const pass = async (): Promise<void> => {
    const sent = await memory.read();
    let unsaved = 0;
    const keep = async (force = false) => {
      if (unsaved && (force || unsaved >= KEEP_EVERY)) { unsaved = 0; await memory.write(sent); }
    };
    const account = await accountMeasured(options.request, options.workspaceId);
    const songs = await (await options.openMedia()).all();
    // only hashes this index proved from the bytes may read the device-wide store
    const proven = new Set(provenHashes(songs));
    try {
      for (const song of songs) {
        if (stopped || !sendingOn()) return;
        const sha = song.identity.content_sha256;
        const before = sent[String(song.songId)];
        if (later.has(song.songId) || !proven.has(sha)) continue;
        const facts = await read(sha);
        if (!facts) continue;
        // the best measurement here: the neural tracker's once it has measured the song
        const version = factsVersion(facts.beat_source);
        const mark = `${version}:${sha}`;
        if (before === mark) continue;
        const holds = accountHolds(account.get(song.songId), version);
        // the account's own is better, or the same port measured these same bytes (a measurement is
        // a pure function of them) and this device never sent an older version of its own
        if (holds === 'better' || (holds === 'same' && before === undefined)) {
          sent[String(song.songId)] = mark;
          unsaved += 1;
          continue;
        }
        await idle();
        if (stopped || !isOnline()) return;
        uploading.set({ ...uploading.get(), saving: true });
        const outcome = await send(song, sha, facts).finally(() => uploading.set({ ...uploading.get(), saving: false }));
        if (outcome === 'saved') uploading.set({ ...uploading.get(), saved: uploading.get().saved + 1 });
        if (outcome === 'stop') return;
        if (outcome === 'later') later.add(song.songId);
        else {
          sent[String(song.songId)] = mark;
          unsaved += 1;
          await keep();
        }
        await wait(BETWEEN_SONGS_MS);
      }
    } finally {
      await keep(true);
    }
  };

  void (async () => {
    let failures = 0;
    while (!stopped) {
      if (sendingOn() && isOnline()) {
        try {
          await pass();
          failures = 0;
        } catch {
          // offline, a timeout, a server error, an ended sign-in: wait longer each time
          failures += 1;
        }
      }
      if (stopped) break;
      await wait(failures ? backoffMs(failures, BACKOFF_BASE_MS, BACKOFF_MAX_MS) : RESWEEP_MS);
    }
  })();

  return () => { stopped = true; };
}
