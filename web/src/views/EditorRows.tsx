import { DragEvent, KeyboardEvent, memo, MouseEvent, PointerEvent, RefObject, useRef, useState } from 'react';
import { MixItem, post } from '../api';
import { clock, etaWords, seamStatusWords } from '../lib';
import { Action, announce, Menu } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { seamFacts } from '../ui/seam';
import { useMixPath } from './mixScope';
import { RequestTag, useRequestComing } from './Requests';

/** What a row can ask the editor to do. The editor keeps this object in a ref, so its contents can
 * change every render without any row having to redraw. */
export type RowActions = {
  play: (item: MixItem) => void;
  move: (from: number, to: number, how: MoveHow) => Promise<void>;
  lock: (item: MixItem) => Promise<void>;
  remove: (item: MixItem, rowKey: string) => Promise<void>;
  selectSong: (rowKey: string) => void;
  selectSeam: (rowKey: string) => void;
  toggleSeam: (rowKey: string) => void;
  hearSeam: (rowKey: string) => void;
  dragOver: (rowKey: string | null) => void;
  refresh: () => void;
};

export type MoveHow = 'up' | 'down' | 'handle' | 'drag';

/** Pressing a control in a row uses the control. Pressing anything else in it selects the row. */
const CONTROLS = 'button,a,input,select,textarea,summary,audio,[role="button"],[role="menu"]';
const pickedTheRow = (event: MouseEvent<HTMLElement>) => !(event.target as HTMLElement).closest(CONTROLS);

export function SeamUnlessReplaced(props: Parameters<typeof SeamRow>[0] & { inDraft: boolean }) {
  const { inDraft, ...row } = props;
  const replaced = useRequestComing(row.previous.song_id);
  return !inDraft && replaced ? null : <SeamRow {...row} />;
}

type SeamRowProps = {
  item: MixItem;
  previous: MixItem;
  rowKey: string;
  seamKey: string;
  open: boolean;
  names: Record<string, string>;
  guard: Record<string, string>;
  actions: RefObject<RowActions>;
};

/** A transition isn't a song, so it doesn't look like one: it hangs between two songs, with its own
 * state, and selecting it opens it beside the timeline. Nothing here plays unless Hear it is pressed. */
