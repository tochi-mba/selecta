import { useCallback, useMemo, useRef, type MutableRefObject } from 'react';
import type { MixData, Request } from '../api';
import type { FlagId } from '../flags';
import { makeCoexistingResolver, makeResolver, reportDeviceAvailability, type LapsedWhy, type MediaResolver, type MediaStore, type SourceBook } from '../media';
import type { ControllerLink, WhereHeld } from '../devices/controller';
import type { Api } from './api';
import { registeredDeviceId } from './ConnectMusic';
import { cloudLibraryAssets, cloudLibraryResolver, matchAsset } from './cloudLibraryMedia';
import { deviceMusicRequest, mediaRequest, type AvailabilitySources } from './deviceMusicRequest';
import type { RecipeStore } from './recipeStore';
import { profilesBySong, type TonalStore } from './tonalProfiles';
import { withVersions } from './songVersions';

/** Where CloudShell's songs can play from, and the resolver that plays them (ADR-0465, ADR-0469):
 * the availability sources the request adapter reads, the adapted request itself, and the device
 * first, hosted fallback resolver. Kept out of CloudShell.tsx so the shell stays under the cap. */
export function useCloudShellMedia({ api, cloud, workspaceId, on, coexisting, openStore, lapsed, refreshStatus, recipes, browserHarmonic, tonal, offlineShell, roomsHere, onServed, book }: {
  api: Api;
  cloud: Request;
  workspaceId: string;
  on: (id: FlagId) => boolean;
  /** a grandfathered account with stored media readable gets the hosted path */
  coexisting: boolean;
  openStore: () => Promise<MediaStore>;
  /** the sweep's lapsed map: files gone, changed or waiting for permission */
  lapsed: MutableRefObject<Map<number, LapsedWhy>>;
  refreshStatus: MutableRefObject<(() => void) | null>;
  recipes: RecipeStore;
  browserHarmonic: boolean;
  tonal: TonalStore;
  offlineShell: boolean;
  roomsHere: boolean;
  /** told whether the library shown came from the server or this device's kept copy */
  onServed: (from: { at: number | null } | null) => void;
  book: SourceBook;
}) {
  // ADR-0475: the device that is playing when it is not this one, for the request adapter. Set
  // by the shell each render, once the session is known; read by the adapter at each press.
  const controllerLink = useRef<ControllerLink | null>(null);
  const whereHeld = useRef<WhereHeld | null>(null);
  // ADR-0475 R8: songs the device R1 would choose holds now, which a mix made here may use
  const mixableIds = useRef<ReadonlySet<number> | null>(null);
  const sources = useMemo<AvailabilitySources>(() => ({
    controller: () => controllerLink.current,
    holders: () => whereHeld.current,
    mixable: () => mixableIds.current,
    here: async () => {
      const opened = await openStore();
      const found = new Map<number, 'here' | 'reauth' | 'reconnect'>();
      for (const song of await opened.all()) {
        const why = lapsed.current.get(song.songId);
        // a file the sweep found gone is not on this device; a lapsed permission asks again;
        // a song picked without a durable handle plays only while this visit holds its file
        if (why === 'missing' || why === 'changed' || song.availabilityIssue === 'changed') continue;
        if (song.ref.kind !== 'handle' && !opened.sessionFile(song.songId)) {
          found.set(song.songId, 'reconnect');
          continue;
        }
        found.set(song.songId, why === 'permission' ? 'reauth' : 'here');
      }
      return found;
    },
    hosted: coexisting ? async (songs) => {
      const listing = cloudLibraryAssets(api, workspaceId); // read again after an upload (cloudLibraryMedia.ts)
      const assets = await listing;
      return new Set(songs.filter((song) => matchAsset({ song_id: song.id, title: song.title, artist: song.artist }, song.content_sha256 ?? null, assets)).map((song) => song.id));
    } : undefined,
    // Make a Mix and My Mixes: recipes on the server, this browser's current mix and shaping here
    recipes,
    // Harmonic matches: answered from the profiles this browser measured, answers kept here
    tonal: browserHarmonic ? {
      profiles: async () => profilesBySong(tonal, await openStore()),
      reviews: () => tonal.reviews(),
      review: (pair, verdict) => tonal.review(pair, verdict),
    } : undefined,
    // Request a song: this browser's requests per workspace, and the room's from the server
    workspaceId,
    // an account without Rooms (off, or locked to a plan) never asks for a room's requests
    rooms: roomsHere,
    // cloud.offline_shell: the last catalogue is kept here and served, with this device's own
    // songs, while SelectaDJ cannot be reached; the banner says the library is from this device
    offline: offlineShell ? {
      deviceSongs: async () => (await (await openStore()).all()).map((song) => ({
        id: song.songId, content_sha256: song.identity.content_sha256, title: song.identity.title, artist: song.identity.artist,
        album: song.identity.album ?? null, duration_s: song.identity.duration_s ?? null, available_on: 1,
      })),
      onServed: (from) => onServed(from.cached ? { at: from.at } : null),
    } : undefined,
  }), [api, cloud, workspaceId, coexisting, openStore, recipes, browserHarmonic, tonal, offlineShell, roomsHere]);
  const request = useMemo(() => deviceMusicRequest(cloud, sources), [cloud, sources]);
  // imports register through the adapted request, so each landed batch reads a fresh catalogue
  const media = useMemo(() => mediaRequest(request), [request]);
  const programme = useRef<MixData['mix']>([]);
  const resolving = useRef<Promise<MediaResolver> | null>(null);
  const resolverFor = useRef<string | null>(null);
  const resolver = useCallback(async () => {
    if (resolverFor.current !== workspaceId) { resolverFor.current = workspaceId; resolving.current = null; }
    return (resolving.current ??= openStore().then((opened) => makeCoexistingResolver({
    // any version of the song this device holds plays it (ADR-0469 amendment 2)
    device: withVersions(makeResolver(opened, undefined, (songId, present, why) => {
      if (present) lapsed.current.delete(songId);
      else lapsed.current.set(songId, why ?? 'missing');
      refreshStatus.current?.();
      const reportingDevice = registeredDeviceId(workspaceId);
      if (on('cloud.local_media') && reportingDevice) {
        const snapshot = present ? { present: [songId], absent: [] } : { present: [], absent: [songId] };
        void reportDeviceAvailability(media, reportingDevice, snapshot).then(() => {
          refreshStatus.current?.();
        }).catch(() => undefined);
      }
    }, { sharedCache: on('cloud.content_cache') }), workspaceId),
    hosted: coexisting ? cloudLibraryResolver(api, workspaceId, {
      songs: () => programme.current,
      shaOf: async (songId) => (await opened.get(songId))?.identity.content_sha256 ?? null,
    }) : null,
    book,
  })));
  }, [openStore, coexisting, api, workspaceId, book, media, on]);
  return { sources, request, media, resolver, programme, controllerLink, whereHeld, mixableIds };
}
