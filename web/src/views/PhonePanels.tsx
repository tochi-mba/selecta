import { ReactNode, useContext, useEffect, useState } from 'react';
import type { MixItem } from '../api';
import { useApi } from '../requestContext';
import { flagOn, useFlags } from '../flags';
import { clock } from '../lib';
import { Action, Status } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { SeamDiagram, seamFamily, SongMotif } from '../ui/MusicObjects';
import { storySeamWords, TransitionsWorkedOutLive } from './editorMode';
import { PlayedTransitions, playedKey, StemSurfacesContext } from './liveTransitions';
import { useMixPath } from './mixScope';
import { RequestTag } from './Requests';

/** How much of each song the transition picture shows: the last part of one, the first of the next. */
const SHOWN = 0.22;
/** Where Hear it starts: this many seconds before the outgoing song ends, so the way in is heard too. */
export const HEAR_LEAD = 35;

/** The moves a person can choose here, "Let SelectaDJ pick" first, as the timeline's own picker
 * offers them (cloud.browser_moves), with any stem moves this device can or can't play. */
export function usePickable(live: boolean, names: Record<string, string>): [string, string, string?][] {
  const on = useFlags();
  const stems = useContext(StemSurfacesContext);
  if (!live || !on('cloud.browser_moves')) return [];
  return [
    ...Object.entries(names).filter(([move]) => move !== 'blend').map(([move, words]): [string, string] => [move, words]),
    ...(stems?.stemMoves ?? []).map((offered): [string, string, string?] => [offered.move, offered.label, offered.disabledReason]),
  ];
}

/** The end of one song and the start of the next, drawn from their real waveforms where this device
 * has them, overlapping the way the chosen move overlaps them. Without waveforms it is the timeline's
 * own transition drawing. It is a picture: what it says is said in words beside it. */
export function TransitionPicture({ previous, item, names, live, waveformOf }: {
  previous: MixItem;
  item: MixItem;
  names: Record<string, string>;
  live: boolean;
  waveformOf?: (songId: number) => Promise<number[] | null>;
}) {
  const [peaks, setPeaks] = useState<[number[], number[]] | null>(null);
  useEffect(() => {
    let current = true;
    setPeaks(null);
    if (!waveformOf) return undefined;
    void Promise.all([waveformOf(previous.song_id), waveformOf(item.song_id)]).then(([a, b]) => {
      if (current && a?.length && b?.length) setPeaks([a, b]);
    });
    return () => { current = false; };
  }, [previous.song_id, item.song_id, waveformOf]);
  const seam = item.seam;
  if (!seam) return null;
  const move = seam.state.status === 'ready' ? seam.state.style : seam.settings.move;
  const family = move === 'cut' ? 'cut' : seamFamily(move);
  if (!peaks) return <SeamDiagram seam={seam} from={previous.title} into={item.title} names={names} live={live} />;
  // where the outgoing song stops and the incoming one starts, out of 100
  const [ends, starts] = family === 'cut' ? [50, 50] : family === 'effect' ? [62, 48] : [66, 34];
  const tail = peaks[0].slice(Math.floor(peaks[0].length * (1 - SHOWN)));
  const head = peaks[1].slice(0, Math.ceil(peaks[1].length * SHOWN));
  const loud = Math.max(...tail, ...head, 0.0001);
  const bars = (values: number[], from: number, to: number, mid: number, fade: 'out' | 'in') => values.map((value, at) => {
    const x = from + ((to - from) * at) / values.length;
    const reach = fade === 'out' && x > starts ? Math.max(0.15, (ends - x) / Math.max(1, ends - starts)) : fade === 'in' && x < ends ? Math.max(0.15, (x - starts) / Math.max(1, ends - starts)) : 1;
    const height = Math.max(0.6, (value / loud) * 18 * reach);
    return <rect key={at} x={x.toFixed(2)} y={(mid - height).toFixed(2)} width={Math.max(0.25, ((to - from) / values.length) * 0.7).toFixed(2)} height={(height * 2).toFixed(2)} />;
  });
  return (
    <figure className="pe-picture" data-family={family}>
      <svg viewBox="0 0 100 64" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {family !== 'cut' && <rect className="pe-picture-overlap" x={starts} y="0" width={Math.max(0, ends - starts)} height="64" />}
        <g className="pe-picture-out">{bars(tail, 0, ends, 18, 'out')}</g>
        <g className="pe-picture-in">{bars(head, starts, 100, 46, 'in')}</g>
        {family === 'cut' && <line className="pe-picture-cut" x1="50" x2="50" y1="0" y2="64" />}
      </svg>
      <figcaption>
        <span>End of <b dir="auto">{previous.title}</b></span>
        <span>Start of <b dir="auto">{item.title}</b></span>
      </figcaption>
    </figure>
  );
}

/** One transition, opened, for a mix whose transitions are worked out as it plays (a browser mix):
 * the picture, what happens in words, the move as large choices, Hear it, and a comparison with
 * SelectaDJ's own pick. Every choice is saved as it's made, so what is heard is what is in the mix. */
