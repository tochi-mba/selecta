import { KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject, useContext, useEffect, useRef, useState } from 'react';
import type { MixItem } from '../api';
import { flagOn } from '../flags';
import { clock } from '../lib';
import { announce, Status } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { SongMotif } from '../ui/MusicObjects';
import { storySeamWords, TransitionsWorkedOutLive } from './editorMode';
import { type PlayedSeam, PlayedTransitions, playedKey } from './liveTransitions';
import { RequestTag } from './Requests';

/** A finger has to travel this far on the handle before it is a drag, so a tap is never a move. */
const DRAG_FROM = 6;
/** The band at the top and bottom of the screen where a carried song scrolls the list. */
const EDGE = 72;

export type StoryDrag = { from: number; to: number; offset: number };

/** What a transition says on the list: what will happen, in a few words, and its state. */
export function connectorWords(item: MixItem, previous: MixItem, names: Record<string, string>, live: boolean, played: PlayedSeam | undefined) {
  const seam = item.seam;
  const words = storySeamWords(seam, names, previous.title, live, played);
  const chosen = seam?.settings.move ?? 'auto';
  if (live && seam?.state.status === 'none' && !played) {
    return chosen === 'auto'
      ? { kind: words.kind, headline: 'SelectaDJ picks as it plays' }
      : { kind: words.kind, headline: names[chosen] ?? chosen.replaceAll('_', ' ') };
  }
  return { kind: words.kind, headline: played && !played.fellBack ? `Played: ${played.label}` : words.headline };
}

/** The mix read top to bottom: each song a compact row, and between two songs a slim connector that
 * says what happens. Only the handle starts a drag, so a finger anywhere else scrolls the list. The
 * carried song follows the finger while the others stay where they are, and a line in the gap says
 * where it will land. */
