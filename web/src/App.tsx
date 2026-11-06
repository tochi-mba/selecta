import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, get, MixData, MixItem, post, problemKind, Status } from './api';
import { connectMainPlayer } from './audio/focus';
import { loadResume } from './lib';
import { NowState, SetPlayer } from './player';
import { navigate, Route, useRoute } from './router';
import { PageLink, Shell } from './shell/Shell';
import { sayThisTabIsPlaying, whenAnotherTabPlays } from './state/tabs';
import { Action, announce, Dialog, Drawer, Section, Skeleton } from './ui/controls';
import { showProblem, showToast } from './ui/toasts';
import { Library } from './views/Library';
import { Links } from './views/Links';
import { Mix } from './views/Mix';
import { Mixes } from './views/Mixes';
import { Now } from './views/Now';
import { RequestsContext, RequestsPanel, useRequests } from './views/Requests';
import { Start } from './views/Start';
import { Workshop } from './views/Workshop';
import { MixScope } from './views/mixScope';
import type { Undo, View } from './views/shared';

const PATHS: Record<View, string> = {
  Mixes: '/mixes',
  Now: '/listen',
  Edit: '/mix/current/edit',
  Library: '/library',
  Words: '/discover',
  Workshop: '/workshop',
};

const TITLES: Record<Route['page'], string> = {
  listen: 'Listen',
  mixes: 'Mixes',
  edit: 'Edit',
  library: 'Library',
  discover: 'Discover',
  workshop: 'Workshop',
  listening: 'Listening test',
  missing: 'Not found',
};

const KEYS: [string, string][] = [
  ['Space', 'Play or pause'],
  ['N', 'Jump to the transition'],
  ['Shift N', 'Next song'],
  ['P', 'Previous song'],
  ['← →', 'Back or forward 5 seconds'],
  ['M', 'Mute'],
  ['R', 'Request a song'],
  ['Z', 'Undo'],
  ['F', 'Fullscreen lyrics'],
  ['/', 'Search your library'],
  ['?', 'This list'],
];