export function LiveTransitionPanel(props: {
  previous: MixItem;
  item: MixItem;
  names: Record<string, string>;
  guard: Record<string, string>;
  refresh: () => void;
  onHear: () => void;
  hearWords: string;
  onAddBetween: () => void;
  waveformOf?: (songId: number) => Promise<number[] | null>;
}) {
  const { previous, item, names, guard, refresh, onHear, hearWords, onAddBetween, waveformOf } = props;
  const { post } = useApi();
  const at = useMixPath();
  const live = useContext(TransitionsWorkedOutLive);
  const played = useContext(PlayedTransitions)[playedKey(previous.song_id, item.song_id)];
  const stems = useContext(StemSurfacesContext);
  const seam = item.seam!;
  const chosen = seam.settings.move ?? 'auto';
  const pickable = usePickable(live && seam.state.status === 'none', names);
  const [problem, setProblem] = useState('');
  const [mine, setMine] = useState<string | null>(chosen !== 'auto' ? chosen : null);
  useEffect(() => { if (chosen !== 'auto') setMine(chosen); }, [chosen]);
  const words = storySeamWords(seam, names, previous.title, live, played);
  const choose = async (move: string) => {
    setProblem('');
    try {
      await post(at(`/mix/${item.position}/seam`), { move }, guard);
      refresh();
    } catch (error) {
      setProblem((error as Error).message);
      return false; // said here, so the button draws no tick
    }
  };
  const nameOf = (move: string) => pickable.find(([one]) => one === move)?.[1] ?? names[move] ?? move.replaceAll('_', ' ');
  return (
    <div className="pe-panel">
      <TransitionPicture previous={previous} item={item} names={names} live={live} waveformOf={waveformOf} />
      <p className="pe-panel-now">
        <Status kind={words.kind}>{chosen !== 'auto' && live && seam.state.status === 'none' && !played ? nameOf(chosen) : words.headline}</Status>
      </p>
      {played?.fellBack && <p className="warn pe-panel-fix">This one fell back. Choose another move below, or let SelectaDJ pick.</p>}
      <div className="pe-panel-row">
        <button type="button" className="primary" aria-description={hearWords} onClick={onHear}><Icon name="play" /> Hear it</button>
        {pickable.length > 0 && (chosen !== 'auto'
          ? <Action run={() => choose('auto')}>Try SelectaDJ’s pick</Action>
          : mine && <Action run={() => choose(mine)}>Back to {nameOf(mine)}</Action>)}
      </div>
      {pickable.length > 0 && (
        <fieldset className="pe-moves">
          <legend>How it moves into {item.title}</legend>
          <div className="pe-move-grid">
            {pickable.map(([move, label, reason]) => (
              <Action key={move} aria-pressed={chosen === move} disabled={!!reason} title={reason} run={() => choose(move)}>
                {label}{reason && <small>Not on this device</small>}
              </Action>
            ))}
          </div>
          {pickable.find(([, , reason]) => reason)?.[2] && <p className="hint">{pickable.find(([, , reason]) => reason)?.[2]}</p>}
        </fieldset>
      )}
      <p className="hint">{hearWords}{words.detail ? ` ${words.detail}` : ''}</p>
      {stems?.offer(chosen)}
      {stems?.readiness(playedKey(previous.song_id, item.song_id))}
      {problem && <p className="warn" role="alert">{problem}</p>}
      <button type="button" className="pe-quiet" onClick={onAddBetween}><Icon name="plus" /> Add a song between these</button>
    </div>
  );
}

/** One song, opened: what's known about it and everything that can be done to it from here, as full
 * rows. The same moves are on the reorder handle; these are for anyone who doesn't drag. */
export function SongPanel(props: {
  item: MixItem;
  index: number;
  total: number;
  playWords: string;
  onPlay: () => void;
  onMove: (to: number) => void;
  onAddAfter: () => void;
  onLock?: () => Promise<void>;
  onRemove: () => Promise<void>;
  extra?: ReactNode;
}) {
  const { item, index, total, playWords, onPlay, onMove, onAddAfter, onLock, onRemove, extra } = props;
  const facts = [item.artist, clock(item.duration), item.bpm ? `${Math.round(item.bpm)} BPM` : '', item.key ?? ''].filter(Boolean);
  return (
    <div className="pe-panel pe-song-panel">
      <p className="pe-panel-song"><SongMotif songId={item.song_id} /><span dir="auto">{facts.join(' · ')}</span></p>
      <RequestTag item={item} />
      <p className="hint">Number {index + 1} of {total}{item.locked && flagOn('editor.locks') ? '. Locked: it stays here when the mix is rebuilt.' : '.'}</p>
      <div className="pe-list-actions" role="group" aria-label={`Actions for ${item.title}`}>
        <button type="button" className="primary" onClick={onPlay}><Icon name="play" /> {playWords}</button>
        <button type="button" disabled={index === 0} onClick={() => onMove(index - 1)}><Icon name="up" /> Move up</button>
        <button type="button" disabled={index === total - 1} onClick={() => onMove(index + 1)}><Icon name="down" /> Move down</button>
        <button type="button" disabled={index === 0} onClick={() => onMove(0)}><Icon name="up" /> Move to the top</button>
        <button type="button" disabled={index === total - 1} onClick={() => onMove(total - 1)}><Icon name="down" /> Move to the end</button>
        <button type="button" onClick={onAddAfter}><Icon name="plus" /> Add a song after this</button>
        {onLock && <Action run={onLock}><Icon name="lock" /> {item.locked ? 'Unlock' : 'Lock it here'}</Action>}
        {extra}
        <Action className="destructive" working="Removing…" aria-label={`Remove ${item.title}`} run={onRemove}><Icon name="trash" /> Remove from the mix</Action>
      </div>
    </div>
  );
}
