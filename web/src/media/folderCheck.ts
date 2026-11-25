import { breathe } from './breathe';
import { isAudioName } from './importer';
import type { StoredFolderHandle } from './folders';
import type { DirectoryHandleLike, FileHandleLike, MediaStore, SongSource, StoredSong } from './store';

// Checking a watched folder (`cloud.music_folders`): what is new, changed or missing since the
// last look, worked out from each file's place, size and modified time, so a file already known
// is never read again in full. Only new and changed files go on to the importer (which, with
// `cloud.content_cache`, still asks the fingerprint memo before hashing anything).
//
// EDGE CASE (a very large folder): thousands of files must not freeze the page, so the walk and
// the size check hand the main thread back every few dozen entries.

/** Entries walked or looked at between two hand-backs to the page. */
export const YIELD_EVERY = 64;

export type WalkedFile = { handle: FileHandleLike; path: string };
export type FileFacts = WalkedFile & { size: number; modified: number };

// A zero-length timer here made a hidden tab's check crawl: browsers hold timers back to once a
// second in a tab that is not in front, and to once a minute after five minutes, so a 2,400-file
// folder's 70-odd hand-backs could take over an hour. `breathe` gives the page its turn without that.
const yieldToPage = breathe;

function stopped(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The check was stopped.', 'AbortError');
}

/** Every audio file in `dir`, at its place inside it. Throws what the browser throws: a
 * NotFoundError for a folder that was renamed, moved or deleted, a NotAllowedError for one whose
 * permission lapsed, an AbortError when `signal` fires. */
export async function walkFolder(dir: DirectoryHandleLike, options: { signal?: AbortSignal; onFound?: (count: number) => void } = {}): Promise<WalkedFile[]> {
  const found: WalkedFile[] = [];
  let seen = 0;
  const visit = async (folder: DirectoryHandleLike, prefix: string): Promise<void> => {
    for await (const entry of folder.values()) {
      stopped(options.signal);
      seen += 1;
      if (seen % YIELD_EVERY === 0) { options.onFound?.(found.length); await yieldToPage(); }
      if (entry.kind === 'directory') await visit(entry, `${prefix}${entry.name}/`);
      else if (isAudioName(entry.name)) found.push({ handle: entry, path: `${prefix}${entry.name}` });
    }
  };
  await visit(dir, '');
  options.onFound?.(found.length);
  return found;
}

/** Each file's size and modified time, from the browser's file record, never its bytes. A file
 * that will not open now (deleted between the walk and here) is left out. */
