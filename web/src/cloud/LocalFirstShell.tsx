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
import { EMPTY_MIX, localFirstRequest, mediaRequest, type AvailabilitySources } from './localFirstRequest';
import { ROOM_REQUEST_EVENT } from './localFirstRequests';
import { askWords, roomLine, useRoomLive, useRoomSession, waitingCount, ROOM_EVENT, type AskKind, type RoomAsk } from '../rooms/useRoomSession';
import { recipeStore } from './recipeStore';
import { SavedBrowserMixes } from './SavedBrowserMixes';
import { SoundCheck } from './SoundCheck';
import { QueueSources } from './QueueSources';
import { ListenQueue } from './ListenQueue';
import { NOTHING_PLAYABLE_NOTICE } from '../engine/scheduler';
import { runningTime } from '../lib';
import { CutoverNotice } from './migration/CutoverNotice';
import { OnboardingSpine } from './onboarding/OnboardingSpine';
import { browserStorage, onboardingFinished, recordImportOutcome } from './onboarding/state';
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
  const sources = useMemo<AvailabilitySources>(() => ({
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
    // cloud.offline_shell: the last catalogue is kept here and served, with this device's own
    // songs, while SelectaDJ cannot be reached; the banner says the library is from this device
    offline: offlineShell ? {
      deviceSongs: async () => (await (await openStore()).all()).map((song) => ({
        id: song.songId, content_sha256: song.identity.content_sha256, title: song.identity.title, artist: song.identity.artist,
        album: song.identity.album ?? null, duration_s: song.identity.duration_s ?? null, available_on: 1,
      })),
      onServed: (from) => setServedFrom(from.cached ? { at: from.at } : null),
    } : undefined,
  }), [api, cloud, workspaceId, coexisting, openStore, recipes, browserHarmonic, tonal, offlineShell]);
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
  const shellPlayer = useMemo(() => new Proxy(player, {
    get(target, key) {
      if (key === 'playFrom') {
        return (from: number, offset?: number) => (mixJustSet.current
          ? new Promise<void>((done) => { playWaiting.current = { from, offset, done }; })
          : target.playFrom(from, offset));
      }
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }), [player]);
  const [now, setNow] = useState<NowState>(player.state);
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
  const [spine, setSpine] = useState(() => !onboardingFinished(workspaceId));
  // frozen at the first status: songs landing mid-import must not unmount the spine under the member
  const startedEmpty = useRef<boolean | null>(null);
  if (status !== null && startedEmpty.current === null) startedEmpty.current = connected === 0;
  const newMember = spine && startedEmpty.current === true;

  const notify = useCallback<ViewProps['notify']>((message, undo) => {
    showToast(message, typeof undo === 'function' ? { undo } : {});
  }, []);
  // Request a song (flag `requests`): the same hook and panel as local mode, answered in the
  // browser; room requests the host accepted arrive on the event stream and join this list
  const songRequests = useRequests({ mix: data.mix, player: shellPlayer, onMix: setMixData }, notify, request);
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
  // a room that opened or closed changes which requests wait: a closed room's leave the list and the count
  const openRoomNow = room?.id;
  useEffect(() => { if (requestsOn) void refreshRoomRequests.current?.(); }, [openRoomNow, requestsOn]);
  const shared: ViewProps | null = status && {
    status, mix: data.mix, mixName: data.name, currentMixName: data.name, canUndo: data.can_undo, mixEta: data.eta,
    refreshMix, setMixData, refreshStatus, request, player: shellPlayer, now, readyNeeded: BROWSER_MIX_NEEDS,
    analysisAvailable: false, transitionEditingAvailable: false, visualizerAvailable: false, waveformOf,
    startedAMix: (savedMixes ?? 0) > 0,
    setView: (view: View) => navigate(VIEW_PATHS[view]), notify, stage: false, toggleStage: IDLE,
  };
  const song = data.mix[now.position];
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
          <OnboardingSpine request={media} workspaceId={workspaceId} deps={spineDeps} onDone={() => { setSpine(false); refreshStatus(); }} />
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
        return <>{(status?.counts.ready ?? 0) >= BROWSER_MIX_NEEDS ? <Mixes {...shared} /> : (
          <MixesEmpty
            current={data.mix.length > 0 ? <CurrentMix mix={data.mix} mixName={data.name} now={now} player={shellPlayer} setView={shared.setView} analysisAvailable={false} /> : undefined}
            connected={connected}
            checking={importLive.phase === 'running' ? { checked: importLive.registered, total: importLive.total } : undefined}
          />
        )}{localExport}</>;
      case 'listen':
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
        player={shellPlayer}
        now={now}
        song={song}
        showPlayer={route.page !== 'listen' && !!song && now.phase !== 'idle'}
        hasMix={data.mix.length > 0}
        hasNext={data.mix.length > now.position + 1}
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
            {room.toAdd > 0 && <span className="room-open-waiting">{countOf(room.toAdd, 'request')} to add</span>}
          </a>
        ) : undefined}
        banner={<>{offlineShell && <ConnectionBanner plays={on('cloud.offline_playback')} cachedAt={servedFrom ? servedFrom.at : undefined} signedOutOffline={offlineReadOnly} />}{notices}{on('cloud.offline_playback') && playback.offlineNotice && playback.offlineNotice !== takeoverSeen && <p className="warn" role="alert">{playback.offlineNotice} <button onClick={() => setTakeoverSeen(playback.offlineNotice)}>Dismiss</button></p>}{on('devices.remote_control') && playback.view?.speaker !== 'here' && <ControllerNotices notices={playback.view?.notices} speakerName={playback.view?.speaker_name ?? null} session={playback.view?.session ?? null} send={(name, args) => { void playback.command(name, args); }} />}{on('cloud.progressive_import') && <ImportChip workspaceId={workspaceId} onView={() => navigate('/workshop')} />}{isHostedAccount(account) && <CutoverNotice accountId={account.user.id} />}{feedback}</>}
      >
        {/* one page's render error stays inside that page, as in the hosted shell */}
        <Section key={route.page === 'more' ? `more-${route.id}` : route.page} name={describeRoute(route).title}>{page()}</Section>
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