export function App() {
  const route = useRoute();
  const routeRef = useRef(route);
  routeRef.current = route;
  const [status, setStatus] = useState<Status | null>(null);
  const [problem, setProblem] = useState('');
  const [data, setData] = useState<MixData>({ mix: [], name: 'Your mix', can_undo: false });
  const [helping, setHelping] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [stage, setStage] = useState(false);
  const mix = data.mix;
  const mixRef = useRef<MixItem[]>([]);
  mixRef.current = mix;

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
        if (seen === mixChanges.current) setMixData(next);
      })
      .catch((error: Error) => {
        // a stopped server is shown once, across the top, not as a stream of messages
        if (problemKind(error) !== 'offline') showProblem(`Couldn’t read your mix: ${error.message}`);
      });
  }, [setMixData]);
  const refreshStatus = useCallback(() => {
    return get<Status>('/status')
      .then((next) => {
        setStatus(next);
        setProblem('');
      })
      .catch((error: Error) => setProblem(error.message));
  }, []);

  // Which draft is open comes from the address, so it can't be confused with the current mix.
  const draftId = route.page === 'edit' ? route.draft : null;
  const [draftData, setDraftData] = useState<MixData | null>(null);
  const [draftGone, setDraftGone] = useState(false);
  const draftRef = useRef(draftId);
  draftRef.current = draftId;
  const refreshDraft = useCallback(() => {
    const asked = draftRef.current;
    if (asked === null) return;
    get<MixData>(`/mix?draft=${asked}`)
      .then((next) => {
        if (draftRef.current !== asked) return;
        setDraftData(next);
        setDraftGone(false);
      })
      .catch((error: Error) => {
        if (draftRef.current !== asked) return;
        // a draft that's gone says so, rather than quietly showing a different mix
        if (error instanceof ApiError && error.status === 404) setDraftGone(true);
      });
  }, []);
  useEffect(() => {
    setDraftData(null);
    setDraftGone(false);
    refreshDraft();
  }, [draftId, refreshDraft]);
  const openDraft = useCallback((id: number) => navigate(`/mixes/drafts/${id}/edit`), []);
  const closeDraft = useCallback(() => {
    if (draftRef.current !== null) navigate('/mix/current/edit');
  }, []);
  const goTo = useCallback((next: View) => navigate(PATHS[next]), []);

  const undoIn = useCallback(async (scope: number | null) => {
    const next = await post<MixData>(scope === null ? '/mix/undo' : `/mix/undo?draft=${scope}`);
    if (scope === null) setMixData(next);
    else if (draftRef.current === scope) setDraftData(next);
    showToast(next.undone ? `Undid ${next.undone}.` : 'Nothing to undo.');
  }, [setMixData]);
  const notify = useCallback((message: string, undo: Undo = false) => {
    if (typeof undo === 'function') {
      showToast(message, { undo });
    } else if (undo) {
      // it undoes the mix this was said about, wherever you are when you press it
      const scope = draftRef.current;
      showToast(message, { undo: () => undoIn(scope) });
    } else {
      showToast(message);
    }
  }, [undoIn]);

  // Any action that fails says so, rather than appearing to do nothing.
  useEffect(() => {
    const failed = (event: PromiseRejectionEvent) => {
      const message = event.reason instanceof Error ? event.reason.message : 'Something went wrong.';
      showProblem(message === 'Failed to fetch' ? 'Can’t reach Selecta right now. Try again in a moment.' : message);
    };
    window.addEventListener('unhandledrejection', failed);
    return () => window.removeEventListener('unhandledrejection', failed);
  }, []);

  const player = useMemo(() => new SetPlayer(() => mixRef.current, refreshMix), [refreshMix]);
  useEffect(() => {
    connectMainPlayer({
      isPlaying: () => player.state.phase === 'playing',
      pause: () => player.pause(),
      resume: () => player.resume(),
    });
    return () => connectMainPlayer(null);
  }, [player]);
  const playDraft = useCallback(async (id: number, from = 0) => {
    const next = await post<MixData>(`/drafts/${id}/play`);
    setMixData(next);
    navigate('/listen');
    void player.playFrom(from);
    showToast(`Now playing ${next.name}. What was playing is kept in your drafts.`, { undo: () => undoIn(null) });
  }, [player, setMixData, undoIn]);
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
    if (player.state.phase !== 'playing') return;
    void player.pause();
    showToast('Playing in another tab now. Press play here to bring it back.');
  }), [player]);

  useEffect(() => {
    void refreshStatus();
    get<MixData>('/mix')
      .then((next) => {
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
    const timer = window.setInterval(() => void refreshStatus(), 4000);
    return () => window.clearInterval(timer);
  }, [refreshStatus, setMixData, player]);

  useEffect(refreshMix, [route.page, refreshMix]);

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
  useEffect(() => {
    if (!draftBusy) return;
    const timer = window.setInterval(refreshDraft, 2000);
    return () => window.clearInterval(timer);
  }, [draftBusy, refreshDraft]);

  // Anything still rendering gets checked often, so its status changes on its own.
  const busy = mix.some((item) => ['none', 'queued', 'rendering'].includes(item.seam?.state.status ?? ''));
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(refreshMix, 1500);
    return () => window.clearInterval(timer);
  }, [busy, refreshMix]);

  const playing = mix[now.position];
  const active = now.phase !== 'idle';

  // said once for each song, so a screen reader isn't talking over the music all the time
  useEffect(() => {
    if (active && playing?.title) announce(`Now playing ${playing.title} by ${playing.artist}`);
  }, [active, playing?.title, playing?.artist]);

  useEffect(() => {
    document.title = active && playing ? `${playing.title} · Selecta` : `${TITLES[route.page]} · Selecta`;
  }, [active, playing?.title, route.page]);

  // Media keys, headsets and the system's now-playing panel: each does what it says it does.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    session.metadata = active && playing && typeof MediaMetadata !== 'undefined'
      ? new MediaMetadata({ title: playing.title, artist: playing.artist, album: data.name })
      : null;
    session.playbackState = now.phase === 'playing' ? 'playing' : now.phase === 'paused' ? 'paused' : 'none';
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => { if (now.phase !== 'playing') void player.togglePause(); }],
      ['pause', () => { if (now.phase === 'playing') void player.togglePause(); }],
      ['nexttrack', () => void player.next()],
      ['previoustrack', () => void player.previous()],
      ['seekto', (details) => { if (details.seekTime !== undefined) void player.seek(details.seekTime); }],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // this browser doesn't have that one, which is fine
      }
    }
  }, [active, playing?.title, now.phase, data.name, player]);

  const toggleStage = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      const asked = document.documentElement.requestFullscreen?.();
      // a browser can say no, and the lyrics still fill the page
      if (asked) void asked.catch(() => setStage((on) => !on));
      else setStage((on) => !on);
    }
  }, []);
  useEffect(() => {
    const change = () => setStage(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHelping(false);
        if (!document.fullscreenElement) setStage(false);
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = !!target && (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable || !!target.closest('[role="grid"],[role="menu"],[role="dialog"]'));
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (event.code === 'Space') {
        if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
        event.preventDefault();
        if (mixRef.current.length) void player.togglePause();
      } else if (key === 'n') {
        if (event.shiftKey) void player.next();
        else void player.skip();
      } else if (key === 'p') void player.previous();
      else if (key === 'm') player.toggleMute();
      else if (key === 'r') setRequesting(true);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (player.state.phase === 'idle') return;
        void player.seek(player.state.songTime + (event.key === 'ArrowLeft' ? -5 : 5));
      } else if (key === 'z') {
        const place = routeRef.current;
        void undoIn(place.page === 'edit' ? place.draft : null);
      } else if (key === 'f') {
        navigate('/listen');
        toggleStage();
      } else if (key === '?') setHelping((on) => !on);
      else if (event.key === '/') {
        event.preventDefault();
        navigate('/library');
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [player, undoIn, toggleStage]);

  if (problem && !status) {
    return (
      <main className="page" id="main">
        <h1 className="display">Can’t reach Selecta.</h1>
        <p className="lede">{problem}. It may have stopped running. Start it again, and this page will pick up by itself.</p>
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
    canUndo: data.can_undo,
    mixEta: data.eta,
    refreshMix,
    setMixData,
    refreshStatus: () => void refreshStatus(),
    player,
    now,
    setView: goTo,
    notify,
    stage,
    toggleStage,
    openDraft,
    closeDraft,
    playDraft,
    openRequests: () => setRequesting(true),
  };
  const nothingToHear = route.page === 'listen' && !mix.length;
  const waitingRequests = requests.requests?.filter((request) => request.id > 0).length ?? 0;
  return (
    <RequestsContext.Provider value={requests}>
      <Shell
        route={route}
        player={player}
        now={now}
        song={playing}
        showPlayer={route.page !== 'listen' && !!playing && active}
        hasMix={mix.length > 0}
        stage={stage}
        waitingRequests={waitingRequests}
        onRequests={() => setRequesting(true)}
        onHelp={() => setHelping(true)}
        banner={problem ? (
          <div className="connection" role="alert">
            <span><b>Can’t reach Selecta.</b> What’s on screen may be out of date, and anything already loaded keeps playing. Trying again every few seconds.</span>
            <Action run={refreshStatus} working="Trying…">Try now</Action>
          </div>
        ) : undefined}
      >
        <Section name={TITLES[route.page]} key={route.page}>
          {(route.page === 'mixes' || nothingToHear) && <Mixes {...shared} tab={route.page === 'mixes' ? route.tab : 'browse'} />}
          {route.page === 'listen' && !nothingToHear && <Now {...shared} />}
          {route.page === 'edit' && draftId === null && <Mix {...shared} key="current" />}
          {route.page === 'edit' && draftId !== null && draftGone && (
            <main className="page" id="main">
              <h1 className="display small">That draft isn’t there any more.</h1>
              <p className="lede">It may have been deleted or played in another tab. Nothing else has changed.</p>
              <PageLink to="/mixes/mine" className="button primary">See your mixes</PageLink>
            </main>
          )}
          {route.page === 'edit' && draftId !== null && !draftGone && !draftData && <main className="page" aria-busy="true"><Skeleton label="Opening your draft" /></main>}
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
                setMixData={setDraftData}
                renamedDraft={(name) => setDraftData((before) => (before ? { ...before, name } : before))}
              />
            </MixScope.Provider>
          )}
          {route.page === 'library' && <Library {...shared} />}
          {route.page === 'discover' && <Links {...shared} tab={route.tab} />}
          {route.page === 'workshop' && <Workshop {...shared} tab={route.tab} />}
          {route.page === 'listening' && <Workshop {...shared} tab="learning" />}
          {route.page === 'missing' && (
            <main className="page" id="main">
              <h1 className="display small">There’s nothing at this address.</h1>
              <p className="lede">Your music and mixes are fine. It may be an old link.</p>
              <PageLink to="/mixes" className="button primary">Go to Mixes</PageLink>
            </main>
          )}
        </Section>
      </Shell>
      {requesting && (
        <Drawer title="Requests" onClose={() => setRequesting(false)}>
          <RequestsPanel />
        </Drawer>
      )}
      {helping && (
        <Dialog title="Keyboard shortcuts" onClose={() => setHelping(false)} footer={<button autoFocus data-autofocus onClick={() => setHelping(false)}>Close</button>}>
          <dl className="keys">
            {KEYS.map(([key, what]) => (
              <div key={key}>
                <dt><kbd>{key}</kbd></dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </Dialog>
      )}
    </RequestsContext.Provider>
  );
}
