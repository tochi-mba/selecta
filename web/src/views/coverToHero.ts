// A song chosen from Listen's queue sends its cover up to the hero (ADR-0477, plan 3.4): the row's
// cover is measured as it is pressed, and when that song really becomes the one playing the hero's
// cover starts from the row's place and size and settles into its own. Playback never waits for it:
// the press plays at once, and the drawing follows only once the player says the song changed. A
// press that is not followed by that song within a few seconds is forgotten.
//
// Only with the motion part on and not calm; otherwise the hero draws its cover as it always did.
import { feelCalm, feelOn } from '../feel/root';
import { travelFrom } from './stageTravel';

/** How long a press waits for its song to start before the travel is forgotten. */
export const COVER_WAIT_MS = 10_000;

type Sent = { songId: number; left: number; top: number; width: number; height: number; at: number };
let sent: Sent | null = null;

/** Note the pressed row's cover, for the song it starts. Does nothing when motion is calm or off. */
export function sendCoverToHero(cover: Element | null | undefined, songId: number, now = Date.now()): void {
  sent = null;
  if (!cover || !feelOn('motion') || feelCalm()) return;
  const box = cover.getBoundingClientRect();
  if (!box.width || !box.height) return;
  sent = { songId, left: box.left, top: box.top, width: box.width, height: box.height, at: now };
}

/** The noted cover for this song, once, if it was pressed recently enough. */
export function takeCoverFor(songId: number | undefined, now = Date.now()): Sent | null {
  const found = sent;
  if (!found || songId === undefined) return null;
  if (now - found.at > COVER_WAIT_MS) {
    sent = null;
    return null;
  }
  // another song may come first (a hand-over finishing as the press lands): the note waits for its own
  if (found.songId !== songId) return null;
  sent = null;
  return found;
}

/** The hero's cover starts where the row's was and settles into place. True when it ran, so the
 * hero's usual arrival is not added on top. */
export function arriveFromQueue(cover: HTMLElement | null, songId: number | undefined, duration: number, easing: string): boolean {
  const from = takeCoverFor(songId);
  if (!from || !cover || typeof cover.animate !== 'function' || !duration) return false;
  const box = cover.getBoundingClientRect();
  if (!box.width || !box.height) return false;
  const frames: Keyframe[] = [{ transform: travelFrom(from, box), transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }];
  try {
    cover.animate(frames, { duration, easing });
  } catch {
    cover.animate(frames, { duration, easing: 'ease-out' });
  }
  return true;
}
