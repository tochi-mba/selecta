import { KeyboardEvent, PointerEvent, useEffect, useRef, useState } from 'react';
import type { MixItem } from '../api';
import { clock } from '../lib';
import type { PlayerLike } from '../playerContract';

/** The whole mix as one strip: a segment for each song, as long as the song, a notch at each
 * transition, and the playhead while the current mix plays. It is one slider: a finger moves along
 * it to choose a song (the label says which), and letting go plays from there; the arrow keys do the
 * same a song at a time and Enter plays. It reads the clock live, so the editor around it isn't
 * redrawn for every tick (r8c). */
export function MixMap(props: {
  mix: MixItem[];
  playingIndex: number;
  /** the current mix's player, for the playhead; a draft has none */
  player: PlayerLike | null;
  onPlayFrom: (index: number) => void;
  playWords: string;
}) {
  const { mix, playingIndex, player, onPlayFrom, playWords } = props;
  const total = Math.max(1, mix.reduce((sum, item) => sum + (item.duration || 0), 0));
  const starts = mix.map((_, index) => mix.slice(0, index).reduce((sum, item) => sum + (item.duration || 0), 0));
  const [aim, setAim] = useState<number | null>(null);
  const [songTime, setSongTime] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const held = useRef<number | null>(null);

  useEffect(() => {
    if (!player || playingIndex < 0) return undefined;
    const read = () => setSongTime(player.state.songTime || 0);
    read();
    const timer = window.setInterval(read, 500);
    return () => window.clearInterval(timer);
  }, [player, playingIndex]);

  const songAt = (clientX: number) => {
    const box = strip.current?.getBoundingClientRect();
    if (!box?.width) return 0;
    const share = Math.min(Math.max((clientX - box.left) / box.width, 0), 0.9999);
    const seconds = share * total;
    let index = 0;
    while (index + 1 < mix.length && starts[index + 1] <= seconds) index += 1;
    return index;
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (held.current !== null || !event.isPrimary) return;
    held.current = event.pointerId;
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* a pointer the browser no longer tracks */ }
    setAim(songAt(event.clientX));
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (held.current !== event.pointerId) return;
    setAim(songAt(event.clientX));
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (held.current !== event.pointerId) return;
    held.current = null;
    const index = songAt(event.clientX);
    setAim(null);
    onPlayFrom(index);
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = aim ?? Math.max(playingIndex, 0);
    const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? from + 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? from - 1
        : event.key === 'Home' ? 0 : event.key === 'End' ? mix.length - 1 : null;
    if (next !== null) {
      event.preventDefault();
      setAim(Math.min(Math.max(next, 0), mix.length - 1));
    } else if ((event.key === 'Enter' || event.key === ' ') && aim !== null) {
      event.preventDefault();
      onPlayFrom(aim);
      setAim(null);
    } else if (event.key === 'Escape' && aim !== null) {
      setAim(null);
    }
  };

  const shown = aim ?? (playingIndex >= 0 ? playingIndex : null);
  const playhead = playingIndex >= 0 ? ((starts[playingIndex] ?? 0) + Math.min(songTime, mix[playingIndex]?.duration ?? 0)) / total : null;
  const label = shown === null
    ? `${mix.length} songs, ${clock(total)}. ${playWords}`
    : aim !== null
      ? `Let go to play from ${aim + 1}: ${mix[aim].title}`
      : `Playing ${shown + 1} of ${mix.length}: ${mix[shown].title}, ${clock(songTime)} of ${clock(mix[shown].duration)}`;
  return (
    <div className="pe-map">
      <div
        ref={strip}
        className={`pe-map-strip ${aim !== null ? 'is-aiming' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label="Where in the mix"
        aria-valuemin={1}
        aria-valuemax={mix.length}
        aria-valuenow={(shown ?? 0) + 1}
        aria-valuetext={label}
        aria-description="Move along it to choose a song, then let go, or press Enter, to play from there."
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => { held.current = null; setAim(null); }}
        onKeyDown={keys}
        onBlur={() => setAim(null)}
      >
        {mix.map((item, index) => (
          <span
            key={`${item.song_id}-${index}`}
            className={`pe-map-song ${index === playingIndex ? 'is-playing' : ''} ${index === aim ? 'is-aimed' : ''} ${index < playingIndex ? 'is-past' : ''}`}
            style={{ flexGrow: Math.max(item.duration || 0, 1) }}
          />
        ))}
        {playhead !== null && <span className="pe-map-head" style={{ insetInlineStart: `${(playhead * 100).toFixed(2)}%` }} />}
      </div>
      <p className="pe-map-words" aria-hidden="true">{label}</p>
    </div>
  );
}
