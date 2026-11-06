import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, MixData, MixItem, post, Status } from './api';
import { loadResume } from './lib';
import { NowState, SetPlayer } from './player';
import { Library } from './views/Library';
import { Links } from './views/Links';
import { Mix } from './views/Mix';
import { Mixes } from './views/Mixes';
import { Now } from './views/Now';
import { Start } from './views/Start';
import { Workshop } from './views/Workshop';
import { MixScope } from './views/mixScope';
import { RequestsContext, RequestsPanel, useRequests } from './views/Requests';
import type { Toast, Undo, View } from './views/shared';

const OPEN_DRAFT = 'selecta.openDraft';

const NAV: { view: View; label: string }[] = [
  { view: 'Mixes', label: 'Mixes' },
  { view: 'Now', label: 'Now' },
  { view: 'Edit', label: 'Edit' },
  { view: 'Library', label: 'Library' },
  { view: 'Words', label: 'Words' },
];

const KEYS: [string, string][] = [
  ['Space', 'Play or pause'],
  ['N', 'Skip to the seam'],
  ['Z', 'Undo'],
  ['F', 'Fullscreen lyrics'],
  ['/', 'Search your library'],
  ['?', 'This list'],
];

export function App() {
  const [view, setView] = useState<View>('Mixes');
  const [status, setStatus] = useState<Status | null>(null);
  const [problem, setProblem] = useState('');
  const [data, setData] = useState<MixData>({ mix: [], name: 'Your mix', can_undo: false });
  const [toast, setToast] = useState<Toast | null>(null);
  const [helping, setHelping] = useState(false);
  const [stage, setStage] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const mix = data.mix;
  const mixRef = useRef<MixItem[]>([]);
  mixRef.current = mix;

  const setMixData = useCallback((next: MixData) => {
    mixRef.current = next.mix;
    setData(next);
  }, []);
  const refreshMix = useCallback(() => {
    get<MixData>('/mix')
      .then(setMixData)
      .catch((error: Error) => setToast({ message: `Couldn’t read your mix: ${error.message}`, undo: false, id: Date.now() }));
  }, [setMixData]);
  const refreshStatus = useCallback(() => {
    get<Status>('/status')
      .then((next) => {
        setStatus(next);
        setProblem('');
      })
      .catch((error: Error) => setProblem(error.message));
  }, []);

  // One draft can be open at a time. It stays open while looking at other pages, and across reloads.
  const [draftId, setDraftId] = useState<number | null>(() => {
    try {
      const saved = window.localStorage.getItem(OPEN_DRAFT);
      return saved ? Number(saved) : null;
    } catch {
      return null;
    }
  });
  const [draftData, setDraftData] = useState<MixData | null>(null);
  const draftRef = useRef(draftId);
  draftRef.current = draftId;
  const remember = (id: number | null) => {
    try {
      if (id === null) window.localStorage.removeItem(OPEN_DRAFT);
      else window.localStorage.setItem(OPEN_DRAFT, String(id));
    } catch {
      // the draft just won't reopen next time
    }
  };
  const closeDraft = useCallback(() => {
    setDraftId(null);
    setDraftData(null);
    remember(null);
  }, []);
  const refreshDraft = useCallback(() => {
    const asked = draftRef.current;
    if (asked === null) return;
    get<MixData>(`/mix?draft=${asked}`)
      .then((next) => {
        if (draftRef.current === asked) setDraftData(next);
      })
      .catch(() => {
        // deleted or played in another tab, so the current mix is what's left to show
        if (draftRef.current === asked) closeDraft();
      });
  }, [closeDraft]);
  useEffect(refreshDraft, [draftId, view, refreshDraft]);
  const openDraft = useCallback((id: number) => {
    setDraftData(null);
    setDraftId(id);
    remember(id);
    setView('Edit');
  }, []);
  // being sent to Edit from another page means the mix that's playing
  const goTo = useCallback((next: View) => {
    if (next === 'Edit') closeDraft();
    setView(next);
  }, [closeDraft]);

  const notify = useCallback((message: string, undo: Undo = false) => {
    setToast({ message: message.replace(/\.\.$/, '.'), undo, id: Date.now() });
  }, []);
  const undo = useCallback(async (how: Undo = true) => {
    if (typeof how === 'function') {
      await how();
      setToast(null);
      return;
    }
    const open = viewRef.current === 'Edit' ? draftRef.current : null;
    const next = await post<MixData>(open === null ? '/mix/undo' : `/mix/undo?draft=${open}`);
    if (open === null) setMixData(next);
    else setDraftData(next);
    setToast({ message: next.undone ? `Undid ${next.undone}.` : 'Nothing to undo.', undo: false, id: Date.now() });
  }, [setMixData]);

  // Any action that fails says so, rather than appearing to do nothing.
  useEffect(() => {
    const failed = (event: PromiseRejectionEvent) => {
      const message = event.reason instanceof Error ? event.reason.message : 'Something went wrong.';
      setToast({
        message: message === 'Failed to fetch' ? 'Can’t reach Selecta right now. Try again in a moment.' : message,
        undo: false,
        id: Date.now(),
      });
    };
    window.addEventListener('unhandledrejection', failed);
    return () => window.removeEventListener('unhandledrejection', failed);
  }, []);

  const player = useMemo(() => new SetPlayer(() => mixRef.current, refreshMix), [refreshMix]);
  const playDraft = useCallback(async (id: number, from = 0) => {
    const next = await post<MixData>(`/drafts/${id}/play`);
    setMixData(next);
    if (draftRef.current === id) closeDraft();
    setView('Now');
    void player.playFrom(from);
    setToast({ message: `Now playing ${next.name}. What was playing is kept in your drafts.`, undo: true, id: Date.now() });
  }, [closeDraft, player, setMixData]);
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
  useEffect(() => {
    player.onChange = setNow;
  }, [player]);

  useEffect(() => {
    refreshStatus();
    get<MixData>('/mix')
      .then((next) => {
        setMixData(next);
        const resume = loadResume(next.mix);
        if (resume) {
          player.cue(resume.position, resume.time);
          setView('Now');
        }
      })
      .catch((error: Error) => setToast({ message: `Couldn’t read your mix: ${error.message}`, undo: false, id: Date.now() }));
    const timer = window.setInterval(refreshStatus, 4000);
    return () => window.clearInterval(timer);
  }, [refreshStatus, setMixData, player]);

  useEffect(refreshMix, [view, refreshMix]);

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

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.undo ? 8000 : 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const playing = mix[now.position];
  const active = now.phase !== 'idle';

  useEffect(() => {
    document.title = active && playing ? `${playing.title} · Selecta` : 'Selecta';
  }, [active, playing?.title]);

  // Media keys, headsets and the system's now-playing panel.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata =
      active && playing ? new MediaMetadata({ title: playing.title, artist: playing.artist, album: data.name }) : null;
    navigator.mediaSession.playbackState = now.phase === 'playing' ? 'playing' : now.phase === 'paused' ? 'paused' : 'none';
    navigator.mediaSession.setActionHandler('play', () => void player.togglePause());
    navigator.mediaSession.setActionHandler('pause', () => void player.togglePause());
    navigator.mediaSession.setActionHandler('nexttrack', () => void player.skip());
  }, [active, playing?.title, now.phase, data.name, player]);

  const toggleStage = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => setStage((on) => !on));
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
      const typing = event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName);
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (event.code === 'Space') {
        if (event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        if (mixRef.current.length) void player.togglePause();
      } else if (key === 'n') void player.skip();
      else if (key === 'z') void undo();
      else if (key === 'f') {
        setView('Now');
        toggleStage();
      } else if (key === '?') setHelping((on) => !on);
      else if (event.key === '/') {
        event.preventDefault();
        setView('Library');
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [player, undo, toggleStage]);

  if (problem && !status) {
    return (
      <main className="page">
        <h1 className="display">Can’t reach Selecta.</h1>
        <p className="lede">{problem}. It may have stopped running. Start it again, then reload this page.</p>
      </main>
    );
  }
  if (!status) return <main className="page" aria-busy="true" />;
  if (status.counts.total === 0) return <Start status={status} onChange={refreshStatus} />;

  const shared = {
    status,
    mix,
    mixName: data.name,
    canUndo: data.can_undo,
    mixEta: data.eta,
    refreshMix,
    setMixData,
    refreshStatus,
    player,
    now,
    setView: goTo,
    notify,
    stage,
    toggleStage,
    openDraft,
    closeDraft,
    playDraft,
  };
  const shown: View = view === 'Now' && !mix.length ? 'Mixes' : view;
  return (
    <RequestsContext.Provider value={requests}>
      {!stage && (
        <header className="bar">
          <button className="brand" onClick={() => setView('Mixes')}>
            Selecta
          </button>
          <nav aria-label="Main">
            {NAV.map(({ view: name, label }) => (
              <button key={name} aria-current={shown === name ? 'page' : undefined} onClick={() => setView(name)}>
                {label}
              </button>
            ))}
          </nav>
          <button
            className="quiet"
            aria-current={shown === 'Workshop' ? 'page' : undefined}
            onClick={() => setView('Workshop')}
          >
            Workshop
          </button>
          <button className="quiet help" aria-label="Keyboard shortcuts" onClick={() => setHelping(true)}>
            ?
          </button>
        </header>
      )}
      {shown === 'Mixes' && <Mixes {...shared} />}
      {shown === 'Now' && <Now {...shared} />}
      {shown === 'Now' && !stage && <div className="page"><RequestsPanel /></div>}
      {shown === 'Edit' && draftId === null && <Mix {...shared} />}
      {shown === 'Edit' && draftId !== null && !draftData && <main className="page" aria-busy="true" />}
      {shown === 'Edit' && draftId !== null && draftData && (
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
      {shown === 'Library' && <Library {...shared} />}
      {shown === 'Words' && <Links {...shared} />}
      {shown === 'Workshop' && <Workshop {...shared} />}
      {shown !== 'Now' && playing && active && (
        <aside className="mini" aria-label="Now playing">
          <button className="round" onClick={() => void player.togglePause()} aria-label={now.phase === 'playing' ? 'Pause' : 'Play'}>
            {now.phase === 'playing' ? '❚❚' : '▶'}
          </button>
          <button className="mini-song" onClick={() => setView('Now')}>
            <b>{playing.title}</b>
            <span>{playing.artist}</span>
          </button>
          <button onClick={() => void player.skip()}>Skip</button>
        </aside>
      )}
      {toast && (
        <div className={`toast ${active && shown !== 'Now' ? 'raised' : ''}`} role="status" key={toast.id}>
          <span>{toast.message}</span>
          {toast.undo && <button onClick={() => void undo(toast.undo)}>Undo</button>}
        </div>
      )}
      {helping && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={() => setHelping(false)}>
          <div className="panel keys" onClick={(event) => event.stopPropagation()}>
            <h2>Keyboard shortcuts</h2>
            <dl>
              {KEYS.map(([key, what]) => (
                <div key={key}>
                  <dt>
                    <kbd>{key}</kbd>
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
            <button autoFocus onClick={() => setHelping(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </RequestsContext.Provider>
  );
}
