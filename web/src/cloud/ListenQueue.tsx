import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { MixItem } from '../api';
import { clock } from '../lib';
import type { NowState } from '../player';
import type { PlayerLike } from '../playerContract';
import { flip } from '../feel/flip';
import { countOf } from '../ui/format';
import { Icon } from '../ui/Icon';
import { CoverArt } from '../views/CoverArt';
import { useFeelPart } from '../views/feelBits';

/** How many later songs show before "Show all". */
const SHORT = 4;

/** Listen's queue after the next song: what plays later, each one a press away. The next song
 * itself, with its transition, is Listen's own Up Next card above this. */
export function ListenQueue({ mix, now, player }: { mix: readonly MixItem[]; now: Pick<NowState, 'position'>; player: Pick<PlayerLike, 'playFrom'> }) {
  const id = useId();
  const [all, setAll] = useState(false);
  const [starting, setStarting] = useState<number | null>(null);
  // With motion on, the list follows the playing position one step behind, so a hand-over or a jump
  // can measure the rows where they were and let them glide up (feel/flip.ts). Playback has already
  // moved; only the drawing of the list waits for the measuring, a microtask later. With motion off
  // the list is drawn straight from the position, as before.
  const moving = useFeelPart('motion');
  const list = useRef<HTMLOListElement>(null);
  const [drawnAt, setDrawnAt] = useState(now.position);
  const position = moving ? drawnAt : now.position;
  useEffect(() => {
    if (drawnAt === now.position) return;
    const target = now.position;
    const rows = list.current ? Array.from(list.current.children) : [];
    if (!moving || !rows.length) {
      setDrawnAt(target);
      return;
    }
    let live = true;
    queueMicrotask(() => {
      if (live) void flip(rows, () => { flushSync(() => setDrawnAt(target)); });
    });
    return () => { live = false; };
  }, [now.position, drawnAt, moving]);
  const first = position + 2;
  const later = mix.slice(first);
  if (!later.length) return null;
  const shown = all ? later : later.slice(0, SHORT);
  const play = async (at: number) => {
    if (starting !== null) return;
    setStarting(at);
    try { await player.playFrom(at); } finally { setStarting(null); }
  };
  return (
    <section className="listen-queue" aria-labelledby={id}>
      <h2 className="eyebrow" id={id}>Later <span className="soft">· {countOf(later.length, 'song')}</span></h2>
      <ol ref={list}>
        {shown.map((item, offset) => {
          const place = first + offset;
          return (
            <li key={`${place}-${item.song_id}`}>
              <button type="button" className="queue-row" data-lift="row" aria-label={`Play from ${item.title}`} aria-busy={starting === place || undefined} onClick={() => void play(place)}>
                <span className="queue-place" aria-hidden="true">{place + 1}</span>
                <CoverArt seed={item.song_id} songId={item.song_id} size="small" />
                <span className="queue-words"><b dir="auto">{item.title}</b><span dir="auto">{item.artist}</span></span>
                <small>{starting === place ? 'Starting…' : clock(item.duration)}</small>
                <Icon name="play" size="compact" className="queue-play" />
              </button>
            </li>
          );
        })}
      </ol>
      {later.length > SHORT && (
        <button type="button" className="quiet small" aria-expanded={all} onClick={() => setAll((was) => !was)}>
          {all ? 'Show fewer' : `Show all ${later.length}`}
        </button>
      )}
    </section>
  );
}