const SeamRow = memo(function SeamRow({ item, previous, rowKey, seamKey, open, names, guard, actions }: SeamRowProps) {
  const seam = item.seam!;
  const state = seam.state;
  const plannedBars = state.bars ?? seam.settings.bars;
  const chosen = seam.settings.move ?? 'auto';
  const at = useMixPath();
  const label = state.status === 'ready' ? (state.label ?? names[chosen]) : (names[chosen] ?? chosen);
  const facts = seamFacts(seam, names);
  const rate = async (rating: string) => {
    await post(`/seams/${state.key}/rate`, { rating: state.rating === rating ? 'none' : rating });
    actions.current.refresh();
  };

  return (
    <li
      className={`seam ${open ? 'open' : ''}`}
      data-seam={seamKey}
      onClick={(event) => { if (pickedTheRow(event)) actions.current.selectSeam(rowKey); }}
    >
      {seam.too_soon && (
        <p className="warn seam-too-soon">This leaves {previous.title} before the way into it has finished, so it would be missed. Pick a later place to leave it, or an earlier place to bring it in.</p>
      )}
      <div className="seam-line">
        <button className="seam-name" onClick={() => actions.current.toggleSeam(rowKey)} aria-expanded={open}>
          <b>{label}</b>
          <span className={`pill ${state.status} ${state.status === 'ready' && !state.passed ? 'warned' : ''}`}>
            {seamStatusWords(state.status, state.passed)}
            {state.eta !== undefined && `, ${etaWords(state.eta)}`}
          </span>
        </button>
        <div className="seam-actions">
          {state.status === 'ready' && <button onClick={() => actions.current.hearSeam(rowKey)}>Hear it</button>}
          {(state.status === 'none' || state.status === 'failed') && (
            <Action working="Asking…" run={async () => {
              await post(at(`/mix/${item.position}/render${state.status === 'failed' ? '?retry=true' : ''}`), undefined, guard);
              actions.current.refresh();
            }}>
              {state.status === 'failed' ? 'Try again' : 'Render it'}
            </Action>
          )}
          {state.status === 'ready' && (
            <span className="pair" role="group" aria-label="Rate this seam">
              <Action aria-pressed={state.rating === 'good'} run={() => rate('good')}>Good</Action>
              <Action aria-pressed={state.rating === 'bad'} run={() => rate('bad')}>Bad</Action>
            </span>
          )}
          <button onClick={() => actions.current.toggleSeam(rowKey)}>{open ? 'Close' : 'Change'}</button>
        </div>
      </div>
      <div className={`seam-visual ${state.status}`} role="img" aria-label={`${facts.words}${plannedBars ? `, ${plannedBars} bars` : ''}, ${previous.title} into ${item.title}`}>
        <span className="seam-visual-label">{state.status === 'ready' ? 'Transition' : 'Transition plan'} · {plannedBars ? `${plannedBars} bars` : 'Length chosen when rendered'}</span>
        <div className="seam-visual-bars" aria-hidden="true">
          {Array.from({ length: plannedBars ? Math.min(Math.max(plannedBars, 1), 8) : 1 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
        <span className="seam-visual-caption"><b>{previous.title}</b><span>→</span><b>{item.title}</b></span>
      </div>
      {state.status === 'failed' && <p className="warn">Remembered failed attempt: {state.error}</p>}
    </li>
  );
}, (before, after) => before.rowKey === after.rowKey
  && before.seamKey === after.seamKey
  && before.open === after.open
  && before.guard === after.guard
  && before.names === after.names
  && before.previous.title === after.previous.title
  && before.item.title === after.item.title
  && before.item.position === after.item.position
  && JSON.stringify(before.item.seam) === JSON.stringify(after.item.seam));

type SongRowProps = {
  item: MixItem;
  rowKey: string;
  total: number;
  playing: boolean;
  selected: boolean;
  over: boolean;
  actions: RefObject<RowActions>;
};

/** A private drag format stops arbitrary dropped text from becoming a song position. */
const SONG_DRAG_TYPE = 'application/x-selecta-song-position';

/** One song in the timeline. Only the handle starts a drag, so scrolling a long mix on a phone can't
 * pick a song up by accident. A mouse drags it the ordinary way, a finger or pen uses pointer events,
 * and the arrow keys and the Move buttons do the same job without dragging at all. */
export const SongLine = memo(function SongLine({ item, rowKey, total, playing, selected, over, actions }: SongRowProps) {
  const holding = useRef(false);
  const [grabbed, setGrabbed] = useState(false);
  const rowUnder = (event: PointerEvent<HTMLElement>) => document.elementFromPoint?.(event.clientX, event.clientY)?.closest<HTMLElement>('[data-song-key]') ?? null;
  const pressHandle = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    holding.current = true;
  };
  const moveHandle = (event: PointerEvent<HTMLElement>) => {
    if (!holding.current) return;
    actions.current.dragOver(rowUnder(event)?.dataset.songKey ?? null);
    const margin = 90;
    if (event.clientY < margin) window.scrollBy?.(0, -14);
    else if (event.clientY > window.innerHeight - margin) window.scrollBy?.(0, 14);
  };
  const releaseHandle = (event: PointerEvent<HTMLElement>) => {
    if (!holding.current) return;
    holding.current = false;
    const target = rowUnder(event);
    actions.current.dragOver(null);
    if (target?.dataset.position) void actions.current.move(item.position, Number(target.dataset.position), 'drag');
  };
  const handleKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      setGrabbed((was) => !was);
      announce(grabbed ? `Dropped ${item.title} at number ${item.position + 1}.` : `Picked up ${item.title}. Use the up and down arrows to move it. Press Space to drop.`);
      return;
    }
    if (event.key === 'Escape' && grabbed) {
      event.preventDefault();
      event.stopPropagation();
      setGrabbed(false);
      announce(`Finished moving ${item.title}.`);
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    const to = item.position + (event.key === 'ArrowUp' ? -1 : 1);
    if (to >= 0 && to < total) void actions.current.move(item.position, to, 'handle');
  };
  return (
    <li
      className={`song ${over ? 'over' : ''} ${playing ? 'playing' : ''} ${selected ? 'selected' : ''} ${item.from_request ? 'requested' : ''}`}
      data-song-key={rowKey}
      data-position={item.position}
      onClick={(event) => { if (pickedTheRow(event)) actions.current.selectSong(rowKey); }}
      onDragStart={(event: DragEvent<HTMLLIElement>) => {
        if (!(event.target as HTMLElement).closest('[data-handle]')) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(SONG_DRAG_TYPE, String(item.position));
        event.dataTransfer.setDragImage?.(event.currentTarget, 24, 24);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(SONG_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        actions.current.dragOver(rowKey);
      }}
      onDragLeave={() => actions.current.dragOver(null)}
      onDragEnd={() => actions.current.dragOver(null)}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes(SONG_DRAG_TYPE)) return;
        event.preventDefault();
        actions.current.dragOver(null);
        const raw = event.dataTransfer.getData(SONG_DRAG_TYPE);
        if (!/^\d+$/.test(raw)) return;
        const from = Number(raw);
        if (!Number.isSafeInteger(from) || from < 0 || from >= total) return;
        if (from !== item.position) void actions.current.move(from, item.position, 'drag');
      }}
    >
      <span
        className="grip"
        role="button"
        tabIndex={0}
        draggable
        data-handle
        aria-label={`Reorder ${item.title}`}
        aria-pressed={grabbed}
        aria-keyshortcuts="Space ArrowUp ArrowDown"
        title="Drag to move, or press Space and then use the arrow keys"
        onKeyDown={handleKeys}
        onPointerDown={pressHandle}
        onPointerMove={moveHandle}
        onPointerUp={releaseHandle}
        onPointerCancel={() => { holding.current = false; actions.current.dragOver(null); }}
      >
        <Icon name="grip" />
      </span>
      <span className="count">{item.position + 1}</span>
      <div className="song-name">
        <button className="song-select" aria-current={selected ? 'true' : undefined} onClick={() => actions.current.selectSong(rowKey)}>
          <b>{item.title}</b>
        </button>
        <span>{item.artist}</span>
        <RequestTag item={item} />
        {item.locked && <span className="locked-badge"><Icon name="lock" width={14} height={14} /> Locked</span>}
      </div>
      <small className="facts">
        {item.bpm ? `${Math.round(item.bpm)} BPM` : ''} {item.key ?? ''} · {clock(item.duration)}
      </small>
      <div className="song-actions">
        <button onClick={() => actions.current.play(item)} aria-label={`Play from ${item.title}`}><Icon name="play" /> Play</button>
        <Action
          aria-label={`Move ${item.title} up`}
          data-move="up"
          disabled={item.position === 0}
          run={() => actions.current.move(item.position, item.position - 1, 'up')}
        >
          <Icon name="up" />
        </Action>
        <Action
          aria-label={`Move ${item.title} down`}
          data-move="down"
          disabled={item.position === total - 1}
          run={() => actions.current.move(item.position, item.position + 1, 'down')}
        >
          <Icon name="down" />
        </Action>
        <Menu className="song-more" label={<><Icon name="more" /><span className="visually-hidden">More for {item.title}</span></>}>
          <Action role="menuitem" title="A locked song stays right here when the mix is rebuilt" run={() => actions.current.lock(item)}>
            <Icon name="lock" /> {item.locked ? 'Unlock' : 'Lock'}
          </Action>
          <Action role="menuitem" className="destructive" aria-label={`Remove ${item.title}`} run={() => actions.current.remove(item, rowKey)}>
            <Icon name="trash" /> Remove
          </Action>
        </Menu>
      </div>
    </li>
  );
}, (before, after) => before.rowKey === after.rowKey
  && before.total === after.total
  && before.playing === after.playing
  && before.selected === after.selected
  && before.over === after.over
  && before.item.position === after.item.position
  && before.item.song_id === after.item.song_id
  && before.item.title === after.item.title
  && before.item.artist === after.item.artist
  && before.item.bpm === after.item.bpm
  && before.item.key === after.item.key
  && before.item.duration === after.item.duration
  && before.item.locked === after.item.locked
  && JSON.stringify(before.item.from_request) === JSON.stringify(after.item.from_request));

