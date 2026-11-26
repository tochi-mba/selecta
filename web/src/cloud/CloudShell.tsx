import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MixData, Request, Status } from '../api';
import { accountFlagOn, flagListed, setFlags, useFlags } from '../flags';
import { findLapsed, makeResolver, makeSourceBook, MediaStore, reportDeviceAvailability, deviceAvailabilitySnapshot, type LapsedWhy, type MediaResolver } from '../media';
import { useArtIndex } from './artIndex';
import type { NowState } from '../player';
import { BytesContext, noBytesHere, RequestContext } from '../requestContext';
import { navigate, parseRoute, useLocationText } from '../router';
import { describeRoute, destinationsFor, moreDestinationsFor, moreRouteOf, type MoreDestinationId, type ShellRoute } from '../shell/manifest';
import { Shell } from '../shell/Shell';
import { useMediaKeys } from '../shell/useMediaKeys';
import { setJobsSource } from '../state/jobs';
import { Drawer, Section } from '../ui/controls';
import { showToast } from '../ui/toasts';
import { PlayedTransitions, StemSurfacesContext } from '../views/liveTransitions';
import { useSplitterNotices } from './stems/useStems';
import { useStemsEngine } from './stems/useStemsEngine';
import { playedByPair } from './playedSeams';
import { peaksFrom } from '../dsp/waveform';
import { RequestsContext, RequestsPanel, useRequests, type RequestRow } from '../views/Requests';
import type { View, ViewProps } from '../views/shared';
import { holdsHostedStorage, planName, type Account, type Api } from './api';
import { useLibraryPlaces } from './libraryPlacesChrome';
import { LibraryPlacesContext } from '../views/LibraryPlaces';
import { ConnectMusic, registeredDeviceId } from './ConnectMusic';
import { forgetCloudLibraryAssets, LIBRARY_CHANGED_EVENT } from './cloudLibraryMedia';
import { isHostedAccount } from './deviceMusicGate';
import { lucyTransport as currentLucyTransport, setLucyTransport } from '../lucy/client';
import { useLocalFirstPlayer } from './deviceMusicPlayer';
import { BROWSER_MIX_NEEDS } from './deviceMusicMixes';
import { EMPTY_MIX, mediaRequest, readCatalogue } from './deviceMusicRequest';
import { useRemote } from '../devices/useRemote';
import { bestHolder, HolderContext, mixHeld, musicHolder, whereHeldFrom, programmeTurn, type MusicHolder } from '../devices/controller';
import { useHoldings } from '../devices/useHoldings';
import { DEVICE_REGISTERED } from '../devices/playbackWire';
import { tabLog } from '../devices/audioTab';
import { movedFrom, soundAllowedHere, usePlayOn, type StartAsk, type StartResult } from '../devices/playOn';
import { ROOM_REQUEST_EVENT } from './deviceMusicRequests';
import { useRoomRounds, addable, askWords, useRoomLive, useRoomSession, waitingCount, ROOM_EVENT, type AskKind, type RoomAsk } from '../rooms/useRoomSession';
import { recipeStore } from './recipeStore';
import { browserStorage, onboardingFinished, onboardingPutOff, recordImportOutcome } from './onboarding/state';
import { bindImportWorkspace, endImportSession, useImportShellView } from './importSession';
import { importRunnerFor, useImportCarryOn } from './importResume';
import { useServerFreeControls } from './serverFreeControls';
import { provenHashes, startTonalProfiler, tonalStore } from './tonalProfiles';
import { startFactsUploader } from './factsUploader';
import { waveformBook } from './sharedWaveforms';
import { onReconnect } from './connection';
import { plainMessage } from './resilientRequest';
import { useAccountMix } from './useAccountMix';
import { setTabBusy } from './accountTabs';
import { useWhereToPlay } from '../devices/useWhereToPlay';
import { footerWords } from './hosted/HostedMakeAMix';
import { browserFlags } from './browserFlags';
import { sendingOn } from './accountFacts';
import { accountMixesOn } from './accountMixes';
import { inspectorOn } from './seamInspection';
import { DeviceActivityDrawer } from './DeviceActivity';
import { localExportOn } from './localExport';
import { placingOn } from './accountPlacements';
import { RoomOpenLine } from './RoomOpenLine';
import { useCloudShellMedia, useCloudSongs } from './cloudShellMedia';
import { CloudShellPages } from './CloudShellPages';
import { CloudShellNotices, otherTabNote } from './CloudShellNotices';
import type { NoticeGroups } from './NoticeStack';
import { useCloudUploadQueue } from './uploadQueueWiring';

