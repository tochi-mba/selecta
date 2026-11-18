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
import { Skeleton } from '../ui/controls';
import { countOf } from '../ui/format';
import { showToast } from '../ui/toasts';
import { Library } from '../views/Library';
import { Mixes } from '../views/Mixes';
import { MyMixes } from '../views/MyMixes';
import { Now } from '../views/Now';
import type { View, ViewProps } from '../views/shared';
import type { Account, Api } from './api';
import { ConnectMusic, mediaDeviceId } from './ConnectMusic';
import { hostedResolver, matchAsset, readHostedAssets, type HostedAsset } from './hostedMedia';
import { isHostedAccount } from './localFirstGate';
import { CannotPlayHere, LibraryEmpty, ListenEmpty, MixesEmpty, NotOnThisAccount, OnlyOnYourComputer } from './LocalFirstEmpty';
import { useLocalFirstPlayer } from './localFirstPlayer';
import { BROWSER_MIX_NEEDS } from './localFirstMixes';
import { EMPTY_MIX, localFirstRequest, mediaRequest, type AvailabilitySources } from './localFirstRequest';
import { recipeStore, type RecipeStore, type RecipeSummary } from './recipeStore';
import { QueueSources } from './QueueSources';
import { CutoverNotice } from './migration/CutoverNotice';
import { OnboardingSpine } from './onboarding/OnboardingSpine';
import { browserStorage, onboardingFinished, recordImportOutcome } from './onboarding/state';
import { ImportChip } from './ImportChip';
import { StorageCard } from './StorageCard';
import { bindImportWorkspace, endImportSession, useImportSession } from './importSession';
import { useServerFreeControls } from './serverFreeControls';

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
  requests: false,
  editor: false,
  'app.activity': false,
  export: false,
  lucy: false,
  // lyrics are looked up by this computer's own server; the browser has none to show or require
  'lyrics.lookup': false,
  // a browser mix has no measured feel, energy or stems to shape by; its ending can be chosen
  'mixes.shaping.feel': false,
  'mixes.shaping.energy_arc': false,
  'mixes.shaping.stem_moves': false,
} as const;

const VIEW_PATHS: Record<View, string> = { Mixes: '/mixes', Now: '/listen', Edit: '/mix/current/edit', Library: '/library', Words: '/discover', Workshop: '/workshop' };
const IDLE = (): void => {};
const AVAILABILITY_REFRESH_MS = 12 * 60 * 60 * 1000;

