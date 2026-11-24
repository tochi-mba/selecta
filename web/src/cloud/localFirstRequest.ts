import { ApiError, LibraryPage, LibrarySong, MixData, Request, SongAvailability, Status } from '../api';
import { browserMoveNames, browserMovesOn } from './browserMoves';
import { linksFamily } from './localFirstLinks';
import { mixFamily, type PlayableSong } from './localFirstMixes';
import { discoveriesFamily, type DiscoveriesSources } from './localFirstDiscoveries';
import { DEFAULT_STEERING, WORKED_OUT_LIVE, type RecipeStore } from './recipeStore';
import { requestsFamily } from './localFirstRequests';
import { readCached, writeCached } from './offlineCache';
import { canHeal, classify } from './resilientRequest';

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
  content_sha256?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  duration_s?: number | null;
  available_on?: number;
  /** "Never play" for the account: a mix SelectaDJ builds leaves it out (it can be added by hand). */
  never?: boolean;
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

/** What this browser knows about where songs can play from (BF-0462-04): this device's own
 * connected files (`here`: song id to whether the file opens or needs permission again) and the
 * content hashes of the account's hosted copies, for a grandfathered account. Either may be absent. */
export type AvailabilitySources = {
  here?: () => Promise<ReadonlyMap<number, 'here' | 'reauth' | 'reconnect'>>;
  hosted?: (songs: readonly CatalogueSong[]) => Promise<ReadonlySet<number>>;
  /** Where browser mixes are kept (BF-0462-05); without it the current mix is empty. */
  recipes?: RecipeStore;
  /** Harmonic matches from key profiles measured on this device (cloud.browser_harmonic);
   * without it `/discoveries` is refused as not here yet. */
  tonal?: Omit<DiscoveriesSources, 'songs'>;
  /** The workspace whose song requests this browser keeps (localFirstRequests.ts); with the
   * recipe store, Request a song works here. */
  workspaceId?: string;
  /** ADR-0475: the device that is playing when it is not this one; null when this device is the
   * speaker or nothing is playing. Read each time, so it is always the newest session. */
  controller?: () => import('../devices/controller').ControllerLink | null;
  /** ADR-0475 R4: which of the person's other devices hold a song; null until known. */
  holders?: () => import('../devices/controller').WhereHeld | null;
  /** Whether this account has Rooms. False: a room's requests are never asked for (the server
   * answers 404 to an account without Rooms). Left out: asked, as before. */
  rooms?: boolean;
  /** `cloud.offline_shell`: keep the last catalogue in this browser and serve it, merged with
   * `deviceSongs`, while SelectaDJ cannot be reached. Needs `workspaceId`. */
  offline?: {
    /** The songs in this device's own index, in catalogue shape. */
    deviceSongs?: () => Promise<CatalogueSong[]>;
    /** Told where each catalogue read came from: the server, or this device (with when the
     * server last answered, null when it never has here). */
    onServed?: (from: { cached: false } | { cached: true; at: number | null }) => void;
  };
};
export type Availability = { here: ReadonlyMap<number, 'here' | 'reauth' | 'reconnect'>; hosted: ReadonlySet<number> };
export const NO_AVAILABILITY: Availability = { here: new Map(), hosted: new Set() };

/** One song's availability: this device first, then a hosted copy, then the member's other devices. */
export function availabilityOf(song: CatalogueSong, known: Availability): SongAvailability {
  const device = known.here.get(song.id);
  if (device === 'here') return 'here';
  if (known.hosted.has(song.id)) return 'hosted';
  if (device === 'reauth') return 'reauth';
  // picked on this device in an earlier visit: it is here, the browser just needs it chosen again
  if (device === 'reconnect') return 'reconnect';
  return (song.available_on ?? 0) > 0 ? 'elsewhere' : 'nowhere';
}

/** A catalogue song in the Library's shape. Nothing is analysed in the browser yet, so no tempo,
 * key or energy is claimed; where it can play from rides alongside as `availability`. */
export function asLibrarySong(song: CatalogueSong, known: Availability = NO_AVAILABILITY): LibrarySong {
  const availability = availabilityOf(song, known);
  const here = availability !== 'nowhere';
  const playable = availability === 'here' || availability === 'hosted';
  return {
    id: song.id, artist: song.artist, title: song.title, genre: null,
    duration: song.duration_s ?? 0, bpm: null, camelot: null,
    detected_bpm: null, detected_camelot: null, override_bpm: null, override_camelot: null,
    music_override: null, energy: null, grid_confidence: null, lyric_status: null,
    never: song.never === true, priority: false, availability,
    // the availability line says where it is; readiness only says how far analysis has got
    // in a browser mix a song that plays here is ready: its transitions are worked out from the
    // audio as the mix plays, so nothing has to be measured first (BF-0462-05)
    readiness: playable
      ? { status: 'mix_ready', reason: WORKED_OUT_LIVE }
      : here
        ? { status: 'analysed_incomplete', reason: availability === 'reconnect' ? 'Plays once you connect it again.' : 'Plays once it is on this device.' }
        : { status: 'missing', reason: '' },
  };
}