/** Local-first personal Cloud on the shared shell (ADR-0462, ADR-0463).
 *
 * The same Shell, manifest, router and views as local mode: Listen, Make a Mix, My Mixes and
 * Library, with Cloud's own surfaces in More. Views ask through the adapted, authenticated request
 * (deviceMusicRequest.ts); the player is the browser engine through the playback session
 * (deviceMusicPlayer.ts). CloudApp mounts this only when the account has the local-first experience
 * and `cloud.local_first` is on; otherwise the hosted pages render exactly as before.
 */
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
const LUCY_POLL_MS = 500;

export function CloudShell({ api, account, more, notices, accountNotices, feedback, onSignOut, offlineReadOnly = false }: {
  api: Api;
  account: Account;
  /** The account panel for a More destination, drawn by CloudApp with its own handlers. */
  more: (id: MoreDestinationId) => ReactNode;
  /** The account's notices (suspended, account problem, over quota, paused live updates), drawn
   * by CloudApp from the same sources as the hosted frame, shown first in the banner. */
  notices?: ReactNode;
  /** cloud.page_layout: the same account notices, by how pressing they are (NoticeStack.tsx) */
  accountNotices?: NoticeGroups;
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
  useArtIndex(openStore);
  // Device first, hosted fallback (ADR-0465): only a grandfathered account with stored media
  // readable gets the hosted path; every answer lands in the source book the queue shows.
  const book = useMemo(() => makeSourceBook(), []);
  const coexisting = isHostedAccount(account) && on('cloud.stored_media');
  // library.places: the Library says where songs are kept, for an account with a cloud library
  // (the grant, or songs still stored after it was taken away); nothing new for anyone else
  const placesOn = on('library.places') && on('cloud.stored_media') && holdsHostedStorage(account);
  // cloud.catalogue_play: cloud songs found by catalogue id, and counted on every device
  const cataloguePlay = coexisting && flagListed('cloud.catalogue_play');
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
  const lucyHere = accountFlagOn('lucy.cloud_conversation') && accountFlagOn('lucy');
  // corrections, the energy shape and locks, from the account (browserFlags.ts)
  const measuredHere = sendingOn();
  const accountMixesHere = accountMixesOn();
  const studioHere = inspectorOn();
  const exportHere = localExportOn();
  const placingHere = placingOn();
  const offlineShell = on('cloud.offline_shell');
  // where the library shown came from: null from the server, or this device's kept copy
  const [servedFrom, setServedFrom] = useState<{ at: number | null } | null>(null);
  const sharedDerived = on('cloud.content_cache');
  const tonal = useMemo(() => tonalStore(workspaceId, sharedDerived ? { held: async () => provenHashes(await (await openStore()).all()) } : undefined), [workspaceId, sharedDerived, openStore]);
  const roomsHere = on('rooms') && !account.feature_locks.rooms;
  // where each song can play from, the adapted request and the resolver (cloudShellMedia.ts)
  const { sources, request, media, resolver, programme, controllerLink, whereHeld, mixableIds } = useCloudShellMedia({
    api, cloud, workspaceId, on, coexisting, places: placesOn, catalogue: cataloguePlay, openStore, lapsed, refreshStatus: refreshStatusRef, recipes, browserHarmonic, tonal, offlineShell, roomsHere, onServed: setServedFrom, book,
  });
  mediaRef.current = media;

  const [status, setStatus] = useState<Status | null>(null);
  const [statusProblem, setStatusProblem] = useState('');
  const [data, setData] = useState<MixData>(EMPTY_MIX);
  programme.current = data.mix;
  // cloud.catalogue_play: the songs in the cloud library, read again with each status
  const cloudSongs = useCloudSongs(request, cataloguePlay, status);
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
  // an upload accepted (or a stored song changed): read the hosted copies and the catalogue again
  useEffect(() => {
    const changed = () => { forgetCloudLibraryAssets(workspaceId); refreshStatus(); };
    window.addEventListener(LIBRARY_CHANGED_EVENT, changed);
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, changed);
  }, [workspaceId, refreshStatus]);
  useEffect(() => { refreshStatus(); refreshMix(); void sweepLapsed(true); }, [refreshStatus, refreshMix, sweepLapsed]);
  useEffect(() => {
    const refreshWhenActive = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void sweepLapsed();
    };
    const timer = window.setInterval(refreshWhenActive, AVAILABILITY_REFRESH_MS);
    // a browser's first visit registers its device after the startup sweep: report then, or the
    // server counts no songs here and nothing can play on this device until the next sweep
    const registered = () => { void sweepLapsed(true); };
    window.addEventListener(DEVICE_REGISTERED, registered);
    window.addEventListener('focus', refreshWhenActive);
    document.addEventListener('visibilitychange', refreshWhenActive);
    return () => {
      window.removeEventListener(DEVICE_REGISTERED, registered);
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWhenActive);
      document.removeEventListener('visibilitychange', refreshWhenActive);
    };
  }, [sweepLapsed]);

  // The import session outlives any one page: each landed batch refreshes the counts, and a
  // finished import records its outcome in the onboarding state even with the spine gone.
  useEffect(() => { bindImportWorkspace(workspaceId); }, [workspaceId]);
  const importLive = useImportShellView(workspaceId);
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
    setFlags(browserFlags(browserHarmonic, lucyHere, { measured: measuredHere, accountMixes: accountMixesHere, studio: studioHere, localExport: exportHere, placing: placingHere }));
    // Cloud has no jobs server at all, so the source stays off when this shell unmounts.
    return () => { setFlags(null); };
  }, [browserHarmonic, lucyHere, measuredHere, accountMixesHere, studioHere, exportHere, placingHere]);
  // ADR-0476: Lucy's page asks the account's API, and reads her events by asking. Set while
  // rendering, because the page's own first read runs in an effect before this shell's do.
  const lucyTransport = useMemo(() => (lucyHere ? { request: cloud, base: '/lucy-cloud', pollMs: LUCY_POLL_MS, device: () => registeredDeviceId(workspaceId) } : null), [lucyHere, cloud, workspaceId]);
  setLucyTransport(lucyTransport);
  const lucyAlive = useRef(false);
  useEffect(() => {
    lucyAlive.current = true;
    setLucyTransport(lucyTransport);
    // forgotten only once the shell is really gone: a re-run puts it straight back first
    return () => {
      lucyAlive.current = false;
      window.setTimeout(() => { if (!lucyAlive.current && currentLucyTransport() === lucyTransport) setLucyTransport(null); }, 0);
    };
  }, [lucyTransport]);

  // Listen's waveforms for the visit: from the audio the engine decoded to play each song, else its file
  const [waveforms] = useState(waveformBook);
  const { player, refusal, device: playback, seams: scheduled, prefetch, output } = useLocalFirstPlayer({
    api, workspaceId, mix: data.mix, remoteControl: on('devices.remote_control'), resolver, request, decoded: waveforms.fromDecoded,
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
  const holderValue = useMemo<MusicHolder | null>(() => (holderDevice ? { deviceId: holderDevice.device_id, name: holderDevice.name, songs: holderDevice.songs, online: holderDevice.online, ids: holdings.speakerSongs, places: whereHeld.current, lastOpen: (name: string) => { const found = holdings.devices?.find((one) => one.name === name); return found ? Math.max(0, playback.serverNow() - found.last_seen_at) : null; }, speaking: remote ? holderDevice.online && holderDevice.device_id === playback.view?.speaker_device_id : undefined } : null), [holderDevice?.device_id, holderDevice?.name, holderDevice?.songs, holderDevice?.online, holdings.speakerSongs, holdings.ids, holdings.devices, playback.view?.speaker_device_id, !!remote]);
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
  // the measurements made here go to the account when both flags say so (factsUploader.ts)
  useEffect(() => startFactsUploader({ request: cloud, workspaceId, openMedia: openStore }), [cloud, workspaceId, openStore]);
  // a song the engine has not decoded yet (the strip's first song, say) is decoded from its own file
  const waveformOf = useCallback((songId: number) => waveforms.of(songId, {
    resolve: resolveTrack, openStore, shared: sharedDerived,
    decode: async (bytes) => peaksFrom(await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes)),
  }), [waveforms, resolveTrack, openStore, sharedDerived]);
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
  const soundElsewhere = useRef<(() => boolean) | null>(null);
  const hereOnPurpose = useRef(false);
  const shellPlayer = useMemo(() => new Proxy(player, {
    get(target, key) {
      if (key === 'playFrom') {
        return (from: number, offset?: number) => {
          // ADR-0475 R8: the sound is made on another device, so Play never starts it here
          const away = hereOnPurpose.current ? null : soundElsewhere.current;
          hereOnPurpose.current = false;
          if (away?.()) return Promise.resolve();
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
    // not taken (sent before this device was the speaker, just after a move): again in 2 seconds
    void publishProgramme(songOrder, playingAt).then((took) => { if (!took) published.current = { key, at: Date.now() - PUBLISH_RETRY_MS + 2_000 }; });
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
    // G2 (58): a move with no mix named takes over the programme that plays, from where it is
    const programmeMove = ask.move && !ask.mix_id && remoteMix.length > 0;
    const wanted = programmeMove ? null : ask.mix_id ?? recipes.current() ?? (await newestMix(recipes))?.mix_id ?? null;
    if (wanted && recipes.current() !== wanted) recipes.setCurrent(wanted);
    const mix = programmeMove ? { ...data, mix: remoteMix } : await request<MixData>('/mix').catch(() => null);
    if (!mix?.mix.length) return 'no_mix';
    const here = await sources.here?.().catch(() => null);
    // cloud.catalogue_play: a mix with songs in the cloud library plays here without a folder
    const inCloud = cataloguePlay ? (cloudSongs ?? await request.cloudSongs().catch(() => null))?.ids : undefined;
    if (!mix.mix.some((item) => here?.get(item.song_id) === 'here' || inCloud?.has(item.song_id))) {
      showToast(`${ask.asker_name} asked to play here. Choose your music folder again to play.`, { actions: [{ label: 'Choose music', run: () => navigate('/library') }] });
      return 'needs_music';
    }
    if (!pressed && !soundAllowedHere()) { setAskedToPlay(ask); return 'needs_gesture'; }
    // another device became the speaker meanwhile (its own Play here instead): stand down
    // (I85: a move asks for exactly that, so it takes the music over)
    if (!ask.move && (await playback.refreshSession())?.speaker === 'elsewhere') return 'declined';
    setMixData(mix);
    player.startFreeOnce = !ask.move;
    player.startMovingOnce = !!ask.move;
    hereOnPurpose.current = true;
    // G2 (58): moving the programme that plays carries on from where it is
    // (B7: from a speaker that went away, its last known place, not time run on since)
    const seen = ask.move ? await playback.refreshSession() : null;
    const lapsed = (seen?.session?.lease_expires_at ?? Infinity) <= playback.serverNow();
    const lastSeen = seen?.speaker === 'offline' || lapsed ? seen?.session?.anchor_at ?? undefined : undefined;
    tabLog('move from', { speaker: seen?.speaker, lapsed, lastSeen, offset: seen?.session?.offset_ms });
    const from = seen ? movedFrom(seen.session, mix.mix, lastSeen ?? playback.serverNow()) : null;
    void shellPlayer.playFrom(from?.song_index ?? 0, from ? from.offset_ms / 1000 : 0);
    return 'starting';
  }, [data, recipes, remoteMix, request, setMixData, shellPlayer, sources, cataloguePlay, cloudSongs]);
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
  // (also when the music moved from one device to another: the ask that moved it is done)
  const speakerNowId = remote?.view.speaker_device_id ?? null;
  useEffect(() => { if (speakerHereNow) resetAsk(); }, [speakerHereNow, speakerNowId, resetAsk]);
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
    // B7: the speaker went away: the programme carries on from its last place on the device chosen
    onPlayOn: (device: { device_id: string; name: string }) => {
      if (remote.view.speaker !== 'offline') return void playOn.ask(device, recipes.current() ?? null);
      where.say(device.device_id, `Carrying on from ${remote.view.speaker_name ?? 'the other device'} on ${device.name}.`);
      void playOn.ask(device, null, true);
    },
    // G2 (58): the programme that plays moves, not a saved mix: the asked device plays it from here
    onMove: (device: { device_id: string; name: string }) => void playOn.ask(device, null, true),
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
    ofMix: (device: { device_id: string }) => ({ held: mixHeld(holdings.ids, device.device_id, remoteMix.map((item) => item.song_id)), total: remoteMix.length }),
  } : null;
  // ADR-0475 R8: a mix made here when another device makes the sound. With a speaker playing
  // elsewhere, the new mix is offered to it (Play on {speaker} now, or Later); with none and no
  // music here, Play asks the device R1 chooses to play it.
  const bestHere = on('devices.remote_control') && holdings.devices ? bestHolder(holdings.devices, playback.device?.id ?? null) : null;
  mixableIds.current = bestHere && bestHere.songs > (status?.counts.ready ?? 0) ? holdings.ids.get(bestHere.device_id) ?? null : null;
  const speakerElsewhere = remote && remote.view.speaker === 'elsewhere' && playback.view?.speaker_device_id
    ? { device_id: playback.view.speaker_device_id, name: playback.view.speaker_name ?? 'the other device' } : null;
  const accountMix = useAccountMix({
    recipes, request, refreshMix, setMixData,
    audibleHere: playback.view?.speaker === 'here' && now.phase !== 'idle',
    playHere: () => { hereOnPurpose.current = true; void shellPlayer.playFrom(0); },
    askToPlay: (device, mixId, move) => void playOn.ask(device, mixId, move),
    devices: () => holdings.devices ?? [],
    heldOrder: () => programme.current.map((item) => item.song_id).join(','),
  });
  // ADR-0475: with nobody playing elsewhere, the one rule decides where Play makes the sound
  const where = useWhereToPlay({
    enabled: on('devices.remote_control') && !speakerElsewhere,
    // until this device's own report is in, the server would count none of its songs: play here, as before
    situation: holdings.devices && !((status?.counts.ready ?? 0) > 0 && !holdings.devices.find((one) => one.device_id === playback.device?.id)?.reported_at) ? {
      devices: holdings.devices, defaultId: holdings.defaultId, thisDeviceId: playback.device?.id ?? null, mixIds: songOrder, ids: holdings.ids,
      speaker: playback.view?.speaker === 'here' && playback.view.speaker_device_id ? { deviceId: playback.view.speaker_device_id, online: true } : null,
      // cloud.catalogue_play: the cloud library's songs play on every signed-in browser
      ...(cloudSongs ? { cloud: cloudSongs } : {}),
    } : null,
    cloud, refreshHoldings: holdings.refresh,
    playHere: () => { hereOnPurpose.current = true; void shellPlayer.playFrom(0); },
    askToPlay: (device) => void playOn.ask(device, recipes.current()),
    asking: playOn.state, playHereInstead: () => { playOn.reset(); void player.playHereInstead(); }, playingOn: playback.view?.speaker === 'elsewhere' ? playback.view.speaker_device_id : null, playableHere: followsHere, speakingHere: playback.view?.speaker === 'here',
  });
  soundElsewhere.current = !on('devices.remote_control') ? null
    : speakerElsewhere ? () => { accountMix.offerLater(speakerElsewhere); return true; }
      : where.decide;
  // what Make a Mix says Play does: asks the speaker, or starts on the device the rule chose
  const chosenElsewhere = where.choice && (where.choice.kind === 'default' || where.choice.kind === 'only') && where.choice.device.device_id !== playback.device?.id ? where.choice.device : null;
  const playsOn = speakerElsewhere ? { name: speakerElsewhere.name, now: false } : where.choice?.kind === 'ask' ? { name: '', now: true, ask: true } : chosenElsewhere ? { name: chosenElsewhere.name, now: true } : !followsHere && bestHere ? { name: bestHere.name, now: true } : undefined;
  const askedBanner = askedToPlay && (
    <p className="asked-to-play" role="alert" data-testid="asked-to-play">
      <span className="asked-to-play-words">{askedToPlay.asker_name} asked to play here. Press Play to allow sound from this tab.</span>
      <button className="primary" onClick={() => { const ask = askedToPlay; setAskedToPlay(null); void startAskedMix(ask, true).then((result) => playOn.answer(ask, result)); }}>Play</button>
      <button onClick={() => { const ask = askedToPlay; setAskedToPlay(null); void playOn.answer(ask, 'declined'); }}>Not now</button>
    </p>
  );
  const requestsPlayback = useMemo(() => (remote ? { mix: remoteMix, player: remote.player, onMix: NOT_THIS_MIX } : { mix: data.mix, player: shellPlayer, onMix: setMixData }), [data.mix, remote?.player, remoteMix, setMixData, shellPlayer, !!remote]);
  const songRequests = useRequests(requestsPlayback, notify, request);
  const [requesting, setRequesting] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
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
  useRoomRounds({ api, workspaceId, roomId: room?.id, enabled: roomsOn && accountFlagOn('rooms.rounds', account.features), isSpeaker: () => playback.isSpeaker(), playing: roomPlayback, request });
  const roomWaiting = room ? room.toApprove : 0;
  // R12: what a sign-out in any tab of this browser would stop, answered from here
  setTabBusy({ playing: playback.isSpeaker() && now.phase === 'playing', room: !!room, importing: importLive.phase === 'running' });
  const roomShown = useRoomLive();
  // "N requests to add" counts only what the Requests list can add now; the rest are on the way
  const roomAdd = roomShown && requestsOn ? addable(roomShown.coming, songRequests.requests) : { ready: room?.toAdd ?? 0, onTheWay: 0, onDevice: 0 };
  // a room that opened or closed changes which requests wait: a closed room's leave the list and the count
  const openRoomNow = room?.id;
  useEffect(() => { if (requestsOn) void refreshRoomRequests.current?.(); }, [openRoomNow, requestsOn]);
  const shared: ViewProps | null = status && {
    status, mix: data.mix, mixName: data.name, currentMixName: data.name, canUndo: data.can_undo, mixEta: data.eta,
    refreshMix, setMixData, refreshStatus, request, player: shellPlayer, now, readyNeeded: BROWSER_MIX_NEEDS,
    analysisAvailable: false, transitionEditingAvailable: false, visualizerAvailable: true, waveformOf,
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
  // F47: media keys and the lock screen belong to the tab making the sound, never another tab
  useMediaKeys({ on: on('listen.media_keys') && !playback.otherTab && !playback.carryOn, player: shellPlayer, getMix: currentMix, mixName: data.name, now });
  // The spine must import into the same index instance this shell reads (memory mirror and
  // session files are per-instance), or freshly connected songs read as on another device
  // until the page reloads.
  // cloud.resilient_import: the runner journals, retries and skips what an interrupted run did
  // (off, it is the plain import); the shell also carries an interrupted import on by itself
  const spineDeps = useMemo(() => ({
    importMusic: importRunnerFor({ request: media, openStore, workspaceId }),
  }), [media, openStore, workspaceId]);
  useImportCarryOn({ request: media, openStore, workspaceId, watch: { onAvailabilityChanged: () => sweepLapsed(true), playing: () => playingNow.current() } });
  // cloud.move_to_cloud: the upload queue carries on after a reload; the current mix goes first
  useCloudUploadQueue({ on: on('cloud.move_to_cloud'), workspaceId, api, openStore, mixSongs: () => data.mix.map((item) => item.song_id), playing: () => playingNow.current(), onAvailabilityChanged: () => sweepLapsed(true) });
  const connect =<ConnectMusic request={media} workspaceId={workspaceId} openStore={openStore} onAvailabilityChanged={() => sweepLapsed(true)} />;
  // library.places: what the Library knows about where songs are kept (views/LibraryPlaces.tsx)
  const libraryPlaces = useLibraryPlaces({
    on: placesOn, cloud, workspaceId, accountId: account.user.id, canUpload: isHostedAccount(account) && on('cloud.uploads'),
    offline: servedFrom !== null || offlineReadOnly, otherDevices: !!holdings.devices?.some((one) => one.device_id !== playback.device?.id),
    // cloud.move_to_cloud: a song's details offer "Upload to your cloud library"
    fromDevice: on('cloud.move_to_cloud') ? { request: media, openStore } : null,
  });

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
        stage={false} next={remote ? undefined : data.mix[now.position + 1]}
        waitingRequests={on('requests') ? waitingCount(roomShown, songRequests.requests) : 0}
        onRequests={() => setRequesting(true)}
        onActivity={() => setActivityOpen(true)}
        onHelp={controls.onHelp}
        onCommands={controls.onCommands}
        mode="cloud"
        more={moreItems}
        account={onSignOut ? { email: account.user.email, plan: planName(account), onSignOut } : undefined}
        status={room && roomsPlace && !(route.page === 'more' && route.id === 'rooms') ? <RoomOpenLine room={room} path={roomsPlace.path} waiting={roomWaiting} add={roomAdd} /> : undefined}
        banner={<CloudShellNotices account={account} workspaceId={workspaceId} on={on} playback={playback} deviceName={(id) => holdings.devices?.find((one) => one.device_id === id)?.name ?? null}
          asked={askedBanner} accountMix={accountMix.banner} where={where} playNoticeShown={!(route.page === 'listen' && (remote || !followsHere))} onPlayHere={() => void shellPlayer.togglePause()}
          onListen={route.page === 'listen'} offlineShell={offlineShell} servedFrom={servedFrom} offlineReadOnly={offlineReadOnly} notices={notices} accountNotices={accountNotices} feedback={feedback} />}
        // cloud.page_layout: another tab playing is said in the mini player, off Listen
        playerNote={on('cloud.page_layout') && route.page !== 'listen' ? otherTabNote(playback, () => void shellPlayer.togglePause()) : undefined}
      >
        {/* one page's render error stays inside that page, as in the hosted shell */}
        <HolderContext.Provider value={holderValue}><LibraryPlacesContext.Provider value={libraryPlaces}><Section key={route.page === 'more' ? `more-${route.id}` : route.page} name={describeRoute(route).title}><CloudShellPages at={{
          api, cloud, request, media, workspaceId, on, route, moreItems, more, shared, status, statusProblem, setStatusProblem, refreshStatus, refreshMix,
          data, mixProblem, setMixData, shellPlayer, now, playback, refusal, output, notify, openStore, connect, sweepLapsed, stems, recipes, deviceTrack, book,
          lucyHere, offlineShell, browserHarmonic, workspacePage, coexisting, newMember, spineDeps, setSpine, setSpineAsked, savedMixes, fileCheck, connected, mixReady, localExport, importLive,
          remote, playWays, holdings, where, followsHere, newest, songOrder, playOn,
        }} /></Section></LibraryPlacesContext.Provider></HolderContext.Provider>
        <footer className="cloud-footer">{footerWords(coexisting, on('cloud.move_to_cloud'))}</footer>
      </Shell>
      {requesting && on('requests') && (
        <Drawer title="Requests" onClose={() => setRequesting(false)}>
          <RequestsPanel />
        </Drawer>
      )}
      {activityOpen && (on('app.activity') || on('export')) && <DeviceActivityDrawer workspaceId={workspaceId} titleOf={(id) => data.mix.find((item) => item.song_id === id)?.title ?? null} onClose={() => setActivityOpen(false)} />}
      {controls.overlays}
    </BytesContext.Provider>
    </StemSurfacesContext.Provider>
    </PlayedTransitions.Provider>
    </RequestsContext.Provider>
    </RequestContext.Provider>
  );
}