/** A real target between two songs, saying where a new song would land. */
export function AddGap({ title, landsAt, onAdd }: { title: string; landsAt: number; onAdd: () => void }) {
  return (
    <li className="add-gap">
      <button onClick={onAdd} aria-label={`Add a song after ${title}`} title={`Add a song here, as number ${landsAt}`}>
        <Icon name="plus" width={16} height={16} /> Add a song <small aria-hidden="true">as number {landsAt}</small>
      </button>
    </li>
  );
}

/** One song selected in the timeline: what's known about it, and what can be done from here. */
export function SongInspector(props: {
  item: MixItem;
  hasIn: boolean;
  hasOut: boolean;
  onPlay: () => void;
  onAddAfter: () => void;
  onSeamIn: () => void;
  onSeamOut: () => void;
}) {
  const { item, hasIn, hasOut, onPlay, onAddAfter, onSeamIn, onSeamOut } = props;
  return (
    <div className="inspector">
      <div className="inspector-identity">
        <p className="inspector-pair"><b>{item.title}</b></p>
        <p className="song-detail-artist">{item.artist}</p>
        <RequestTag item={item} />
      </div>
      <dl className="song-facts">
        <div><dt>Place in the mix</dt><dd>{item.position + 1}</dd></div>
        <div><dt>Length</dt><dd>{clock(item.duration)}</dd></div>
        <div><dt>Tempo</dt><dd>{item.bpm ? `${Math.round(item.bpm)} BPM` : 'Not measured yet'}</dd></div>
        <div><dt>Key</dt><dd>{item.key ?? 'Not measured yet'}</dd></div>
        <div><dt>Locked</dt><dd>{item.locked ? 'Yes, it stays here when the mix is rebuilt' : 'No'}</dd></div>
      </dl>
      <div className="row wrap">
        <button className="primary" onClick={onPlay}><Icon name="play" /> Play from here</button>
        <button onClick={onAddAfter}><Icon name="plus" /> Add a song after this</button>
        {hasIn && <button onClick={onSeamIn}>Transition into this song</button>}
        {hasOut && <button onClick={onSeamOut}>Transition out of this song</button>}
      </div>
    </div>
  );
}
