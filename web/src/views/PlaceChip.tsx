import type { LibrarySong } from '../api';
import { openToPlay, type MusicHolder } from '../devices/controller';
import { Icon, type IconName } from '../ui/Icon';

/** library.places: where a song is kept and, apart from that, whether it can play here (plan
 * phase 2, T-20261125-67ba). The chip names the place: on this device, in your cloud library, or
 * both, each with its icon; on a phone only the icons show, and the full words stay the button's
 * name. The line under it is said only when the song cannot play here, and why. Pressing the chip
 * opens the song's details, where each place has its own row. */

type Part = { icon: IconName; words: string };

/** The chip's icons and words for a song's places. */
export function placeParts(song: LibrarySong): { parts: Part[]; words: string; kind: 'here' | 'cloud' | 'both' | 'other' | 'none' } {
  const places = song.places;
  const device = !!places?.device;
  const cloud = places?.cloud ?? null;
  if (device && cloud) {
    const words = cloud.measuring ? 'On this device, getting ready in your cloud library' : 'On this device and in your cloud library';
    return { kind: 'both', words, parts: [{ icon: 'system', words: 'On this device' }, { icon: 'cloud', words: 'In your cloud library' }] };
  }
  if (device) return { kind: 'here', words: 'On this device', parts: [{ icon: 'system', words: 'On this device' }] };
  // an upload the cloud studio has not measured yet still plays from the original
  if (cloud) return { kind: 'cloud', words: cloud.measuring ? 'Getting ready' : 'In your cloud library', parts: [{ icon: 'cloud', words: 'In your cloud library' }] };
  const named = places?.other.online[0] ?? places?.other.before[0];
  if (named || (places?.other.devices ?? 0) > 0) {
    const words = named ? `On ${named}` : 'On another device';
    return { kind: 'other', words, parts: [{ icon: 'tablet', words }] };
  }
  return { kind: 'none', words: 'Not kept anywhere', parts: [{ icon: 'warning', words: 'Not kept anywhere' }] };
}

/** Whether it can play here, said only when it cannot: null when it plays. */
export function playLine(song: LibrarySong, offline: boolean, holder: MusicHolder | null): string | null {
  const places = song.places;
  if (!places || places.device === 'here') return null;
  if (places.cloud) return offline ? 'Needs a connection' : null;
  if (places.device === 'reauth') return 'Allow again to play here';
  if (places.device === 'reconnect') return 'Choose again to play here';
  const open = places.other.online[0];
  if (open) return `Plays on ${open}`;
  const away = places.other.before[0] ?? (holder && !holder.places && holder.ids?.has(song.id) ? holder.name : undefined);
  if (away) return openToPlay(away);
  return places.other.devices > 0 ? 'Plays on another device' : null;
}

export function PlaceChip({ song, offline, holder, onOpen, aside }: {
  song: LibrarySong;
  offline: boolean;
  holder: MusicHolder | null;
  onOpen: () => void;
  /** Set aside or Never played: said under the chip when nothing more pressing is */
  aside?: string;
}) {
  const { parts, words, kind } = placeParts(song);
  const line = playLine(song, offline, holder) ?? aside ?? null;
  // "Getting ready" alone would not say where: the place is said first, for a screen reader
  const where = kind === 'cloud' && song.places?.cloud?.measuring ? 'In your cloud library, ' : '';
  // drawn inside the row's state cell (`.lw-state.lw-places`)
  return (
    <>
      <button type="button" className="place-chip" data-place={kind} onClick={onOpen} title={`${where}${words}. Where it is kept`}>
        <span className="place-chip-icons" aria-hidden="true">{parts.map((part) => <Icon key={part.icon} name={part.icon} size="compact" />)}</span>
        {where && <span className="visually-hidden">{where}</span>}
        <span className="place-chip-words">{words}</span>
      </button>
      {line && <small className="place-line" data-can-play="no">{line}</small>}
    </>
  );
}
