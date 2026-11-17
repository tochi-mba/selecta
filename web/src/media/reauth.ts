import { fileSha256 } from './identity';
import type { FileHandleLike, MediaStore, StoredSong } from './store';

// Re-authorisation (ADR-0458, BF-0458-07).
//
// Browser handles and permissions are not durable: a browser may ask again, a file may move.
// Every lapse surfaces as one consistent item, {songId, why, regrant()}, so the UI shows one
// polite flow whatever lapsed. After a re-grant or a re-pick, the library reconciles by content
// hash against the stored identity, so recovery never creates a duplicate entry.

export type LapsedWhy = 'permission' | 'missing';

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
  try {
    if (handle.queryPermission && (await handle.queryPermission({ mode: 'read' })) !== 'granted') return 'ask';
    await handle.getFile();
    return 'granted';
  } catch {
    return 'missing';
  }
}

/** Every stored handle whose permission lapsed or whose file no longer opens. Songs stored
 * with a re-pick marker are not listed here: they never had a durable handle to lapse, and
 * the repair flow covers re-choosing them. */
export async function findLapsed(store: MediaStore): Promise<LapsedItem[]> {
  const lapsed: LapsedItem[] = [];
  for (const song of await store.all()) {
    if (song.ref.kind !== 'handle') continue;
    const state = await handleState(song.ref.handle);
    if (state === 'granted') continue;
    lapsed.push({
      songId: song.songId,
      title: song.identity.title,
      why: state === 'ask' ? 'permission' : 'missing',
      regrant: () => regrant(store, song),
    });
  }
  return lapsed;
}

async function regrant(store: MediaStore, song: StoredSong): Promise<RegrantOutcome> {
  if (song.ref.kind !== 'handle') return { status: 'missing' };
  const handle = song.ref.handle;
  try {
    if (handle.requestPermission && (await handle.requestPermission({ mode: 'read' })) !== 'granted') return { status: 'denied' };
    const file = await handle.getFile();
    const digest = await fileSha256(file);
    if (digest !== song.identity.content_sha256) return { status: 'different_file' };
    // Same bytes, same identity, same songId: writing the row back reconciles without ever
    // minting a second entry.
    await store.put(song);
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
