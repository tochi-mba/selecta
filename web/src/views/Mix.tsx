import { DragEvent, FormEvent, KeyboardEvent, PointerEvent, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError, del, DraftList, MixData, MixItem, post, Suggestion } from '../api';
import { etaRangeWords, runningTime } from '../lib';
import { mixReadiness, occurrenceKeys, orderOf } from '../state/readiness';
import { Action, announce, Dialog, Sheet } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/useReducedMotion';
import { PageLink } from '../shell/PageLink';
import { Adder } from './Adder';
import { RenameDraft } from './Drafts';
import { AddGap, MoveHow, RowActions, SeamUnlessReplaced, SongInspector, SongLine } from './EditorRows';
import { EditorHeader, MixSwitcher } from './EditorHeader';
import { EditorMode, useEditorMode } from './editorMode';
import { EditorStory, EnergyDisclosure, ViewSwitch } from './EditorStory';
import { ExportPanel } from './ExportPanel';
import { MixScope, useMixPath } from './mixScope';
import { ComingSongs } from './Requests';
import { InspectorTab, SeamInspector } from './SeamInspector';
import { ViewProps } from './shared';

/** A transition is known by the two songs it's between, and a song by which time it appears in the mix,
 * so a selection stays with what was selected as the mix moves around. It remembers their names so it
 * can say what's gone if it goes. It never slides over to whatever is next to it. */
type Selection =
  | { kind: 'seam'; a: string; b: string; from: string; into: string }
  | { kind: 'song'; key: string; title: string };

// The same app-wide player survives route changes. Remember which *object*
// was selected for each scope without persisting a potentially stale
// transition across browser reloads or sharing it between app instances.
const selectionByPlayer = new WeakMap<ViewProps['player'], Map<string, Selection | null>>();

/** Above this, rows skip being drawn until they're scrolled near. Everything stays in the page, so
 * focus, find-in-page and screen readers all carry on working, which virtualizing the list would break. */
const LONG_MIX = 40;
const RECENT_DRAFT_KEY = 'selecta.recentDraft';
const INSPECTOR_WIDTH_KEY = 'selecta.inspectorWidth';
const MIN_INSPECTOR_WIDTH = 320;
const MAX_INSPECTOR_WIDTH = 520;

function savedInspectorWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY));
    return Number.isFinite(saved) ? Math.min(Math.max(saved, MIN_INSPECTOR_WIDTH), MAX_INSPECTOR_WIDTH) : 380;
  } catch {
    return 380;
  }
}

