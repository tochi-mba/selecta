import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MixData, Request, Status } from '../api';
import { setFlags, useFlags } from '../flags';
import { findLapsed, makeCoexistingResolver, makeResolver, makeSourceBook, MediaStore, reportDeviceAvailability, deviceAvailabilitySnapshot, type LapsedWhy, type MediaResolver } from '../media';
import type { NowState } from '../player';
import { BytesContext, noBytesHere, RequestContext } from '../requestContext';
import { navigate, parseRoute, useLocationText } from '../router';
import { describeRoute, destinationOf, DESTINATIONS, destinationsFor, moreDestinationsFor, moreRouteOf, type MoreDestinationId, type ShellRoute } from '../shell/manifest';
import { Shell } from '../shell/Shell';
import { useMediaKeys } from '../shell/useMediaKeys';
import { ControllerNotices } from '../devices/ControllerNotices';
import { setJobsSource } from '../state/jobs';
import { Drawer, Section, Skeleton } from '../ui/controls';
import { countOf } from '../ui/format';
import { showToast } from '../ui/toasts';
import { Links } from '../views/Links';
import { Mix } from '../views/Mix';
import { PlayedTransitions, StemSurfacesContext } from '../views/liveTransitions';
import { StemsCard } from './stems/StemsCard';
import { useSplitterNotices } from './stems/useStems';
import { useStemsEngine } from './stems/useStemsEngine';
import { playedByPair } from './playedSeams';
import { peaksFrom } from '../dsp/waveform';
import { Mixes } from '../views/Mixes';
import { MyMixes } from '../views/MyMixes';
import { Now } from '../views/Now';
import { RequestsContext, RequestsPanel, useRequests, type RequestRow } from '../views/Requests';
import type { View, ViewProps } from '../views/shared';
import type { Account, Api } from './api';
import { planName } from './api';
import { ConnectMusic, registeredDeviceId } from './ConnectMusic';
import { hostedResolver, matchAsset, readHostedAssets, type HostedAsset } from './hostedMedia';
import { isHostedAccount } from './localFirstGate';
import { CloudLibrary } from './CloudLibrary';
import { CloudWorkspace } from './CloudWorkspace';
import { CurrentMix } from '../views/CurrentMix';
import { CannotPlayHere, ListenEmpty, MixesEmpty, NotOnThisAccount, OnlyOnYourComputer, PageNotFound } from './LocalFirstEmpty';
import { useLocalFirstPlayer } from './localFirstPlayer';
import { BROWSER_MIX_NEEDS } from './localFirstMixes';
import { EMPTY_MIX, localFirstRequest, mediaRequest, readCatalogue, type AvailabilitySources } from './localFirstRequest';
import { RemoteListen } from '../devices/RemoteListen';
import { useRemote } from '../devices/useRemote';
import { bestHolder, HolderContext, musicHolder, whereHeldFrom, type WhereHeld, programmeTurn, type ControllerLink, type MusicHolder } from '../devices/controller';
import { useHoldings } from '../devices/useHoldings';
import { ControllerListen } from '../devices/ControllerListen';
import { soundAllowedHere, usePlayOn, type StartAsk, type StartResult } from '../devices/playOn';
import { ROOM_REQUEST_EVENT } from './localFirstRequests';
import { addable, askWords, roomLine, useRoomLive, useRoomSession, waitingCount, ROOM_EVENT, type AskKind, type RoomAsk } from '../rooms/useRoomSession';
import { recipeStore } from './recipeStore';
import { SavedBrowserMixes } from './SavedBrowserMixes';
import { SoundCheck } from './SoundCheck';
import { QueueSources } from './QueueSources';
import { ListenQueue } from './ListenQueue';
import { NOTHING_PLAYABLE_NOTICE } from '../engine/scheduler';
import { runningTime } from '../lib';
import { CutoverNotice } from './migration/CutoverNotice';
import { OnboardingSpine } from './onboarding/OnboardingSpine';
import { browserStorage, onboardingFinished, onboardingPutOff, recordImportOutcome } from './onboarding/state';
import { ImportChip } from './ImportChip';
import { StorageCard } from './StorageCard';
import { bindImportWorkspace, endImportSession, useImportSession } from './importSession';
import { importRunnerFor, useImportCarryOn } from './importResume';
import { useServerFreeControls } from './serverFreeControls';
import { BrowserHarmonicMatches } from './BrowserHarmonicMatches';
import { profilesBySong, startTonalProfiler, tonalStore } from './tonalProfiles';
import { onReconnect } from './connection';
import { ConnectionBanner } from './ConnectionBanner';
import { plainMessage } from './resilientRequest';
import { useAccountMix } from './useAccountMix';

/** Local-first personal Cloud on the shared shell (ADR-0462, ADR-0463).
 *
 * The same Shell, manifest, router and views as local mode: Listen, Make a Mix, My Mixes and
 * Library, with Cloud's own surfaces in More. Views ask through the adapted, authenticated request
 * (localFirstRequest.ts); the player is the browser engine through the playback session
 * (localFirstPlayer.ts). CloudApp mounts this only when the account has the local-first experience
 * and `cloud.local_first` is on; otherwise the hosted pages render exactly as before.
 */

/** Shell features served by this computer's own server and not by the browser runtime yet. The
 * shell reads them through the one flag read, so their buttons are gone rather than dead. The
 * command palette and the keyboard shortcuts stay: this shell offers their server-free subset
 * (serverFreeControls.tsx), which needs nothing but this browser and its own player. */
export const NOT_IN_THE_BROWSER = {
  // Request a song is here (localFirstRequests.ts): a request joins only when the member adds it,
  // right after the playing song. Bridge songs need measured keys and tempos, which a browser
  // library has none of.
  'requests.bridges': false,
  // The editor is here (reorder, add, remove, clear, Save a copy, through the recipe store).
  // What it can't do in a browser: lock songs to analysed positions, draw an energy horizon
  // from measurements, or open a transition to re-render it (every one is worked out live).
  'editor.energy_horizon': false,
  'editor.locks': false,
  seam_inspector: false,
  'app.activity': false,
  export: false,
  lucy: false,
  // lyrics are looked up by this computer's own server; the browser has none to show or require
  'lyrics.lookup': false,
  // Harmonic matches are here with cloud.browser_harmonic (BrowserHarmonicMatches.tsx), from
  // whole-song key profiles measured on this device; without it the tab is off (browserFlags)
  // tempo and key corrections and "is it music?" are written to this computer's own analysis
  'library.corrections': false,
  // a browser mix has no measured feel, energy or stems to shape by; its ending can be chosen
  'mixes.shaping.feel': false,
  'mixes.shaping.energy_arc': false,
  'mixes.shaping.stem_moves': false,
} as const;

/** What this shell turns off, with Harmonic matches off too unless the browser's own version
 * (cloud.browser_harmonic) is on for the account. */
function browserFlags(browserHarmonic: boolean): Record<string, boolean> {
  return browserHarmonic ? { ...NOT_IN_THE_BROWSER } : { ...NOT_IN_THE_BROWSER, 'discover.harmonic': false };
}

