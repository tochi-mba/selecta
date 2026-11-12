import { KeyboardEvent, memo, PointerEvent, RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, Eta, MixData, MixItem, post } from '../api';
import { flagOn } from '../flags';
import { mainPlayerTouched, releaseAudio, takeAudio } from '../audio/focus';
import { etaRangeWords } from '../lib';
import { Lane, LANES, Shape, SHAPES, Side, SIDES, StemDeck } from '../studio';
import { Action, announce, Problem } from '../ui/controls';
import { TermHint } from '../ui/Glossary';
import { Icon } from '../ui/Icon';
import { SongMotif } from '../ui/MusicObjects';
import { moveInGrid } from '../ui/primitives';
import { seamFacts } from '../ui/seam';
import { useStickyClearance } from '../ui/useStickyClearance';
import { useMixPath } from './mixScope';

type Session = {
  status: 'none' | 'queued' | 'rendering' | 'ready' | 'failed';
  key: string;
  error?: string;
  bars?: number;
  cells?: number;
  seconds?: number;
  start_shape?: Shape;
  shape?: Shape | null;
  eta?: Eta;
};

const LANE_WORDS: Record<Lane, string> = { vocals: 'Voice', drums: 'Drums', bass: 'Bass', other: 'Melody' };
/** Equal bar ranges for the same cells in the Grid and List editors. */
const barRange = (index: number, barsPerCell: number) => {
  const start = index * barsPerCell + 1;
  const end = start + barsPerCell - 1;
  return start === end ? `bar ${start}` : `bars ${start}–${end}`;
};
const WAIT_MS = 2000;
const UNSAVED = 'selecta.studio.';
/** The column of solo buttons, in front of the squares, in the grid's one tab stop. */
const SOLO_COLUMN = -1;

function savedShape(key: string, cells: number): Shape | null {
  try {
    // A browser may still hold a draft written by an older Selecta version or a different
    // bar layout. Never feed a malformed grid into the audio deck or overwrite the current
    // transition with it. The committed shape remains the safe starting point.
    const candidate: unknown = JSON.parse(window.localStorage.getItem(UNSAVED + key) ?? 'null');
    if (!candidate || typeof candidate !== 'object') return null;
    const saved = candidate as Shape;
    for (const side of SIDES) {
      for (const lane of LANES) {
        const squares = saved[side]?.[lane];
        if (!Array.isArray(squares) || squares.length !== cells || squares.some((value) => value !== 0 && value !== 1)) return null;
      }
    }
    return saved;
  } catch {
    return null;
  }
}

function keepShape(key: string, shape: Shape | null) {
  try {
    if (shape) window.localStorage.setItem(UNSAVED + key, JSON.stringify(shape));
    else window.localStorage.removeItem(UNSAVED + key);
    return true;
  } catch {
    return false;
  }
}

type CellActions = { focus: (row: number, column: number) => void; toggle: (side: Side, lane: Lane, index: number) => void };

/** One square of the grid. Memoised (r8c): the playhead moving on redraws only the square it leaves
 * and the one it reaches, not all of them, and the handlers come through a ref so they never count
 * as a change. */
const StudioCell = memo(function StudioCell({ side, lane, row, index, value, now, changed, lost, saving, focusable, label, title, actions }: {
  side: Side;
  lane: Lane;
  row: number;
  index: number;
  value: number;
  now: boolean;
  changed: boolean;
  lost: boolean;
  saving: boolean;
  focusable: boolean;
  label: string;
  title: string;
  actions: RefObject<CellActions>;
}) {
  return (
    <span role="gridcell" className="studio-gridcell">
      <button
        data-cell={`${row}-${index}`}
        tabIndex={focusable ? 0 : -1}
        className={`studio-cell ${now ? 'now' : ''} ${changed ? 'ai-changed' : ''}`}
        aria-pressed={Boolean(value)}
        aria-disabled={lost || saving || undefined}
        aria-label={label}
        title={title}
        onFocus={() => actions.current.focus(row, index)}
        onClick={(event) => { if (event.detail === 0) actions.current.toggle(side, lane, index); }}
      />
    </span>
  );
});