export async function factsOf(files: readonly WalkedFile[], options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<FileFacts[]> {
  const facts: FileFacts[] = [];
  for (let index = 0; index < files.length; index += 1) {
    stopped(options.signal);
    const one = files[index];
    try {
      const file = await one.handle.getFile();
      facts.push({ ...one, size: file.size, modified: file.lastModified });
    } catch { /* gone since the walk: counted as missing if it was known */ }
    if ((index + 1) % YIELD_EVERY === 0) { options.onProgress?.(index + 1, files.length); await yieldToPage(); }
  }
  options.onProgress?.(files.length, files.length);
  return facts;
}

export type CheckPlan = {
  /** New or changed files: these go to the importer. */
  fresh: FileFacts[];
  /** Files already known with the same size and time: nothing to do. */
  known: number;
  /** Songs imported before this folder was watched, recognised as the very same file by the
   * browser (`isSameEntry`), so they join this folder without being read. */
  adopt: { songId: number; source: SongSource }[];
  /** Known places whose file has changed since (a new size or time): the old song loses this
   * place once the new file is imported. */
  changed: { songId: number; path: string }[];
  /** Known places with no file now. Nothing is deleted: their songs show as not found here the
   * way every lapsed file does. */
  missing: { songId: number; path: string }[];
};

/** What one check of `folderId` has to do, given the files there now and the songs this browser
 * knows. Pure apart from asking the browser whether two handles are the same file. */
export async function planCheck(folderId: string, facts: readonly FileFacts[], songs: readonly StoredSong[], signal?: AbortSignal): Promise<CheckPlan> {
  const byPath = new Map<string, { song: StoredSong; source: SongSource }>();
  // songs with no place in this folder yet, by file name, for adopting what was imported before
  const byName = new Map<string, StoredSong[]>();
  for (const song of songs) {
    const here = song.sources?.filter((one) => one.folderId === folderId) ?? [];
    for (const source of here) byPath.set(source.path, { song, source });
    if (!here.length && song.ref.kind === 'handle') {
      const list = byName.get(song.ref.handle.name) ?? [];
      list.push(song);
      byName.set(song.ref.handle.name, list);
    }
  }
  const plan: CheckPlan = { fresh: [], known: 0, adopt: [], changed: [], missing: [] };
  const seen = new Set<string>();
  let looked = 0;
  for (const fact of facts) {
    stopped(signal);
    seen.add(fact.path);
    const was = byPath.get(fact.path);
    if (was) {
      if (was.source.size === fact.size && was.source.modified === fact.modified) plan.known += 1;
      else { plan.fresh.push(fact); plan.changed.push({ songId: was.song.songId, path: fact.path }); }
      continue;
    }
    let adopted = false;
    for (const song of byName.get(fact.handle.name) ?? []) {
      const same = (song.ref as { handle: FileHandleLike & { isSameEntry?: (other: unknown) => Promise<boolean> } }).handle.isSameEntry;
      if (!same) break;
      looked += 1;
      if (looked % YIELD_EVERY === 0) await yieldToPage();
      try {
        if (await same.call((song.ref as { handle: unknown }).handle, fact.handle)) {
          plan.adopt.push({ songId: song.songId, source: { folderId, path: fact.path, size: fact.size, modified: fact.modified } });
          adopted = true;
          break;
        }
      } catch { /* the browser would not say: read it as new, which costs a read, never a song */ }
    }
    if (!adopted) plan.fresh.push(fact);
  }
  for (const [path, { song }] of byPath) if (!seen.has(path)) plan.missing.push({ songId: song.songId, path });
  return plan;
}

/** How many songs came from `folderId`, by the index (a song is counted once however many of its
 * files the folder holds). */
export function songsIn(folderId: string, songs: readonly StoredSong[]): number {
  return songs.filter((song) => song.sources?.some((one) => one.folderId === folderId)).length;
}

/** What stopping watching `folderId` would remove, if asked to: songs whose every place is in
 * that folder (or in folders no longer watched). A song also found in another watched folder
 * stays; so does a song with no recorded place at all (added as loose files, or before watching
 * began), since nothing says it came from here. */
export function songsOnlyIn(folderId: string, songs: readonly StoredSong[], watched: ReadonlySet<string>): StoredSong[] {
  return songs.filter((song) => {
    const sources = song.sources ?? [];
    if (!sources.some((one) => one.folderId === folderId)) return false;
    return !sources.some((one) => one.folderId !== folderId && watched.has(one.folderId));
  });
}

/** Forget every place `folderId` gave the index's songs; the songs themselves stay. */
export async function dropFolderSources(store: MediaStore, folderId: string): Promise<void> {
  for (const song of await store.all()) {
    if (!song.sources?.some((one) => one.folderId === folderId)) continue;
    const sources = song.sources.filter((one) => one.folderId !== folderId);
    const next: StoredSong = { ...song };
    if (sources.length) next.sources = sources;
    else delete next.sources;
    await store.put(next);
  }
}

/** Move every place in `fromId` under `toId`, with `prefix` in front of its path: watching a
 * parent folder in place of the folders inside it keeps their songs without reading them again. */
export async function rebaseSources(store: MediaStore, fromId: string, toId: string, prefix: readonly string[]): Promise<void> {
  const lead = prefix.length ? `${prefix.join('/')}/` : '';
  for (const song of await store.all()) {
    if (!song.sources?.some((one) => one.folderId === fromId)) continue;
    const moved = song.sources.map((one) => (one.folderId === fromId ? { ...one, folderId: toId, path: `${lead}${one.path}` } : one));
    const unique = moved.filter((one, index) => moved.findIndex((other) => other.folderId === one.folderId && other.path === one.path) === index);
    await store.put({ ...song, sources: unique });
  }
}

/** How a folder being added stands to one already watched, from the browser's own handles (no
 * reading): the same folder, inside it (`path` is where), or its parent (`path` is where the
 * watched one sits inside the new one). Null where unrelated or where the browser cannot say. */
export type FolderRelation = { relation: 'same' | 'inside' | 'parent'; path: string[] } | null;

export async function relationOf(picked: StoredFolderHandle, watched: StoredFolderHandle): Promise<FolderRelation> {
  try {
    if (watched.isSameEntry && await watched.isSameEntry(picked)) return { relation: 'same', path: [] };
    const inside = watched.resolve ? await watched.resolve(picked) : null;
    if (inside && inside.length) return { relation: 'inside', path: inside };
    const parent = picked.resolve ? await picked.resolve(watched) : null;
    if (parent && parent.length) return { relation: 'parent', path: parent };
  } catch { /* a handle from another origin or a test double: treated as unrelated */ }
  return null;
}