/** The Library page the views ask for, answered from the catalogue. */
export function libraryPage(songs: CatalogueSong[], search: URLSearchParams, known: Availability = NO_AVAILABILITY): LibraryPage {
  const query = (search.get('q') ?? '').trim().toLowerCase();
  const state = search.get('state') ?? 'all';
  const sort = search.get('sort') ?? 'title';
  const limit = Math.max(1, Number(search.get('limit') ?? PAGE) || PAGE);
  const start = Math.max(0, Number(search.get('after') ?? 0) || 0);
  const matching = songs
    .filter((song) => !query || `${song.title} ${song.artist} ${song.album ?? ''}`.toLowerCase().includes(query))
    // nothing is measured in the browser, so every song is not analysed yet; ready means it plays
    // here (a browser mix works its transitions out as it plays); needing attention is a song this
    // device cannot play
    .filter((song) => {
      if (state === 'all' || state === 'not_yet') return true;
      const where = availabilityOf(song, known);
      if (state === 'ready') return where === 'here' || where === 'hosted';
      if (state === 'attention') return where === 'reauth' || where === 'reconnect' || where === 'nowhere';
      return state === 'missing' && where === 'nowhere';
    })
    .sort((one, other) => {
      const key = sort === 'artist' ? 'artist' : 'title';
      return one[key].localeCompare(other[key]) || one.id - other.id;
    });
  const page = matching.slice(start, start + limit);
  const next = start + limit < matching.length ? String(start + limit) : null;
  return { songs: page.map((song) => asLibrarySong(song, known)), total: matching.length, next };
}

/** The status the shared shell and views read, from what the catalogue knows. */
export function statusFrom(songs: CatalogueSong[], known: Availability = NO_AVAILABILITY, steering: Status['steering'] = DEFAULT_STEERING): Status {
  const available = songs.filter((song) => (song.available_on ?? 0) > 0).length;
  const ready = songs.filter((song) => ['here', 'hosted'].includes(availabilityOf(song, known))).length;
  return {
    counts: { total: songs.length, music: songs.length, analysed: 0, ready, lyrics: 0, set_aside: 0, missing: songs.length - available },
    steering,
    // the browser's moves by name, so the shared views can say which one a seam asks for
    moves: browserMovesOn() ? browserMoveNames() : {},
    analysis_running: false,
    analysing: [],
    mix_rendering: false,
    scan: { status: 'idle' },
  };
}

const CATALOGUE_KEY = 'catalogue';

/** The kept catalogue with this device's own songs added: a song imported here after the last
 * server answer is still in the Library offline. The kept row wins where both have it. */
export function mergeSongs(kept: readonly CatalogueSong[], device: readonly CatalogueSong[]): CatalogueSong[] {
  const known = new Set(kept.map((song) => song.id));
  return [...kept, ...device.filter((song) => !known.has(song.id))];
}

/** The current mix before a recipe store has answered, or without one. */
export const EMPTY_MIX: MixData = { mix: [], name: 'Current mix', can_undo: false };

