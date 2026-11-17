import { ApiError, LibraryPage, LibrarySong, MixData, Request, Status } from '../api';

/** The local-first shell's request adapter (ADR-0462 "one adapter per route family").
 *
 * The shared views ask in local mode's shapes (`/library`, `/status`, `/mix`). Cloud has no such
 * routes for a local-first account; it has the metadata-only catalogue (ADR-0458). This adapter
 * answers each family the views use from the catalogue, at the boundary, so no view learns which
 * mode it is in. A family Cloud cannot serve yet is refused with a plain reason (`flag_off`, which
 * the views already render as "not available here") rather than a fake success or a network 404.
 */

/** A catalogue row as `/api/local-media/songs` answers it. */
export type CatalogueSong = {
  id: number;
  title: string;
  artist: string;
  album?: string | null;
  duration_s?: number | null;
  available_on?: number;
};

export const NOT_HERE_YET = 'SelectaDJ can’t do that in your browser yet.';
const PAGE = 100;
/** Enough for a large personal library; the catalogue pages at 100. */
const MAX_PAGES = 200;

export function notHereYet(path: string): ApiError {
  return new ApiError(NOT_HERE_YET, 404, 'flag_off', `local-first:${path.split('?')[0]}`);
}

/** Every catalogue song, page by page. `cloud` is the authenticated client (paths without /api). */
export async function readCatalogue(cloud: Request): Promise<CatalogueSong[]> {
  const songs: CatalogueSong[] = [];
  let after = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer = await cloud<{ songs: CatalogueSong[]; next?: number }>(`/local-media/songs?after=${after}&limit=${PAGE}`);
    songs.push(...answer.songs);
    if (answer.next === undefined || answer.next === null) break;
    after = answer.next;
  }
  return songs;
}

/** A catalogue song in the Library's shape. Nothing is analysed in the browser yet, so no tempo,
 * key or energy is claimed; a song on none of the member's devices says so. */
export function asLibrarySong(song: CatalogueSong): LibrarySong {
  const here = (song.available_on ?? 0) > 0;
  return {
    id: song.id, artist: song.artist, title: song.title, genre: null,
    duration: song.duration_s ?? 0, bpm: null, camelot: null,
    detected_bpm: null, detected_camelot: null, override_bpm: null, override_camelot: null,
    music_override: null, energy: null, grid_confidence: null, lyric_status: null,
    never: false, priority: false,
    readiness: here
      ? { status: 'analysed_incomplete', reason: 'On your devices. Not analysed in this browser yet.' }
      : { status: 'missing', reason: 'Not on any of your devices right now. Connect it again to play it.' },
  };
}

/** The Library page the views ask for, answered from the catalogue. */
export function libraryPage(songs: CatalogueSong[], search: URLSearchParams): LibraryPage {
  const query = (search.get('q') ?? '').trim().toLowerCase();
  const state = search.get('state') ?? 'all';
  const sort = search.get('sort') ?? 'title';
  const limit = Math.max(1, Number(search.get('limit') ?? PAGE) || PAGE);
  const start = Math.max(0, Number(search.get('after') ?? 0) || 0);
  const matching = songs
    .filter((song) => !query || `${song.title} ${song.artist} ${song.album ?? ''}`.toLowerCase().includes(query))
    // nothing in the browser is mix-ready yet, so the ready view is honestly empty
    .filter((song) => state === 'all' || (state === 'missing' && !(song.available_on ?? 0)))
    .sort((one, other) => {
      const key = sort === 'artist' ? 'artist' : 'title';
      return one[key].localeCompare(other[key]) || one.id - other.id;
    });
  const page = matching.slice(start, start + limit);
  const next = start + limit < matching.length ? String(start + limit) : null;
  return { songs: page.map(asLibrarySong), total: matching.length, next };
}

/** The status the shared shell and views read, from what the catalogue knows. */
export function statusFrom(songs: CatalogueSong[]): Status {
  const available = songs.filter((song) => (song.available_on ?? 0) > 0).length;
  return {
    counts: { total: songs.length, music: songs.length, analysed: 0, ready: 0, lyrics: 0, set_aside: 0, missing: songs.length - available },
    steering: { mix_language: 'any', stems: 'auto', energy_arc: null, target: null },
    moves: {},
    analysis_running: false,
    analysing: [],
    mix_rendering: false,
    scan: { status: 'idle' },
  };
}

/** No recipe store reaches the browser yet (BF-0462-05), so the current mix is truthfully empty. */
export const EMPTY_MIX: MixData = { mix: [], name: 'Current mix', can_undo: false };

/** The adapted request. `cloud` asks the Cloud API with the account's token and workspace. */
export function localFirstRequest(cloud: Request): Request {
  let catalogue: Promise<CatalogueSong[]> | null = null;
  let readAt = 0;
  // one catalogue read serves a burst of requests (status, the library page, a search)
  const songs = () => {
    if (!catalogue || performance.now() - readAt > 3000) {
      readAt = performance.now();
      catalogue = readCatalogue(cloud);
      catalogue.catch(() => { catalogue = null; });
    }
    return catalogue;
  };
  const adapted = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const [route, query = ''] = path.split('?');
    if (method === 'GET' && route === '/library') return libraryPage(await songs(), new URLSearchParams(query)) as T;
    if (method === 'GET' && route === '/status') return statusFrom(await songs()) as T;
    if (method === 'GET' && route === '/mix' && !query) return EMPTY_MIX as T;
    // Make a Mix's ideas need analysed songs; none are analysed in the browser yet
    if (method === 'GET' && route === '/vibes') return [] as T;
    // the catalogue's own routes pass straight through (the import surface uses them)
    if (route.startsWith('/local-media/')) return cloud<T>(path, init);
    throw notHereYet(path);
  };
  return adapted as Request;
}

/** The media importer asks with full `/api/...` paths (web/src/media); the Cloud client adds
 * `/api` itself, so strip it here rather than in the importer. */
export function mediaRequest(cloud: Request): Request {
  return (<T,>(path: string, init?: RequestInit) => cloud<T>(path.replace(/^\/api(?=\/)/, ''), init)) as Request;
}
