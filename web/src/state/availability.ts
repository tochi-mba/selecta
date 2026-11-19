import type { SongAvailability } from '../api';
import type { StatusKind } from '../ui/controls';

/** What a song's availability means to the member (BF-0462-04): one answer for the Library row,
 * its details and the Play capability, so none can disagree. Only a shell whose music lives on
 * the member's devices sends availability; local mode never does, and shows nothing new. */
export type AvailabilityFacts = { kind: StatusKind; words: string; reason: string; canPlay: boolean };

const FACTS: Record<SongAvailability, AvailabilityFacts> = {
  here: { kind: 'ready', words: 'On this device', reason: 'The file is connected here and can play.', canPlay: true },
  reauth: { kind: 'needs-action', words: 'Needs permission again', reason: 'This browser needs your permission to open the file again. Allow it under Connect music.', canPlay: false },
  reconnect: { kind: 'needs-action', words: 'Connect again to play', reason: 'Choose it again under Connect music to play it here.', canPlay: false },
  hosted: { kind: 'ready', words: 'Hosted copy', reason: 'Plays from your hosted copy in SelectaDJ Cloud.', canPlay: true },
  elsewhere: { kind: 'unavailable', words: 'Not on this device', reason: 'It is on another of your devices. Connect it here to play it here.', canPlay: false },
  nowhere: { kind: 'failed', words: 'Missing on every device', reason: 'It is not on any of your devices right now. Connect it again to play it.', canPlay: false },
};

export function availabilityFacts(state: SongAvailability | undefined): AvailabilityFacts | null {
  return state ? FACTS[state] ?? null : null;
}
