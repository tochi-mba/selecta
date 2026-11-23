import { useId, useState } from 'react';
import type { MixItem } from '../api';
import { clock } from '../lib';
import type { NowState } from '../player';
import type { PlayerLike } from '../playerContract';
import { countOf } from '../ui/format';
import { Icon } from '../ui/Icon';
import { CoverArt } from '../views/CoverArt';

/** How many later songs show before "Show all". */
const SHORT = 4;

/** Listen's queue after the next song: what plays later, each one a press away. The next song
 * itself, with its transition, is Listen's own Up Next card above this. */
export function ListenQueue({ mix, now, player }: { mix: readonly MixItem[]; now: Pick<NowState, 'position'>; player: Pick<PlayerLike, 'playFrom'> }) {
  const id = useId();
  const [all, setAll] = useState(false);
  const [starting, setStarting] = useState<number | null>(null);
  const first = now.position + 2;
  const later = mix.slice(first);
  if (!later.length) return null;
  const shown = all ? later : later.slice(0, SHORT);
  const play = async (position: number) => {
    if (starting !== null) return;
    setStarting(position);
    try { await player.playFrom(position); } finally { setStarting(null); }
  };
  return (
    <section className="listen-queue" aria-labelledby={id}>
      <h2 className="eyebrow" id={id}>Later <span className="soft">· {countOf(later.length, 'song')}</span></h2>
      <ol>
        {shown.map((item, offset) => {
          const position = first + offset;
          return (
            <li key={`${position}-${item.song_id}`}>
              <button type="button" className="queue-row" aria-label={`Play from ${item.title}`} aria-busy={starting === position || undefined} onClick={() => void play(position)}>
                <span className="queue-place" aria-hidden="true">{position + 1}</span>
                <CoverArt seed={item.song_id} songId={item.song_id} size="small" />
                <span className="queue-words"><b dir="auto">{item.title}</b><span dir="auto">{item.artist}</span></span>
                <small>{starting === position ? 'Starting…' : clock(item.duration)}</small>
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
