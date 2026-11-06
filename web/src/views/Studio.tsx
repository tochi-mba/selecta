import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Eta, MixData, MixItem, post } from '../api';
import { mainPlayerTouched, releaseAudio, takeAudio } from '../audio/focus';
import { etaRangeWords } from '../lib';
import { Lane, LANES, Shape, SHAPES, Side, SIDES, StemDeck } from '../studio';
import { Action, Problem } from '../ui/controls';
import { Icon } from '../ui/Icon';
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
const WAIT_MS = 2000;
const UNSAVED = 'selecta.studio.';

function savedShape(key: string): Shape | null {
  try {
    return JSON.parse(window.localStorage.getItem(UNSAVED + key) ?? 'null');
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

/** Both songs' voice, drums, bass and melody on one grid. Tap a square and it's heard straight away.
 * Press a name to hear only that part. Nothing is rendered until "Use this". */
export function Studio(props: {
  position: number;
  item: MixItem;
  previous: MixItem;
  onClose: () => void;
  onUsed: (data: MixData) => void;
  onListen?: () => void;
  notify: (message: string) => void;
  guard?: Record<string, string>;
}) {
  const { position, item, previous, onClose, onUsed, notify, guard } = props;
  const [session, setSession] = useState<Session | null>(null);
  const [shape, setShape] = useState<Shape | null>(null);
  const [problem, setProblem] = useState('');
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
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
  const [focusCell, setFocusCell] = useState({ row: 0, column: 0 });
  const deck = useRef<StemDeck | null>(null);
  const grid = useRef<HTMLDivElement>(null);
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
    const unsaved = savedShape(session.key);
    const chosen = unsaved ?? committed;
    setRestored(!!unsaved && JSON.stringify(unsaved) !== JSON.stringify(committed));
    const made = new StemDeck(session.seconds ?? 1, session.cells ?? 8, chosen);
    made.onCell = setCell;
    deck.current = made;
    setShape(chosen);
    made
      .load((side, lane) => `/api/studio/${session.key}/${side}/${lane}`)
      .then(() => setLoaded(true))
      .catch((error: Error) => setProblem(error.message));
  }, [session]);

  const change = (next: Shape) => {
    setShape(next);
    setChanges(null);
    setBefore(null);
    setProblem('');
    deck.current?.setShape(next);
    if (session?.key) setRetained(keepShape(session.key, next));
  };
  /** Selecta's turn. What was there can be put back, and nothing is final until "Use this". */
  const askSelecta = async (mine: boolean) => {
    if (!shape) return;
    setAsking(mine ? 'tune' : 'arrange');
    setProblem('');
    try {
      const answer = await post<{ shape: Shape; changes: string[] }>(at(`/mix/${position}/studio/tune`), { shape: mine ? shape : null });
      const same = JSON.stringify(answer.shape) === JSON.stringify(shape);
      setBefore(same ? null : shape);
      setShape(answer.shape);
      deck.current?.setShape(answer.shape);
      if (session?.key) setRetained(keepShape(session.key, answer.shape));
      setChanges(same ? [mine ? 'Nothing to change. This is as good as Selecta can make it.' : 'This is already what Selecta would make.'] : mine ? answer.changes : ['Selecta arranged this from what’s in the stems.']);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setAsking('');
    }
  };
  const putBack = () => {
    if (!before) return;
    setShape(before);
    if (session?.key) setRetained(keepShape(session.key, before));
    deck.current?.setShape(before);
    setBefore(null);
    setChanges(null);
  };
  const toggle = (side: Side, lane: Lane, index: number) => {
    if (!shape) return;
    const cells = shape[side][lane].map((value, at) => (at === index ? (value ? 0 : 1) : value));
    change({ ...shape, [side]: { ...shape[side], [lane]: cells } });
  };
  const playOrStop = async () => {
    if (!deck.current) return;
    if (playing) {
      deck.current.stop();
      setPlaying(false);
      setCell(-1);
      quiet();
    } else {
      listen();
      await deck.current.play();
      setPlaying(true);
    }
  };
  const solo = async (name: string) => {
    if (!deck.current) return;
    const next = soloed === name ? null : name;
    setSoloed(next);
    deck.current.solo(next);
    if (next && !playing) {
      listen();
      await deck.current.play();
      setPlaying(true);
    }
  };
  const use = async () => {
    if (!shape || applying.current) return;
    applying.current = true;
    setSaving(true);
    deck.current?.stop();
    setPlaying(false);
    quiet();
    try {
      onUsed(await post<MixData>(at(`/mix/${position}/studio/use`), { shape }, guard));
      if (session?.key) keepShape(session.key, null);
      notify('Rendering your version. It’ll play in the mix when it’s ready.');
      onClose();
    } catch (error) {
      // the shape stays right here, so nothing's lost by this going wrong
      setProblem((error as Error).message);
      setSaving(false);
    } finally { applying.current = false; }
  };

  const titles: Record<Side, string> = { a: previous.title, b: item.title };
  const preparing = !session || session.status === 'none' || session.status === 'queued' || session.status === 'rendering';
  const failed = problem || (session?.status === 'failed' ? session.error : '');
  const barsPerCell = session?.bars && session.cells ? session.bars / session.cells : 2;
  const columns = session?.cells ?? 8;
  const dirty = !!shape && JSON.stringify(shape) !== JSON.stringify(session?.shape ?? session?.start_shape);
  const rowCount = SIDES.length * LANES.length;
  const gridKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
    let next = moves[event.key] ? { row: focusCell.row + moves[event.key][0], column: focusCell.column + moves[event.key][1] } : null;
    if (event.key === 'Home') next = { row: focusCell.row, column: 0 };
    if (event.key === 'End') next = { row: focusCell.row, column: columns - 1 };
    if (!next) return;
    event.preventDefault();
    const moved = { row: Math.min(Math.max(next.row, 0), rowCount - 1), column: Math.min(Math.max(next.column, 0), columns - 1) };
    setFocusCell(moved);
    grid.current?.querySelector<HTMLElement>(`[data-cell="${moved.row}-${moved.column}"]`)?.focus();
  };

  return (
    <section className="studio" aria-label="Stem studio">
      <div className="row wrap studio-head">
        <h3>Shape this transition</h3>
        <button onClick={onClose}>Close</button>
      </div>
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
          <p className="hint">
            Each square is {barsPerCell} bar{barsPerCell === 1 ? '' : 's'}. Tap one to turn that part on or off. Press a name to hear only that part.
          </p>
          <p className="hint">Previewing pauses the main mix. After stopping or closing Studio, use the main player to resume it.</p>
          <p className="studio-save-state" role="status">{saving ? 'Applying your transition…' : dirty ? 'Unsaved changes — not applied to the mix' : 'Showing the saved transition'}{dirty && retained ? '. Your work is kept on this browser when you close Studio.' : ''}</p>
          {!retained && <p className="warn" role="alert">This browser could not keep a local copy. Apply your changes before closing Studio to keep them.</p>}
          <div className="row wrap">
            <Action className="primary" run={playOrStop}>
              <Icon name={playing ? 'stop' : 'play'} /> {playing ? 'Stop preview' : 'Play preview'}
            </Action>
            {soloed && <button onClick={() => void solo(soloed)}>Hear everything again</button>}
          </div>
          <div className="row wrap">
            <button disabled={!!asking} onClick={() => void askSelecta(false)}>
              {asking === 'arrange' ? 'Arranging…' : 'Let Selecta arrange it'}
            </button>
            <button disabled={!!asking} onClick={() => void askSelecta(true)}>
              {asking === 'tune' ? 'Fine tuning…' : 'Fine tune mine'}
            </button>
            {before && <button onClick={putBack}>Put it back</button>}
          </div>
          {changes && (
            <ul className="studio-changes" role="status">
              {changes.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          <div className="chips studio-shapes" role="group" aria-label="Ready-made shapes">
            {SHAPES.map((option) => (
              <button key={option.name} title={option.about} onClick={() => change(option.change(shape))}>
                {option.name}
              </button>
            ))}
          </div>
          {restored && <p className="hint" role="status">This is what you were working on before. Start again to go back to what’s in the mix.</p>}
          <p className="hint">Arrow keys move around the grid, and Space turns a square on or off.</p>
          <div className="studio-grid" role="grid" aria-label={`Stems for ${titles.a} and ${titles.b}`} ref={grid} onKeyDown={gridKeys}>
            <div className="studio-lane studio-ruler" role="row" aria-label="Bars">
              <span className="studio-name" role="columnheader">Bar</span>
              {Array.from({ length: columns }, (_, index) => (
                <span key={index} role="columnheader" className={index === cell ? 'now' : undefined}>{index * barsPerCell + 1}</span>
              ))}
            </div>
            {SIDES.map((side, sideIndex) => (
              <div className="studio-side" key={side} role="rowgroup" aria-label={titles[side]}>
                <h4>{titles[side]}</h4>
                {LANES.map((lane, laneIndex) => {
                  const name = `${side}_${lane}`;
                  const row = sideIndex * LANES.length + laneIndex;
                  return (
                    <div className="studio-lane" key={name} role="row">
                      <span role="rowheader" className="studio-gridcell">
                        <button
                          className="studio-name"
                          aria-pressed={soloed === name}
                          aria-label={`Hear only ${titles[side]} ${LANE_WORDS[lane].toLowerCase()}`}
                          onClick={() => void solo(name)}
                        >
                          {LANE_WORDS[lane]}
                        </button>
                      </span>
                      {shape[side][lane].map((value, index) => (
                        <span role="gridcell" className="studio-gridcell" key={index}>
                          <button
                            data-cell={`${row}-${index}`}
                            tabIndex={focusCell.row === row && focusCell.column === index ? 0 : -1}
                            className={`studio-cell ${index === cell ? 'now' : ''}`}
                            aria-pressed={Boolean(value)}
                            aria-label={`${titles[side]} ${LANE_WORDS[lane].toLowerCase()}, square ${index + 1}`}
                            title={`Bar ${index * barsPerCell + 1}`}
                            onFocus={() => setFocusCell({ row, column: index })}
                            onClick={() => toggle(side, lane, index)}
                          />
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="row wrap">
            <button className="primary" disabled={saving || !!asking} onClick={() => void use()}>
              {saving ? 'Applying…' : 'Apply to this transition'}
            </button>
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
