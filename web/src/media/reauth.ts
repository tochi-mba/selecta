import { fileSha256 } from './identity';
import type { FileHandleLike, MediaStore, StoredSong } from './store';

// Re-authorisation (ADR-0458, BF-0458-07).
//
// Browser handles and permissions are not durable: a browser may ask again, a file may move.
// Every lapse surfaces as one consistent item, {songId, why, regrant()}, so the UI shows one
// polite flow whatever lapsed. After a re-grant or a re-pick, the library reconciles by content
// hash against the stored identity, so recovery never creates a duplicate entry.

/** `changed`: the handle still opens but its bytes no longer match the registered identity. */
export type LapsedWhy = 'permission' | 'missing' | 'changed';

export type RegrantOutcome = {
  status: 'recovered' | 'denied' | 'different_file' | 'missing';
};

export type LapsedItem = {
  songId: number;
  title: string;
  why: LapsedWhy;
  /** Call from a user gesture: browsers only show the permission prompt inside one. */
  regrant: () => Promise<RegrantOutcome>;
};

async function handleState(handle: FileHandleLike): Promise<'granted' | 'ask' | 'missing'> {
  // Opening the file is the truth. queryPermission is not consulted: Chromium answers "prompt"
  // for every file under a granted folder, so it would turn every moved or deleted file into a
  // permission problem. Only a refusal for permission (NotAllowedError) asks again; any other
  // failure (NotFoundError, a vanished drive) is a missing file.
  try {
    await handle.getFile();
    return 'granted';
  } catch (problem) {
    return (problem as DOMException | null)?.name === 'NotAllowedError' ? 'ask' : 'missing';
  }
}

/** Every stored handle whose permission lapsed, whose file no longer opens, or whose bytes changed
 * since import. Songs stored with a re-pick marker are not listed here: they never had a durable
 * handle to lapse, and the repair flow covers re-choosing them.
 *
 * Opening every file is expensive at thousands of songs, so a sweep is remembered against the
 * store's availability revision; `force` opens every file again regardless. */
const sweeps = new WeakMap<MediaStore, { revision: number; items: LapsedItem[] }>();
/** The sweep under way per store: concurrent callers (the shell's forced sweep at start-up and
 * a Library visit) join it instead of opening every file twice. */
const inflight = new WeakMap<MediaStore, { force: boolean; sweep: Promise<LapsedItem[]> }>();

export async function findLapsed(store: MediaStore, options: { force?: boolean } = {}): Promise<LapsedItem[]> {
  const remembered = sweeps.get(store);
  if (!options.force && remembered && remembered.revision === store.availabilityRevision) return remembered.items;
  const running = inflight.get(store);
  // A forced caller may join only a forced sweep; an unforced caller may join either.
  if (running && (running.force || !options.force)) return running.sweep;
  const sweep = sweepLapsed(store);
  inflight.set(store, { force: options.force === true, sweep });
  try {
    return await sweep;
  } finally {
    if (inflight.get(store)?.sweep === sweep) inflight.delete(store);
  }
}

async function sweepLapsed(store: MediaStore): Promise<LapsedItem[]> {
  // Remember the revision the sweep started from, so a change made while files were being
  // opened makes the next caller sweep again rather than trust a stale answer.
  const revision = store.availabilityRevision;
  const lapsed: LapsedItem[] = [];
  for (const song of await store.all()) {
    if (song.ref.kind !== 'handle') continue;
    const state = song.availabilityIssue === 'changed' ? 'changed' : await handleState(song.ref.handle);
    if (state === 'granted') continue;
    lapsed.push({
      songId: song.songId,
      title: song.identity.title,
      why: state === 'ask' ? 'permission' : state,
      regrant: () => regrant(store, song),
    });
  }
  sweeps.set(store, { revision, items: lapsed });
  return lapsed;
}

async function regrant(store: MediaStore, song: StoredSong): Promise<RegrantOutcome> {
  if (song.ref.kind !== 'handle') return { status: 'missing' };
  const handle = song.ref.handle;
  try {
    if (handle.requestPermission && (await handle.requestPermission({ mode: 'read' })) !== 'granted') return { status: 'denied' };
    const file = await handle.getFile();
    const digest = await fileSha256(file);
    if (digest !== song.identity.content_sha256) {
      await store.markChanged(song.songId);
      return { status: 'different_file' };
    }
    // Same bytes, same identity, same songId: writing the row back reconciles without ever
    // minting a second entry, and a prior mismatch clears only now the exact bytes read again.
    await store.put(song);
    await store.clearChanged(song.songId);
    return { status: 'recovered' };
  } catch {
    return { status: 'missing' };
  }
}

/** A freshly picked file offered for a song whose handle is gone (or that never had one).
 * Accepted only when the content hash matches the stored identity, then kept reachable for
 * this visit without copying it into browser storage. */
export async function acceptRepick(store: MediaStore, songId: number, file: File): Promise<RegrantOutcome> {
  const song = await store.get(songId);
  if (!song) return { status: 'missing' };
  const digest = await fileSha256(file);
  if (digest !== song.identity.content_sha256) return { status: 'different_file' };
  store.attachSessionFile(songId, file);
  return { status: 'recovered' };
}