/** The adapted request. `cloud` asks the Cloud API with the account's token and workspace. */
export function localFirstRequest(cloud: Request, sources: AvailabilitySources = {}): Request {
  let catalogue: Promise<CatalogueSong[]> | null = null;
  let readAt = 0;
  // `cloud.offline_shell`: the server's answer is kept here, and served back (with this device's
  // own songs) when the server cannot be reached; a refusal or an ended sign-in still throws
  const keep = sources.offline && sources.workspaceId ? { ...sources.offline, workspaceId: sources.workspaceId } : null;
  let keptCount = -1;
  let keptAt = 0;
  const fromServer = async (): Promise<CatalogueSong[]> => {
    if (!keep) return readCatalogue(cloud);
    try {
      const list = await readCatalogue(cloud);
      // kept when it changed size, and otherwise at most once a minute
      if (list.length !== keptCount || Date.now() - keptAt > 60_000) {
        keptCount = list.length;
        keptAt = Date.now();
        void writeCached(keep.workspaceId, CATALOGUE_KEY, list);
      }
      keep.onServed?.({ cached: false });
      return list;
    } catch (problem) {
      if (!canHeal(classify(problem))) throw problem;
      const [kept, device] = await Promise.all([
        readCached<CatalogueSong[]>(keep.workspaceId, CATALOGUE_KEY),
        keep.deviceSongs?.().catch(() => []) ?? Promise.resolve([]),
      ]);
      if (!kept && !device.length) throw problem;
      keep.onServed?.({ cached: true, at: kept?.at ?? null });
      return mergeSongs(kept?.value ?? [], device);
    }
  };
  // one catalogue read serves a burst of requests (status, the library page, a search)
  const songs = () => {
    if (!catalogue || performance.now() - readAt > 3000) {
      readAt = performance.now();
      catalogue = fromServer();
      catalogue.catch(() => { catalogue = null; });
    }
    return catalogue;
  };
  // asked fresh with each Library read: a permission granted a moment ago shows at once
  const availability = async (list: CatalogueSong[]): Promise<Availability> => ({
    here: (await sources.here?.().catch(() => null)) ?? NO_AVAILABILITY.here,
    hosted: (await sources.hosted?.(list).catch(() => null)) ?? NO_AVAILABILITY.hosted,
  });
  const playable = async (): Promise<PlayableSong[]> => {
    const list = await songs();
    const known = await availability(list);
    return list.map((song) => {
      const where = availabilityOf(song, known);
      return { id: song.id, title: song.title, artist: song.artist, duration: song.duration_s ?? 0, playable: where === 'here' || where === 'hosted', never: song.never === true };
    });
  };
  const mixes = sources.recipes ? mixFamily(sources.recipes, playable, () => !!sources.controller?.()) : null;
  const discoveries = sources.tonal ? discoveriesFamily({
    ...sources.tonal,
    songs: async () => {
      const list = await songs();
      const known = await availability(list);
      // only a file on this device can be measured here, so a hosted copy is not offered
      return list.map((song) => ({ id: song.id, title: song.title, artist: song.artist, playable: known.here.get(song.id) === 'here' }));
    },
  }) : null;
  // requests join the current recipe through the mix routes above, so they need the store too
  const requests = sources.recipes && sources.workspaceId
    ? requestsFamily({ cloud, workspaceId: sources.workspaceId, rooms: sources.rooms, controller: sources.controller, holders: sources.holders, songs: playable, send: (<T,>(path: string, init?: RequestInit) => adapted<T>(path, init)) as Request })
    : null;
  // Word connections (discover.word_links): answers nothing while that flag is off
  const links = linksFamily(cloud, sources.recipes, playable);
  const adapted = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const [route, query = ''] = path.split('?');
    if (method === 'GET' && route === '/library') {
      const list = await songs();
      return libraryPage(list, new URLSearchParams(query), await availability(list)) as T;
    }
    if (method === 'GET' && route === '/status') {
      const list = await songs();
      return statusFrom(list, await availability(list), mixes?.steering()) as T;
    }
    const requestAnswer = requests?.answer(method, route, new URLSearchParams(query), init);
    if (requestAnswer) return (await requestAnswer) as T;
    const mixAnswer = mixes?.answer(method, route, new URLSearchParams(query), init);
    if (mixAnswer) return (await mixAnswer) as T;
    const discoveryAnswer = discoveries?.answer(method, route, new URLSearchParams(query), init);
    if (discoveryAnswer) return (await discoveryAnswer) as T;
    const linkAnswer = links.answer(method, route, new URLSearchParams(query), init);
    if (linkAnswer) return (await linkAnswer) as T;
    if (method === 'GET' && route === '/mix' && !query) return EMPTY_MIX as T;
    // without a recipe store there is nothing to build a mix into
    if (method === 'GET' && route === '/vibes') return [] as T;
    // the catalogue's own routes pass straight through (the import surface uses them)
    // (a registration through here changes the catalogue, so the next read asks again)
    if (route.startsWith('/local-media/')) {
      if (method !== 'GET') catalogue = null;
      return cloud<T>(path, init);
    }
    const neverAnswer = setNever(method, route, init);
    if (neverAnswer) return (await neverAnswer) as T;
    throw notHereYet(path);
  };
  /** "Never play" from the Library's row toggle (`/songs/{id}/never`) and its batch actions
   * (`/library/batch`, never and allow), kept for the account (ADR-0475). Priority is an analysis
   * setting and nothing is analysed in the browser, so those batch actions stay not here yet. */
  const setNever = (method: string, route: string, init?: RequestInit): Promise<unknown> | undefined => {
    if (method !== 'POST') return undefined;
    const write = async (never: boolean, entries: { id: number; expected: boolean }[]) => {
      catalogue = null;
      await cloud('/local-media/songs/never', { method: 'POST', body: JSON.stringify({ never, entries }) });
      catalogue = null;
      return {};
    };
    const toggle = route.match(/^\/songs\/(\d+)\/never$/);
    if (toggle) {
      const id = Number(toggle[1]);
      return (async () => {
        const current = (await songs()).find((song) => song.id === id)?.never === true;
        return write(!current, [{ id, expected: current }]);
      })();
    }
    if (route !== '/library/batch') return undefined;
    const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string; entries?: { id: number; expected: unknown }[] };
    if (body.action !== 'never' && body.action !== 'allow') return undefined;
    return write(body.action === 'never', (body.entries ?? []).map((entry) => ({ id: entry.id, expected: entry.expected === true })));
  };
  return adapted as Request;
}

/** The media importer asks with full `/api/...` paths (web/src/media); the Cloud client adds
 * `/api` itself, so strip it here rather than in the importer. */
export function mediaRequest(cloud: Request): Request {
  return (<T,>(path: string, init?: RequestInit) => cloud<T>(path.replace(/^\/api(?=\/)/, ''), init)) as Request;
}