const VIEW_PATHS: Record<View, string> = { Mixes: '/mixes', Now: '/listen', Edit: '/mix/current/edit', Library: '/library', Words: '/discover', Workshop: '/workshop' };
const IDLE = (): void => {};
const NO_SONGS: readonly number[] = [];
const NOT_THIS_MIX = (): void => {};
/** The account's most recently saved mix, or null when there is none (or it cannot be read). */
async function newestMix(recipes: { list: () => Promise<{ mix_id: string; name: string; songs: number; updated_at: number }[]> }): Promise<{ mix_id: string; name: string; songs: number } | null> {
  const all = await recipes.list().catch(() => []);
  return [...all].sort((one, other) => other.updated_at - one.updated_at)[0] ?? null;
}
/** How long the speaker waits before telling the session its programme again after a refusal. */
const PUBLISH_RETRY_MS = 10_000;
const AVAILABILITY_REFRESH_MS = 12 * 60 * 60 * 1000;

export function LocalFirstShell({ api, account, more, notices, feedback, onSignOut, offlineReadOnly = false }: {
  api: Api;
  account: Account;
  /** The account panel for a More destination, drawn by CloudApp with its own handlers. */
  more: (id: MoreDestinationId) => ReactNode;
  /** The account's notices (suspended, account problem, over quota, paused live updates), drawn
   * by CloudApp from the same sources as the hosted frame, shown first in the banner. */
  notices?: ReactNode;
  feedback?: ReactNode;
  /** Sign out of this device, from the side bar's account menu. */
  onSignOut?: () => void;
  /** cloud.offline_shell: opened offline from the account this device last saw, before AuthKit
   * could sign in again. The banner says so; server-only actions wait with their reason. */
  offlineReadOnly?: boolean;
}) {
  const workspaceId = account.workspace.id;
  const on = useFlags();
  const cloud = useCallback(<T,>(path: string, init?: RequestInit) => api<T>(path, init, workspaceId), [api, workspaceId]) as Request;
  // One song index per workspace (ADR-0469): a different account in this browser opens its own.
  const store = useRef<{ workspaceId: string; opened: Promise<MediaStore> } | null>(null);
  const openStore = useCallback(() => {
    if (store.current?.workspaceId !== workspaceId) store.current = { workspaceId, opened: MediaStore.open(workspaceId) };
    return store.current.opened;
  }, [workspaceId]);
  const resolving = useRef<Promise<MediaResolver> | null>(null);
  // Device first, hosted fallback (ADR-0465): only a grandfathered account with stored media
  // readable gets the hosted path; every answer lands in the source book the queue shows.
  const book = useMemo(() => makeSourceBook(), []);
  const coexisting = isHostedAccount(account) && on('cloud.stored_media');
  const hostedCopies = useRef<Promise<HostedAsset[]> | null>(null);
  // BF-0462-04: the Library says where each song can play from, against this device's own
  // connected files and, for a grandfathered account, its hosted copies
  // Probing every handle means opening every file, which at thousands of songs cannot happen
  // inside each /status read. One sweep owns the lapsed map; reads stay cheap, and a file that
  // lapsed between sweeps fails honestly at play time with its notice.
  const lapsed = useRef(new Map<number, LapsedWhy>());
  const refreshStatusRef = useRef<(() => void) | null>(null);
  // The sweep is declared before the media request exists; it reads the request at run time.
  const mediaRef = useRef<ReturnType<typeof mediaRequest> | null>(null);
  const sweeping = useRef<Promise<void> | null>(null);
  const lastAvailabilitySweep = useRef(0);
  const lastAvailabilityReport = useRef(0);
  const forceSweepPending = useRef(false);
  // what Workspace says about the sweep: running now, and when it last looked at the files
  const [fileCheck, setFileCheck] = useState<{ running: boolean; at: number | null }>({ running: false, at: null });
  const sweepLapsed = useCallback((forceReport = false): Promise<void> => {
    if (forceReport) forceSweepPending.current = true;
    if (sweeping.current) return sweeping.current;

    const task = (async () => {
      setFileCheck((was) => ({ ...was, running: true }));
      try {
        do {
          const force = forceSweepPending.current;
          forceSweepPending.current = false;
          const now = Date.now();
          const scanDue = now - lastAvailabilitySweep.current >= AVAILABILITY_REFRESH_MS;
          const reportDue = now - lastAvailabilityReport.current >= AVAILABILITY_REFRESH_MS;
          if (!force && !scanDue && (!on('cloud.local_media') || !reportDue)) break;

          const opened = await openStore();
          // A normal focus does no scan until the cadence is due. The player independently
          // verifies exact bytes when asked to play, so this sweep is for permission and
          // availability reconciliation rather than a per-focus safety check.
          const lapsedItems = await findLapsed(opened, { force: force || scanDue });
          lapsed.current = new Map(lapsedItems.map((item) => [item.songId, item.why] as const));
          if (force || scanDue) lastAvailabilitySweep.current = Date.now();

          // Catalogue availability is a time-bounded device observation (30-day server TTL).
          // Send a complete snapshot on startup and at most twice a day while active. The
          // report contains only catalogue ids and the same profile id used for playback-device
          // auth; no filename, handle, tag or audio bytes leave this browser.
          const reportingDevice = registeredDeviceId(workspaceId);
          if (on('cloud.local_media') && reportingDevice) {
            const snapshot = await deviceAvailabilitySnapshot(opened, lapsedItems);
            try {
              if (!mediaRef.current) throw new Error('not ready');
              await reportDeviceAvailability(mediaRef.current, reportingDevice, snapshot, true);
              lastAvailabilityReport.current = Date.now();
            } catch {
              // A transient auth/network failure leaves the report clock due, so the next
              // foreground event retries the same cached scan without reopening every file.
            }
          }
          refreshStatusRef.current?.();
        } while (forceSweepPending.current);
      } finally {
        sweeping.current = null;
        setFileCheck({ running: false, at: lastAvailabilitySweep.current || null });
        // A force arriving at the very end of the active pass must not be dropped.
        if (forceSweepPending.current) void sweepLapsed();
      }
    })();
    sweeping.current = task;
    return task;
  }, [on, openStore, workspaceId]);
  const recipes = useMemo(() => recipeStore(cloud, workspaceId), [cloud, workspaceId]);
  // How many mixes the account has saved, from the server: a mix made on another device means
  // Make a Mix is past its first run here too, and Workspace counts them. null until it answers.
  const [savedMixes, setSavedMixes] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setSavedMixes(null);
    recipes.list().then((list) => { if (live) setSavedMixes(list.length); }).catch(() => undefined);
    return () => { live = false; };
  }, [recipes]);
  // Harmonic matches (cloud.browser_harmonic): key profiles measured here, kept in this browser
  const browserHarmonic = on('cloud.browser_harmonic');
  const offlineShell = on('cloud.offline_shell');
  // where the library shown came from: null from the server, or this device's kept copy
  const [servedFrom, setServedFrom] = useState<{ at: number | null } | null>(null);
  const tonal = useMemo(() => tonalStore(workspaceId), [workspaceId]);
  const roomsHere = on('rooms') && !account.feature_locks.rooms;
  // ADR-0475: the device that is playing when it is not this one, for the request adapter. Set
  // further down each render, once the session is known; read by the adapter at each press.
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
      const listing = (hostedCopies.current ??= readHostedAssets(api, workspaceId).catch((problem) => { hostedCopies.current = null; throw problem; }));
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
      onServed: (from) => setServedFrom(from.cached ? { at: from.at } : null),
    } : undefined,
  }), [api, cloud, workspaceId, coexisting, openStore, recipes, browserHarmonic, tonal, offlineShell, roomsHere]);
  const request = useMemo(() => localFirstRequest(cloud, sources), [cloud, sources]);
  // imports register through the adapted request, so each landed batch reads a fresh catalogue
  const media = useMemo(() => mediaRequest(request), [request]);
  mediaRef.current = media;
  const programme = useRef<MixData['mix']>([]);
  const resolverFor = useRef<string | null>(null);
  const resolver = useCallback(async () => {
    if (resolverFor.current !== workspaceId) { resolverFor.current = workspaceId; resolving.current = null; }
    return (resolving.current ??= openStore().then((opened) => makeCoexistingResolver({
    device: makeResolver(opened, undefined, (songId, present, why) => {
      if (present) lapsed.current.delete(songId);
      else lapsed.current.set(songId, why ?? 'missing');
      refreshStatusRef.current?.();
      const reportingDevice = registeredDeviceId(workspaceId);
      if (on('cloud.local_media') && reportingDevice) {
        const snapshot = present ? { present: [songId], absent: [] } : { present: [], absent: [songId] };
        void reportDeviceAvailability(media, reportingDevice, snapshot).then(() => {
          refreshStatusRef.current?.();
        }).catch(() => undefined);
      }
    }, { sharedCache: on('cloud.content_cache') }),
    hosted: coexisting ? hostedResolver(api, workspaceId, {
      songs: () => programme.current,
      shaOf: async (songId) => (await opened.get(songId))?.identity.content_sha256 ?? null,
    }) : null,
    book,
  })));
  }, [openStore, coexisting, api, workspaceId, book, media, on]);

  const [status, setStatus] = useState<Status | null>(null);
  const [statusProblem, setStatusProblem] = useState('');
  const [data, setData] = useState<MixData>(EMPTY_MIX);
  programme.current = data.mix;
  const refreshStatus = useCallback(() => {
    request<Status>('/status')
      .then((next) => { setStatus(next); setStatusProblem(''); })
      .catch((error: Error) => setStatusProblem(offlineShell ? plainMessage(error) : error.message));
  }, [request, offlineShell]);
  // cloud.offline_shell: a mix that could not be read says so with a retry, never an empty mix
  const [mixProblem, setMixProblem] = useState(false);
  const refreshMix = useCallback(() => {
    request<MixData>('/mix').then((next) => { setData(next); setMixProblem(false); }).catch(() => { if (offlineShell) setMixProblem(true); });
  }, [request, offlineShell]);
  // back online: read the library and the mix again
  useEffect(() => (offlineShell ? onReconnect(() => { refreshStatus(); refreshMix(); }) : undefined), [offlineShell, refreshStatus, refreshMix]);
  refreshStatusRef.current = refreshStatus;
  useEffect(() => { refreshStatus(); refreshMix(); void sweepLapsed(true); }, [refreshStatus, refreshMix, sweepLapsed]);
  useEffect(() => {
    const refreshWhenActive = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void sweepLapsed();
    };
    const timer = window.setInterval(refreshWhenActive, AVAILABILITY_REFRESH_MS);
    window.addEventListener('focus', refreshWhenActive);
    document.addEventListener('visibilitychange', refreshWhenActive);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWhenActive);
      document.removeEventListener('visibilitychange', refreshWhenActive);
    };
  }, [sweepLapsed]);

  // The import session outlives any one page: each landed batch refreshes the counts, and a
  // finished import records its outcome in the onboarding state even with the spine gone.
  useEffect(() => { bindImportWorkspace(workspaceId); }, [workspaceId]);
  const importLive = useImportSession(workspaceId);
  const lastBatches = useRef(importLive.batches);
  useEffect(() => {
    const moved = importLive.batches !== lastBatches.current;
    lastBatches.current = importLive.batches;
    const ended = (importLive.phase === 'finished' || importLive.phase === 'paused') && importLive.summary !== null;
    if (ended) {
      recordImportOutcome(browserStorage(), workspaceId, importLive.summary!);
      void sweepLapsed();
    }
    if (moved || ended) refreshStatus();
  }, [importLive.batches, importLive.phase, importLive.summary, refreshStatus, sweepLapsed, workspaceId]);
  // Leaving the shell ends the import and forgets its snapshot (ADR-0469): a different account
  // signing in to this tab starts from idle, never from the last account's summary.
  useEffect(() => () => endImportSession(), []);

  // This shell has no local server: the shell's job badge and the local-only buttons stand down
  // while it is open, and come back exactly as they were when it closes.
  // Before any child subscribes to jobs (children's effects run first): this shell has no jobs server.
  useState(() => setJobsSource(false));
  useEffect(() => {
    setJobsSource(false);
    setFlags(browserFlags(browserHarmonic));
    // Cloud has no jobs server at all, so the source stays off when this shell unmounts.
    return () => { setFlags(null); };
  }, [browserHarmonic]);

  // cloud.offline_playback: said once when playing offline ended because another device took over
  const [takeoverSeen, setTakeoverSeen] = useState('');
  const { player, refusal, device: playback, seams: scheduled, prefetch, output } = useLocalFirstPlayer({
    api, workspaceId, mix: data.mix, remoteControl: on('devices.remote_control'), resolver,
  });
  // what each transition really played on this device this visit, for the editor (cloud.browser_moves)
  const played = useMemo(() => (on('cloud.browser_moves') ? playedByPair(scheduled) : {}), [scheduled]);
  // the browser stem splitter (cloud.browser_stems): absent while the stem model's licence is held
  const songOrder = useMemo(() => data.mix.map((item) => item.song_id), [data.mix]);
  const stems = useStemsEngine({ role: playback.view?.speaker === 'elsewhere' ? 'controller' : 'speaker', programme: songOrder, prefetch });
  // devices.remote_control: a device that is not the speaker, and does not hold the mix that is
  // playing, steers it from Listen and the mini player (devices/useRemote.ts); null otherwise
  const loadRemoteSongs = useCallback(() => readCatalogue(cloud), [cloud]);
  // A device with none of its music chosen cannot follow the mix itself, even when the account's
  // current mix is the very one that is playing: it is a remote too.
  const followsHere = (status?.counts.ready ?? 0) > 0;
  // ADR-0475 R8: the current mix is the account's, so every device has the speaker's mix. A device
  // that is not the speaker steers it from the remote, whatever music it holds itself; before R8 a
  // device whose own mix was the programme showed the ordinary Listen, with a Play that played here.
  const remote = useRemote({ remoteControl: on('devices.remote_control'), device: playback, mixSongIds: NO_SONGS, loadSongs: loadRemoteSongs });
  // ADR-0475: what the speaker can open, so a request is judged by the device that will play it
  const [holderId, setHolderId] = useState<string | null>(null);
  const holdings = useHoldings(cloud, on('devices.remote_control'), remote ? playback.view?.speaker_device_id ?? null : holderId);
  // R4, R6: which of the person's other devices hold a song (this device is judged on its own)
  whereHeld.current = holdings.devices ? whereHeldFrom(holdings.devices, holdings.ids, [playback.device?.id ?? null]) : null;
  // ADR-0475 R6: the device to name as where the music is (the speaker, else the best holder)
  const holderDevice = holdings.devices ? musicHolder(holdings.devices, playback.device?.id ?? null, remote ? playback.view?.speaker_device_id ?? null : null) : null;
  useEffect(() => { setHolderId(holderDevice?.device_id ?? null); }, [holderDevice?.device_id]);
  const holderValue = useMemo<MusicHolder | null>(() => (holderDevice ? { deviceId: holderDevice.device_id, name: holderDevice.name, songs: holderDevice.songs, online: holderDevice.online, ids: holdings.speakerSongs, places: whereHeld.current } : null), [holderDevice?.device_id, holderDevice?.name, holderDevice?.songs, holderDevice?.online, holdings.speakerSongs, holdings.ids, holdings.devices]);
  const remoteProgramme = remote ? remote.session.programme.map((entry) => entry.song_id).join(',') : '';
  const remoteMix = useMemo<MixData['mix']>(() => (remoteProgramme ? remoteProgramme.split(',').map(Number).map((songId, position) => {
    const known = remote?.book.get(songId);
    return { position, song_id: songId, artist: known?.artist ?? '', title: known?.title ?? `Song ${position + 1}`, duration: (known?.duration_s ?? 0), bpm: null, key: null, locked: false, seam: null };
  }) : []), [remoteProgramme, remote?.book]);
  controllerLink.current = remote ? {
    speakerName: remote.view.speaker_name ?? 'the other device',
    online: remote.view.speaker === 'elsewhere',
    programme: remoteMix.map((item) => item.song_id),
    songIndex: remote.session.song_index,
    holds: holdings.speakerSongs,
    send: playback.send,
  } : null;
  useSplitterNotices(stems.store, (words) => showToast(words));
  const resolveTrack = useCallback<MediaResolver>(async (songId) => (await resolver())?.(songId) ?? null, [resolver]);
  // Harmonic matches read only this device's own files (never a hosted copy), to measure and to
  // preview: the music stays here. Measuring waits for spare time, one song at a time.
  const deviceResolving = useRef<{ workspaceId: string; made: Promise<MediaResolver> } | null>(null);
  const deviceTrack = useCallback<MediaResolver>(async (songId) => {
    if (deviceResolving.current?.workspaceId !== workspaceId) deviceResolving.current = { workspaceId, made: openStore().then((opened) => makeResolver(opened)) };
    return (await deviceResolving.current.made)(songId);
  }, [openStore, workspaceId]);
  const playingNow = useRef<() => boolean>(() => false);
  playingNow.current = () => player.state.phase === 'playing';
  useEffect(() => {
    if (!browserHarmonic) return undefined;
    return startTonalProfiler({ store: tonal, openMedia: openStore, resolve: deviceTrack, playing: () => playingNow.current() });
  }, [browserHarmonic, tonal, openStore, deviceTrack]);
  // Listen's strip: each song's waveform from its own file here, decoded once and kept for the visit
  const waveforms = useRef(new Map<number, Promise<number[] | null>>());
  const waveformOf = useCallback((songId: number) => {
    let made = waveforms.current.get(songId);
    if (!made) {
      made = (async () => {
        const track = await resolveTrack(songId);
        if (!track || typeof OfflineAudioContext === 'undefined') return null;
        const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await track.data());
        return peaksFrom(decoded);
      })().catch(() => null);
      waveforms.current.set(songId, made);
      // a song not readable yet (not connected this visit) is tried again next time
      void made.then((peaks) => { if (!peaks) waveforms.current.delete(songId); });
    }
    return made;
  }, [resolveTrack]);
  // Make a Mix sets the new mix and asks to play it in the same breath (local mode's player reads
  // the mix from its server). Here the engine learns the mix from the next render, so a play asked
  // for straight after a new mix waits for that render instead of playing the old one.
  const mixJustSet = useRef(false);
  const playWaiting = useRef<{ from: number; offset?: number; done: () => void } | null>(null);
  const setMixData = useCallback((next: MixData) => { mixJustSet.current = true; setData(next); }, []);
  useEffect(() => {
    mixJustSet.current = false;
    const waiting = playWaiting.current;
    if (!waiting) return;
    playWaiting.current = null;
    void player.playFrom(waiting.from, waiting.offset).finally(waiting.done);
  }, [data.mix, player]);
  // set each render below: what Play does when another device makes the sound; null plays here
  const soundElsewhere = useRef<(() => void) | null>(null);
  const hereOnPurpose = useRef(false);
  const shellPlayer = useMemo(() => new Proxy(player, {
    get(target, key) {
      if (key === 'playFrom') {
        return (from: number, offset?: number) => {
          // ADR-0475 R8: the sound is made on another device, so Play never starts it here
          const away = hereOnPurpose.current ? null : soundElsewhere.current;
          hereOnPurpose.current = false;
          if (away) { away(); return Promise.resolve(); }
          return mixJustSet.current
          ? new Promise<void>((done) => { playWaiting.current = { from, offset, done }; })
          : target.playFrom(from, offset);
        };
      }
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }), [player]);
  const [now, setNow] = useState<NowState>(player.state);
  // devices.remote_control: while this device is the speaker it tells the session which songs it
  // is playing, in order, whenever that changes (a new mix, a request added, a reorder). Without
  // this the session has no programme and another device has nothing to show or steer.
  const publishProgramme = playback.publishProgramme;
  const sessionNow = playback.view?.speaker === 'here' ? playback.view.session : null;
  const published = useRef({ key: '', at: 0 });
  const remoteControlOn = on('devices.remote_control');
  const audible = now.phase !== 'idle';
  const playingAt = now.position;
  // ADR-0475 R4: the order this device's mix and the session last agreed on. When the session's
  // programme then changes and this mix has not, another device changed what is coming up (a
  // request added from a phone): this device takes that into its mix and keeps playing. When
  // this mix changed, it is sent as before.
  const agreed = useRef<string | null>(null);
  const adopting = useRef(false);
  useEffect(() => {
    if (!remoteControlOn || !sessionNow || !audible || !songOrder.length) return;
    const theirs = (sessionNow.programme ?? []).map((entry) => entry.song_id);
    const turn = programmeTurn(songOrder, theirs, agreed.current);
    if (turn === 'agree') { agreed.current = songOrder.join(','); return; }
    if (turn === 'adopt') {
      // the song that is playing must stay where it is; anything else is not an add
      if (theirs[playingAt] !== songOrder[playingAt]) { agreed.current = null; return; }
      if (adopting.current) return;
      adopting.current = true;
      void request<MixData>('/mix/order', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-mix-order': songOrder.join(',') }, body: JSON.stringify({ song_ids: theirs }) })
        .then((changed) => { agreed.current = changed.mix.map((item) => item.song_id).join(','); setMixData(changed); })
        // a song this device cannot play: its own mix stands and is sent again
        .catch(() => { agreed.current = null; })
        .finally(() => { adopting.current = false; });
      return;
    }
    // one try per programme and ownership; again after a pause if the session still lacks it
    const key = `${sessionNow.fence ?? ''}:${songOrder.join(',')}`;
    if (published.current.key === key && Date.now() - published.current.at < PUBLISH_RETRY_MS) return;
    published.current = { key, at: Date.now() };
    void publishProgramme(songOrder, playingAt);
  }, [audible, playingAt, publishProgramme, remoteControlOn, request, sessionNow, setMixData, songOrder]);
  useEffect(() => {
    player.onChange = setNow;
    setNow(player.state);
    return () => { player.onChange = IDLE; };
  }, [player]);

  const path = useLocationText().split('?')[0];
  // With the browser Workspace (cloud.workspace), /workshop is that page and More has no This device
  const workspacePage = on('cloud.workspace');
  const moreRoute = moreRouteOf(path);
  const route: ShellRoute = (moreRoute && !(workspacePage && moreRoute.id === 'workspace') ? moreRoute : null) ?? parseRoute(path);
  const moreItems = moreDestinationsFor({ mode: 'cloud', feature: on, experience: account.experience ?? null }).filter((place) => !(workspacePage && place.id === 'workspace'));
  const connected = status?.counts.music ?? 0;
  // Finish later is remembered on this browser: the spine then opens only when asked for
  const [spine, setSpine] = useState(() => !onboardingFinished(workspaceId) && !onboardingPutOff(workspaceId));
  const [spineAsked, setSpineAsked] = useState(false);
  // frozen at the first status: songs landing mid-import must not unmount the spine under the member
  const startedEmpty = useRef<boolean | null>(null);
  if (status !== null && startedEmpty.current === null) startedEmpty.current = connected === 0;
  const newMember = spine && (startedEmpty.current === true || spineAsked);

  const notify = useCallback<ViewProps['notify']>((message, undo) => {
    showToast(message, typeof undo === 'function' ? { undo } : {});
  }, []);
  // Request a song (flag `requests`): the same hook and panel as local mode, answered in the
  // browser; room requests the host accepted arrive on the event stream and join this list
  // with another device playing, requests are added to its programme: the list is judged against
  // what that device is playing, and nothing here changes this device's own mix
  // ADR-0475 R2, "Play on {device}". Asked to play: this device checks it has a mix, that it
  // holds the mix's music now, and that the browser lets this tab start sound, in that order,
  // then takes over and plays by its own action. One press here is needed when the tab has not
  // been pressed since it loaded; the asker is told to wait for it.
  const [askedToPlay, setAskedToPlay] = useState<StartAsk | null>(null);
  const startAskedMix = useCallback(async (ask: StartAsk, pressed: boolean): Promise<StartResult> => {
    // the mix the asker named; else the one this device already has; else the account's newest
    // saved mix (which mix is "current" is remembered per browser, so a fresh tab has none)
    const wanted = ask.mix_id ?? recipes.current() ?? (await newestMix(recipes))?.mix_id ?? null;
    if (wanted && recipes.current() !== wanted) recipes.setCurrent(wanted);
    const mix = await request<MixData>('/mix').catch(() => null);
    if (!mix?.mix.length) return 'no_mix';
    const here = await sources.here?.().catch(() => null);
    if (!mix.mix.some((item) => here?.get(item.song_id) === 'here')) {
      showToast(`${ask.asker_name} asked to play here. Choose your music folder again to play.`, { actions: [{ label: 'Choose music', run: () => navigate('/library') }] });
      return 'needs_music';
    }
    if (!pressed && !soundAllowedHere()) { setAskedToPlay(ask); return 'needs_gesture'; }
    setMixData(mix);
    hereOnPurpose.current = true;
    void shellPlayer.playFrom(0);
    return 'starting';
  }, [recipes, request, setMixData, shellPlayer, sources]);
  // what "Play on {device}" would play when this device has no current mix of its own: the
  // account's newest saved mix, read while Listen shows that card
  const [newest, setNewest] = useState<{ mix_id: string; name: string; songs: number; ids?: number[] } | null>(null);
  const wantsNewest = on('devices.remote_control') && !followsHere && !remote && !data.mix.length && path === '/listen';
  useEffect(() => {
    if (!wantsNewest) return undefined;
    let live = true;
    // its songs too, so each device can be judged by how many of them it holds (R1, R3)
    void newestMix(recipes).then(async (found) => {
      if (!live) return;
      setNewest(found);
      if (!found) return;
      const read = await recipes.read(found.mix_id).catch(() => null);
      if (live && read) setNewest({ ...found, ids: read.songs.map((song) => song.song_id) });
    });
    return () => { live = false; };
  }, [recipes, wantsNewest]);
  const playOn = usePlayOn({
    cloud, deviceId: playback.device?.id ?? null, enabled: on('devices.remote_control'), serverNow: playback.serverNow,
    onAsk: (ask) => startAskedMix(ask, false),
  });
  // the other device is the speaker now: what was said while asking has done its job
  const resetAsk = playOn.reset;
  const speakerHereNow = remote?.view.speaker === 'elsewhere';
  useEffect(() => { if (speakerHereNow) resetAsk(); }, [speakerHereNow, resetAsk]);
  // the speaker is away, or a press found nobody playing: every way on from this device (R1)
  const speakerId = playback.view?.speaker_device_id ?? null;
  const [hereSongs, setHereSongs] = useState(0);
  useEffect(() => {
    if (!remoteProgramme || !followsHere) { setHereSongs(0); return undefined; }
    let live = true;
    const ids = remoteProgramme.split(',').map(Number);
    void sources.here?.().then((held) => { if (live) setHereSongs(ids.filter((id) => held.get(id) === 'here').length); }).catch(() => undefined);
    return () => { live = false; };
  }, [remoteProgramme, followsHere, sources]);
  const playWays = remote && holdings.devices ? {
    devices: holdings.devices.filter((device) => device.device_id !== speakerId && device.device_id !== playback.device?.id),
    asking: playOn.state,
    onPlayOn: (device: { device_id: string; name: string }) => void playOn.ask(device, recipes.current() ?? null),
    hereSongs,
    // this device plays the programme from where it is: its mix becomes that order, then it takes over
    onPlayHere: () => {
      const at = remote.session.song_index;
      const offset = remote.positionMs() / 1000;
      setMixData({ ...data, mix: remoteMix });
      hereOnPurpose.current = true;
      void shellPlayer.playFrom(at, offset);
    },
    now: playback.serverNow(),
  } : null;
  // ADR-0475 R8: a mix made here when another device makes the sound. With a speaker playing
  // elsewhere, the new mix is offered to it (Play on {speaker} now, or Later); with none and no
  // music here, Play asks the device R1 chooses to play it.
  const bestHere = on('devices.remote_control') && holdings.devices ? bestHolder(holdings.devices, playback.device?.id ?? null) : null;
  mixableIds.current = bestHere && bestHere.songs > (status?.counts.ready ?? 0) ? holdings.ids.get(bestHere.device_id) ?? null : null;
  const speakerElsewhere = remote && remote.view.speaker === 'elsewhere' && playback.view?.speaker_device_id
    ? { device_id: playback.view.speaker_device_id, name: playback.view.speaker_name ?? 'the other device' } : null;
  const playsOn = speakerElsewhere ? { name: speakerElsewhere.name, now: false } : !followsHere && bestHere ? { name: bestHere.name, now: true } : undefined;
  const accountMix = useAccountMix({
    recipes, request, refreshMix, setMixData,
    audibleHere: playback.view?.speaker === 'here' && now.phase !== 'idle',
    playHere: () => { hereOnPurpose.current = true; void shellPlayer.playFrom(0); },
    askToPlay: (device, mixId) => void playOn.ask(device, mixId),
  });
  soundElsewhere.current = !on('devices.remote_control') ? null
    : speakerElsewhere ? () => accountMix.offerLater(speakerElsewhere)
      : !followsHere && bestHere ? () => { void playOn.ask(bestHere, recipes.current()); navigate('/listen'); }
        : null;
  const askedBanner = askedToPlay && (
    <p className="asked-to-play" role="alert" data-testid="asked-to-play">
      {askedToPlay.asker_name} asked to play here. Press Play to allow sound from this tab.
      <button className="primary" onClick={() => { const ask = askedToPlay; setAskedToPlay(null); void startAskedMix(ask, true).then((result) => playOn.answer(ask, result)); }}>Play</button>
      <button onClick={() => { const ask = askedToPlay; setAskedToPlay(null); void playOn.answer(ask, 'declined'); }}>Not now</button>
    </p>
  );
  const requestsPlayback = useMemo(() => (remote ? { mix: remoteMix, player: remote.player, onMix: NOT_THIS_MIX } : { mix: data.mix, player: shellPlayer, onMix: setMixData }), [data.mix, remote?.player, remoteMix, setMixData, shellPlayer, !!remote]);
  const songRequests = useRequests(requestsPlayback, notify, request);
  const [requesting, setRequesting] = useState(false);
  const refreshRoomRequests = useRef(songRequests.refresh);
  refreshRoomRequests.current = songRequests.refresh;
  useEffect(() => {
    const heard = () => {
      if (!on('requests')) return;
      // Every pending/withdrawn room event refreshes the existing Requests drawer and
      // the request-count badge. The browser-first planner never queues audio itself.
      void refreshRoomRequests.current?.();
    };
    window.addEventListener(ROOM_REQUEST_EVENT, heard);
    return () => window.removeEventListener(ROOM_REQUEST_EVENT, heard);
  }, [on]);
  // The host's room session (flag `rooms`): the open room is read here, on every page, so the
  // room stays live and the host hears about each request wherever they are (useRoomSession).
  const roomsPlace = moreItems.find((place) => place.id === 'rooms');
  const roomsOn = on('rooms') && !!roomsPlace && !account.feature_locks.rooms && !offlineReadOnly;
  const roomPlayback = useRef({ mix: data.mix, player: shellPlayer });
  roomPlayback.current = { mix: data.mix, player: shellPlayer };
  const requestsOn = on('requests');
  const onAsked = useCallback((ask: RoomAsk, kind: AskKind, roomId: string) => {
    const words = askWords(ask);
    const title = ask.song?.title ?? 'That song';
    const openRoom = { label: 'Open room', run: () => { if (roomsPlace) navigate(roomsPlace.path); } };
    if (kind === 'approve') {
      showToast(`${words}. Approve it to accept.`, { actions: [{
        label: 'Approve',
        run: async () => {
          try {
            await api(`/rooms/${encodeURIComponent(roomId)}/requests/${encodeURIComponent(ask.request_id)}/approve`, { method: 'POST' }, workspaceId);
            window.dispatchEvent(new Event(ROOM_EVENT));
            void refreshRoomRequests.current?.();
            showToast(`${title} is approved and waiting in Requests.`);
          } catch (problem) { showToast((problem as Error).message || 'Couldn’t approve that request.', { tone: 'problem' }); }
        },
      }, openRoom] });
      return;
    }
    void refreshRoomRequests.current?.();
    showToast(words, { actions: [{
      label: 'Add next',
      run: async () => {
        try {
          // the Requests list gives the row its number here; the same add the panel's button uses
          const list = await request<{ requests: RequestRow[] }>('/requests');
          const row = list.requests.find((one) => one.song_id === ask.song?.song_id);
          if (!row) { showToast(`${title} isn’t waiting any more.`); return; }
          const { mix, player: playing } = roomPlayback.current;
          const live = ['playing', 'paused'].includes(playing.state.phase);
          const changed = await request<MixData>(`/requests/${row.id}/add`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: live ? JSON.stringify({ order: mix.map((item) => item.song_id), position: playing.state.position }) : undefined,
          });
          setMixData(changed);
          void refreshRoomRequests.current?.();
          window.dispatchEvent(new Event(ROOM_EVENT));
          showToast(live ? `${title} plays after the current song.` : `${title} is in your mix.`);
        } catch (problem) { showToast((problem as Error).message || 'Couldn’t add it. Try again.', { tone: 'problem' }); }
      },
    }, requestsOn ? { label: 'Open requests', run: () => setRequesting(true) } : openRoom] });
  }, [api, workspaceId, request, setMixData, roomsPlace, requestsOn]);
  const room = useRoomSession({ api, workspaceId, enabled: roomsOn, onAsked });
  const roomWaiting = room ? room.toApprove : 0;
  const roomShown = useRoomLive();
  // "N requests to add" counts only what the Requests list can add now; the rest are on the way
  const roomAdd = roomShown && requestsOn ? addable(roomShown.coming, songRequests.requests) : { ready: room?.toAdd ?? 0, onTheWay: 0, onDevice: 0 };
  // a room that opened or closed changes which requests wait: a closed room's leave the list and the count
  const openRoomNow = room?.id;
  useEffect(() => { if (requestsOn) void refreshRoomRequests.current?.(); }, [openRoomNow, requestsOn]);
  const shared: ViewProps | null = status && {
    status, mix: data.mix, mixName: data.name, currentMixName: data.name, canUndo: data.can_undo, mixEta: data.eta,
    refreshMix, setMixData, refreshStatus, request, player: shellPlayer, now, readyNeeded: BROWSER_MIX_NEEDS,
    analysisAvailable: false, transitionEditingAvailable: false, visualizerAvailable: false, waveformOf,
    startedAMix: (savedMixes ?? 0) > 0,
    setView: (view: View) => navigate(VIEW_PATHS[view]), notify, stage: false, toggleStage: IDLE,
    playOn: playsOn,
  };
  const song = data.mix[now.position];
  const mixReady = Math.max(status?.counts.ready ?? 0, mixableIds.current?.size ?? 0);
  const localExport: ReactNode = null;
  // Ctrl K, the single keys and their help, for what this shell really has (W5's server-free
  // subset); the media keys and what the OS shows as playing drive the browser player.
  const places = [
    ...destinationsFor({ mode: 'cloud', feature: on, experience: account.experience ?? null }),
    ...moreItems,
  ].map((place) => ({ id: place.id, label: place.label, path: place.path, about: place.id === 'workspace' && 'icon' in place ? 'Your library at a glance, connecting music, this browser’s storage and diagnostics' : place.about }));
  const controls = useServerFreeControls({ places, player: shellPlayer, now, hasMix: data.mix.length > 0, hasNext: data.mix.length > now.position + 1 });
  const currentMix = useCallback(() => data.mix, [data.mix]);
  useMediaKeys({ on: on('listen.media_keys'), player: shellPlayer, getMix: currentMix, mixName: data.name, now });
  // The spine must import into the same index instance this shell reads (memory mirror and
  // session files are per-instance), or freshly connected songs read as on another device
  // until the page reloads.
  // cloud.resilient_import: the runner journals, retries and skips what an interrupted run did
  // (off, it is the plain import); the shell also carries an interrupted import on by itself
  const spineDeps = useMemo(() => ({
    importMusic: importRunnerFor({ request: media, openStore, workspaceId }),
  }), [media, openStore, workspaceId]);
  useImportCarryOn({ request: media, openStore, workspaceId });
  const connect = <ConnectMusic request={media} workspaceId={workspaceId} openStore={openStore} onAvailabilityChanged={() => sweepLapsed(true)} />;

  const page = (): ReactNode => {
    if (route.page === 'more') {
      const item = moreItems.find((place) => place.id === route.id);
      if (!item) return <NotOnThisAccount />;
      if (item.id === 'workspace') return <ThisDevice openStore={openStore}>{connect}<StemsCard enabled={stems.enabled} store={stems.store} /></ThisDevice>;
      return <main className="page" id="main" data-place={item.id}><h1 className="display small">{item.label}</h1><div className="stack">{more(item.id)}</div></main>;
    }
    if (!shared) {
      return <main className="page" id="main" aria-busy={!statusProblem}><h1 className="display small">{describeRoute(route).title}</h1>{statusProblem ? (offlineShell ? <StatusProblem words={statusProblem} onRetry={() => { setStatusProblem(''); refreshStatus(); refreshMix(); }} /> : <p role="alert">{statusProblem}</p>) : <Skeleton variant="rows" lines={4} label="Opening your library" />}</main>;
    }
    if (newMember) {
      return (
        <main className="page" id="main">
          <h1 className="display small">Welcome to SelectaDJ</h1>
          <OnboardingSpine request={media} workspaceId={workspaceId} deps={spineDeps} onDone={() => { setSpine(false); setSpineAsked(false); refreshStatus(); }} />
        </main>
      );
    }
    // Make a Mix > Harmonic matches, from key profiles measured on this device
    if (route.page === 'discover' && route.tab === 'harmonic' && browserHarmonic && on('discover.harmonic')) return <BrowserHarmonicMatches resolveTrack={deviceTrack} />;
    // Workspace, with the tabs a browser can fill (cloud.workspace)
    if (route.page === 'workshop' && workspacePage) {
      return (
        <CloudWorkspace
          tab={route.tab}
          status={shared.status}
          workspaceId={workspaceId}
          openStore={openStore}
          connect={connect}
          stems={<StemsCard enabled={stems.enabled} store={stems.store} />}
          stemsShown={stems.enabled && !!stems.store}
          measuringKeys={browserHarmonic && on('discover.harmonic')}
          savedMixes={savedMixes}
          fileCheck={fileCheck}
          playback={{ refusal, speaker: playback.view?.speaker ?? null, phase: now.phase }}
        />
      );
    }
    switch (route.page) {
      case 'library':
        return <CloudLibrary shared={shared} connected={connected} connect={{ request: media, workspaceId, openStore, onAvailabilityChanged: () => sweepLapsed(true) }} />;
      case 'mixes':
        if (route.tab === 'mine') return <><MyMixes {...shared} suppressDrafts>{on('drafts') && <SavedBrowserMixes workspaceId={workspaceId} recipes={recipes} request={request} setMixData={setMixData} refreshStatus={refreshStatus} player={shellPlayer} notify={notify} phase={now.phase} currentSeconds={runningTime(data.mix)} />}</MyMixes>{localExport}</>;
        // R8: a device with little or no music makes mixes from the songs the device R1 chooses holds
        return <>{mixReady >= BROWSER_MIX_NEEDS ? <Mixes {...shared} status={{ ...shared.status, counts: { ...shared.status.counts, ready: mixReady } }} /> : (
          <MixesEmpty
            current={data.mix.length > 0 ? <CurrentMix mix={data.mix} mixName={data.name} now={now} player={shellPlayer} setView={shared.setView} analysisAvailable={false} /> : undefined}
            connected={connected}
            onSetUp={onboardingFinished(workspaceId) ? undefined : () => { setSpineAsked(true); setSpine(true); }}
            checking={importLive.phase === 'running' ? { checked: importLive.registered, total: importLive.total } : undefined}
          />
        )}{localExport}</>;
      case 'listen':
        // something is playing on another device and this one does not hold that mix: the remote
        if (remote) return <RemoteListen remote={remote} playableHere={status?.counts.ready ?? 0} ways={playWays} refusal={playback.error} speakerSongs={holdings.speakerSongs} />;
        // nothing is playing (no speaker at all) and this device holds no music, but the person
        // has another device: play on one that has music (ADR-0475 R1, R2), or say which is
        // missing; never a Play button that cannot work here
        if (on('devices.remote_control') && !followsHere && status && holdings.devices && holdings.devices.some((device) => device.device_id !== playback.device?.id)) {
          return (
            <ControllerListen
              mixName={data.mix.length ? data.name : newest?.name ?? ''} mixSongs={data.mix.length || (newest?.songs ?? 0)} devices={holdings.devices} thisDeviceId={playback.device?.id ?? null}
              mixIds={data.mix.length ? songOrder : newest?.ids ?? []} ids={holdings.ids}
              now={playback.serverNow()} asking={playOn.state}
              onPlayOn={(device) => void playOn.ask(device, recipes.current() ?? newest?.mix_id ?? null)}
            />
          );
        }
        return (
          <>
            {refusal && <div className="page"><CannotPlayHere reason={refusal} /></div>}
            {data.mix.length ? <Now {...shared} listenQueue={<ListenQueue mix={data.mix} now={now} player={shellPlayer} />} noticeAction={<>{output?.state === 'output_unverified' && <SoundCheck />}{on('cloud.local_media') && <QueueSources mix={data.mix} book={book} problemsOnly={!coexisting} nothingPlays={now.notice === NOTHING_PLAYABLE_NOTICE} />}</>} /> : mixProblem ? <MixProblem onRetry={refreshMix} /> : <ListenEmpty connected={connected} playable={status?.counts.ready ?? 0} saved={savedMixes} />}
          </>
        );
      case 'edit':
        // Saved browser mixes are opened as the current mix from My Mixes, so only the current
        // mix has an editor here.
        if (route.draft !== null) return <OnlyOnYourComputer title="Editing a saved draft" nearest={{ label: 'My Mixes', path: '/mixes/mine' }} />;
        if (mixProblem && !data.mix.length) return <MixProblem onRetry={refreshMix} />;
        return <Mix {...shared} key="current" />;
      case 'missing':
        return <PageNotFound />;
      case 'discover':
        // Word connections are answered in the browser (localFirstLinks.ts) while
        // discover.word_links is on for the account; with it off this page is as it was
        if (route.tab === 'words' && on('discover.word_links')) return <Links {...shared} tab="words" />;
        // falls through
      default: {
        const nearest = DESTINATIONS.find((place) => place.id === destinationOf(route) && place.id !== 'workspace') ?? DESTINATIONS.find((place) => place.id === 'library')!;
        return <OnlyOnYourComputer title={describeRoute(route).title} nearest={{ label: nearest.label, path: nearest.path }} />;
      }
    }
  };

  return (
    <RequestContext.Provider value={request}>
    <RequestsContext.Provider value={songRequests}>
    <PlayedTransitions.Provider value={played}>
    <StemSurfacesContext.Provider value={stems.surfaces}>
    <BytesContext.Provider value={noBytesHere}>
      <Shell
        route={route}
        // a controller's mini player is the remote session through the same contract (useRemote)
        player={remote ? remote.player : shellPlayer}
        now={remote ? remote.now : now}
        song={remote ? remote.song : song}
        showPlayer={route.page !== 'listen' && (remote ? remote.now.phase !== 'idle' : !!song && now.phase !== 'idle')}
        hasMix={data.mix.length > 0}
        hasNext={remote ? remote.hasNext : data.mix.length > now.position + 1}
        stage={false}
        waitingRequests={on('requests') ? waitingCount(roomShown, songRequests.requests) : 0}
        onRequests={() => setRequesting(true)}
        onHelp={controls.onHelp}
        onCommands={controls.onCommands}
        mode="cloud"
        more={moreItems}
        account={onSignOut ? { email: account.user.email, plan: planName(account), onSignOut } : undefined}
        status={room && roomsPlace && !(route.page === 'more' && route.id === 'rooms') ? (
          <a className="room-open-line" role="status" data-testid="room-open-line" href={roomsPlace.path} title={`${roomLine(room)}. Open Rooms.`} onClick={(event) => { event.preventDefault(); navigate(roomsPlace.path); }}>
            <b>{roomLine(room)}</b>
            <span>{countOf(room.guestsHere, 'guest')} here</span>
            {roomWaiting > 0 && <span className="room-open-waiting">{countOf(roomWaiting, 'request')} to approve</span>}
            {roomAdd.ready > 0 && <span className="room-open-waiting">{countOf(roomAdd.ready, 'request')} to add</span>}
            {roomAdd.onTheWay > 0 && <span className="room-open-waiting">{countOf(roomAdd.onTheWay, 'request')} on the way</span>}
            {roomAdd.onDevice > 0 && <span className="room-open-waiting" data-testid="room-on-device" title={`${countOf(roomAdd.onDevice, 'request')} waiting on another device`}>{roomAdd.onDevice} waiting on a device</span>}
          </a>
        ) : undefined}
        banner={<>{askedBanner}{accountMix.banner}{offlineShell && <ConnectionBanner plays={on('cloud.offline_playback')} cachedAt={servedFrom ? servedFrom.at : undefined} signedOutOffline={offlineReadOnly} />}{notices}{on('cloud.offline_playback') && playback.offlineNotice && playback.offlineNotice !== takeoverSeen && <p className="warn" role="alert">{playback.offlineNotice} <button onClick={() => setTakeoverSeen(playback.offlineNotice)}>Dismiss</button></p>}{on('devices.remote_control') && playback.view?.speaker !== 'here' && <ControllerNotices notices={playback.view?.notices} speakerName={playback.view?.speaker_name ?? null} session={playback.view?.session ?? null} send={(name, args) => { void playback.command(name, args); }} />}{on('cloud.progressive_import') && <ImportChip workspaceId={workspaceId} onView={() => navigate('/workshop')} />}{isHostedAccount(account) && <CutoverNotice accountId={account.user.id} />}{feedback}</>}
      >
        {/* one page's render error stays inside that page, as in the hosted shell */}
        <HolderContext.Provider value={holderValue}><Section key={route.page === 'more' ? `more-${route.id}` : route.page} name={describeRoute(route).title}>{page()}</Section></HolderContext.Provider>
        <footer className="cloud-footer">SelectaDJ Cloud. Your music files stay on your devices; your account keeps their details.</footer>
      </Shell>
      {requesting && on('requests') && (
        <Drawer title="Requests" onClose={() => setRequesting(false)}>
          <RequestsPanel />
        </Drawer>
      )}
      {controls.overlays}
    </BytesContext.Provider>
    </StemSurfacesContext.Provider>
    </PlayedTransitions.Provider>
    </RequestsContext.Provider>
    </RequestContext.Provider>
  );
}