function useNarrow(width = 1100): boolean {
  const query = `(max-width: ${width}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const change = () => setNarrow(list.matches);
    list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, [query]);
  return narrow;
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const seamKeyOf = (a: string, b: string) => `${a}>${b}`;

export function Mix(props: ViewProps) {
  const { mix, mixName, refreshMix, setMixData, player, now, setView, notify, status, refreshStatus, mixEta, draftPlace, openDraft, closeDraft, playDraft, renamedDraft, canUndo, undo, currentMixName } = props;
  const draftId = useContext(MixScope);
  const inDraft = draftId !== null;
  const selectionScope = inDraft ? `draft:${draftId}` : 'current';
  const at = useMixPath();
  const line = status.analysing ?? [];
  const order = orderOf(mix);
  const keys = useMemo(() => occurrenceKeys(mix), [order]);
  const guard = useMemo(() => ({ 'x-mix-order': order }), [order]);
  // Story, Arrange or Detail is only how this same mix, scope and selection are shown.
  const [mode, setMode] = useEditorMode();
  const reduceMotion = useReducedMotion();
  const page = useRef<HTMLElement>(null);
  const storyHeading = useId();
  const arrangeHeading = useId();
  // What to bring into view once a change of view or selection has been drawn. 'focus' moves focus too.
  const reveal = useRef<'focus' | 'scroll' | null>(null);
  // The view last shown, so Detail opens a transition on the way in rather than every time one closes.
  const shownMode = useRef<EditorMode | null>(null);

  // Only the stable draft ID and exact saved order are remembered in this browser.
  // Reopening is opt-in and the My Mixes shortcut validates both against the server.
  useEffect(() => {
    if (draftId === null) return;
    try {
      window.localStorage.setItem(RECENT_DRAFT_KEY, JSON.stringify({ id: draftId, order }));
    } catch { /* private browsing can disable storage */ }
  }, [draftId, order]);

  const [selected, setSelected] = useState<Selection | null>(() => selectionByPlayer.get(player)?.get(selectionScope) ?? null);
  const selectedScope = useRef(selectionScope);
  useEffect(() => {
    let byScope = selectionByPlayer.get(player);
    if (!byScope) {
      byScope = new Map();
      selectionByPlayer.set(player, byScope);
    }
    // A draft switch can reuse this mounted editor. Restore that scope's own
    // object before persisting anything, rather than briefly assigning the
    // previous draft's occurrence or pair to the newly opened mix.
    if (selectedScope.current !== selectionScope) {
      selectedScope.current = selectionScope;
      setSelected(byScope.get(selectionScope) ?? null);
      return;
    }
    byScope.set(selectionScope, selected);
  }, [player, selectionScope, selected]);
  const [gone, setGone] = useState('');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('listen');
  const [hearNow, setHearNow] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState(savedInspectorWidth);
  const narrow = useNarrow();
  // where a new song goes is a place in the mix, not a number, so it stays right if the mix moves
  const [adding, setAdding] = useState<string | null>(inDraft && !mix.length ? 'start' : null);
  const [renaming, setRenaming] = useState(false);
  const [problem, setProblem] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(mixName);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Multiple pointer/keyboard drops must not race each other against the
  // same order guard and then steal focus with an obsolete server response.
  const moving = useRef(false);
  const focusAfter = useRef<{ key: string; how: 'up' | 'down' | 'handle' } | null>(null);
  const inspector = useRef<HTMLElement | null>(null);
  const selectedIdentity = selected?.kind === 'seam' ? `${selected.a}>${selected.b}` : selected?.kind === 'song' ? selected.key : '';

  useEffect(() => {
    if (!selectedIdentity || narrow) return;
    const panel = inspector.current;
    if (typeof panel?.scrollTo !== 'function') return;
    panel.scrollTo({
      top: 0,
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [selectedIdentity, narrow]);

  const resizeInspector = (next: number) => {
    const safe = Math.min(Math.max(Math.round(next), MIN_INSPECTOR_WIDTH), MAX_INSPECTOR_WIDTH);
    setInspectorWidth(safe);
    try { window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(safe)); } catch { /* it remains in memory */ }
  };
  const beginInspectorResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspectorWidth;
    const move = (next: globalThis.PointerEvent) => resizeInspector(startWidth + startX - next.clientX);
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  };
  const resizeInspectorWithKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const change = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0;
    if (!change && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    resizeInspector(event.key === 'Home' ? MIN_INSPECTOR_WIDTH : event.key === 'End' ? MAX_INSPECTOR_WIDTH : inspectorWidth + change);
  };

  const readiness = useMemo(() => mixReadiness(mix), [mix]);
  const total = runningTime(mix);
  const { ready, waiting, rendering, seams } = readiness;

  const selectedIndex = selected?.kind === 'seam' ? keys.findIndex((key, index) => index > 0 && key === selected.b && keys[index - 1] === selected.a) : -1;
  const selectedSongIndex = selected?.kind === 'song' ? keys.indexOf(selected.key) : -1;
  const selectedItem = selectedIndex > 0 ? mix[selectedIndex] : null;
  const selectedBefore = selectedIndex > 0 ? mix[selectedIndex - 1] : null;
  const selectedSong = selectedSongIndex >= 0 ? mix[selectedSongIndex] : null;

  // What was selected has gone, so the selection goes with it, and says nothing was changed.
  useEffect(() => {
    if (!selected) return;
    if (selected.kind === 'seam' && selectedIndex <= 0) {
      setSelected(null);
      const words = `The transition from ${selected.from} into ${selected.into} isn’t in this mix any more, so nothing was changed.`;
      setGone(words);
      announce(words);
    } else if (selected.kind === 'song' && selectedSongIndex < 0) {
      setSelected(null);
      const words = `${selected.title} isn’t in this mix any more, so nothing was changed.`;
      setGone(words);
      announce(words);
    }
  }, [selected, selectedIndex, selectedSongIndex]);

  const placeOf = (anchor: string): number => (anchor === 'start' ? 0 : keys.indexOf(anchor) + 1 || -1);
  useEffect(() => {
    if (adding && placeOf(adding) < 0) {
      setAdding(null);
      setProblem('That place in the mix has changed, so nothing was added. Choose where to add it again.');
    }
  }, [adding, keys]);

  // A row that moved in the page can lose focus, so focus goes back to the same control in that row.
  useEffect(() => {
    const wanted = focusAfter.current;
    if (!wanted) return;
    focusAfter.current = null;
    const row = document.querySelector<HTMLElement>(`[data-song-key="${wanted.key}"]`);
    if (!row) return;
    const named = row.querySelector<HTMLElement>(wanted.how === 'handle' ? '[data-handle]' : `[data-move="${wanted.how}"]`);
    const target = named?.matches(':disabled') ? row.querySelector<HTMLElement>('[data-handle]') : named;
    target?.focus();
    target?.scrollIntoView?.({ block: 'nearest' });
  }, [order]);

  const selectSeamAt = (index: number) => {
    setGone('');
    setSelected({ kind: 'seam', a: keys[index - 1], b: keys[index], from: mix[index - 1].title, into: mix[index].title });
  };

  // Detail is the timeline with a transition open, so arriving there with nothing selected opens the
  // first one on its Change tab. That's a selection only: nothing is sent and nothing plays.
  useEffect(() => {
    if (shownMode.current === mode) return;
    shownMode.current = mode;
    if (mode !== 'detail' || selected || !mix.length) return;
    setHearNow(false);
    if (mix.length > 1) {
      setInspectorTab('change');
      selectSeamAt(1);
    } else {
      setGone('');
      setSelected({ kind: 'song', key: keys[0], title: mix[0].title });
    }
    reveal.current = reveal.current ?? 'scroll';
  }, [mode, selected, mix.length]);

  // After a change of view, the same song or transition is found again by its key and brought into view.
  // Focus only moves when what had it has gone, and goes to the view's heading if nothing is selected.
  useLayoutEffect(() => {
    const how = reveal.current;
    if (!how) return;
    reveal.current = null;
    const root = page.current;
    if (!root) return;
    const story = mode === 'story';
    let box: HTMLElement | null = null;
    if (selected?.kind === 'seam') {
      const key = seamKeyOf(selected.a, selected.b);
      box = root.querySelector(story ? `[data-story-seam="${key}"]` : `[data-seam="${key}"]`);
    } else if (selected?.kind === 'song') {
      box = root.querySelector(story ? `[data-story-song="${selected.key}"] .story-song` : `[data-song-key="${selected.key}"]`);
    }
    const heading = root.querySelector<HTMLElement>(`[data-mode-heading="${story ? 'story' : 'arrange'}"]`);
    if (how === 'focus') {
      const control = box?.querySelector<HTMLElement>(story ? '.story-edit' : selected?.kind === 'seam' ? '.seam-name' : '.song-select');
      (control ?? heading)?.focus({ preventScroll: true });
    }
    (box ?? (how === 'focus' ? heading : null))?.scrollIntoView?.({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  const playingIndex = !inDraft && now.phase !== 'idle' ? now.position : -1;
  // Detail is for exact cues, bars and moves, so a transition opened there starts on Change.
  const seamTab: InspectorTab = mode === 'detail' ? 'change' : 'listen';
  const chooseMode = (next: EditorMode) => {
    // The View radios keep focus, so the arrow keys carry on moving between views.
    reveal.current = 'scroll';
    setMode(next);
  };
  const openInDetail = () => {
    // what to open has already been chosen, so Detail mustn't pick the first transition instead
    shownMode.current = 'detail';
    reveal.current = 'focus';
    setMode('detail');
  };
  const selectSongAt = (index: number) => {
    if (!keys[index]) return;
    setGone('');
    setHearNow(false);
    setSelected({ kind: 'song', key: keys[index], title: mix[index].title });
    reveal.current = 'scroll';
  };
  const editSong = (key: string) => {
    const index = keys.indexOf(key);
    if (index < 0) return;
    if (selected?.kind !== 'song' || selected.key !== key) {
      setGone('');
      setHearNow(false);
      setSelected({ kind: 'song', key, title: mix[index].title });
    }
    openInDetail();
  };
  const editSeam = (a: string, b: string) => {
    const index = keys.findIndex((key, at) => at > 0 && key === b && keys[at - 1] === a);
    if (index <= 0) return;
    // the same transition, already open, keeps its tab and anything it's playing
    if (selectedIndex !== index) {
      setHearNow(false);
      setInspectorTab('change');
      selectSeamAt(index);
    }
    openInDetail();
  };

  const addSong = async (song: Suggestion, anchor: string) => {
    const position = placeOf(anchor);
    if (position < 0) return;
    try {
      setMixData(await post<MixData>(at('/mix/songs'), { song_id: song.song_id, position }, guard));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'mix_changed') refreshMix();
      setProblem((error as Error).message);
      return;
    }
    setAdding(null);
    setProblem('');
    notify(`Added ${song.title}.`, true);
    announce(`Added ${song.title} as number ${position + 1}.`);
  };

  const act = async (call: Promise<MixData>, message?: string) => {
    try {
      setMixData(await call);
      if (message) notify(message, true);
    } catch (error) {
      // what's shown was out of date, so show what's true before anyone tries again
      if (error instanceof ApiError && error.code === 'mix_changed') refreshMix();
      throw error;
    }
  };

  const moveSong = async (from: number, to: number, how: MoveHow) => {
    const moved = mix[from];
    if (!moved || from === to || to < 0 || to >= mix.length) return;
    if (moving.current) {
      announce('A song is still moving. Try the next move when this one finishes.');
      return;
    }
    moving.current = true;
    const words = how === 'up' ? `Moved ${moved.title} up.` : how === 'down' ? `Moved ${moved.title} down.` : 'Moved that song.';
    if (how !== 'drag') focusAfter.current = { key: keys[from], how };
    try {
      await act(post<MixData>(at('/mix/move'), { source: from, target: to }, guard), words);
      announce(`Moved ${moved.title} to number ${to + 1} of ${mix.length}.`);
    } catch (error) {
      focusAfter.current = null;
      if (how === 'up' || how === 'down') throw error;
      // the row goes back where it was, because nothing actually moved
      setProblem((error as Error).message);
      refreshMix();
    } finally {
      moving.current = false;
      setDragOver(null);
    }
  };

  const playFrom = (item: MixItem) => {
    if (inDraft) {
      void playDraft?.(draftId, item.position);
      return;
    }
    setView('Now');
    void player.playFrom(item.position);
  };

  const rowActions = useRef<RowActions>(null!);
  rowActions.current = {
    play: playFrom,
    move: moveSong,
    lock: (item) => act(post<MixData>(at(`/mix/${item.position}/lock`), undefined, guard)),
    remove: async (item, rowKey) => {
      // the row and its menu are about to go, so focus moves to the row that takes its place
      const index = keys.indexOf(rowKey);
      const neighbour = keys[index + 1] ?? keys[index - 1];
      focusAfter.current = neighbour ? { key: neighbour, how: 'handle' } : null;
      try {
        await act(del<MixData>(at(`/mix/songs/${item.position}`), guard), `Removed ${item.title}.`);
      } catch (error) {
        focusAfter.current = null;
        throw error;
      }
      if (!neighbour) document.getElementById('content')?.focus({ preventScroll: true });
      announce(`Removed ${item.title}.`);
    },
    selectSong: (rowKey) => {
      setGone('');
      setHearNow(false);
      const index = keys.indexOf(rowKey);
      setSelected((was) => (was?.kind === 'song' && was.key === rowKey ? null : { kind: 'song', key: rowKey, title: mix[index]?.title ?? 'That song' }));
    },
    selectSeam: (rowKey) => {
      const index = keys.indexOf(rowKey);
      if (index <= 0 || selectedIndex === index) return;
      setHearNow(false);
      setInspectorTab(seamTab);
      selectSeamAt(index);
    },
    toggleSeam: (rowKey) => {
      const index = keys.indexOf(rowKey);
      if (index <= 0) return;
      setHearNow(false);
      setInspectorTab('change');
      if (selectedIndex === index) setSelected(null);
      else selectSeamAt(index);
    },
    hearSeam: (rowKey) => {
      const index = keys.indexOf(rowKey);
      if (index <= 0) return;
      setHearNow(true);
      setInspectorTab('listen');
      selectSeamAt(index);
    },
    dragOver: setDragOver,
    refresh: refreshMix,
  };

  const renderAll = async () => {
    setMixData(await post<MixData>(at('/mix/render'), undefined, guard));
    notify(`Rendering ${waiting} seam${waiting === 1 ? '' : 's'}, in order, ahead of everything else.`);
  };

  const saveMix = async (event: FormEvent) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    const made = await post<{ name: string }>('/drafts', { name: clean, copy_current: true }, guard);
    setNaming(false);
    notify(`Saved a copy as a draft: ${made.name}. It’s in My Mixes.`);
  };

  const prioritize = async (take: boolean) => {
    const next = await (take ? post<DraftList>(`/drafts/${draftId}/line`) : del<DraftList>(`/drafts/${draftId}/line`));
    refreshMix();
    const placed = next.drafts.find((item) => item.id === draftId);
    if (!take) notify('Taken out of the line. It won’t render by itself now.');
    else if (placed?.place) {
      notify(placed.place === 1 && next.current.left === 0 ? 'Rendering this in the background.' : `This is in line, and will be ready in ${etaRangeWords(placed.eta ?? undefined)}.`);
    }
  };
  const copyDraft = async () => {
    const made = await post<{ name: string }>(`/drafts/${draftId}/duplicate`);
    notify(`Made a copy: ${made.name}.`);
  };
  const deleteDraft = async () => {
    const id = draftId;
    const gone = await del<{ name: string }>(`/drafts/${id}`);
    closeDraft?.();
    setView('Mixes');
    notify(`Deleted ${gone.name}.`, async () => {
      // this draft, by its own number, whichever was deleted most recently
      const back = await post<{ id: number }>(`/drafts/restore?id=${id}`);
      openDraft?.(back.id);
    });
  };
  const renameForm = renaming && inDraft && (
    <RenameDraft
      id={draftId}
      name={mixName}
      onDone={(next) => {
        renamedDraft?.(next);
        setRenaming(false);
      }}
    />
  );
  const backToCurrent = () => {
    closeDraft?.();
    setView('Edit');
  };

  const scrollWhileDragging = (event: DragEvent) => {
    const margin = 90;
    if (event.clientY < margin) window.scrollBy?.(0, -18);
    else if (event.clientY > window.innerHeight - margin) window.scrollBy?.(0, 18);
  };

  const clear = async (expectedOrder: string) => {
    // Keep listening on a failed/late mutation. The sound only stops after
    // the server confirms that the exact mix we saw was cleared.
    const empty = await post<MixData>('/mix/clear', undefined, { 'x-mix-order': expectedOrder });
    player.stop();
    setMixData(empty);
    notify('Cleared the mix.', true);
  };
  const deleteConfirmation = confirmDelete && (
    <Dialog title={`Delete ${mixName}?`} onClose={() => setConfirmDelete(false)} footer={(
      <>
        <button onClick={() => setConfirmDelete(false)}>Keep this draft</button>
        <Action className="destructive" working="Deleting…" run={async () => {
          await deleteDraft();
          setConfirmDelete(false);
        }}>Delete draft</Action>
      </>
    )}>
      <p>Delete this saved draft, not your current mix. Your music files are never touched.</p>
      <p className="hint">You can use Undo from the notification to restore this draft if no later change has replaced the restore point.</p>
    </Dialog>
  );
  const clearConfirmation = confirmClear !== null && (
    <Dialog title="Clear the current mix?" onClose={() => setConfirmClear(null)} footer={(
      <>
        <button onClick={() => setConfirmClear(null)}>Keep current mix</button>
        <Action className="destructive" working="Clearing…" run={async () => {
          await clear(confirmClear);
          setConfirmClear(null);
        }}>Clear current mix</Action>
      </>
    )}>
      <p>This stops playback and clears the current mix only. Your saved drafts and original music files stay untouched.</p>
      <p className="hint">Undo can bring back the cleared mix before any newer edit replaces that restore point.</p>
    </Dialog>
  );

  const jumpToProblem = () => {
    const index = readiness.firstProblem;
    if (index === null) return;
    setHearNow(false);
    setInspectorTab('change');
    selectSeamAt(index);
    if (mode === 'story') {
      // Story shows every transition too, so this stays in Story and goes to that transition's Edit button.
      reveal.current = 'focus';
      return;
    }
    const row = document.querySelector<HTMLElement>(`[data-seam="${seamKeyOf(keys[index - 1], keys[index])}"]`);
    row?.scrollIntoView?.({ block: 'center' });
    row?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  };

  const adder = (anchor: string) => (
    <Adder
      position={placeOf(anchor)}
      onAdd={(song) => void addSong(song, anchor)}
      onClose={() => setAdding(null)}
      notify={notify}
      line={line}
      refreshStatus={refreshStatus}
    />
  );

  if (!mix.length && inDraft) {
    return (
      <main className="page mix" id="main">
        <MixSwitcher draftId={draftId} openDraft={openDraft} closeDraft={backToCurrent} />
        <p className="eyebrow">Draft</p>
        <h1 className="display small">{mixName}</h1>
        <p className="lede">Add the first song. Nothing here touches what’s playing.</p>
        <div className="row wrap">
          <button onClick={() => setAdding('start')}>Add a song</button>
          <button onClick={() => setRenaming(true)}>Rename</button>
          <button onClick={() => setConfirmDelete(true)}>Delete</button>
          <button onClick={backToCurrent}>Back to current mix</button>
        </div>
        {renameForm}
        {deleteConfirmation}
        {problem && <p className="warn" role="alert">{problem}</p>}
        {adding === 'start' && adder('start')}
      </main>
    );
  }

  if (!mix.length) {
    return (
      <main className="page" id="main">
        <h1 className="display small">Nothing here yet</h1>
        <p className="lede">Start from one of Selecta’s mixes, or add songs yourself.</p>
        <div className="row wrap">
          <button className="primary" onClick={() => setView('Mixes')}>See the mixes</button>
          <button onClick={() => setAdding('start')}>Add a song</button>
        </div>
        {problem && <p className="warn" role="alert">{problem}</p>}
        {adding === 'start' && adder('start')}
      </main>
    );
  }

  const seamInspector = selectedItem && selectedBefore && (
    <SeamInspector
      key={seamKeyOf(keys[selectedIndex - 1], keys[selectedIndex])}
      item={selectedItem}
      previous={selectedBefore}
      names={status.moves}
      refreshMix={refreshMix}
      notify={notify}
      guard={guard}
      tab={inspectorTab}
      setTab={(tab) => { setHearNow(false); setInspectorTab(tab); }}
      autoPlay={hearNow}
      onClose={() => setSelected(null)}
      onListen={() => {
        if (now.phase === 'playing') void player.togglePause();
      }}
    />
  );
  const songInspector = selectedSong && (
    <SongInspector
      item={selectedSong}
      hasIn={selectedSongIndex > 0}
      hasOut={selectedSongIndex < mix.length - 1}
      onPlay={() => playFrom(selectedSong)}
      onAddAfter={() => {
        setAdding(keys[selectedSongIndex]);
        setSelected(null);
      }}
      onSeamIn={() => { setHearNow(false); setInspectorTab(seamTab); selectSeamAt(selectedSongIndex); }}
      onSeamOut={() => { setHearNow(false); setInspectorTab(seamTab); selectSeamAt(selectedSongIndex + 1); }}
    />
  );
  const inspecting = !!seamInspector || !!songInspector;
  // Lucy is told which mix this is, and the selected song or transition by its position, never more.
  const askLucy = new URLSearchParams({ scope: inDraft ? `draft:${draftId}` : 'current' });
  if (selectedSongIndex >= 0) askLucy.set('occurrence', String(selectedSongIndex));
  else if (selectedIndex > 0) askLucy.set('seam', String(selectedIndex));
  askLucy.set('from', inDraft ? `/mixes/drafts/${draftId}/edit` : '/mix/current/edit');

  const actions = (
    <>
      {inDraft ? (
        <>
          <Action className="primary" working="Starting…" run={() => playDraft?.(draftId)}>Play this mix</Action>
          {draftPlace ? (
            <Action run={() => prioritize(false)}>Take out of line</Action>
          ) : (
            waiting > 0 && (
              <Action title="Renders in the background, right after your current mix" run={() => prioritize(true)}>
                Prioritize
              </Action>
            )
          )}
          <button onClick={() => setRenaming(true)}>Rename</button>
          <Action working="Copying…" run={copyDraft}>Copy</Action>
        </>
      ) : (
        <>
          <button className="primary" onClick={() => {
            setView('Now');
            void player.playFrom(0);
          }}>
            Play from the top
          </button>
          <button onClick={() => {
            setName(mixName);
            setNaming(!naming);
          }} aria-expanded={naming}>
            Save a copy
          </button>
        </>
      )}
      {canUndo && undo && <Action working="Undoing…" run={() => undo(draftId)}>Undo last change</Action>}
      {readiness.firstProblem !== null && <button onClick={jumpToProblem}><Icon name="warning" /> Jump to first problem</button>}
      {!inDraft && ready < seams && (
        <Action run={renderAll} disabled={!waiting}>
          {waiting ? 'Render every transition' : rendering ? `Rendering ${ready} of ${seams}…` : 'Change failed transitions to continue'}
        </Action>
      )}
      {mix.length > 1 && <button onClick={() => setExporting(true)}>Download audio</button>}
      <PageLink className="button" to={`/mixes/lucy?${askLucy.toString()}`}>Ask Lucy about this mix</PageLink>
      {inDraft ? (
        <>
          <button className="destructive" onClick={() => setConfirmDelete(true)}><Icon name="trash" /> Delete</button>
          <button onClick={backToCurrent}>Back to current mix</button>
        </>
      ) : (
        <>
          <button onClick={() => setView('Mixes')}>New mix</button>
          <button className="destructive" onClick={() => setConfirmClear(order)}>Clear</button>
        </>
      )}
    </>
  );

  return (
    <main className="page mix" id="main" ref={page}>
      <EditorHeader
        draftId={draftId}
        mix={mix}
        mixName={mixName}
        mixEta={mixEta}
        draftPlace={draftPlace}
        currentMixName={currentMixName}
        readiness={readiness}
        totalSeconds={total}
        switcher={<MixSwitcher draftId={draftId} openDraft={openDraft} closeDraft={backToCurrent} />}
        actions={actions}
        view={<ViewSwitch mode={mode} onChange={chooseMode} />}
      />
      {renameForm}
      {deleteConfirmation}
      {clearConfirmation}
      {naming && (
        <form className="row" onSubmit={saveMix}>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label="Name this mix" />
          <button className="primary" disabled={!name.trim()}>Save copy</button>
          <button type="button" onClick={() => setNaming(false)}>Cancel</button>
        </form>
      )}
      {problem && <p className="warn" role="alert">{problem}</p>}
      {gone && <p className="notice" role="status">{gone}</p>}
      {exporting && <ExportPanel mix={mix} mixName={mixName} inDraft={inDraft} guard={guard} setMixData={setMixData} names={status.moves} onClose={() => setExporting(false)} />}

      {mode === 'story' && (
        <EditorStory
          mix={mix}
          keys={keys}
          names={status.moves}
          selected={selected}
          playingIndex={playingIndex}
          headingId={storyHeading}
          onSelectSong={selectSongAt}
          onEditSong={editSong}
          onEditSeam={editSeam}
        />
      )}

      {/* Arrange and Detail share one timeline. In Story it stays mounted but hidden, so an open
          transition keeps its pending choice, its tab and any preview exactly as they were. */}
      <section className="editor-arrange" aria-labelledby={arrangeHeading} hidden={mode === 'story'}>
        <h2 id={arrangeHeading} className="editor-mode-heading" tabIndex={-1} data-mode-heading="arrange">
          {mode === 'detail' ? 'Timeline, with a transition open' : 'Timeline'}
        </h2>
        {mix.length > 1 && <EnergyDisclosure items={mix} selectedIndex={selectedSongIndex} playingIndex={playingIndex} onSelect={selectSongAt} />}

        <div className={`edit-layout ${inspecting && !narrow ? 'has-inspector' : ''}`} style={inspecting && !narrow ? { '--inspector-width': `${inspectorWidth}px` } as React.CSSProperties : undefined}>
          <ol className={`timeline density ${mix.length > LONG_MIX ? 'long' : ''}`} onDragOver={scrollWhileDragging}>
            {mix.map((item, index) => (
              <FragmentRow key={keys[index]}>
                {index > 0 && (
                  <SeamUnlessReplaced
                    inDraft={inDraft}
                    item={item}
                    previous={mix[index - 1]}
                    rowKey={keys[index]}
                    seamKey={seamKeyOf(keys[index - 1], keys[index])}
                    names={status.moves}
                    guard={guard}
                    open={selectedIndex === index}
                    actions={rowActions}
                  />
                )}
                <SongLine
                  item={item}
                  rowKey={keys[index]}
                  total={mix.length}
                  playing={!inDraft && now.phase !== 'idle' && now.position === index}
                  selected={selectedSongIndex === index}
                  over={dragOver === keys[index]}
                  actions={rowActions}
                />
                {!inDraft && <ComingSongs afterSongId={item.song_id} />}
                {adding === keys[index]
                  ? <li className="adder-row">{adder(keys[index])}</li>
                  : <AddGap title={item.title} landsAt={index + 2} onAdd={() => setAdding(keys[index])} />}
              </FragmentRow>
            ))}
          </ol>
          {inspecting && !narrow && (
            <div className="inspector-column">
              <div
                className="inspector-resize"
                role="separator"
                aria-label="Resize inspector"
                aria-orientation="vertical"
                aria-valuemin={MIN_INSPECTOR_WIDTH}
                aria-valuemax={MAX_INSPECTOR_WIDTH}
                aria-valuenow={inspectorWidth}
                tabIndex={0}
                onPointerDown={beginInspectorResize}
                onKeyDown={resizeInspectorWithKeys}
              />
              <aside ref={inspector} className="edit-inspector" aria-label={seamInspector ? 'This transition' : 'This song'}>
                <div className="inspector-head">
                  <h2>{seamInspector ? 'Transition' : 'Song'}</h2>
                  <button aria-label="Close" onClick={() => setSelected(null)}><Icon name="close" /></button>
                </div>
                {seamInspector || songInspector}
              </aside>
            </div>
          )}
        </div>
      </section>
      {inspecting && narrow && mode !== 'story' && (
        <Sheet title={seamInspector ? 'Transition' : 'Song'} onClose={() => setSelected(null)}>{seamInspector || songInspector}</Sheet>
      )}
    </main>
  );
}
