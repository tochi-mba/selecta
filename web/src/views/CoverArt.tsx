import type { CSSProperties } from 'react';
import { Icon } from '../ui/Icon';
import { SongMotif } from '../ui/MusicObjects';

/** A cover tile drawn from a name or library id: a stable colour and angle, with the song's own
 * motif on it. It is decoration, never album art, so it is hidden from assistive technology.
 * Only the Cloud sheet (cloud/cloudMusic.css) draws it; everywhere else it takes no room. */
export function CoverArt({ seed, songId, size = 'row' }: { seed: string | number; songId?: number; size?: 'hero' | 'row' | 'small' }) {
  const text = String(seed);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  const style = { '--art-hue': String(hash % 360), '--art-turn': `${100 + ((hash >>> 9) % 160)}deg` } as CSSProperties;
  return (
    <span className="cover-art" data-size={size} style={style} aria-hidden="true">
      {songId !== undefined ? <SongMotif songId={songId} /> : <Icon name="music" />}
    </span>
  );
}