export function PhoneStory(props: {
  mix: MixItem[];
  keys: string[];
  names: Record<string, string>;
  selectedSeam: number;
  selectedSong: number;
  playingIndex: number;
  movingKey: string | null;
  affected: Set<number> | null;
  onOpenSeam: (index: number) => void;
  onOpenSong: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onCarry: (from: string | null, over: string | null) => void;
  headingId: string;
  list: RefObject<HTMLOListElement | null>;
}) {
  const { mix, keys, names, selectedSeam, selectedSong, playingIndex, movingKey, affected, onOpenSeam, onOpenSong, onMove, onCarry, headingId, list } = props;
  const live = useContext(TransitionsWorkedOutLive);
  const played = useContext(PlayedTransitions);
  const [drag, setDrag] = useState<StoryDrag | null>(null);
  const held = useRef<{ id: number; from: number; startY: number; lastY: number; moved: boolean; tops: number[]; frame: number } | null>(null);
  const dragNow = useRef(drag);
  dragNow.current = drag;

  /** Where the carried song would land for a finger at this height on the page. */
  const landing = (from: number, pageY: number, tops: number[]) => {
    let to = 0;
    for (let index = 0; index < tops.length; index += 1) {
      if (index === from) continue;
      if (pageY > tops[index]) to += 1;
    }
    return Math.min(Math.max(to, 0), mix.length - 1);
  };
  const middles = () => [...(list.current?.querySelectorAll<HTMLElement>(':scope > li > .pe-song') ?? [])].map((row) => {
    const box = row.getBoundingClientRect();
    return box.top + window.scrollY + box.height / 2;
  });

  const finish = (commit: boolean) => {
    const was = held.current;
    held.current = null;
    if (was?.frame) window.cancelAnimationFrame(was.frame);
    const shown = dragNow.current;
    setDrag(null);
    onCarry(null, null);
    if (!was?.moved || !shown) return;
    if (commit && shown.to !== shown.from) onMove(shown.from, shown.to);
    else if (!commit) announce(`Put ${mix[shown.from]?.title ?? 'the song'} back where it was.`);
  };

  // the screen's edges scroll the list while a song is carried, faster the nearer the edge
  const follow = () => {
    const now = held.current;
    if (!now?.moved) return;
    const chrome = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bottom-chrome')) || 0;
    const top = (Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-block')) || 0) + EDGE;
    const bottom = window.innerHeight - chrome - EDGE;
    const step = now.lastY < top ? -Math.ceil((top - now.lastY) / 6) : now.lastY > bottom ? Math.ceil((now.lastY - bottom) / 6) : 0;
    if (step) {
      window.scrollBy(0, step);
      update(now.lastY);
    }
    now.frame = window.requestAnimationFrame(follow);
  };

  const update = (clientY: number) => {
    const now = held.current;
    if (!now) return;
    now.lastY = clientY;
    const pageY = clientY + window.scrollY;
    const to = landing(now.from, pageY, now.tops);
    const offset = pageY - now.startY;
    setDrag((was) => {
      if (was && was.to !== to) navigator.vibrate?.(8);
      return { from: now.from, to, offset };
    });
    onCarry(keys[now.from], keys[to]);
  };

  const press = (index: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    // a second finger (the thumb holding the phone) never starts a second drag
    if (held.current || !event.isPrimary || event.button > 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    held.current = { id: event.pointerId, from: index, startY: event.clientY + window.scrollY, lastY: event.clientY, moved: false, tops: [], frame: 0 };
  };
  const carry = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const now = held.current;
    if (!now || now.id !== event.pointerId) return;
    if (!now.moved) {
      if (Math.abs(event.clientY + window.scrollY - now.startY) < DRAG_FROM) return;
      now.moved = true;
      now.tops = middles();
      announce(`Carrying ${mix[now.from].title}. Let go where it should go, or press Escape to put it back.`);
      now.frame = window.requestAnimationFrame(follow);
    }
    event.preventDefault();
    update(event.clientY);
  };
  const release = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (held.current?.id !== event.pointerId) return;
    finish(true);
  };

  useEffect(() => {
    if (!drag) return undefined;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [!!drag]);
  useEffect(() => () => { if (held.current?.frame) window.cancelAnimationFrame(held.current.frame); }, []);

  const keysOnHandle = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const to = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (to >= 0 && to < mix.length) onMove(index, to);
  };

  // the line in the gap where the carried song will land, measured from the rows themselves
  const line = (() => {
    if (!drag || drag.to === drag.from || !list.current) return null;
    const rows = list.current.querySelectorAll<HTMLElement>(':scope > li > .pe-song');
    const target = rows[drag.to];
    if (!target) return null;
    const box = target.getBoundingClientRect();
    const base = list.current.getBoundingClientRect().top;
    return drag.to < drag.from ? box.top - base - 2 : box.bottom - base + 2;
  })();
  const landingWords = drag && drag.to !== drag.from
    ? `Drop to move it ${drag.to === 0 ? 'to the top' : drag.to === mix.length - 1 ? 'to the end' : `to number ${drag.to + 1}`}`
    : null;

  return (
    <>
      <ol className={`pe-story ${drag ? 'is-carrying' : ''}`} ref={list} aria-labelledby={headingId}>
        {mix.map((item, index) => {
          const key = keys[index];
          const previous = mix[index - 1];
          const lifted = drag?.from === index;
          const words = previous ? connectorWords(item, previous, names, live, played[playedKey(previous.song_id, item.song_id)]) : null;
          return (
            <li key={key} className="pe-item" data-song-key={key} data-position={item.position}>
              {previous && words && (
                <div className={`pe-seam ${selectedSeam === index ? 'is-open' : ''} ${affected?.has(index) ? 'is-affected' : ''}`} data-pe-seam={`${keys[index - 1]}>${key}`} data-seam={`${keys[index - 1]}>${key}`}>
                  <button type="button" className="pe-seam-open" aria-expanded={selectedSeam === index} onClick={() => onOpenSeam(index)}>
                    <span className="visually-hidden">Transition from {previous.title} into {item.title}: </span>
                    <Status kind={words.kind}>{words.headline}</Status>
                    {affected?.has(index) && <span className="pe-seam-note">Changes if dropped there</span>}
                    <Icon name="down" size="compact" className="pe-chevron" />
                  </button>
                </div>
              )}
              <div
                className={`pe-song ${selectedSong === index ? 'is-open' : ''} ${playingIndex === index ? 'is-playing' : ''} ${lifted ? 'is-lifted' : ''} ${movingKey === key ? 'is-moving' : ''}`}
                style={lifted ? { transform: `translateY(${drag!.offset}px)` } : undefined}
                aria-busy={movingKey === key || undefined}
              >
                <span className="pe-number" aria-hidden="true">{playingIndex === index ? <Icon name="play" size="compact" /> : index + 1}</span>
                <button type="button" className="pe-song-open" aria-current={selectedSong === index ? 'true' : undefined} onClick={() => onOpenSong(index)}>
                  <SongMotif songId={item.song_id} />
                  <span className="pe-song-words">
                    <h3 dir="auto"><span className="visually-hidden">{index + 1}. </span>{item.title}</h3>
                    <span className="pe-song-facts"><span dir="auto">{item.artist}</span> · <span className="visually-hidden">length </span>{clock(item.duration)}{playingIndex === index && <b className="pe-tag"> · Playing now</b>}{item.locked && flagOn('editor.locks') && <b className="pe-tag"> · Locked</b>}</span>
                  </span>
                </button>
                <RequestTag item={item} />
                <button type="button" className="pe-icon-button" aria-label={`More for ${item.title}`} title={`More for ${item.title}`} onClick={() => onOpenSong(index)}>
                  <Icon name="more" />
                </button>
                <button
                  type="button"
                  className="pe-handle"
                  data-handle
                  aria-label={`Reorder ${item.title}`}
                  aria-description={`Number ${index + 1} of ${mix.length}. Drag, or use the up and down arrow keys.`}
                  aria-keyshortcuts="ArrowUp ArrowDown"
                  title="Drag to move, or use the arrow keys"
                  onPointerDown={press(index)}
                  onPointerMove={carry}
                  onPointerUp={release}
                  onPointerCancel={() => finish(false)}
                  onLostPointerCapture={() => { if (held.current) finish(false); }}
                  onKeyDown={keysOnHandle(index)}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <Icon name="grip" />
                </button>
                {movingKey === key && <span className="status status-working pe-song-status" role="status">Moving…</span>}
              </div>
            </li>
          );
        })}
      </ol>
      {line !== null && <div className="pe-drop-line" style={{ top: `${line}px` }} aria-hidden="true" />}
      {landingWords && <p className="pe-drop-words" role="status">{landingWords}</p>}
    </>
  );
}