export function LocalFirstShell({ api, account, more, notices, feedback }: {
  api: Api;
  account: Account;
  /** The account panel for a More destination, drawn by CloudApp with its own handlers. */
  more: (id: MoreDestinationId) => ReactNode;
  /** The account's notices (suspended, account problem, over quota, paused live updates), drawn
   * by CloudApp from the same sources as the hosted frame, shown first in the banner. */
  notices?: ReactNode;
  feedback?: ReactNode;
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
  const sweepLapsed = useCallback((forceReport = false): Promise<void> => {
    if (forceReport) forceSweepPending.current = true;
    if (sweeping.current) return sweeping.current;

    const task = (async () => {
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
          if (on('cloud.local_media')) {
            const snapshot = await deviceAvailabilitySnapshot(opened, lapsedItems);
            try {
              if (!mediaRef.current) throw new Error('not ready');
              await reportDeviceAvailability(mediaRef.current, mediaDeviceId(workspaceId), snapshot, true);
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
        // A force arriving at the very end of the active pass must not be dropped.
        if (forceSweepPending.current) void sweepLapsed();
      }
    })();
    sweeping.current = task;
    return task;
  }, [on, openStore, workspaceId]);
  const recipes = useMemo(() => recipeStore(cloud, workspaceId), [cloud, workspaceId]);
  const sources = useMemo<AvailabilitySources>(() => ({
    here: async () => {
      const opened = await openStore();
      const found = new Map<number, 'here' | 'reauth'>();
      for (const song of await opened.all()) {
        const why = lapsed.current.get(song.songId);
        // a file the sweep found gone is not on this device; a lapsed permission asks again;
        // a song picked without a durable handle plays only while this visit holds its file
        if (why === 'missing' || why === 'changed' || song.availabilityIssue === 'changed') continue;
        if (song.ref.kind !== 'handle' && !opened.sessionFile(song.songId)) continue;
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
  }), [api, cloud, workspaceId, coexisting, openStore, recipes]);
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
      if (on('cloud.local_media')) {
        const snapshot = present ? { present: [songId], absent: [] } : { present: [], absent: [songId] };
        void reportDeviceAvailability(media, mediaDeviceId(workspaceId), snapshot).then(() => {
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
      .catch((error: Error) => setStatusProblem(error.message));
  }, [request]);
  const refreshMix = useCallback(() => { request<MixData>('/mix').then(setData).catch(() => undefined); }, [request]);
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
  useEffect(() => {
    setJobsSource(false);
    setFlags({ ...NOT_IN_THE_BROWSER });
    return () => { setJobsSource(true); setFlags(null); };
  }, []);

  const { player, refusal, device: playback } = useLocalFirstPlayer({
    api, workspaceId, mix: data.mix, remoteControl: on('devices.remote_control'), resolver,
  });
  const resolveTrack = useCallback<MediaResolver>(async (songId) => (await resolver())?.(songId) ?? null, [resolver]);
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
  const route: ShellRoute = moreRouteOf(path) ?? parseRoute(path);
  const moreItems = moreDestinationsFor({ mode: 'cloud', feature: on, experience: account.experience ?? null });
  const connected = status?.counts.music ?? 0;
  const [spine, setSpine] = useState(() => !onboardingFinished(workspaceId));
  // frozen at the first status: songs landing mid-import must not unmount the spine under the member
  const startedEmpty = useRef<boolean | null>(null);
  if (status !== null && startedEmpty.current === null) startedEmpty.current = connected === 0;
  const newMember = spine && startedEmpty.current === true;

  const notify = useCallback<ViewProps['notify']>((message, undo) => {
    showToast(message, typeof undo === 'function' ? { undo } : {});
  }, []);
  const shared: ViewProps | null = status && {
    status, mix: data.mix, mixName: data.name, currentMixName: data.name, canUndo: data.can_undo, mixEta: data.eta,
    refreshMix, setMixData, refreshStatus, request, player: shellPlayer, now, readyNeeded: BROWSER_MIX_NEEDS,
    analysisAvailable: false, transitionEditingAvailable: false, visualizerAvailable: false,
    setView: (view: View) => navigate(VIEW_PATHS[view]), notify, stage: false, toggleStage: IDLE,
  };
  const song = data.mix[now.position];
  const localExport: ReactNode = null;
  // Ctrl K, the single keys and their help, for what this shell really has (W5's server-free
  // subset); the media keys and what the OS shows as playing drive the browser player.
  const places = [
    ...destinationsFor({ mode: 'cloud', feature: on, experience: account.experience ?? null }).filter((place) => place.id !== 'workspace'),
    ...moreItems,
  ].map((place) => ({ id: place.id, label: place.label, path: place.path, about: place.about }));
  const controls = useServerFreeControls({ places, player: shellPlayer, now, hasMix: data.mix.length > 0, hasNext: data.mix.length > now.position + 1 });
  const currentMix = useCallback(() => data.mix, [data.mix]);
  useMediaKeys({ on: on('listen.media_keys'), player: shellPlayer, getMix: currentMix, mixName: data.name, now });
  const connect = <ConnectMusic request={media} workspaceId={workspaceId} openStore={openStore} onAvailabilityChanged={() => sweepLapsed(true)} />;

  const page = (): ReactNode => {
    if (route.page === 'more') {
      const item = moreItems.find((place) => place.id === route.id);
      if (!item) return <NotOnThisAccount />;
      if (item.id === 'workspace') return <ThisDevice openStore={openStore}>{connect}</ThisDevice>;
      return <main className="page" id="main"><h1 className="display small">{item.label}</h1><div className="stack">{more(item.id)}</div></main>;
    }
    if (!shared) {
      return <main className="page" id="main" aria-busy={!statusProblem}><h1 className="display small">{describeRoute(route).title}</h1>{statusProblem ? <p role="alert">{statusProblem}</p> : <Skeleton variant="rows" lines={4} label="Opening your library" />}</main>;
    }
    if (newMember) {
      return (
        <main className="page" id="main">
          <h1 className="display small">Welcome to SelectaDJ</h1>
          <OnboardingSpine request={media} workspaceId={workspaceId} onDone={() => { setSpine(false); refreshStatus(); }} />
          <button className="quiet" onClick={() => setSpine(false)}>Look around first</button>
        </main>
      );
    }
    switch (route.page) {
      case 'library':
        return connected === 0
          ? <main className="page" id="main"><h1 className="display small">Library</h1><LibraryEmpty />{connect}</main>
          : <><Library {...shared} /><div className="page">{connect}</div></>;
      case 'mixes':
        if (route.tab === 'mine') return <><MyMixes {...shared} suppressDrafts />{on('drafts') && <SavedBrowserRecipes workspaceId={workspaceId} recipes={recipes} request={request} setMixData={setMixData} refreshStatus={refreshStatus} />}{localExport}</>;
        return <>{(status?.counts.ready ?? 0) >= BROWSER_MIX_NEEDS ? <Mixes {...shared} /> : (
          <MixesEmpty
            connected={connected}
            checking={importLive.phase === 'running' ? { checked: importLive.registered, total: importLive.total } : undefined}
          />
        )}{localExport}</>;
      case 'listen':
        return (
          <>
            {refusal && <div className="page"><CannotPlayHere reason={refusal} /></div>}
            {data.mix.length ? <Now {...shared} /> : <ListenEmpty connected={connected} />}
            {on('cloud.local_media') && data.mix.length > 0 && <div className="page"><QueueSources mix={data.mix} book={book} /></div>}
          </>
        );
      case 'missing':
        return <OnlyOnYourComputer title="That page" nearest={{ label: 'Library', path: '/library' }} />;
      default: {
        const nearest = DESTINATIONS.find((place) => place.id === destinationOf(route) && place.id !== 'workspace') ?? DESTINATIONS.find((place) => place.id === 'library')!;
        return <OnlyOnYourComputer title={describeRoute(route).title} nearest={{ label: nearest.label, path: nearest.path }} />;
      }
    }
  };

  return (
    <RequestContext.Provider value={request}>
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
        waitingRequests={0}
        onRequests={IDLE}
        onHelp={controls.onHelp}
        onCommands={controls.onCommands}
        mode="cloud"
        more={moreItems}
        banner={<>{notices}{on('devices.remote_control') && playback.view?.speaker !== 'here' && <ControllerNotices notices={playback.view?.notices} speakerName={playback.view?.speaker_name ?? null} session={playback.view?.session ?? null} send={(name, args) => { void playback.command(name, args); }} />}{on('cloud.progressive_import') && <ImportChip workspaceId={workspaceId} onView={() => navigate('/workshop')} />}{isHostedAccount(account) && <CutoverNotice accountId={account.user.id} />}{feedback}</>}
      >
        {page()}
        <footer className="cloud-footer">SelectaDJ Cloud. Your music files stay on your devices; your account keeps their details.</footer>
      </Shell>
      {controls.overlays}
    </BytesContext.Provider>
    </RequestContext.Provider>
  );
}

/** Browser-first saved recipes keep their server identity (string mix_id). The shared local Drafts
 * actions use numeric IDs and /drafts mutation routes that recipes do not have, so this list offers
 * only the operation the recipe contract supports: making a saved recipe the current mix. Playback
 * remains in the shared Current mix card, where the device resolver can refuse missing files. */
function SavedBrowserRecipes({ workspaceId, recipes, request, setMixData, refreshStatus }: {
  workspaceId: string;
  recipes: RecipeStore;
  request: NonNullable<ViewProps['request']>;
  setMixData: ViewProps['setMixData'];
  refreshStatus: ViewProps['refreshStatus'];
}) {
  const [list, setList] = useState<RecipeSummary[] | null>(null);
  const [problem, setProblem] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const latest = useRef({ recipes, request, setMixData, refreshStatus });
  latest.current = { recipes, request, setMixData, refreshStatus };
  const load = useCallback(() => {
    setProblem('');
    return latest.current.recipes.list().then((next) => setList(next)).catch((error: Error) => setProblem(error.message || 'Couldn’t load your saved mixes.'));
  }, []);
  useEffect(() => {
    setList(null);
    void load();
  }, [load, workspaceId]);
  const useAsCurrent = async (recipe: RecipeSummary) => {
    if (pending) return;
    setPending(recipe.mix_id);
    setNotice('');
    setProblem('');
    const { recipes: currentRecipes, request: currentRequest, setMixData: updateMix, refreshStatus: refresh } = latest.current;
    const previous = currentRecipes.current();
    currentRecipes.setCurrent(recipe.mix_id);
    try {
      const current = await currentRequest<MixData>('/mix');
      updateMix(current);
      refresh();
      setNotice(`${recipe.name} is now your current mix. Use Play on the current mix when its songs are available to play here.`);
    } catch (error) {
      currentRecipes.setCurrent(previous);
      setProblem((error as Error).message || 'Couldn’t open that saved mix.');
    } finally { setPending(null); }
  };
  const currentId = recipes.current();
  return (
    <section className="panel stack" aria-labelledby="saved-browser-mixes">
      <h2 id="saved-browser-mixes">Saved browser mixes</h2>
      {problem && <p className="warn" role="alert">{problem} <button onClick={() => void load()}>Try again</button></p>}
      {notice && <p className="hint" role="status">{notice}</p>}
      {list === null && !problem && <Skeleton variant="rows" lines={2} label="Loading saved mixes" />}
      {list?.length === 0 && <div className="empty-state"><p role="status">No saved drafts yet. Make a Mix to create one.</p><button className="primary" onClick={() => navigate('/mixes')}>Make a Mix</button></div>}
      {!!list?.length && <ul className="draft-list density">
        {list.map((recipe) => {
          const selected = recipe.mix_id === currentId;
          return <li className="draft" key={recipe.mix_id}>
            <div className="draft-name"><b>{recipe.name}</b><span className="soft">{countOf(recipe.songs, 'song')} · saved browser mix</span></div>
            <div className="row wrap draft-actions">
              <button disabled={selected || pending !== null} onClick={() => void useAsCurrent(recipe)}>{pending === recipe.mix_id ? 'Opening…' : selected ? 'Current mix' : 'Use as current mix'}</button>
            </div>
          </li>;
        })}
      </ul>}
    </section>
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
