import { lazy, startTransition, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get, MixData, MixItem, OFFLINE_WORDS, post, problemKind, Status } from './api';
import { getDraftNames } from './state/draftNames';
import { audioOwner, connectMainPlayer, mainPlayerTouched, stopPreviewsOnly } from './audio/focus';
import { bindMediaSession, syncMediaSession } from './audio/mediaSession';
import { setFlags, useFlags } from './flags';
import { loadResume } from './lib';
import { NowState, SetPlayer } from './player';
import { navigate, useRoute } from './router';
import { buildCommands } from './shell/commands';
import { describeRoute, shownRoute } from './shell/manifest';
import { PageLink, Shell } from './shell/Shell';
import { markNewestUndone } from './state/activity';
import { keepIfSame, keepUnchangedMix } from './state/keepUnchanged';
import { prefs, readFlagFromAddress, setPrefs, usePrefs } from './state/prefs';
import { Links, Mix, MyMixes, warmRouteChunks, Workshop } from './routeChunks';
import { watchLowPower } from './ui/lowPower';
import { orderOf } from './state/readiness';
import { shortcutFor, shortcutsOn } from './state/shortcuts';
import { openGlossary } from './state/glossaryRequests';
import { sayThisTabIsPlaying, whenAnotherTabPlays } from './state/tabs';
import { ActivityPanel } from './ui/ActivityPanel';
import { CommandPalette } from './ui/CommandPalette';
import { Action, announce, Dialog, Drawer, Section, Skeleton } from './ui/controls';
import { GlossaryHost } from './ui/Glossary';
import { setToastsQuiet, showProblem, showToast } from './ui/toasts';
import { useVisiblePoll } from './ui/useVisiblePoll';
import { ExportJobs } from './views/ExportJobs';
import { Library } from './views/Library';
import { ListenEmpty } from './views/ListenEmpty';
import { Mixes } from './views/Mixes';
import { Now } from './views/Now';
import { RequestsContext, RequestsPanel, waitingRequestCount, useRequests } from './views/Requests';
import { Start } from './views/Start';
import { MixScope } from './views/mixScope';
import { prefetchLibrary } from './views/libraryPrefetch';
import { takeStartupStatus } from './startupStatus';
import { draftMovesWaiting } from './views/optimisticMove';
import type { Undo, View } from './views/shared';

// Lucy is optional and only loaded when someone opens it, so it costs Make a Mix nothing.
const Lucy = lazy(() => import('./views/Lucy'));

const PATHS: Record<View, string> = {
  Mixes: '/mixes',
  Now: '/listen',
  Edit: '/mix/current/edit',
  Library: '/library',
  Words: '/discover',
  Workshop: '/workshop',
};

const SET_UP_KEY = 'selecta.setUp';

