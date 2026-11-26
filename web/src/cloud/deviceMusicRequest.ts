import { ApiError, LibraryPage, LibrarySong, MixData, Request, SongAvailability, Status } from '../api';
import { accountMeasured, noteCorrection, sendingOn, type Measured } from './accountFacts';
import { accountMixes, accountMixesOn, fallsBack } from './accountMixes';
import { accountOrderPlanner } from './accountOrder';
import { accountIdeas } from './accountIdeas';
import { accountDiscoveries } from './accountDiscoveries';
import { browserMoveNames, browserMovesOn } from './browserMoves';
import { linksFamily } from './deviceMusicLinks';
import { mixFamily, type PlayableSong, type SongPlace } from './deviceMusicMixes';
import { MOVE_OFFER_EVENT, notOnSpeaker, playsOn, speakerHolds, type MoveOffer } from '../devices/controller';
import { discoveriesFamily, type DiscoveriesSources } from './deviceMusicDiscoveries';
import { DEFAULT_STEERING, WORKED_OUT_LIVE, type RecipeStore } from './recipeStore';
import { requestsFamily } from './deviceMusicRequests';
import { askToMake, forgetRatings, inspectorOn, seamOptions, withInspection } from './seamInspection';
import { exportFamily, exportStudio } from './localExport';
import { readCached, writeCached } from './offlineCache';
import { canHeal, classify } from './resilientRequest';
import { libraryFamily } from './deviceMusicLibrary';
import { isFirst } from './measuringControl';
import { flagListed } from '../flags';
import { groupVersions, hereBySong, linkBySong, rememberGrouping, setBySong, whereBySong, type Grouping } from './songVersions';

/** The local-first shell's request adapter (ADR-0462 "one adapter per route family").
 *
 * The shared views ask in local mode's shapes (`/library`, `/status`, `/mix`). Cloud has no such
 * routes for a local-first account; it has the metadata-only catalogue (ADR-0458). This adapter
 * answers each family the views use from the catalogue, at the boundary, so no view learns which
 * mode it is in. A family only the app on a computer serves is refused with a plain reason
 * (`flag_off`, which the views already render as "not available here") rather than a fake success
 * or a network 404. The shell hides those controls (browserFlags.ts), so the refusal is a backstop.
 */

/** A catalogue row as `/api/local-media/songs` answers it. */
export type CatalogueSong = {
  id: number;
  content_sha256?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  duration_s?: number | null;
  /** The file's format, from its name (mp3, flac, m4a...). */
  codec?: string | null;
  available_on?: number;
  /** "Never play" for the account: a mix SelectaDJ builds leaves it out (it can be added by hand). */
  never?: boolean;
  /** Another file of an earlier song (same title and artist, about the same length): that song's
   * id. Such a row is a version, never a song of its own (songVersions.ts). */
  duplicate_of?: number | null;
  /** On a grouped song only: every version's id, the primary first. */
  versions?: number[];
  /** The member set it aside (Is it music? answered no): kept out of mixes (T-20261126-3f92). */
  set_aside?: boolean;
};

/** The refusal for a route only the SelectaDJ app on a computer answers. */
export const ONLY_IN_THE_APP = 'That works in the SelectaDJ app on a computer, not in a browser.';
// the server's largest page (local_media/api.py), so a big library is a few reads, not dozens
const PAGE = 1000;
/** How long one catalogue read is kept. A write through this adapter (`/local-media`, Never play)
 * or a library event from the server (`CATALOGUE_CHANGED_EVENT`) forgets it at once, so this only
 * bounds how long a change made on another device can go unseen. It was 3 s, which, with a
 * request waiting (polled every 4 s), read every page of the catalogue again on every poll. */
export const CATALOGUE_KEEP_MS = 5 * 60_000;
/** Said on `window` when the server says the library changed (CloudApp's event stream). */
export const CATALOGUE_CHANGED_EVENT = 'selecta:catalogue-changed';
// counted once for the page, so an adapter made again (its sources changed) leaves no listener behind
let catalogueChanges = 0;
if (typeof window !== 'undefined') window.addEventListener(CATALOGUE_CHANGED_EVENT, () => { catalogueChanges += 1; });

export function onlyInTheApp(path: string): ApiError {
  return new ApiError(ONLY_IN_THE_APP, 404, 'flag_off', `device-music:${path.split('?')[0]}`);
}