/** More > This device: the music connected here and the storage it uses (workspace extras). */
function ThisDevice({ openStore, children }: { openStore: () => Promise<MediaStore>; children: ReactNode }) {
  const [degraded, setDegraded] = useState(false);
  useEffect(() => {
    let live = true;
    void openStore().then((opened) => { if (live) setDegraded(opened.degraded); }).catch(() => undefined);
    return () => { live = false; };
  }, [openStore]);
  return (
    <main className="page" id="main">
      <h1 className="display small">This device</h1>
      <StorageCard degraded={degraded} />
      {children}
    </main>
  );
}

/** The library could not be opened (cloud.offline_shell): plain words and one way on. */
function StatusProblem({ words, onRetry }: { words: string; onRetry: () => void }) {
  return (
    <div className="stack" role="alert">
      <p>SelectaDJ couldn’t open your library. {words}</p>
      <div><button type="button" onClick={onRetry}>Try again</button></div>
    </div>
  );
}

/** The current mix could not be read (cloud.offline_shell): never shown as an empty mix. */
function MixProblem({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="page" id="main">
      <div className="stack" role="alert">
        <p>SelectaDJ couldn’t load your mix. It is still saved; try again, or wait for the connection to come back.</p>
        <div><button type="button" onClick={onRetry}>Try again</button></div>
      </div>
    </main>
  );
}