function hasBeenSetUp(): boolean {
  try {
    return window.localStorage.getItem(SET_UP_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSetUp() {
  try {
    window.localStorage.setItem(SET_UP_KEY, '1');
  } catch {
    // this only changes the wording if the server is ever unreachable
  }
}

const scopeKey = (scope: number | null) => (scope === null ? 'current' : `draft:${scope}`);

const nameOfControl = (control: HTMLElement) => (control.getAttribute('aria-label') ?? control.textContent ?? '').trim();

export function App() {
  // a page whose feature is off in this build is Not Found, as if it had never been built
  const on = useFlags();
  const route = shownRoute(useRoute());
  const routeRef = useRef(route);
  routeRef.current = route;

  // Keep the player and the first listening/browsing surfaces in the entry bundle. Once that
  // first frame has painted, fetch the editor and secondary workspaces while the browser is idle.
  // The route loaders contain page code only, so this can never delay or reschedule audio.
  useEffect(() => warmRouteChunks(), []);
  const [status, setStatus] = useState<Status | null>(null);
  const [problem, setProblem] = useState('');
  const [data, setData] = useState<MixData>({ mix: [], name: 'Your mix', can_undo: false });
  const currentCanUndo = useRef(data.can_undo);
  currentCanUndo.current = data.can_undo;
  const [helping, setHelping] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [commanding, setCommanding] = useState(false);
  const [commandDrafts, setCommandDrafts] = useState<{ id: number; name: string }[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [stage, setStage] = useState(false);
  const [stageFallback, setStageFallback] = useState(false);
  const preferences = usePrefs();
  useEffect(() => readFlagFromAddress(window.location.search), []);
  // SF-0235-08: lower decorative motion on a device that can't keep up (not under unit tests,
  // where a frame loop would only spin).
  useEffect(() => (import.meta.env.MODE === 'test' ? undefined : watchLowPower()), []);
  const mix = data.mix;
  const mixRef = useRef<MixItem[]>([]);
  mixRef.current = mix;
  const shownData = useRef(data);
  shownData.current = data;

  // an edit's answer is newer than a check that was already on its way, so that check is ignored
  const mixChanges = useRef(0);
  const setMixData = useCallback((next: MixData) => {
    mixChanges.current += 1;
    mixRef.current = next.mix;
    setData(next);
  }, []);
  const refreshMix = useCallback(() => {
    const seen = mixChanges.current;
    get<MixData>('/mix')
      .then((next) => {
        // r8c: an answer that changes nothing keeps what's shown, so a long editor doesn't redraw
        if (seen === mixChanges.current) setMixData(keepUnchangedMix(shownData.current, next));
      })
      .catch((error: Error) => {
        // a stopped server is shown once, across the top, not as a stream of messages
        if (problemKind(error) !== 'offline') showProblem(`Couldn’t read your mix: ${error.message}`);
      });
  }, [setMixData]);
  // Status can be requested by a timer and several views at once. Sharing
  // the same in-flight read prevents an older, slow status reply from
  // overwriting a newer one and stops a disconnected server being hammered.
  const statusReading = useRef<Promise<void> | null>(null);
  const refreshStatus = useCallback(() => {
    if (statusReading.current) return statusReading.current;
    const work = get<Status>('/status')
      .then((next) => {
        setFlags(next.flags);
        setStatus((before) => keepIfSame(before, next));
        setProblem('');
      })
      .catch((error: Error) => setProblem(error.message))
      .finally(() => {
        if (statusReading.current === work) statusReading.current = null;
      });
    statusReading.current = work;
    return work;
  }, []);

  // Which draft is open comes from the address, so it can't be confused with the current mix.
  const draftId = route.page === 'edit' ? route.draft : null;
  const [draftData, setDraftData] = useState<MixData | null>(null);
  // The global keyboard handler must read the latest loaded identity synchronously,
  // including between a render and its effect re-subscription.
  const draftDataRef = useRef(draftData);
  draftDataRef.current = draftData;
  const [draftGone, setDraftGone] = useState(false);
  const draftRef = useRef(draftId);
  draftRef.current = draftId;
  const draftMixRef = useRef<MixItem[]>([]);
  // as with the current mix, an edit (or a move shown before its answer) is newer than a read already on its way
  const draftChanges = useRef(0);
  const setDraftMix = useCallback((next: MixData) => {
    draftChanges.current += 1;
    draftMixRef.current = next.mix;
    setDraftData(next);
  }, []);
  const refreshDraft = useCallback(() => {
    const asked = draftRef.current;
    if (asked === null) return;
    const seen = draftChanges.current;
    get<MixData>(`/mix?draft=${asked}`)
      .then((next) => {
        // MI-0162-05: nor while draft moves are on their way, which this read may predate. Only moves
        // already on screen in this draft count: one not shown yet has none, and another draft's moves
        // must not leave it on its loading skeleton.
        const movesShown = draftMovesWaiting() && draftDataRef.current?.draft?.id === asked;
        if (draftRef.current !== asked || seen !== draftChanges.current || movesShown) return;
        setDraftMix(keepUnchangedMix(draftDataRef.current?.draft?.id === asked ? draftDataRef.current : null, next));
        setDraftGone(false);
      })
      .catch((error: Error) => {
        if (draftRef.current !== asked) return;
        // a draft that's gone says so, rather than quietly showing a different mix
        if (error instanceof ApiError && error.status === 404) setDraftGone(true);
      });
  }, [setDraftMix]);
  useEffect(() => {
    setDraftData(null);
    setDraftGone(false);
    refreshDraft();
  }, [draftId, refreshDraft]);
  const openDraft = useCallback((id: number) => navigate(`/mixes/drafts/${id}/edit`), []);
  // r8c: pages are memoised, so what they're handed keeps its identity from one render to the next
  const refreshStatusQuietly = useCallback(() => void refreshStatus(), [refreshStatus]);
  const openRequests = useCallback(() => setRequesting(true), []);
  const renamedDraft = useCallback((name: string) => setDraftData((before) => (before ? { ...before, name } : before)), []);
  const closeDraft = useCallback(() => {
    if (draftRef.current !== null) navigate('/mix/current/edit');
  }, []);
  const goTo = useCallback((next: View) => navigate(PATHS[next]), []);

  // With `order`, it only goes ahead if that mix is still in the order it was left in, because undoing
  // always takes back the newest change, and that may no longer be the change this was offered for.
  const undoIn = useCallback(async (scope: number | null, order?: string) => {
    const next = await post<MixData>(scope === null ? '/mix/undo' : `/mix/undo?draft=${scope}`, undefined, order === undefined ? undefined : { 'x-mix-order': order });
    if (scope === null) setMixData(next);
    else if (draftRef.current === scope) setDraftMix(next);
    showToast(next.undone ? `Undid ${next.undone}.` : 'Nothing to undo.');
    return !!next.undone;
  }, [setMixData, setDraftMix]);
  const undoNewest = useCallback(async (scope: number | null) => {
    // if the server had nothing to take back, Activity mustn't say something was undone
    if (await undoIn(scope)) markNewestUndone(scopeKey(scope));
  }, [undoIn]);
  const notify = useCallback((message: string, undo: Undo = false) => {
    if (typeof undo === 'function') {
      showToast(message, { undo });
    } else if (undo) {
      // it undoes the mix this was said about, wherever you are when you press it
      const scope = draftRef.current;
      const order = orderOf(scope === null ? mixRef.current : draftMixRef.current);
      // UF-0380-07: the toast itself names the mix that changed, not only Activity
      const where = scope === null ? shownData.current.name : draftDataRef.current?.name;
      showToast(message, { scope: scopeKey(scope), undo: () => undoIn(scope, order), where });
    } else {
      showToast(message);
    }
  }, [undoIn]);

  // Any action that fails says so, rather than appearing to do nothing.
  useEffect(() => {
    const failed = (event: PromiseRejectionEvent) => {
      const message = event.reason instanceof Error ? event.reason.message : 'Something went wrong.';
      showProblem(message);
    };
    window.addEventListener('unhandledrejection', failed);
    return () => window.removeEventListener('unhandledrejection', failed);
  }, []);

  // kept for the life of the app, above every page, so nothing a page does can start a second one
  const [player] = useState(() => new SetPlayer(() => mixRef.current, refreshMix));
  useEffect(() => {
    connectMainPlayer({
      isPlaying: () => player.state.phase === 'playing',
      pause: () => player.pause(),
      resume: () => player.resume(),
    });
    return () => connectMainPlayer(null);
  }, [player]);
  const [confirmDraft, setConfirmDraft] = useState<{ id: number; from: number; order: string; replacing: string } | null>(null);
  const activatingDraft = useRef(false);
  const activateDraft = useCallback(async (id: number, from: number, expectedOrder: string) => {
    if (activatingDraft.current) return;
    activatingDraft.current = true;
    try {
      // The server rejects a draft activation if the current mix changed in
      // another tab since the listener chose which mix to replace.
      const next = await post<MixData>(`/drafts/${id}/play`, undefined, { 'x-mix-order': expectedOrder });
      setMixData(next);
      navigate('/listen');
      void player.playFrom(from);
      const order = orderOf(next.mix);
      showToast(`Now playing ${next.name}. What was playing is kept in your drafts.`, { scope: 'current', undo: () => undoIn(null, order) });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'mix_changed') refreshMix();
      throw error;
    } finally {
      activatingDraft.current = false;
    }
  }, [player, refreshMix, setMixData, undoIn]);
  const playDraft = useCallback((id: number, from = 0) => {
    const order = orderOf(mixRef.current);
    if (mixRef.current.length && player.state.phase !== 'idle') {
      setConfirmDraft({ id, from, order, replacing: data.name });
      return Promise.resolve();
    }
    return activateDraft(id, from, order);
  }, [activateDraft, data.name, player]);
  const requests = useRequests({ mix, player, onMix: setMixData }, notify);
  const foundAt = useRef<number | null>(null);
  useEffect(() => {
    const found = status?.new_songs;
    if (!found || found.at === foundAt.current) return;
    const firstSeen = foundAt.current === null;
    foundAt.current = found.at;
    if (firstSeen && Date.now() / 1000 - found.at > 300) return;
    const what = found.count === 1 ? `a new song, ${found.first}` : `${found.count} new songs`;
    notify(`Found ${what} in your folder. Adding to your library and analysing.`);
  }, [status?.new_songs, notify]);
  const [now, setNow] = useState<NowState>(player.state);
  // the music ticks 20 times a second. Listen wants that fairly often, for the lyrics, and every other
  // page only needs to know when something other than the time has changed, or a second has gone by
  const shownNow = useRef(player.state);
  const shownAt = useRef(0);
  useEffect(() => {
    player.onChange = (next) => {
      const before = shownNow.current;
      const { songTime: _time, ...rest } = next;
      const { songTime: _was, ...restBefore } = before;
      const sameOtherwise = JSON.stringify(rest) === JSON.stringify(restBefore);
      const moment = performance.now();
      const listening = routeRef.current.page === 'listen';
      const due = listening ? moment - shownAt.current >= 80 : Math.floor(next.songTime) !== Math.floor(before.songTime);
      if (sameOtherwise && !due) return;
      shownNow.current = next;
      shownAt.current = moment;
      setNow(next);
    };
  }, [player]);

  // Only one tab plays at a time. The one that starts playing takes the sound.
  useEffect(() => {
    if (now.phase === 'playing') sayThisTabIsPlaying();
  }, [now.phase]);
  useEffect(() => whenAnotherTabPlays(() => {
    // the other tab has the sound now, so nothing finishing here may bring this one back over it
    mainPlayerTouched();
    const previewing = !!audioOwner();
    stopPreviewsOnly();
    if (player.state.phase !== 'playing' && !previewing) return;
    void player.pause();
    showToast('Playing in another tab now. Press play here to bring it back.');
  }), [player]);

  useEffect(() => {
    // MI-0162-04: opened on the Library, its first rows are asked for now, not after status and the mix
    if (window.location.pathname === '/library') prefetchLibrary(window.location.search);
    // S4-0111-05: the status read just before the app started is used, not asked for a second time
    const handed = takeStartupStatus<Status>();
    if (handed) {
      setFlags(handed.flags);
      setStatus(handed);
    } else void refreshStatus();
    const seen = mixChanges.current;
    get<MixData>('/mix')
      .then((next) => {
        // A user may act before the first read returns, including from
        // another tab. Do not replace that newer state with startup data.
        if (seen !== mixChanges.current) return;
        setMixData(next);
        const resume = loadResume(next.mix);
        if (resume) {
          player.cue(resume.position, resume.time);
          // an address that says where to go wins over where you were listening
          if (window.location.pathname === '/') navigate('/listen', { replace: true });
        }
      })
      .catch((error: Error) => {
        if (problemKind(error) !== 'offline') showProblem(`Couldn’t read your mix: ${error.message}`);
      });
  }, [refreshStatus, setMixData, player]);
  // A hidden tab stops asking the server and catches up the moment it's looked at again.
  useVisiblePoll(refreshStatus, 4000);

  const firstMixRoute = useRef(true);
  useEffect(() => {
    // Startup has its own one-time read and resume handling. Route changes
    // afterwards refresh the authoritative current mix without double reads.
    if (firstMixRoute.current) { firstMixRoute.current = false; return; }
    refreshMix();
  }, [route.page, refreshMix]);

  // Coming back after the server was away, everything shown may be out of date.
  const wasAway = useRef(false);
  useEffect(() => {
    if (problem) {
      wasAway.current = true;
    } else if (wasAway.current) {
      wasAway.current = false;
      refreshMix();
      refreshDraft();
    }
  }, [problem, refreshMix, refreshDraft]);

  // A draft being rendered has to show that as it happens too.
  const draftBusy = !!draftData && (draftData.draft?.place != null || draftData.mix.some((item) => ['queued', 'rendering'].includes(item.seam?.state.status ?? '')));
  // r8c: while the server is away only the status check keeps trying; coming back reads both again
  useVisiblePoll(refreshDraft, 2000, draftBusy && !problem);

  // Anything still rendering gets checked often, so its status changes on its own.
  const busy = mix.some((item) => ['none', 'queued', 'rendering'].includes(item.seam?.state.status ?? ''));
  useVisiblePoll(refreshMix, 1500, busy && !problem);

  const playing = mix[now.position];
  const active = now.phase !== 'idle';

  // said once for each song, so a screen reader isn't talking over the music all the time
  useEffect(() => {
    if (active && playing?.title) announce(`Now playing ${playing.title} by ${playing.artist}`);
  }, [active, playing?.title, playing?.artist]);

  const pageTitle = describeRoute(route).title;
  useEffect(() => {
    document.title = active && playing ? `${playing.title} · Selecta` : `${pageTitle} · Selecta`;
  }, [active, playing?.title, pageTitle]);

  // a library that exists means this person is set up, even if the server is away next time
  const setUp = !!status && status.counts.total > 0;
  useEffect(() => {
    if (setUp) rememberSetUp();
  }, [setUp]);

  // Register media keys just once. Handlers read live state so they cannot act on a stale song.
  const mediaKeys = on('listen.media_keys');
  useEffect(() => {
    if (!('mediaSession' in navigator) || !mediaKeys) return;
    return bindMediaSession(navigator.mediaSession, player, () => mixRef.current);
  }, [player, mediaKeys]);

  // The OS advances at playbackRate 1 between these authoritative one-second updates.
  // Preview ownership never turns the paused mix into a second apparent player.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !mediaKeys) return;
    const update = () => {
      const state = player.state;
      syncMediaSession(navigator.mediaSession, state, mixRef.current[state.position], data.name, !!audioOwner());
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [player, mediaKeys, now.phase, now.position, playing?.song_id, playing?.title, playing?.artist, data.name]);

  // Going on stage hides everything that had focus, so coming back puts focus back where it was.
  const beforeStage = useRef<{ element: HTMLElement | null; name: string } | null>(null);
  const noteFocusForStage = () => {
    if (document.fullscreenElement || stageRef.current) return;
    const element = document.activeElement as HTMLElement | null;
    beforeStage.current = { element, name: element ? nameOfControl(element) : '' };
  };
  const stageRef = useRef(false);
  stageRef.current = stage;
  const toggleStage = useCallback(() => {
    if (!on('listen.stage') && !stageRef.current) return;
    noteFocusForStage();
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (stageRef.current) {
      setStage(false);
      setStageFallback(false);
      return;
    }
    const asked = document.documentElement.requestFullscreen?.();
    const fillThePage = () => {
      setStage(true);
      setStageFallback(true);
    };
    // a browser can say no, and the lyrics still fill the page
    if (asked) void asked.catch(fillThePage);
    else fillThePage();
  }, []);
  useEffect(() => {
    const change = () => {
      setStage(!!document.fullscreenElement);
      setStageFallback(false);
    };
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  // The Stage belongs to Listen. Going to another page while it is open (Back, a link, a shortcut)
  // leaves it, and the browser's fullscreen with it, instead of keeping that page fullscreen (T0128).
  useEffect(() => {
    if (route.page === 'listen' || !stageRef.current) return;
    setStage(false);
    setStageFallback(false);
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
  }, [route.page]);
  useEffect(() => {
    setToastsQuiet(stage);
    if (stage) return;
    const back = beforeStage.current;
    beforeStage.current = null;
    if (!back) return;
    if (back.element?.isConnected && back.element !== document.body) {
      back.element.focus();
      return;
    }
    // the Stage replaced the controls, so what had focus is a new button with the same name by now
    const again = back.name
      ? [...document.querySelectorAll<HTMLElement>('#main button, #main a, #main summary')].find((control) => control.offsetParent !== null && nameOfControl(control) === back.name)
      : undefined;
    (again ?? document.getElementById('main'))?.focus({ preventScroll: !again });
  }, [stage]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHelping(false);
        // also cancels a palette opening that hasn't painted yet (Ctrl K then Escape at once)
        setCommanding(false);
        if (!document.fullscreenElement) {
          setStage(false);
          setStageFallback(false);
        } else if (stageRef.current) {
          // a browser usually takes Escape for itself; when the page gets it, it still leaves Stage (MP-0285-05)
          void document.exitFullscreen?.().catch(() => {});
        }
      }
      const shortcut = shortcutFor(event);
      if (!shortcut) return;
      if (shortcut !== 'palette' && !prefs().singleKeys) return;
      switch (shortcut) {
        case 'palette':
          // turned off, it leaves the browser's own Ctrl K alone
          if (!prefs().palette) return;
          event.preventDefault();
          // MP-0298-06: opening re-renders the whole app (Listen and its visualiser included), so it is a
          // transition: the key press paints at once and the palette renders right after, interruptibly
          startTransition(() => setCommanding(true));
          break;
        case 'playPause':
          event.preventDefault();
          if (mixRef.current.length) void player.togglePause();
          break;
        case 'next': void player.next(); break;
        case 'jump': void player.skip(); break;
        case 'previous': void player.previous(); break;
        case 'mute': player.toggleMute(); break;
        case 'request':
          // focus goes to the search box, and this key press isn't what they wanted to search for
          event.preventDefault();
          setRequesting(true);
          break;
        case 'back5':
        case 'forward5':
          if (player.state.phase === 'idle') return;
          void player.seek(player.state.songTime + (shortcut === 'back5' ? -5 : 5));
          break;
        case 'undo': {
          const place = routeRef.current;
          const scope = place.page === 'edit' ? place.draft : null;
          if (scope !== null) {
            // A draft link can be open before its response arrives, or after a different
            // draft's response. In neither case may the shortcut mutate a guessed scope.
            const loaded = draftDataRef.current;
            if (draftRef.current !== scope || loaded?.draft?.id !== scope) {
              announce('Wait for this draft to load before undoing.');
              break;
            }
            if (!loaded.can_undo) {
              announce('Nothing to undo in this draft.');
              break;
            }
          } else if (!currentCanUndo.current) {
            announce('Nothing to undo in the current mix.');
            break;
          }
          void undoNewest(scope).catch((error: Error) => showProblem(error.message));
          break;
        }
        case 'stage':
          navigate('/listen');
          toggleStage();
          break;
        case 'help': setHelping((on) => !on); break;
        case 'search':
          event.preventDefault();
          navigate('/library');
          // The shortcut is an action, not just a route: when Library is already open it
          // must still put the person in the search box. Defer until navigation has painted
          // so the same path also works from every other page.
          window.setTimeout(() => {
            document.querySelector<HTMLInputElement>('input[type="search"][aria-label="Search your library"]')?.focus();
          }, 0);
          break;
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [player, undoNewest, toggleStage]);

  // the drafts it can jump to are only ever as old as this opening of it
  useEffect(() => {
    if (!commanding || !on('drafts')) return;
    let live = true;
    getDraftNames().then((list) => { if (live) setCommandDrafts(list.drafts); }).catch(() => { if (live) setCommandDrafts([]); });
    return () => { live = false; };
  }, [commanding]);

  if (problem && !status) {
    return (
      <main className="page" id="main">
        <h1 className="display">Can’t reach Selecta.</h1>
        <p className="lede">
          {problem === OFFLINE_WORDS ? '' : `${problem}. `}It may have stopped running. Start it again, and this page will pick up by itself.
          {hasBeenSetUp() ? ' Your library, mixes and ratings are safe, and you won’t have to set anything up again.' : ''}
        </p>
        <Action className="primary" run={refreshStatus} working="Trying…">Try now</Action>
      </main>
    );
  }
  if (!status) return <main className="page" aria-busy="true"><Skeleton label="Starting up" /></main>;
  if (status.counts.total === 0) return <Start status={status} onChange={() => void refreshStatus()} />;

  const shared = {
    status,
    mix,
    mixName: data.name,
    currentMixName: data.name,
    canUndo: data.can_undo,
    mixEta: data.eta,
    refreshMix,
    setMixData,
    refreshStatus: refreshStatusQuietly,
    player,
    now,
    setView: goTo,
    notify,
    stage,
    stageFallback,
    toggleStage,
    openDraft,
    closeDraft,
    playDraft,
    openRequests,
    undo: undoNewest,
  };
  const nothingToHear = route.page === 'listen' && !mix.length;
  const waitingRequests = waitingRequestCount(requests.requests);
  const counts = status.counts;
  const editingDraft = draftId !== null;
  const draftLoaded = editingDraft && draftData?.draft?.id === draftId;
  const commands = commanding ? buildCommands({
    hasMix: mix.length > 0,
    playing: now.phase === 'playing',
    active,
    hasNext: !!mix[now.position + 1],
    canUndo: editingDraft ? !!draftLoaded && !!draftData?.can_undo : data.can_undo,
    undoScope: editingDraft ? (draftLoaded ? `Draft: ${draftData.name}` : `Draft #${draftId}`) : `Current mix: ${data.name}`,
    undoUnavailable: editingDraft && !draftLoaded ? 'Wait for this draft to load.' : undefined,
    readySongs: counts.ready ?? 0,
    songsLeftToAnalyse: Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0),
    analysing: status.analysis_running,
    drafts: commandDrafts,
    theme: preferences.theme,
    motion: preferences.motion,
    togglePause: () => void player.togglePause(),
    next: () => void player.next(),
    jump: () => void player.skip(),
    toggleStage: () => { navigate('/listen'); toggleStage(); },
    openRequests: () => setRequesting(true),
    openActivity: () => setActivityOpen(true),
    openHelp: () => setHelping(true),
    undo: () => {
      const current = routeRef.current;
      const scope = current.page === 'edit' ? current.draft : null;
      if (scope !== draftId || (editingDraft && (!draftLoaded || draftRef.current !== draftId))) {
        showProblem('The open mix changed. Open commands again before undoing.');
        return;
      }
      void undoNewest(draftId).catch((error: Error) => showProblem(error.message));
    },
    startAnalysis: () => {
      void post('/analysis/start').then(() => {
        void refreshStatus();
        showToast('Analysing the rest of your library in the background.');
      }).catch((error: Error) => showProblem(error.message));
    },
  }) : [];
  return (
    <RequestsContext.Provider value={requests}>
      <Shell
        route={route}
        player={player}
        now={now}
        song={playing}
        showPlayer={route.page !== 'listen' && !!playing && active}
        hasMix={mix.length > 0}
        hasNext={mix.length > now.position + 1}
        stage={stage}
        waitingRequests={waitingRequests}
        onRequests={() => setRequesting(true)}
        onHelp={() => setHelping(true)}
        onCommands={() => startTransition(() => setCommanding(true))}
        onActivity={() => setActivityOpen(true)}
        banner={problem ? (
          <div className="connection" role="alert">
            <span><b>Can’t reach Selecta.</b> What’s on screen may be out of date, and anything already loaded keeps playing. Trying again every few seconds.</span>
            <Action run={refreshStatus} working="Trying…">Try now</Action>
          </div>
        ) : undefined}
      >
        <Section name={pageTitle} key={route.page}>
          {/* a split page names itself straight away, so the loading shell is never a page without a heading */}
          <Suspense fallback={<main className="page" id="main" aria-busy="true"><h1 className="display small">{pageTitle}</h1><Skeleton label={`Opening ${pageTitle}`} /></main>}>
          {route.page === 'mixes' && route.tab === 'mine' && <MyMixes {...shared} />}
          {route.page === 'mixes' && route.tab === 'browse' && <Mixes {...shared} />}
          {nothingToHear && <ListenEmpty />}
          {route.page === 'listen' && !nothingToHear && <Now {...shared} />}
          {route.page === 'edit' && draftId === null && <Mix {...shared} key="current" />}
          {route.page === 'edit' && draftId !== null && draftGone && (
            <main className="page" id="main">
              <h1 className="display small">That draft isn’t there any more.</h1>
              <p className="lede">It may have been deleted or played in another tab. Nothing else has changed.</p>
              <PageLink to="/mixes/mine" className="button primary">See my mixes</PageLink>
            </main>
          )}
          {route.page === 'edit' && draftId !== null && !draftGone && !draftData && <main className="page mix" id="main" aria-busy="true"><Skeleton variant="timeline" label="Opening your draft" /></main>}
          {route.page === 'edit' && draftId !== null && !draftGone && draftData && (
            <MixScope.Provider value={draftId}>
              <Mix
                {...shared}
                key={draftId}
                mix={draftData.mix}
                mixName={draftData.name}
                canUndo={draftData.can_undo}
                mixEta={draftData.eta}
                draftPlace={draftData.draft?.place ?? null}
                refreshMix={refreshDraft}
                setMixData={setDraftMix}
                renamedDraft={renamedDraft}
              />
            </MixScope.Provider>
          )}
          {route.page === 'library' && <Library {...shared} />}
          {route.page === 'discover' && <Links {...shared} tab={route.tab} />}
          {route.page === 'workshop' && <Workshop {...shared} tab={route.tab} />}
          {route.page === 'listening' && <Workshop {...shared} tab="learning" />}
          {route.page === 'lucy' && <Lucy conversation={route.conversation} setMixData={setMixData} player={player} />}
          {route.page === 'missing' && (
            <main className="page" id="main">
              <h1 className="display small">There’s nothing at this address.</h1>
              <p className="lede">Your music and mixes are fine. It may be an old link.</p>
              <PageLink to="/mixes" className="button primary">Go to Make a Mix</PageLink>
            </main>
          )}
          </Suspense>
        </Section>
      </Shell>
      {confirmDraft && (
        <Dialog
          title={`Replace ${confirmDraft.replacing}?`}
          onClose={() => setConfirmDraft(null)}
          footer={(
            <>
              <button onClick={() => setConfirmDraft(null)}>Keep current mix</button>
              <Action className="primary" working="Switching…" run={async () => {
                const choice = confirmDraft;
                setConfirmDraft(null);
                await activateDraft(choice.id, choice.from, choice.order);
              }}>Replace with draft</Action>
            </>
          )}
        >
          <p>Playing this draft will stop the current mix. The old mix is kept in My Mixes, and you can undo the switch.</p>
          <p className="hint">Cancel to keep listening without changing either mix.</p>
        </Dialog>
      )}
      {requesting && on('requests') && (
        <Drawer title="Requests" onClose={() => setRequesting(false)}>
          <RequestsPanel />
        </Drawer>
      )}
      {activityOpen && (on('app.activity') || on('export')) && (
        <Drawer title={on('app.activity') ? 'Activity' : 'Exports'} onClose={() => setActivityOpen(false)}>
          {on('app.activity') && <ActivityPanel />}
          {on('export') && <ExportJobs />}
        </Drawer>
      )}
      {commanding && on('app.command_palette') && <CommandPalette commands={commands} onClose={() => setCommanding(false)} />}
      {helping && on('app.shortcuts') && (
        <Dialog title="Keyboard shortcuts" onClose={() => setHelping(false)} footer={<>{on('app.glossary') && <button onClick={() => openGlossary()}>Music terms</button>}<button autoFocus data-autofocus onClick={() => setHelping(false)}>Close</button></>}>
          <dl className="keys">
            {shortcutsOn().filter((shortcut) => shortcut.id !== 'palette' || preferences.palette).map((shortcut) => (
              <div key={shortcut.id}>
                <dt><kbd>{shortcut.keys}</kbd></dt>
                <dd>{shortcut.label}</dd>
              </div>
            ))}
          </dl>
          <div className="row wrap">
            {on('app.command_palette') && (
              <label className="choice">
                <input type="checkbox" checked={preferences.palette} onChange={(event) => setPrefs({ palette: event.target.checked })} />
                Use Ctrl K for search and commands
              </label>
            )}
            <label className="choice">
              <input type="checkbox" checked={preferences.singleKeys} onChange={(event) => setPrefs({ singleKeys: event.target.checked })} />
              Use single-key shortcuts
            </label>
          </div>
        </Dialog>
      )}
      {on('app.glossary') && <GlossaryHost />}
    </RequestsContext.Provider>
  );
}
