import type { LibrarySong } from '../api';
import type { StatusKind } from '../ui/controls';
import { trackReadiness } from './readiness';

/** SF-0227-03: one song can be ready for one thing and not another. Playing needs only the file;
 * joining a mix needs analysis; stems are split per transition, only when one asks for them; and
 * timed lyrics come from a separate lookup. Each gets its own answer, so none borrows another's. */
export type Capability = { name: 'Play' | 'Mixes' | 'Stems' | 'Lyrics'; kind: StatusKind; words: string };

const UNREACHABLE = ['missing', 'set_aside', 'excluded'];

export function capabilities(
  song: Pick<LibrarySong, 'bpm' | 'readiness' | 'lyric_status' | 'priority'>,
  { lyrics = true }: { lyrics?: boolean } = {},
): Capability[] {
  const status = song.readiness?.status ?? 'unknown';
  const track = trackReadiness(song);
  const analysed = song.bpm !== null && song.bpm !== undefined;
  const play: Capability = status === 'missing'
    ? { name: 'Play', kind: 'failed', words: 'File is missing' }
    : track.words === 'State unknown'
      ? { name: 'Play', kind: 'unavailable', words: 'State unknown' }
      : { name: 'Play', kind: 'ready', words: 'The file is here and can play' };
  const mixes: Capability = { name: 'Mixes', kind: track.kind, words: track.words };
  const stems: Capability = UNREACHABLE.includes(status)
    ? { name: 'Stems', kind: 'unavailable', words: 'Not split: mixes can’t use this song' }
    : status === 'needs_attention'
      ? { name: 'Stems', kind: 'unavailable', words: 'Not split until it can be analysed' }
      : !analysed
        ? { name: 'Stems', kind: 'queued', words: 'Possible after analysis' }
        : { name: 'Stems', kind: 'queued', words: song.priority ? 'Split when a transition needs them, and kept when space is cleared' : 'Split when a transition needs them' };
  const lyric = song.lyric_status;
  const words: Capability = lyric === 'synced'
    ? { name: 'Lyrics', kind: 'ready', words: 'Timed' }
    : lyric === 'instrumental'
      ? { name: 'Lyrics', kind: 'ready', words: 'Instrumental, so none are needed' }
      : lyric
        ? { name: 'Lyrics', kind: 'warning', words: 'Not timed' }
        : { name: 'Lyrics', kind: 'queued', words: 'Not looked up yet' };
  return lyrics ? [play, mixes, stems, words] : [play, mixes, stems];
}
