import type { ControllerLink, WhereHeld } from '../devices/controller';
import type { MediaResolver } from '../media';
import type { CatalogueSong } from './deviceMusicRequest';

/** One song, however many files of it (ADR-0469 amendment 2).
 *
 * The catalogue lists every file a person registered: a version of a song (another file of the
 * same recording: same title and artist, length within a few seconds) carries `duplicate_of`,
 * its song's primary id. This is the one place the browser turns that list into songs: one row
 * per song, under the primary id that mixes, requests and rooms already use, with every version's
 * id in `versions`. Library, search, Requests, Make a Mix, the queue and counts all read the
 * grouped list, so no surface can show an extra copy. Any id that arrives from elsewhere (an old
 * mix, a request made before grouping) is resolved to its song with `primaryOf`.
 *
 * On a device, the version played is the one this device holds; the resolver tries the asked id
 * first, then the song's other versions (`withVersions`).
 */

export type Grouping = {
  /** One row per song, under its primary id. */
  songs: CatalogueSong[];
  /** Every file row as the server listed it. */
  files: CatalogueSong[];
  primaryOf: (songId: number) => number;
  /** Every id of this song, best version first (see `qualityOf`). */
  versionsOf: (songId: number) => number[];
};

/** Lossless first, then the common lossy formats by how well they usually sound. */
const FORMAT_RANK: Record<string, number> = { flac: 5, wav: 5, aiff: 5, aif: 5, alac: 5, m4a: 3, aac: 3, ogg: 3, opus: 3, oga: 3, mp3: 2, wma: 1 };
export function qualityOf(song: Pick<CatalogueSong, 'codec'>): number {
  return FORMAT_RANK[(song.codec ?? '').toLowerCase()] ?? 0;
}

const EMPTY: Grouping = { songs: [], files: [], primaryOf: (id) => id, versionsOf: (id) => [id] };

export function groupVersions(files: readonly CatalogueSong[]): Grouping {
  const byId = new Map(files.map((song) => [song.id, song]));
  const members = new Map<number, number[]>();
  const rootOf = new Map<number, number>();
  for (const song of [...files].sort((one, other) => one.id - other.id)) {
    const pointed = song.duplicate_of ?? null;
    // a version whose primary is not listed (removed) waits for the server's repair; until then
    // it heads its own group, so it is never lost
    const root = pointed !== null && byId.has(pointed) ? pointed : song.id;
    rootOf.set(song.id, root);
    const list = members.get(root) ?? [];
    if (root === song.id) list.unshift(song.id);
    else list.push(song.id);
    members.set(root, list);
  }
  const songs: CatalogueSong[] = [];
  for (const [root, ids] of members) {
    const primary = byId.get(root)!;
    if (ids.length === 1) { songs.push(primary); continue; }
    const all = ids.map((id) => byId.get(id)!);
    songs.push({
      ...primary,
      versions: ids,
      available_on: all.reduce((most, song) => Math.max(most, song.available_on ?? 0), 0),
      // "Never play" is about the song: any version marked keeps the song out
      never: all.some((song) => song.never === true),
    });
  }
  const primaryOf = (id: number) => rootOf.get(id) ?? id;
  // best first: lossless before lossy, then the longer file (less trimmed); the engine plays the
  // first of these this device can open
  const ranked = new Map<number, number[]>();
  for (const [root, ids] of members) {
    ranked.set(root, [...ids].sort((one, other) => qualityOf(byId.get(other)!) - qualityOf(byId.get(one)!) || (byId.get(other)!.duration_s ?? 0) - (byId.get(one)!.duration_s ?? 0) || one - other));
  }
  const versionsOf = (id: number) => {
    const ids = ranked.get(primaryOf(id));
    return ids && ids.includes(id) ? ids : [id];
  };
  return { songs, files: [...files], primaryOf, versionsOf };
}

/** The latest grouping per workspace, for parts of the shell that receive bare ids. */
const latest = new Map<string, Grouping>();

let newest: Grouping = EMPTY;

export function rememberGrouping(workspaceId: string | undefined, grouping: Grouping): void {
  latest.set(workspaceId ?? '', grouping);
  newest = grouping;
}

/** The grouping this tab read last (one account is signed in per tab), for code that only has
 * a recipe in hand. Before any catalogue read, every id is its own song. */
export function currentGrouping(): Grouping {
  return newest;
}

export function groupingFor(workspaceId: string | undefined): Grouping {
  return latest.get(workspaceId ?? '') ?? EMPTY;
}

/** A device resolver that plays whichever version of the song this device holds. The answer
 * keeps the asked id, so the engine never learns which file it was. */
export function withVersions(resolve: MediaResolver, workspaceId: string): MediaResolver {
  return async (songId) => {
    let first: Error | null = null;
    for (const id of groupingFor(workspaceId).versionsOf(songId)) {
      try {
        const found = await resolve(id);
        if (found) return { ...found, id: songId };
      } catch (problem) {
        first ??= problem as Error;
      }
    }
    if (first) throw first;
    return null;
  };
}

/** The best of this device's answers across a song's versions. */
const RANK = { here: 3, reauth: 2, reconnect: 1 } as const;
export function hereBySong(grouping: Grouping, here: ReadonlyMap<number, 'here' | 'reauth' | 'reconnect'>): Map<number, 'here' | 'reauth' | 'reconnect'> {
  const found = new Map<number, 'here' | 'reauth' | 'reconnect'>();
  for (const [id, state] of here) {
    const song = grouping.primaryOf(id);
    const had = found.get(song);
    if (!had || RANK[state] > RANK[had]) found.set(song, state);
  }
  return found;
}

export function setBySong(grouping: Grouping, ids: ReadonlySet<number>): Set<number> {
  return new Set([...ids].map((id) => grouping.primaryOf(id)));
}

/** Where a song is held: any device holding any of its versions. */
export function whereBySong(grouping: Grouping, where: WhereHeld | null): WhereHeld | null {
  if (!where) return null;
  return (songId) => {
    const online = new Set<string>();
    const before = new Set<string>();
    for (const id of grouping.versionsOf(songId)) {
      const places = where(id);
      places.online.forEach((name) => online.add(name));
      places.before.forEach((name) => before.add(name));
    }
    return { online: [...online], before: [...before].filter((name) => !online.has(name)) };
  };
}

/** The playing device as songs: what it holds and plays, by song, so a request for a song is
 * matched whichever version the speaker has. */
export function linkBySong(grouping: Grouping, link: ControllerLink | null): ControllerLink | null {
  if (!link) return null;
  return {
    ...link,
    programme: link.programme.map((id) => grouping.primaryOf(id)),
    holds: link.holds ? setBySong(grouping, link.holds) : null,
  };
}