function StudioListEditor({ shape, titles, missing, barsPerCell, soloed, disabled, onToggle, onSolo }: {
  shape: Shape;
  titles: Record<Side, string>;
  missing: string[];
  barsPerCell: number;
  soloed: string | null;
  disabled: boolean;
  onToggle: (side: Side, lane: Lane, index: number) => void;
  onSolo: (name: string) => void;
}) {
  return (
    <div className="studio-list" aria-label="Stem controls by song and part">
      {SIDES.map((side, sideIndex) => (
        <section key={side} aria-labelledby={`studio-list-${side}`}>
          <h4 id={`studio-list-${side}`}>{titles[side]}</h4>
          {LANES.map((lane, laneIndex) => {
            const name = `${side}_${lane}`;
            const row = sideIndex * LANES.length + laneIndex;
            const lost = missing.includes(name);
            return (
              <fieldset key={name} disabled={lost || disabled}>
                <legend>{LANE_WORDS[lane]}{lost ? ' - unavailable' : ''}</legend>
                <button type="button" aria-pressed={soloed === name} onClick={() => onSolo(name)}>
                  {soloed === name ? 'Hear everything' : `Hear only ${LANE_WORDS[lane].toLowerCase()}`}
                </button>
                <div className="studio-list-cells">
                  {shape[side][lane].map((value, index) => (
                    <label key={index}>
                      <input type="checkbox" data-cell={`${row}-${index}`} disabled={lost} checked={Boolean(value)} onChange={() => onToggle(side, lane, index)} />
                      <span>{barRange(index, barsPerCell)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** A guided view over the exact same grid. These controls deliberately make only two
 * lossless, explainable edits: fill or clear one complete lane. Merely moving between
 * Shape and Detailed never translates or normalizes the working copy. */
function StudioShapeEditor({ shape, titles, missing, disabled, onSetLane }: {
  shape: Shape;
  titles: Record<Side, string>;
  missing: string[];
  disabled: boolean;
  onSetLane: (side: Side, lane: Lane, value: 0 | 1) => void;
}) {
  return (
    <div className="studio-list studio-shape" role="region" aria-label="Guided shape controls">
      <p className="hint">Two songs, each with voice, drums, bass and melody. Use throughout or leave out changes every cell of only that part of that song. Switching to Grid or List preserves the same exact cells; nothing is applied until you choose Apply.</p>
      {SIDES.map((side) => (
        <section key={side} aria-labelledby={`studio-shape-${side}`}>
          <h4 id={`studio-shape-${side}`}>{titles[side]}</h4>
          {LANES.map((lane) => {
            const name = `${side}_${lane}`;
            const lost = missing.includes(name);
            const active = shape[side][lane].filter(Boolean).length;
            const total = shape[side][lane].length;
            return (
              <fieldset key={name} disabled={lost || disabled}>
                <legend>{LANE_WORDS[lane]}{lost ? ' - unavailable' : ''}</legend>
                <p className="hint">{active === 0 ? 'Left out' : active === total ? 'Used throughout' : `Used in ${active} of ${total} sections`}</p>
                <div className="row wrap">
                  <button type="button" aria-pressed={active === total} onClick={() => onSetLane(side, lane, 1)}>Use throughout</button>
                  <button type="button" aria-pressed={active === 0} onClick={() => onSetLane(side, lane, 0)}>Leave out</button>
                </div>
              </fieldset>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** Both songs' voice, drums, bass and melody on one grid. Tap a square and it's heard straight away.
 * Press a name to hear only that part. Four things are kept apart here: the copy you're working on, one
 * recovered from this browser, what's applied to the mix, and the audio that was rendered from it.
 * Nothing is rendered until Apply. */
export function Studio(props: {
  position: number;
  item: MixItem;
  previous: MixItem;
  names?: Record<string, string>;
  onClose: () => void;
  onUsed: (data: MixData) => void;
  onConflict?: () => void;
  onListen?: () => void;
  notify: (message: string) => void;
  guard?: Record<string, string>;
}) {
  const { position, item, previous, names, onClose, onUsed, onConflict, notify, guard } = props;
  const [session, setSession] = useState<Session | null>(null);
  const [shape, setShape] = useState<Shape | null>(null);
  const [problem, setProblem] = useState('');
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [cell, setCell] = useState(-1);
  const [soloed, setSoloed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState('');
  const [changes, setChanges] = useState<string[] | null>(null);
  const [before, setBefore] = useState<Shape | null>(null);
  const [restored, setRestored] = useState(false);
  const [retained, setRetained] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const applying = useRef(false);
  const tuneAttempt = useRef(0);
  const latestShape = useRef<Shape | null>(null);
  latestShape.current = shape;
  const [focusCell, setFocusCell] = useState({ row: 0, column: 0 });
  const [editorMode, setEditorMode] = useState<'shape' | 'grid' | 'list'>('grid');
  const changeEditorMode = (next: 'shape' | 'grid' | 'list') => {
    if (next === editorMode) return;
    setEditorMode(next);
    announce(`${next === 'shape' ? 'Shape' : next === 'grid' ? 'Detailed grid' : 'Detailed list'} controls. All eight lanes and every square are unchanged.`);
  };
  const deck = useRef<StemDeck | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLElement>(null);
  useStickyClearance(head);
  // SF-0243-03: a stroke remembers the grid from before it started, so a cancelled pointer, Escape
  // or leaving the page mid-stroke puts every square it touched back
  const paintStroke = useRef<{ id: number; value: 0 | 1; visited: Set<string>; before: Shape; key?: string } | null>(null);
  const at = useMixPath();
  const owner = useRef({
    id: `studio-${position}-${item.song_id}`,
    label: 'The Studio',
    stop: () => {
      deck.current?.stop();
      setPlaying(false);
      setCell(-1);
    },
  });
  const listen = () => takeAudio(owner.current);
  // stopping here doesn't bring the mix back: someone working in the Studio isn't done listening
  const quiet = () => {
    mainPlayerTouched();
    releaseAudio(owner.current.id);
  };
  // A Studio preview is an intentional, temporary audio owner, never background music.
  useEffect(() => {
    const hide = () => {
      if (!document.hidden) return;
      deck.current?.stop();
      setPlaying(false);
      setCell(-1);
      quiet();
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    setProblem('');
    setLoaded(false);
    const follow = () => {
      post<Session>(at(`/mix/${position}/studio`))
        .then((next) => {
          if (!live) return;
          setSession(next);
          if (next.status !== 'ready' && next.status !== 'failed') timer = window.setTimeout(follow, WAIT_MS);
        })
        .catch((error: Error) => live && setProblem(error.message));
    };
    follow();
    return () => {
      live = false;
      window.clearTimeout(timer);
      deck.current?.close();
      deck.current = null;
      quiet();
    };
  }, [position, item.song_id, previous.song_id, attempt]);

  useEffect(() => {
    if (session?.status !== 'ready' || deck.current || !session.start_shape) return;
    const committed = session.shape ?? session.start_shape;
    // what you were working on is still here, even after leaving the page or a failed render
    const unsaved = savedShape(session.key, session.cells ?? 8);
    const chosen = unsaved ?? committed;
    setRestored(!!unsaved && JSON.stringify(unsaved) !== JSON.stringify(committed));
    const made = new StemDeck(session.seconds ?? 1, session.cells ?? 8, chosen);
    made.onCell = setCell;
    deck.current = made;
    latestShape.current = chosen;
    setShape(chosen);
    made
      .load((side, lane) => `/api/studio/${session.key}/${side}/${lane}`)
      .then((lost) => {
        setMissing(Array.isArray(lost) ? lost : []);
        setLoaded(true);
      })
      .catch((error: Error) => setProblem(error.message));
  }, [session]);

  const change = (next: Shape) => {
    // Once Apply has started, this exact working copy is frozen. Otherwise a
    // late response could clear an unsaved newer arrangement.
    if (applying.current) return;
    // A stroke doesn't cancel a fine tune on its way: askSelecta sees the grid moved on (latestShape)
    // and keeps the person's version, saying so, rather than dropping the answer in silence.
    latestShape.current = next;
    setShape(next);
    setAsking('');
    setChanges(null);
    setBefore(null);
    setProblem('');
    deck.current?.setShape(next);
    if (session?.key) setRetained(keepShape(session.key, next));
  };
  /** Selecta's turn. What was there can be put back, nothing is final until Apply, and if it fails or
   * the grid changed while it was thinking, what you've got stays exactly as it is. */
  const askSelecta = async (mine: boolean) => {
    if (!shape || applying.current) return;
    const sent = shape;
    const request = ++tuneAttempt.current;
    setAsking(mine ? 'tune' : 'arrange');
    setProblem('');
    try {
      const answer = await post<{ shape: Shape; changes: string[] }>(at(`/mix/${position}/studio/tune`), { shape: mine ? shape : null });
      if (request !== tuneAttempt.current) return;
      if (latestShape.current !== sent) {
        setChanges(['You changed the grid while Selecta was working, so your version stays.']);
        return;
      }
      const same = JSON.stringify(answer.shape) === JSON.stringify(shape);
      setBefore(same ? null : shape);
      latestShape.current = answer.shape;
      setShape(answer.shape);
      deck.current?.setShape(answer.shape);
      if (session?.key) setRetained(keepShape(session.key, answer.shape));
      setChanges(same ? [mine ? 'Nothing to change. This is as good as Selecta can make it.' : 'This is already what Selecta would make.'] : mine ? answer.changes : ['Selecta arranged this from what’s in the stems.']);
    } catch (error) {
      if (request === tuneAttempt.current && latestShape.current === sent) setProblem((error as Error).message);
    } finally {
      if (request === tuneAttempt.current) setAsking('');
    }
  };
  const putBack = () => {
    if (!before || applying.current) return;
    tuneAttempt.current += 1;
    latestShape.current = before;
    setAsking('');
    setShape(before);
    if (session?.key) setRetained(keepShape(session.key, before));
    deck.current?.setShape(before);
    setBefore(null);
    setChanges(null);
  };
  const toggle = (side: Side, lane: Lane, index: number) => {
    const current = latestShape.current;
    if (!current || applying.current || missing.includes(`${side}_${lane}`)) return;
    const cells = current[side][lane].map((value, at) => (at === index ? (value ? 0 : 1) : value));
    change({ ...current, [side]: { ...current[side], [lane]: cells } });
  };
  // Each pointer stroke paints a single on/off value. Revisiting a square
  // within the same stroke cannot undo it; every edit is immediately
  // persisted to the local recoverable working shape, not the server.
  const paint = (target: Element | null, stroke: NonNullable<typeof paintStroke.current>) => {
    const button = target?.closest<HTMLButtonElement>('button.studio-cell[data-cell]');
    if (!button || !grid.current?.contains(button) || button.getAttribute('aria-disabled') === 'true') return;
    const match = /^(\d+)-(\d+)$/.exec(button.dataset.cell ?? '');
    if (!match) return;
    const row = Number(match[1]);
    const column = Number(match[2]);
    const side = SIDES[Math.floor(row / LANES.length)];
    const lane = LANES[row % LANES.length];
    const current = latestShape.current;
    if (!side || !lane || !current?.[side]?.[lane] || column >= current[side][lane].length ||
        missing.includes(`${side}_${lane}`) || applying.current || saving) return;
    const key = `${row}-${column}`;
    if (stroke.visited.has(key)) return;
    stroke.visited.add(key);
    if (current[side][lane][column] === stroke.value) return;
    const updated = current[side][lane].map((value, index) => index === column ? stroke.value : value);
    change({ ...current, [side]: { ...current[side], [lane]: updated } });
  };
  const startPaint = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || saving || applying.current) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button.studio-cell[data-cell]');
    const match = /^(\d+)-(\d+)$/.exec(button?.dataset.cell ?? '');
    if (!button || !match || button.getAttribute('aria-disabled') === 'true') return;
    const side = SIDES[Math.floor(Number(match[1]) / LANES.length)];
    const lane = LANES[Number(match[1]) % LANES.length];
    const current = latestShape.current;
    if (!side || !lane || !current?.[side]?.[lane]) return;
    paintStroke.current = { id: event.pointerId, value: current[side][lane][Number(match[2])] ? 0 : 1, visited: new Set(), before: current, key: session?.key };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    paint(button, paintStroke.current);
  };
  const movePaint = (event: PointerEvent<HTMLDivElement>) => {
    const stroke = paintStroke.current;
    if (!stroke || stroke.id !== event.pointerId) return;
    const under = document.elementFromPoint?.(event.clientX, event.clientY);
    paint(under ?? (event.target as HTMLElement), stroke);
  };
  const stopPaint = () => { paintStroke.current = null; };
  /** The browser took the gesture (a scroll, a palm, a lost pointer) or Escape was pressed: undo
   * just this stroke. Squares changed before it are kept. */
  const cancelPaint = () => {
    const stroke = paintStroke.current;
    paintStroke.current = null;
    if (!stroke || applying.current) return;
    if (JSON.stringify(stroke.before) !== JSON.stringify(latestShape.current)) change(stroke.before);
  };
  const cancelPaintNow = useRef(cancelPaint);
  cancelPaintNow.current = cancelPaint;
  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !paintStroke.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancelPaintNow.current();
    };
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('keydown', escape, true);
      // leaving mid-stroke keeps the grid as it was before the stroke, not half-painted
      const stroke = paintStroke.current;
      paintStroke.current = null;
      if (stroke?.key) keepShape(stroke.key, stroke.before);
    };
  }, []);
  const setLane = (side: Side, lane: Lane, value: 0 | 1) => {
    if (!shape || missing.includes(`${side}_${lane}`)) return;
    change({ ...shape, [side]: { ...shape[side], [lane]: shape[side][lane].map(() => value) } });
  };
  const start = async () => {
    listen();
    try {
      await deck.current?.play();
      setPlaying(true);
    } catch (error) {
      // it never made a sound, so whatever was playing can carry on
      setPlaying(false);
      releaseAudio(owner.current.id);
      throw error;
    }
  };
  const playOrStop = async () => {
    if (!deck.current) return;
    if (playing) {
      deck.current.stop();
      setPlaying(false);
      setCell(-1);
      quiet();
    } else {
      await start();
    }
  };
  const solo = async (name: string) => {
    if (!deck.current || applying.current || missing.includes(name)) return;
    const next = soloed === name ? null : name;
    setSoloed(next);
    deck.current.solo(next);
    if (next && !playing) await start();
  };
  const use = async () => {
    if (!shape || applying.current || !session) return;
    const submitted = latestShape.current ?? shape;
    applying.current = true;
    tuneAttempt.current += 1;
    setSaving(true);
    deck.current?.stop();
    setPlaying(false);
    quiet();
    try {
      // the same pair, or nothing: this shape was made for these stems and no others
      const now = await post<Session>(at(`/mix/${position}/studio`));
      if (now.key !== session.key) {
        setProblem('This transition has changed since the Studio opened, so nothing was applied. Your shape is still here.');
        setSaving(false);
        onConflict?.();
        return;
      }
      const result = await post<MixData>(at(`/mix/${position}/studio/use`), { shape: submitted }, guard);
      onUsed(result);
      // A browser may still dispatch a final pointer event before the
      // disabled state paints. Only delete the stored working copy if it is
      // the exact shape the server accepted.
      if (latestShape.current === submitted) {
        keepShape(session.key, null);
        notify('Rendering your version. It’ll play in the mix when it’s ready.');
        onClose();
      } else {
        setProblem('An earlier shape was applied. Your newer changes are still here; apply them when ready.');
        setSaving(false);
      }
    } catch (error) {
      // the shape stays right here, so nothing's lost by this going wrong
      setProblem((error as Error).message);
      setSaving(false);
      if (error instanceof ApiError && error.code === 'mix_changed') onConflict?.();
    } finally { applying.current = false; }
  };

  const titles: Record<Side, string> = { a: previous.title, b: item.title };
  const preparing = !session || session.status === 'none' || session.status === 'queued' || session.status === 'rendering';
  const failed = problem || (session?.status === 'failed' ? session.error : '');
  const barsPerCell = session?.bars && session.cells ? session.bars / session.cells : 2;
  const columns = session?.cells ?? 8;
  const committed = session?.shape ?? session?.start_shape;
  // r8c: worked out once per change of the grid, not on every move of the playhead
  const dirty = useMemo(() => !!shape && JSON.stringify(shape) !== JSON.stringify(committed), [shape, committed]);
  const cellActions = useRef<CellActions>({ focus: () => {}, toggle: () => {} });
  cellActions.current = { focus: (row, column) => setFocusCell({ row, column }), toggle };
  // Only the actual returned eight-lane cells count as an AI change. Freeform explanation
  // text never drives the visual diff, and editing after a proposal clears this comparison.
  const aiDiffs = useMemo(() => {
    if (!before || !shape) return [] as { side: Side; lane: Lane; index: number; from: number; to: number }[];
    return SIDES.flatMap((side) => LANES.flatMap((lane) =>
      shape[side][lane].flatMap((to, index) =>
        before[side][lane][index] === to ? [] : [{ side, lane, index, from: before[side][lane][index], to }],
      ),
    ));
  }, [before, shape]);
  const changedCells = useMemo(() => new Set(aiDiffs.map((diff) => diff.side + '_' + diff.lane + ':' + diff.index)), [aiDiffs]);
  const rowCount = SIDES.length * LANES.length;
  const rendered = seamFacts(item.seam, names);
  const stemName = (name: string) => {
    const [side, lane] = name.split('_') as [Side, Lane];
    return `${titles[side]} ${LANE_WORDS[lane].toLowerCase()}`;
  };
  const gridKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: { row: number; column: number } | null;
    if (event.ctrlKey && event.key === 'Home') next = { row: 0, column: 0 };
    else if (event.ctrlKey && event.key === 'End') next = { row: rowCount - 1, column: columns - 1 };
    else if (event.key === 'Home') next = { row: focusCell.row, column: 0 };
    else next = moveInGrid(event.key, focusCell, rowCount, columns, SOLO_COLUMN);
    if (!next) return;
    event.preventDefault();
    setFocusCell(next);
    grid.current?.querySelector<HTMLElement>(`[data-cell="${next.row}-${next.column}"]`)?.focus();
  };

  return (
    <section className="studio" aria-label="Stem studio">
      <header className="studio-head" ref={head}>
        <div className="studio-pair">
          <h3>Shape transition {position}</h3>
          <p><SongMotif songId={previous.song_id} /><b>{previous.title}</b> <span aria-hidden="true">→</span><span className="visually-hidden"> into </span> <SongMotif songId={item.song_id} /><b>{item.title}</b></p>
        </div>
        {shape && loaded && (
          <div className="studio-transport">
            <Action className="primary" run={playOrStop}>
              <Icon name={playing ? 'stop' : 'play'} /> {playing ? 'Stop preview' : 'Play preview'}
            </Action>
            {soloed && <button onClick={() => void solo(soloed)}>Hear everything again</button>}
            {playing && cell >= 0 && <span className="studio-playhead" role="status">Preview at bar {Math.round(cell * ((session?.bars ?? 8) / (session?.cells ?? 8))) + 1}</span>}
          </div>
        )}
        <button onClick={onClose}>Close</button>
      </header>
      {failed && (loaded ? <p className="warn" role="alert">{failed}</p> : <Problem retry={() => { deck.current?.close(); deck.current = null; setSession(null); setAttempt((value) => value + 1); }}>{failed}</Problem>)}
      {!failed && preparing && (
        <p className="hint" role="status">
          Separating vocals, drums, bass and melody from both songs.
          {session?.eta?.late ? ' This is taking longer than usual.' : session?.eta ? ` Estimated time: ${etaRangeWords(session.eta)}.` : ' This may take a few minutes.'} Your mix keeps playing until you start a preview.
        </p>
      )}
      {!failed && session?.status === 'ready' && !loaded && <p className="hint" role="status">Loading the stems…</p>}
      {shape && loaded && (
        <>
          <dl className="studio-states" aria-label="Where this shape has got to">
            <div className={dirty ? 'on' : undefined}><dt>Working copy</dt><dd>{dirty ? 'Changed, not applied yet' : 'Same as what’s applied'}</dd></div>
            <div className={restored ? 'on' : undefined}><dt>Recovered from this browser</dt><dd>{restored ? 'Yes, your earlier work' : 'Nothing to recover'}</dd></div>
            <div><dt>Applied to the mix</dt><dd>{session?.shape ? 'Your shape' : 'Selecta’s starting shape'}</dd></div>
            <div><dt>Rendered audio</dt><dd>{rendered.words}</dd></div>
          </dl>
          <p className="hint">
            Two songs, four parts per song: voice, drums, bass and melody.<TermHint term="studio-lane" /> Each square is {barsPerCell} bar{barsPerCell === 1 ? '' : 's'} in that song.<TermHint term="studio-cell" /> The Grid and List change the same exact cells. Tap one to turn that part on or off; press a name to hear only that part during a preview.<TermHint term="solo" />
          </p>
          <p className="hint">Previewing pauses the main mix. After stopping or closing Studio, use the main player to resume it.</p>
          <p className="studio-save-state" role="status">{saving ? 'Applying your transition…' : dirty ? 'Unsaved changes - not applied to the mix' : 'Showing the saved transition'}{dirty && retained ? `${saving ? ' ' : '. '}Your work is kept on this browser when you close Studio.` : ''}</p>
          {!retained && <p className="warn" role="alert">This browser could not keep a local copy. Apply your changes before closing Studio to keep them.</p>}
          {missing.length > 0 && (
            <p className="warn" role="alert">
              Couldn’t load {missing.map(stemName).join(', ')}, so {missing.length === 1 ? 'that part' : 'those parts'} can’t be heard or changed here. The rest work as normal.
            </p>
          )}
          {flagOn('stem_studio.auto_arrange') && (
            <div className="row wrap">
              <button disabled={saving || !!asking} aria-busy={asking === 'arrange'} onClick={() => void askSelecta(false)}>
                {asking === 'arrange' ? 'Arranging…' : 'Let Selecta arrange it'}
              </button>
              <button disabled={saving || !!asking} aria-busy={asking === 'tune'} onClick={() => void askSelecta(true)}>
                {asking === 'tune' ? 'Fine tuning…' : 'Fine tune mine'}
              </button>
              {before && <button disabled={saving} onClick={putBack}>Put it back</button>}
              <TermHint term="suggestion" />
            </div>
          )}
          {changes && (
            <ul className="studio-changes" role="status">
              {changes.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          {before && <details className="studio-diff" open>
            <summary>{aiDiffs.length} exact cell {aiDiffs.length === 1 ? 'change' : 'changes'} from Selecta’s suggestion</summary>
            <p className="hint">Only the returned arrangement is compared with your previous working copy. Put it back to undo the whole suggestion.</p>
            <ol>
              {aiDiffs.map((diff) => (
                <li key={diff.side + '-' + diff.lane + '-' + diff.index}>
                  {titles[diff.side]} · {LANE_WORDS[diff.lane]} · square {diff.index + 1}: {diff.from ? 'On' : 'Off'} → {diff.to ? 'On' : 'Off'}
                </li>
              ))}
            </ol>
          </details>}
          <div className="chips studio-shapes" role="group" aria-label="Ready-made shapes">
            {SHAPES.map((option) => (
              <button key={option.name} disabled={saving} title={option.about} onClick={() => change(option.change(shape))}>
                {option.name}
              </button>
            ))}
          </div>
          {restored && <p className="hint" role="status">This is what you were working on before. Start again to go back to what’s in the mix.</p>}
          <div className="chips" role="group" aria-label="Studio editor mode">
            <button aria-pressed={editorMode === 'shape'} onClick={() => changeEditorMode('shape')}>Shape</button>
            <button aria-pressed={editorMode === 'grid'} onClick={() => changeEditorMode('grid')}>Detailed grid</button>
            <button aria-pressed={editorMode === 'list'} onClick={() => changeEditorMode('list')}>Detailed list</button>
          </div>
          {editorMode === 'shape' ? (
            <StudioShapeEditor
              shape={shape}
              titles={titles}
              missing={missing}
              disabled={saving}
              onSetLane={setLane}
            />
          ) : editorMode === 'grid' ? (
            <>
              <p className="hint">Arrow keys move around the grid, and Space turns a square on or off. Drag from a square to paint the same on/off value across the squares you touch. Left of the first square is the part’s name, which plays that part alone.</p>
              <div
            className="studio-grid"
            role="grid"
            aria-label={`Stems for ${titles.a} and ${titles.b}`}
            ref={grid}
            onKeyDown={gridKeys}
            onPointerDown={startPaint}
            onPointerMove={movePaint}
            onPointerUp={stopPaint}
            onPointerCancel={cancelPaint}
            onLostPointerCapture={stopPaint}
            style={{ '--cells': columns } as React.CSSProperties}
              >
            <div className="studio-lane studio-ruler" role="row" aria-label="Bars">
              <span className="studio-name" role="columnheader">Bar</span>
              {Array.from({ length: columns }, (_, index) => (
                <span key={index} role="columnheader" className={index === cell ? 'now' : undefined}>{index * barsPerCell + 1}</span>
              ))}
            </div>
            {SIDES.map((side, sideIndex) => (
              <div className="studio-side" key={side} role="rowgroup" aria-label={titles[side]}>
                <div className="studio-side-name" role="row">
                  <span role="gridcell" aria-colspan={columns + 1}><h4>{titles[side]}</h4></span>
                </div>
                {LANES.map((lane, laneIndex) => {
                  const name = `${side}_${lane}`;
                  const row = sideIndex * LANES.length + laneIndex;
                  const lost = missing.includes(name);
                  const silenced = !!soloed && soloed !== name;
                  return (
                    <div className={`studio-lane ${silenced ? 'silenced' : ''} ${soloed === name ? 'soloed' : ''} ${lost ? 'lost' : ''}`} key={name} role="row">
                      <span role="rowheader" className="studio-gridcell">
                        <button
                          className="studio-name"
                          data-cell={`${row}-${SOLO_COLUMN}`}
                          tabIndex={focusCell.row === row && focusCell.column === SOLO_COLUMN ? 0 : -1}
                          aria-pressed={soloed === name}
                          aria-disabled={lost || saving || undefined}
                          aria-label={`Hear only ${titles[side]} ${LANE_WORDS[lane].toLowerCase()}${lost ? ', unavailable' : ''}`}
                          title={lost ? 'This part couldn’t be loaded' : undefined}
                          onFocus={() => setFocusCell({ row, column: SOLO_COLUMN })}
                          onClick={() => void solo(name)}
                        >
                          {soloed === name ? 'Solo: ' : ''}{LANE_WORDS[lane]}
                        </button>
                      </span>
                      {shape[side][lane].map((value, index) => (
                        <StudioCell
                          key={index}
                          side={side}
                          lane={lane}
                          row={row}
                          index={index}
                          value={value}
                          now={index === cell}
                          changed={changedCells.has(side + '_' + lane + ':' + index)}
                          lost={lost}
                          saving={saving}
                          focusable={focusCell.row === row && focusCell.column === index}
                          label={`${titles[side]} ${LANE_WORDS[lane].toLowerCase()}, ${barRange(index, barsPerCell)}, ${value ? 'on' : 'off'}${lost ? ', unavailable' : ''}`}
                          title={lost ? 'This part couldn’t be loaded' : barRange(index, barsPerCell)}
                          actions={cellActions}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
              </div>
            </>
          ) : (
            <StudioListEditor
              shape={shape}
              titles={titles}
              missing={missing}
              barsPerCell={barsPerCell}
              soloed={soloed}
              disabled={saving}
              onToggle={toggle}
              onSolo={(name) => void solo(name)}
            />
          )}
          <div className="row wrap">
            <button className="primary" disabled={saving || !!asking} onClick={() => void use()}>
              {saving ? 'Applying…' : 'Apply to this transition'}
            </button>
            <TermHint term="applied" />
            {session?.start_shape && (
              <button onClick={() => {
                change((session.shape ?? session.start_shape) as Shape);
                keepShape(session.key, null);
                setRestored(false);
              }}>
                Start again
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