/** Every catalogue song, page by page, however many pages there are (it used to stop silently at
 * 200 pages, 20,000 songs). `cloud` is the authenticated client (paths without /api). */
export async function readCatalogue(cloud: Request): Promise<CatalogueSong[]> {
  const songs: CatalogueSong[] = [];
  let after = 0;
  for (;;) {
    const answer = await cloud<{ songs: CatalogueSong[]; next?: number | null }>(`/local-media/songs?after=${after}&limit=${PAGE}`);
    songs.push(...answer.songs);
    if (answer.next === undefined || answer.next === null) break;
    // a cursor that doesn't move on would ask for the same page for ever
    if (!(answer.next > after) || !answer.songs.length) break;
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
  /** cloud.catalogue_play: the upload in the cloud library that is a song, from its rows (best
   * version first) and the whole list; null when it has none. */
  cloudCopy?: (rows: readonly CatalogueSong[], all: readonly CatalogueSong[]) => Promise<string | null>;
  /** Where browser mixes are kept (BF-0462-05); without it the current mix is empty. */
  recipes?: RecipeStore;
  /** Harmonic matches from key profiles measured on this device (cloud.browser_harmonic);
   * without it `/discoveries` is refused as the app's alone. */
  tonal?: Omit<DiscoveriesSources, 'songs'>;
  /** The workspace whose song requests this browser keeps (deviceMusicRequests.ts); with the
   * recipe store, Request a song works here. */
  workspaceId?: string;
  /** ADR-0475: the device that is playing when it is not this one; null when this device is the
   * speaker or nothing is playing. Read each time, so it is always the newest session. */
  controller?: () => import('../devices/controller').ControllerLink | null;
  /** ADR-0475 R4: which of the person's other devices hold a song; null until known. */
  holders?: () => import('../devices/controller').WhereHeld | null;
  /** ADR-0475 R8: songs another device holds now that a mix made here may use (the device R1
   * would choose, when it has more of the music than this one); null when none. */
  mixable?: () => ReadonlySet<number> | null;
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
/** `elsewhere`: which other devices of the person hold a song (ADR-0475 R6), when known. */
export type Availability = {
  here: ReadonlyMap<number, 'here' | 'reauth' | 'reconnect'>;
  hosted: ReadonlySet<number>;
  elsewhere?: import('../devices/controller').WhereHeld | null;
  /** By file rather than by song, for a song's versions: this device's own answers and the rows. */
  files?: { here: ReadonlyMap<number, 'here' | 'reauth' | 'reconnect'>; rows: ReadonlyMap<number, CatalogueSong> };
  /** ADR-0488: how many rooms loved each song (the account's crowd marks), when Rooms is on. */
  loved?: ReadonlyMap<number, number>;
  /** Tempo, key and energy measured on the member's devices and saved to the account, with
   * their own corrections (cloud.brain and cloud.device_analysis); absent otherwise. */
  facts?: ReadonlyMap<number, Measured>;
};
export const NO_AVAILABILITY: Availability = { here: new Map(), hosted: new Set() };

/** Every place a song is kept, each on its own: a song can be on this device and in the cloud
 * library at once, and on other devices too. */
export type Places = {
  /** this device: plays now, needs permission again, needs choosing again, or not here */
  device: 'here' | 'reauth' | 'reconnect' | null;
  /** a copy in the cloud library */
  cloud: boolean;
  /** `devices`: how many devices the server counts holding it (this one may be among them);
   * `online` and `before`: the member's other open and closed devices that hold it, by name, once
   * the holdings are known (empty until then) */
  other: { devices: number; online: readonly string[]; before: readonly string[] };
};
const HELD_NOWHERE_ELSE = { online: [], before: [] } as const;

/** Where one song is kept: this device, the cloud library and the member's other devices. */
export function placesOf(song: CatalogueSong, known: Availability): Places {
  const held = known.elsewhere?.(song.id) ?? HELD_NOWHERE_ELSE;
  return {
    device: known.here.get(song.id) ?? null,
    cloud: known.hosted.has(song.id),
    other: { devices: song.available_on ?? 0, online: held.online, before: held.before },
  };
}

/** One song's availability, the one place it plays from: this device first, then a hosted copy,
 * then the member's other devices. A reduction of `placesOf`. */
export function availabilityOf(song: CatalogueSong, known: Availability): SongAvailability {
  const { device, cloud, other } = placesOf(song, known);
  if (device === 'here') return 'here';
  if (cloud) return 'hosted';
  if (device === 'reauth') return 'reauth';
  // picked on this device in an earlier visit: it is here, the browser just needs it chosen again
  if (device === 'reconnect') return 'reconnect';
  return other.devices > 0 ? 'elsewhere' : 'nowhere';
}

/** ADR-0488: what rooms made of a song, said after how it plays; nothing when no room loved it. */
const lovedWords = (rooms: number) => (rooms > 0 ? ` Loved in ${rooms} ${rooms === 1 ? 'room' : 'rooms'}.` : '');

/** A catalogue song in the Library's shape. Tempo, key and energy are the account's measurements
 * when it has them (`known.facts`), and are never claimed otherwise; where it can play from rides
 * alongside as `availability`. */
export function asLibrarySong(song: CatalogueSong, known: Availability = NO_AVAILABILITY): LibrarySong {
  const availability = availabilityOf(song, known);
  const here = availability !== 'nowhere';
  const playable = availability === 'here' || availability === 'hosted';
  const openElsewhere = playable ? null : known.elsewhere?.(song.id).online[0] ?? null;
  const versions = song.versions && song.versions.length > 1
    ? song.versions.map((id) => {
      const row = known.files?.rows.get(id);
      return { id, length: row?.duration_s ?? 0, format: row?.codec ?? null, here: known.files?.here.get(id) === 'here', primary: id === song.id };
    })
    : undefined;
  return {
    ...(versions ? { versions } : {}),
    id: song.id, artist: song.artist, title: song.title, genre: null,
    duration: song.duration_s ?? 0, ...measuredOf(known.facts?.get(song.id)),
    music_override: song.set_aside ? 0 : null, grid_confidence: null, lyric_status: null,
    // priority: this device measures it before the others (measuringControl.ts)
    never: song.never === true, priority: isFirst(song.id), availability,
    // the availability line says where it is; readiness only says how far analysis has got
    // in a browser mix a song that plays here is ready: its transitions are worked out from the
    // audio as the mix plays, so nothing has to be measured first (BF-0462-05)
    // ADR-0475 I83: a song another open device holds plays there, so it can be played, added
    // and started from here, on that device
    readiness: song.set_aside
      ? { status: 'set_aside', reason: 'You set this aside.' }
      : playable
      ? { status: 'mix_ready', reason: `${WORKED_OUT_LIVE}${lovedWords(known.loved?.get(song.id) ?? 0)}` }
      : openElsewhere
        ? { status: 'mix_ready', reason: `Plays on ${openElsewhere}.` }
      : here
        ? { status: 'analysed_incomplete', reason: availability === 'reconnect' ? 'Plays once you connect it again.' : 'Plays once it is on this device.' }
        : { status: 'missing', reason: '' },
  };
}

/** A song's tempo and key in use (the member's correction first), and what was measured. */
function measuredOf(facts: Measured | undefined) {
  const bpm = facts?.bpm ?? null;
  const camelot = facts?.camelot ?? null;
  const overrideBpm = facts?.override_bpm ?? null;
  const overrideKey = facts?.override_camelot ?? null;
  return {
    bpm: overrideBpm ?? bpm, camelot: overrideKey ?? camelot, detected_bpm: bpm, detected_camelot: camelot,
    override_bpm: overrideBpm, override_camelot: overrideKey, energy: facts?.energy ?? null,
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
    // the browser's filters are about where a song plays: ready means it plays here (a browser mix
    // works its transitions out as it plays); needing attention is a song this device cannot play
    .filter((song) => {
      if (state === 'all' || state === 'not_yet') return true;
      if (state === 'set_aside') return song.set_aside === true;
      const where = availabilityOf(song, known);
      if (song.set_aside && state !== 'attention' && state !== 'missing') return false;
      if (state === 'ready') return where === 'here' || where === 'hosted';
      // R6: plays now, here or on another of the person's devices that is open
      if (state === 'playable_now') return where === 'here' || where === 'hosted' || (known.elsewhere?.(song.id).online.length ?? 0) > 0;
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
  const ready = songs.filter((song) => !song.set_aside && ['here', 'hosted'].includes(availabilityOf(song, known))).length;
  const setAside = songs.filter((song) => song.set_aside).length;
  return {
    counts: { total: songs.length, music: songs.length - setAside, analysed: 0, ready, lyrics: 0, set_aside: setAside, missing: songs.length - available },
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

/** The mix with each song's tempo, key and energy as the account measured them (the member's own
 * tempo and key first), where the row has none: the energy horizon draws these (T-20261126-bfec).
 * A song the account has not measured keeps nothing, never a guess. */
export function withMeasured(mix: MixData, measured: ReadonlyMap<number, Measured> | undefined): MixData {
  if (!measured?.size || !mix.mix.length) return mix;
  let changed = false;
  const items = mix.mix.map((item) => {
    const found = measured.get(item.song_id);
    if (!found) return item;
    const bpm = item.bpm ?? found.override_bpm ?? found.bpm ?? null;
    const key = item.key ?? found.override_camelot ?? found.camelot ?? null;
    const energy = item.energy ?? found.energy ?? null;
    if (bpm === item.bpm && key === item.key && energy === (item.energy ?? null)) return item;
    changed = true;
    return { ...item, bpm, key, energy };
  });
  return changed ? { ...mix, mix: items } : mix;
}

/** The adapted request, with what its grouped catalogue knows about the cloud library
 * (cloud.catalogue_play): a song's upload by catalogue id, and every file of a song with one. */
export type DeviceMusicRequest = Request & {
  cloudAssetOf: (songId: number) => Promise<string | null>;
  cloudSongs: () => Promise<CloudSongs>;
};
/** The songs in the cloud library: every file id of each, and how many songs. */
export type CloudSongs = { ids: ReadonlySet<number>; songs: number };

/** The adapted request. `cloud` asks the Cloud API with the account's token and workspace. */
export function deviceMusicRequest(cloud: Request, sources: AvailabilitySources = {}): DeviceMusicRequest {
  let catalogue: Promise<Grouping> | null = null;
  let lastGrouping: Grouping | null = null;
  let readAt = 0;
  // `cloud.offline_shell`: the server's answer is kept here, and served back (with this device's
  // own songs) when the server cannot be reached; a refusal or an ended sign-in still throws
  const keep = sources.offline && sources.workspaceId ? { ...sources.offline, workspaceId: sources.workspaceId } : null;
  let keptCount = -1;
  let keptAt = 0;
  // Staging walkthrough item 5: the first Library of a visit opens from this browser's last copy
  // of the catalogue at once, and the server's list replaces it as soon as it has arrived (a big
  // library is several reads). Only the first read of a visit; every later one is the server's.
  let firstRead = true;
  let arrived: CatalogueSong[] | null = null;
  const fromServer = async (): Promise<CatalogueSong[]> => {
    if (!keep) return readCatalogue(cloud);
    if (arrived) { const list = arrived; arrived = null; return list; }
    if (firstRead) {
      firstRead = false;
      const kept = await readCached<CatalogueSong[]>(keep.workspaceId, CATALOGUE_KEY).catch(() => null);
      if (kept?.value?.length) {
        const readAgain = () => {
          if (typeof window === 'undefined') return;
          window.dispatchEvent(new Event(CATALOGUE_CHANGED_EVENT));
          window.dispatchEvent(new Event('selecta:library-changed'));
        };
        // the server's list replaces the copy; a refusal or an ended sign-in is never hidden by
        // it: the page reads again and the next read throws it, as every later read would
        void serverList().then((list) => { arrived = list; readAgain(); }, readAgain);
        // the copy is said as one, with this device's own songs, as when the server is away
        const device = await (keep.deviceSongs?.().catch(() => []) ?? Promise.resolve([]));
        keep.onServed?.({ cached: true, at: kept.at });
        return mergeSongs(kept.value, device);
      }
    }
    return serverList();
  };
  const serverList = async (): Promise<CatalogueSong[]> => {
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
  // One catalogue read serves every request until something changes it: a write through here
  // forgets it (below), and so does the server saying the library changed.
  let readChanges = catalogueChanges;
  // ADR-0469 amendment 2: the one place the catalogue becomes songs. Every family below reads
  // the grouped list, so a song is one row however many files of it the person has.
  const grouped = () => {
    if (!catalogue || readChanges !== catalogueChanges || performance.now() - readAt > CATALOGUE_KEEP_MS) {
      readAt = performance.now();
      readChanges = catalogueChanges;
      catalogue = fromServer().then((list) => {
        const grouping = groupVersions(list);
        rememberGrouping(sources.workspaceId, grouping);
        lastGrouping = grouping;
        return grouping;
      });
      catalogue.catch(() => { catalogue = null; });
    }
    return catalogue;
  };
  const songs = async () => (await grouped()).songs;
  // the playing device and the other devices, as songs rather than files
  const holders = async () => whereBySong(await grouped(), sources.holders?.() ?? null);
  const linkNow = () => (lastGrouping ? linkBySong(lastGrouping, sources.controller?.() ?? null) : sources.controller?.() ?? null);
  const holdersNow = () => (lastGrouping ? whereBySong(lastGrouping, sources.holders?.() ?? null) : sources.holders?.() ?? null);
  // asked fresh with each Library read: a permission granted a moment ago shows at once
  const availability = async (_list: CatalogueSong[]): Promise<Availability> => {
    const grouping = await grouped();
    lastGrouping = grouping;
    const here = (await sources.here?.().catch(() => null)) ?? NO_AVAILABILITY.here;
    const hosted = (await sources.hosted?.(grouping.files).catch(() => null)) ?? NO_AVAILABILITY.hosted;
    return {
      here: hereBySong(grouping, here), hosted: setBySong(grouping, hosted), elsewhere: await holders(),
      loved: await lovedNow(),
      facts: await factsNow(),
      files: { here, rows: new Map(grouping.files.map((file) => [file.id, file])) },
    };
  };
  const playable = async (): Promise<PlayableSong[]> => {
    const list = await songs();
    const known = await availability(list);
    const mixable = setBySong(await grouped(), sources.mixable?.() ?? new Set());
    return list.map((song) => {
      const where = availabilityOf(song, known);
      const elsewhere = mixable.has(song.id);
      return { id: song.id, title: song.title, artist: song.artist, duration: song.duration_s ?? 0, playable: where === 'here' || where === 'hosted' || elsewhere, never: song.never === true || song.set_aside === true };
    });
  };
  // R5: a result is placed by the device playing (it plays there, it is on another device, or on none)
  const placeOf: SongPlace = (songId) => {
    const link = linkNow();
    if (!link) return { rank: 0, where: null };
    if (speakerHolds(link, songId)) return { rank: 0, where: playsOn(link.speakerName) };
    const where = holdersNow()?.(songId);
    if (where?.online.length) return { rank: 1, where: `Only on ${where.online[0]}` };
    if (where?.before.length) return { rank: 1, where: `On ${where.before[0]}, not open now` };
    return { rank: where ? 2 : 1, where: where ? 'On no device right now' : notOnSpeaker(link.speakerName).replace(/:.*$/, '') };
  };
  // ADR-0488: how many rooms loved each song, for an account with Rooms; nothing without
  const lovedInRooms = sources.rooms === false ? undefined : () => cloud<{ marks: { song_id: number; next_song_id: number | null; rooms: number }[] }>('/crowd-marks')
    .then((answer) => new Map(answer.marks.filter((mark) => mark.next_song_id === null && mark.rooms > 0).map((mark) => [mark.song_id, mark.rooms])));
  // read at most once a minute: the Library asks where songs are far more often than rooms end
  let lovedKept: Map<number, number> | undefined;
  let lovedAt = 0;
  async function lovedNow(): Promise<Map<number, number> | undefined> {
    if (!lovedInRooms) return undefined;
    if (!lovedAt || Date.now() - lovedAt > 60_000) {
      lovedAt = Date.now();
      lovedKept = await lovedInRooms().catch(() => lovedKept);
    }
    return lovedKept;
  }
  // the account's measurements, read once a session (accountFacts.ts); none when it is off or fails
  const factsNow = async (): Promise<ReadonlyMap<number, Measured> | undefined> => {
    if (!sources.workspaceId || !sendingOn()) return undefined;
    return accountMeasured(cloud, sources.workspaceId).catch(() => undefined);
  };
  // the account's planner orders a new mix when it can (accountOrder.ts); otherwise today's order
  const planOrder = sources.workspaceId ? accountOrderPlanner(cloud, sources.workspaceId) : undefined;
  // cloud.account_mixes: the account's own mix and draft routes answer first (accountMixes.ts)
  const account = accountMixes(cloud);
  // the account's idea cards on Make a Mix, built by its planner (accountIdeas.ts)
  const ideas = sources.workspaceId ? accountIdeas(cloud, sources.workspaceId) : undefined;
  const mixes = sources.recipes ? mixFamily(sources.recipes, playable, () => !!sources.controller?.(), placeOf, lovedInRooms, planOrder, account, ideas) : null;
  const discoveries = sources.tonal ? discoveriesFamily({
    ...sources.tonal,
    // T-20261126-9a31: the account's own sweep over what this device measured, in spare time
    account: sources.workspaceId ? accountDiscoveries(cloud, sources.workspaceId) : undefined,
    songs: async () => {
      const list = await songs();
      const known = await availability(list);
      // only a file on this device can be measured here, so a hosted copy is not offered
      return list.map((song) => ({ id: song.id, title: song.title, artist: song.artist, playable: known.here.get(song.id) === 'here' }));
    },
  }) : null;
  // requests join the current recipe through the mix routes above, so they need the store too
  const requests = sources.recipes && sources.workspaceId
    ? requestsFamily({ cloud, workspaceId: sources.workspaceId, rooms: sources.rooms, controller: sources.controller ? linkNow : undefined, holders: sources.holders ? holdersNow : undefined, songs: playable, send: (<T,>(path: string, init?: RequestInit) => adapted<T>(path, init)) as Request })
    : null;
  // Word connections (discover.word_links): answers nothing while that flag is off
  const links = linksFamily(cloud, sources.recipes, playable);
  // T-20261126-ed4c: the Desktop's song search, and measuring first or paused on this device
  const library = libraryFamily({
    rows: async () => { const list = await songs(); const known = await availability(list); return list.map((song) => asLibrarySong(song, known)); },
    measuring: () => flagListed('cloud.browser_harmonic'),
  });
  // T-20261126-96d3: a mix saved as a file on this device, with the transitions playback plays
  const exports = sources.workspaceId ? exportFamily({
    workspaceId: sources.workspaceId,
    cloud,
    studio: exportStudio(sources.workspaceId, cloud),
    mix: (draft) => adapted<MixData>(draft === null ? '/mix' : `/mix?draft=${draft}`),
  }) : null;
  // T-20261126-827e: the Seam Inspector's reads, from the transitions this device made
  const adapted = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const [route, query = ''] = path.split('?');
    const workspaceId = sources.workspaceId;
    const exportAnswer = exports?.answer(method, route, new URLSearchParams(query), init);
    if (exportAnswer) return (await exportAnswer) as T;
    // T-20261126-bfec: the mix's rows carry each song's tempo, key and energy from the account
    if (workspaceId && method === 'GET' && route === '/mix') {
      const mix = withMeasured(await answered<MixData>(path, init), await factsNow());
      return (inspectorOn() ? withInspection(mix, workspaceId, cloud) : mix) as Promise<T>;
    }
    if (!workspaceId || !inspectorOn()) return answered<T>(path, init);
    const seamAt = /^\/mix\/(\d+)\/(options|render)$/.exec(route);
    if (seamAt && method === 'GET' && seamAt[2] === 'options') return seamOptions() as T;
    if (seamAt && method === 'POST' && seamAt[2] === 'render') {
      const mix = await answered<MixData>(query ? `/mix?${query}` : '/mix');
      return askToMake(workspaceId, mix, Number(seamAt[1])) as Promise<T>;
    }
    return answered<T>(path, init);
  };
  const answered = async <T,>(path: string, init?: RequestInit): Promise<T> => {
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
    // ADR-0475 I84: another device is playing, so a song added from the Library joins its
    // programme (next, or at the end), the same signed press a request uses
    const link = sources.controller?.() ?? null;
    if (link && method === 'POST' && route === '/mix/songs') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { song_id?: number; song_ids?: number[]; position?: number };
      const songId = Number(body.song_id ?? body.song_ids?.[0]);
      // I88: several chosen songs go in at once, in order, those the speaker has (the bar said so)
      const many = (body.song_ids ?? []).map(Number).filter((id) => speakerHolds(link, id));
      if (!many.length && !speakerHolds(link, songId)) {
        // I85: on another open device, so offer to move the music there, never a refusal
        const device = holdersNow()?.(songId).online.find((name) => name !== link.speakerName);
        if (!device) throw new ApiError(notOnSpeaker(link.speakerName), 409, 'not_on_speaker');
        const title = (await songs()).find((one) => one.id === songId)?.title ?? 'This song';
        window.dispatchEvent(new CustomEvent<MoveOffer>(MOVE_OFFER_EVENT, { detail: { songId, title, device, speaker: link.speakerName, programme: link.programme.slice(Math.max(0, link.songIndex)) } }));
        throw new ApiError(`${title} is on ${device}.`, 409, 'move_offered');
      }
      const next = Number.isInteger(body.position) && Number(body.position) <= link.songIndex + 1;
      const order = [...link.programme];
      order.splice(next ? link.songIndex + 1 : order.length, 0, ...(many.length ? many : [songId]));
      if (!(await link.send('set_programme', { songs: order, song_index: link.songIndex, keep_position: true }))) throw new ApiError(`${link.speakerName} didn’t take that. Try again.`, 409, 'speaker_refused');
      const list = await songs();
      return { name: '', can_undo: false, mix: order.map((id, position) => {
        const found = list.find((one) => one.id === id);
        return { position, song_id: id, artist: found?.artist ?? '', title: found?.title ?? 'A song', duration: found?.duration_s ?? 0, bpm: null, key: null, locked: false, seam: null };
      }) } as T;
    }
    const libraryAnswer = library.answer(method, route, new URLSearchParams(query), init);
    if (libraryAnswer) return (await libraryAnswer) as T;
    const requestAnswer = requests?.answer(method, route, new URLSearchParams(query), init);
    if (requestAnswer) return (await requestAnswer) as T;
    // a song added here must play on this device, as the browser's own mixes ask
    const addsHere = method === 'POST' && route === '/mix/songs';
    const accountAnswer = addsHere ? undefined : account.answer(method, route, query, init);
    if (accountAnswer) {
      try {
        return (await accountAnswer) as T;
      } catch (problem) {
        if (!fallsBack(problem)) throw problem;
      }
    } else if (addsHere && sources.recipes) {
      const added = await addPlayable(init);
      if (added !== undefined) return added as T;
    }
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
    // ADR-0478: covers and details from SelectaDJ's own catalogue (and "Wrong cover?") are the
    // server's, gated there by library.art_lookup and the account's own lookup setting
    if (route.startsWith('/catalog/')) return cloud<T>(path, init);
    // ADR-0479: a Good or Bad on a transition the account knows, and every one given, are the
    // account's (cloud.brain; the server says when it is off)
    if ((method === 'POST' && /^\/seams\/[0-9A-Za-z_-]+\/rate$/.test(route)) || (method === 'GET' && route === '/memory/ratings')) {
      if (method === 'POST') forgetRatings();
      return cloud<T>(path, init);
    }
    const corrected = correct(method, route, init);
    if (corrected) return (await corrected) as T;
    const neverAnswer = setNever(method, route, init);
    if (neverAnswer) return (await neverAnswer) as T;
    throw onlyInTheApp(path);
  };
  /** POST /mix/songs through the account (cloud.account_mixes): the song must be one this
   * device can play, as the browser's own mixes ask. Undefined when the account doesn't answer. */
  const addPlayable = async (init?: RequestInit): Promise<unknown> => {
    if (!accountMixesOn()) return undefined;
    const body = JSON.parse(String(init?.body ?? '{}')) as { song_id?: number };
    const song = (await playable()).find((one) => one.id === Number(body.song_id));
    if (!song || !song.playable) throw new ApiError('Choose a song that plays on this device.', 400, 'not_playable', 'device-music:mix');
    try {
      return await account.answer('POST', '/mix/songs', '', init);
    } catch (problem) {
      if (!fallsBack(problem)) throw problem;
      return undefined;
    }
  };
  /** Song details' tempo and key correction (`/songs/{id}/correct`), kept with the account's
   * measurements (`PUT` or `DELETE /song-facts/{id}/correction`), and Is it music?: the
   * member's set-aside mark, `is_music` alone on the same route (null clears it). */
  const correct = (method: string, route: string, init?: RequestInit): Promise<unknown> | undefined => {
    const asked = method === 'POST' ? route.match(/^\/songs\/(\d+)\/correct$/) : null;
    if (!asked || !sources.workspaceId || !sendingOn()) return undefined;
    const songId = Number(asked[1]);
    const workspaceId = sources.workspaceId;
    const body = JSON.parse(String(init?.body ?? '{}')) as { bpm?: number; camelot?: string; is_music?: boolean; clear?: string[] };
    if (typeof body.is_music === 'boolean' || body.clear?.includes('is_music')) {
      // a browser never decides by itself, so true and "decide again" both clear the mark
      const mark = body.is_music === false ? false : null;
      return (async () => {
        await cloud(`/song-facts/${songId}/correction`, { method: 'PUT', body: JSON.stringify({ is_music: mark }) });
        catalogue = null;
        return { redone: 0 };
      })();
    }
    const bpm = typeof body.bpm === 'number' ? body.bpm : null;
    const camelot = typeof body.camelot === 'string' && body.camelot ? body.camelot : null;
    return (async () => {
      if (bpm === null && camelot === null) await cloud(`/song-facts/${songId}/correction`, { method: 'DELETE' });
      else await cloud(`/song-facts/${songId}/correction`, { method: 'PUT', body: JSON.stringify({ bpm, camelot }) });
      noteCorrection(workspaceId, songId, bpm, camelot);
      // the account remakes nothing here: the next mix plans with the new tempo and key
      return { redone: 0 };
    })();
  };
  /** "Never play" from the Library's row toggle (`/songs/{id}/never`) and its batch actions
   * (`/library/batch`, never and allow), kept for the account (ADR-0475). Priority is an analysis
   * setting for the app's own analysis queue, so those batch actions are the app's alone. */
  const setNever = (method: string, route: string, init?: RequestInit): Promise<unknown> | undefined => {
    if (method !== 'POST') return undefined;
    const write = async (never: boolean, entries: { id: number; expected: boolean }[]) => {
      catalogue = null;
      await cloud('/local-media/songs/never', { method: 'POST', body: JSON.stringify({ never, entries }) });
      catalogue = null;
      return {};
    };
    // "Never play" is about the song: every version of it is set, each with what it was
    const everyVersion = async (entries: { id: number; expected: boolean }[]) => {
      const grouping = await grouped();
      const rawNever = new Map(grouping.files.map((file) => [file.id, file.never === true]));
      return entries.flatMap((entry) => {
        const ids = grouping.versionsOf(entry.id);
        // one file: what the page showed; several: each file's own mark (the row shows the song's)
        return ids.length === 1 ? [entry] : ids.map((id) => ({ id, expected: rawNever.get(id) === true }));
      });
    };
    const toggle = route.match(/^\/songs\/(\d+)\/never$/);
    if (toggle) {
      const id = Number(toggle[1]);
      return (async () => {
        const current = (await songs()).find((song) => song.id === id)?.never === true;
        const entries = await everyVersion([{ id, expected: current }]);
        return write(!current, entries);
      })();
    }
    if (route !== '/library/batch') return undefined;
    const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string; entries?: { id: number; expected: unknown }[] };
    if (body.action !== 'never' && body.action !== 'allow') return undefined;
    return everyVersion((body.entries ?? []).map((entry) => ({ id: entry.id, expected: entry.expected === true })))
      .then((entries) => write(body.action === 'never', entries));
  };
  // cloud.catalogue_play: a song's upload found from its versions' rows, never this device's files
  const cloudAssetOf = async (songId: number): Promise<string | null> => {
    if (!sources.cloudCopy) return null;
    const grouping = await grouped();
    const ids = grouping.versionsOf(songId);
    const rows = ids.flatMap((id) => grouping.files.filter((file) => file.id === id));
    return rows.length ? sources.cloudCopy(rows, grouping.files) : null;
  };
  // every file of each song with a cloud copy, so a mix naming any version is matched; and how
  // many songs that is
  const cloudSongs = async (): Promise<CloudSongs> => {
    const grouping = await grouped();
    const hosted = setBySong(grouping, (await sources.hosted?.(grouping.files).catch(() => null)) ?? new Set());
    return { ids: new Set(grouping.files.filter((file) => hosted.has(grouping.primaryOf(file.id))).map((file) => file.id)), songs: hosted.size };
  };
  return Object.assign(adapted as Request, { cloudAssetOf, cloudSongs });
}

/** The media importer asks with full `/api/...` paths (web/src/media); the Cloud client adds
 * `/api` itself, so strip it here rather than in the importer. */
export function mediaRequest(cloud: Request): Request {
  return (<T,>(path: string, init?: RequestInit) => cloud<T>(path.replace(/^\/api(?=\/)/, ''), init)) as Request;
}
