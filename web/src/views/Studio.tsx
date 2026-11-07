import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ApiError, Eta, MixData, MixItem, post } from '../api';
import { mainPlayerTouched, releaseAudio, takeAudio } from '../audio/focus';
import { etaRangeWords } from '../lib';
import { Lane, LANES, Shape, SHAPES, Side, SIDES, StemDeck } from '../studio';
import { Action, Problem } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { moveInGrid } from '../ui/primitives';
import { seamFacts } from '../ui/seam';
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

function StudioListEditor({ shape, titles, missing, barsPerCell, soloed, onToggle, onSolo }: {
  shape: Shape;
  titles: Record<Side, string>;
  missing: string[];
  barsPerCell: number;
  soloed: string | null;
  onToggle: (side: Side, lane: Lane, index: number) => void;
  onSolo: (name: string) => void;
}) {
  return (
    <div className="studio-list" aria-label="Stem controls by song and part">
      {SIDES.map((side) => (
        <section key={side} aria-labelledby={`studio-list-${side}`}>
          <h4 id={`studio-list-${side}`}>{titles[side]}</h4>
          {LANES.map((lane) => {
            const name = `${side}_${lane}`;
            const lost = missing.includes(name);
            return (
              <fieldset key={name} disabled={lost}>
                <legend>{LANE_WORDS[lane]}{lost ? ' — unavailable' : ''}</legend>
                <button type="button" aria-pressed={soloed === name} onClick={() => onSolo(name)}>
                  {soloed === name ? 'Hear everything' : `Hear only ${LANE_WORDS[lane].toLowerCase()}`}
                </button>
                <div className="studio-list-cells">
                  {shape[side][lane].map((value, index) => (
                    <label key={index}>
                      <input type="checkbox" checked={Boolean(value)} onChange={() => onToggle(side, lane, index)} />
                      <span>Bar {index * barsPerCell + 1}</span>
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
  const latestShape = useRef<Shape | null>(null);
  latestShape.current = shape;
  const [focusCell, setFocusCell] = useState({ row: 0, column: 0 });
  const [editorMode, setEditorMode] = useState<'grid' | 'list'>('grid');
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
    const unsaved = savedShape(session.key, session.cells ?? 8);
    const chosen = unsaved ?? committed;
    setRestored(!!unsaved && JSON.stringify(unsaved) !== JSON.stringify(committed));
    const made = new StemDeck(session.seconds ?? 1, session.cells ?? 8, chosen);
    made.onCell = setCell;
    deck.current = made;
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
    setShape(next);
    setChanges(null);
    setBefore(null);
    setProblem('');
    deck.current?.setShape(next);
    if (session?.key) setRetained(keepShape(session.key, next));
  };
  /** Selecta's turn. What was there can be put back, nothing is final until Apply, and if it fails or
   * the grid changed while it was thinking, what you've got stays exactly as it is. */
  const askSelecta = async (mine: boolean) => {
    if (!shape) return;
    const sent = shape;
    setAsking(mine ? 'tune' : 'arrange');
    setProblem('');
    try {
      const answer = await post<{ shape: Shape; changes: string[] }>(at(`/mix/${position}/studio/tune`), { shape: mine ? shape : null });
      if (latestShape.current !== sent) {
        setChanges(['You changed the grid while Selecta was working, so your version stays.']);
        return;
      }
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
    if (!shape || missing.includes(`${side}_${lane}`)) return;
    const cells = shape[side][lane].map((value, at) => (at === index ? (value ? 0 : 1) : value));
    change({ ...shape, [side]: { ...shape[side], [lane]: cells } });
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
    if (!deck.current || missing.includes(name)) return;
    const next = soloed === name ? null : name;
    setSoloed(next);
    deck.current.solo(next);
    if (next && !playing) await start();
  };
  const use = async () => {
    if (!shape || applying.current || !session) return;
    applying.current = true;
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
      onUsed(await post<MixData>(at(`/mix/${position}/studio/use`), { shape }, guard));
      keepShape(session.key, null);
      notify('Rendering your version. It’ll play in the mix when it’s ready.');
      onClose();
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
  const dirty = !!shape && JSON.stringify(shape) !== JSON.stringify(committed);
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
      <header className="studio-head">
        <div className="studio-pair">
          <h3>Shape transition {position}</h3>
          <p><b>{previous.title}</b> <span aria-hidden="true">→</span><span className="visually-hidden"> into </span> <b>{item.title}</b></p>
        </div>
        {shape && loaded && (
          <div className="studio-transport">
            <Action className="primary" run={playOrStop}>
              <Icon name={playing ? 'stop' : 'play'} /> {playing ? 'Stop preview' : 'Play preview'}
            </Action>
            {soloed && <button onClick={() => void solo(soloed)}>Hear everything again</button>}
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
            Each square is {barsPerCell} bar{barsPerCell === 1 ? '' : 's'}. Tap one to turn that part on or off. Press a name to hear only that part.
          </p>
          <p className="hint">Previewing pauses the main mix. After stopping or closing Studio, use the main player to resume it.</p>
          <p className="studio-save-state" role="status">{saving ? 'Applying your transition…' : dirty ? 'Unsaved changes — not applied to the mix' : 'Showing the saved transition'}{dirty && retained ? '. Your work is kept on this browser when you close Studio.' : ''}</p>
          {!retained && <p className="warn" role="alert">This browser could not keep a local copy. Apply your changes before closing Studio to keep them.</p>}
          {missing.length > 0 && (
            <p className="warn" role="alert">
              Couldn’t load {missing.map(stemName).join(', ')}, so {missing.length === 1 ? 'that part' : 'those parts'} can’t be heard or changed here. The rest work as normal.
            </p>
          )}
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
          <div className="chips" role="group" aria-label="Studio editor layout">
            <button aria-pressed={editorMode === 'grid'} onClick={() => setEditorMode('grid')}>Time grid</button>
            <button aria-pressed={editorMode === 'list'} onClick={() => setEditorMode('list')}>Controls by part</button>
          </div>
          {editorMode === 'grid' ? (
            <>
              <p className="hint">Arrow keys move around the grid, and Space turns a square on or off. Left of the first square is the part’s name, which plays that part alone.</p>
              <div
            className="studio-grid"
            role="grid"
            aria-label={`Stems for ${titles.a} and ${titles.b}`}
            ref={grid}
            onKeyDown={gridKeys}
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
                          aria-disabled={lost || undefined}
                          aria-label={`Hear only ${titles[side]} ${LANE_WORDS[lane].toLowerCase()}`}
                          title={lost ? 'This part couldn’t be loaded' : undefined}
                          onFocus={() => setFocusCell({ row, column: SOLO_COLUMN })}
                          onClick={() => void solo(name)}
                        >
                          {soloed === name ? 'Solo: ' : ''}{LANE_WORDS[lane]}
                        </button>
                      </span>
                      {shape[side][lane].map((value, index) => (
                        <span role="gridcell" className="studio-gridcell" key={index}>
                          <button
                            data-cell={`${row}-${index}`}
                            tabIndex={focusCell.row === row && focusCell.column === index ? 0 : -1}
                            className={`studio-cell ${index === cell ? 'now' : ''}`}
                            aria-pressed={Boolean(value)}
                            aria-disabled={lost || undefined}
                            aria-label={`${titles[side]} ${LANE_WORDS[lane].toLowerCase()}, square ${index + 1}`}
                            title={lost ? 'This part couldn’t be loaded' : `Bar ${index * barsPerCell + 1}`}
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
            </>
          ) : (
            <StudioListEditor
              shape={shape}
              titles={titles}
              missing={missing}
              barsPerCell={barsPerCell}
              soloed={soloed}
              onToggle={toggle}
              onSolo={(name) => void solo(name)}
            />
          )}
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
