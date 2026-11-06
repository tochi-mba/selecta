import { useEffect, useRef, useState } from 'react';
import { Eta, MixData, MixItem, post } from '../api';
import { etaRangeWords } from '../lib';
import { Lane, LANES, Shape, SHAPES, Side, SIDES, StemDeck } from '../studio';
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
}) {
  const { position, item, previous, onClose, onUsed, onListen, notify } = props;
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
  const deck = useRef<StemDeck | null>(null);
  const at = useMixPath();

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
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
    };
  }, [position]);

  useEffect(() => {
    if (session?.status !== 'ready' || deck.current || !session.start_shape) return;
    const chosen = session.shape ?? session.start_shape;
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
    } else {
      onListen?.();
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
      onListen?.();
      await deck.current.play();
      setPlaying(true);
    }
  };
  const use = async () => {
    if (!shape) return;
    setSaving(true);
    deck.current?.stop();
    setPlaying(false);
    try {
      onUsed(await post<MixData>(at(`/mix/${position}/studio/use`), { shape }));
      notify('Rendering your version. It’ll play in the mix when it’s ready.');
      onClose();
    } catch (error) {
      setProblem((error as Error).message);
      setSaving(false);
    }
  };

  const titles: Record<Side, string> = { a: previous.title, b: item.title };
  const preparing = !session || session.status === 'none' || session.status === 'queued' || session.status === 'rendering';
  const failed = problem || (session?.status === 'failed' ? session.error : '');
  const barsPerCell = session?.bars && session.cells ? session.bars / session.cells : 2;

  return (
    <section className="studio" aria-label="Stem studio">
      <div className="row wrap studio-head">
        <h3>Shape this seam yourself</h3>
        <button onClick={onClose}>Close</button>
      </div>
      {failed && <p className="warn" role="alert">{failed}</p>}
      {!failed && preparing && (
        <p className="hint" role="status">
          Splitting both songs into voice, drums, bass and melody.
          {session?.eta ? ` It’ll take ${etaRangeWords(session.eta)}.` : ' The first time takes a few minutes.'} Your mix keeps playing.
        </p>
      )}
      {!failed && session?.status === 'ready' && !loaded && <p className="hint" role="status">Loading the stems…</p>}
      {shape && loaded && (
        <>
          <p className="hint">
            Each square is {barsPerCell} bar{barsPerCell === 1 ? '' : 's'}. Tap one to turn that part on or off. Press a name to hear only that part.
          </p>
          <div className="row wrap">
            <button className="primary" onClick={() => void playOrStop()}>
              {playing ? '■ Stop' : '▶ Play it'}
            </button>
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
          {SIDES.map((side) => (
            <div className="studio-side" key={side}>
              <h4>{titles[side]}</h4>
              {LANES.map((lane) => {
                const name = `${side}_${lane}`;
                return (
                  <div className="studio-lane" key={name}>
                    <button
                      className="studio-name"
                      aria-pressed={soloed === name}
                      aria-label={`Hear only ${titles[side]} ${LANE_WORDS[lane].toLowerCase()}`}
                      onClick={() => void solo(name)}
                    >
                      {LANE_WORDS[lane]}
                    </button>
                    {shape[side][lane].map((value, index) => (
                      <button
                        key={index}
                        className={`studio-cell ${index === cell ? 'now' : ''}`}
                        aria-pressed={Boolean(value)}
                        aria-label={`${titles[side]} ${LANE_WORDS[lane].toLowerCase()}, square ${index + 1}`}
                        onClick={() => toggle(side, lane, index)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="row wrap">
            <button className="primary" disabled={saving} onClick={() => void use()}>
              {saving ? 'Saving…' : 'Use this'}
            </button>
            {session?.start_shape && <button onClick={() => change((session.shape ?? session.start_shape) as Shape)}>Start again</button>}
          </div>
        </>
      )}
    </section>
  );
}
