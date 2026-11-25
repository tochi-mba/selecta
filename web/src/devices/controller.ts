import { createContext } from 'react';

// ADR-0475, every device a controller. A device that is not the speaker still sees and steers
// everything in the account: this is the link it holds to the device that is making the sound,
// and the rules for changing that device's programme from here. Only making sound needs files.

/** What a device that is not the speaker knows about the one that is. */
export type ControllerLink = {
  /** The speaker's name as the person set it, read live. */
  speakerName: string;
  /** False while the speaker is not checking in: a press is kept and delivered on its return. */
  online: boolean;
  /** The speaker's programme, as catalogue song ids in play order. */
  programme: readonly number[];
  /** Where in the programme the music is. */
  songIndex: number;
  /** The catalogue ids the speaker reported it can open; null when it has not said. */
  holds: ReadonlySet<number> | null;
  /** Sends a playback command; true when the session took it (or is keeping it for the speaker). */
  send: (name: string, args?: Record<string, unknown>) => Promise<boolean>;
};

/** A device as the holdings route lists it: what it can open, and whether it is here now. */
export type DeviceHolding = { device_id: string; name: string; last_seen_at: number; online: boolean; songs: number; reported_at: number | null };
export type Holdings = { devices: DeviceHolding[]; server_time: number; device_id?: string; song_ids?: number[]; default_speaker_id?: string | null };

/** ADR-0475 R6: another of the person's devices that holds music, for the pages that say where a
 * song is. `ids` are the catalogue ids it reported; null when it has not said which. */
/** `lastOpen`: seconds since a named device was last open (I86), when known. `speaking`: it is the
 * session's speaker and open, so a row's tap goes into what it plays (I84, I87); set only on a
 * remote, where false means the speaker has gone. */
export type MusicHolder = { deviceId: string; name: string; songs: number; online: boolean; ids: ReadonlySet<number> | null; places?: WhereHeld | null; lastOpen?: (name: string) => number | null; speaking?: boolean };
/** ADR-0475 I86: the one hint for a song whose only copies are on devices that are not open. */
export const openToPlay = (device: string) => `Open SelectaDJ on ${device} to play this.`;
export const HolderContext = createContext<MusicHolder | null>(null);

/** The device to name as where the music is: the speaker when one is playing elsewhere, else the
 * open device holding the most songs, else the one holding the most that is not open. */
export function musicHolder(devices: readonly DeviceHolding[], thisDeviceId: string | null, speakerId: string | null): DeviceHolding | null {
  const others = devices.filter((device) => device.device_id !== thisDeviceId && device.songs > 0);
  const speaker = speakerId ? others.find((device) => device.device_id === speakerId) : undefined;
  // a speaker that has gone away is not where the music is: the best open holder is (I87)
  if (speaker?.online) return speaker;
  return bestHolder(others) ?? [...others].sort((one, other) => other.songs - one.songs || other.last_seen_at - one.last_seen_at)[0] ?? null;
}

/** ADR-0475 R4: which of the person's other devices hold a song, by name: `online` hold it now
 * (reported, and open); `before` reported it but are not open, so may need their folder again.
 * A device that has reported nothing is in neither: it is unknown, not empty. */
export type SongPlaces = { online: string[]; before: string[] };
export type WhereHeld = (songId: number) => SongPlaces;

/** Build the lookup from the holdings list and each reporting device's ids. `exceptIds`: this
 * device and the speaker, which are judged on their own. */
export function whereHeldFrom(devices: readonly DeviceHolding[], ids: ReadonlyMap<string, ReadonlySet<number>>, exceptIds: readonly (string | null)[]): WhereHeld {
  const others = devices.filter((device) => !exceptIds.includes(device.device_id) && ids.has(device.device_id))
    .sort((one, other) => other.songs - one.songs || other.last_seen_at - one.last_seen_at);
  return (songId) => {
    const holding = others.filter((device) => ids.get(device.device_id)?.has(songId));
    return { online: holding.filter((device) => device.online).map((device) => device.name), before: holding.filter((device) => !device.online).map((device) => device.name) };
  };
}

/** R4 row two: held now by another open device, not by the speaker. */
export const onlyOn = (device: string, speakerName: string) => `Only on ${device}. ${speakerName} can’t play it.`;
/** R4 row four: held only by a device that is not open (its folder may need choosing again). */
export const needsFolderAgain = (device: string) => `${device} needs its music folder again to play this.`;
/** R4 row five. */
export const NOWHERE_NOW = 'No device has this song’s file right now.';

/** The R4 line for a song the device that would play it cannot open, and whether "Connect music
 * here" is worth offering (only when no device has the file). Unknown places keep the plain
 * "can't play this" line. */
export function notHereWords(places: SongPlaces | null, speakerName: string): { note: string; connectHere: boolean } {
  if (!places) return { note: notOnSpeaker(speakerName), connectHere: false };
  if (places.online.length) return { note: onlyOn(places.online[0], speakerName), connectHere: false };
  if (places.before.length) return { note: needsFolderAgain(places.before[0]), connectHere: false };
  return { note: NOWHERE_NOW, connectHere: true };
}

/** R9: one wording for where a song will make sound when it is not this device. */
export const playsOn = (speakerName: string) => `Plays on ${speakerName}`;
/** R4: the speaker has no file for this song, so adding it would only be skipped. */
export const notOnSpeaker = (speakerName: string) => `${speakerName} can’t play this: its file isn’t there.`;
/** ADR-0475 I85: the speaker lacks a song another open device holds. The Library does not
 * refuse: it asks whether to move the music to that device (`MOVE_OFFER_EVENT` on window, with
 * a `MoveOffer`), and the add answers `move_offered` so the row stays quiet. */
export const MOVE_OFFER_EVENT = 'selecta-move-offer';
/** `programme`: the speaker's song now and what follows, which the moved music carries on with. */
export type MoveOffer = { songId: number; title: string; device: string; speaker: string; programme: number[] };
export const moveWords = (offer: Pick<MoveOffer, 'title' | 'device'>) => `${offer.title} is on ${offer.device}. Move the music there?`;
/** R4: kept for a speaker that is away. */
export const addedOnReturn = (speakerName: string) => `Will be added when ${speakerName} is back.`;

/** Whether the speaker can open a song. Unknown holdings (an older app, no report yet) are not
 * a no: the speaker answers for itself when the song comes up. */
export function speakerHolds(link: ControllerLink, songId: number): boolean {
  return link.holds ? link.holds.has(songId) : true;
}

/** Whether a song is the one playing or still to come on the speaker. */
export function comingUp(link: ControllerLink, songId: number): boolean {
  return link.programme.slice(Math.max(0, link.songIndex)).includes(songId);
}

/** The speaker's programme with a song put right after the one that is playing, as the
 * `set_programme` arguments that keep the music where it is. */
export function programmeWithNext(link: ControllerLink, songId: number): { songs: number[]; song_index: number; keep_position: true } {
  const at = Math.max(0, Math.min(link.programme.length - 1, link.songIndex));
  const songs = [...link.programme];
  songs.splice(at + 1, 0, songId);
  return { songs, song_index: at, keep_position: true };
}

/** How many songs of a mix a device holds; null when it has not said which songs it has. */
export function mixHeld(ids: ReadonlyMap<string, ReadonlySet<number>>, deviceId: string, mixIds: readonly number[]): number | null {
  const held = ids.get(deviceId);
  return held ? mixIds.filter((id) => held.has(id)).length : null;
}

/** R1 with a mix known: the online device holding the most of its songs (a device that has not
 * said which counts by its total); null when no online device holds any. */
export function bestForMix(devices: readonly DeviceHolding[], ids: ReadonlyMap<string, ReadonlySet<number>>, mixIds: readonly number[], exceptId?: string | null): DeviceHolding | null {
  if (!mixIds.length) return bestHolder(devices, exceptId);
  const score = (device: DeviceHolding) => mixHeld(ids, device.device_id, mixIds) ?? (device.songs > 0 ? 0.5 : 0);
  const able = devices.filter((device) => device.online && device.device_id !== exceptId && score(device) > 0);
  able.sort((one, other) => score(other) - score(one) || other.last_seen_at - one.last_seen_at);
  return able[0] ?? null;
}

/** R3's pre-flight line: what the chosen device will skip. Null when it holds the whole mix or
 * has not said. */
export function preflightWords(device: string, held: number | null, total: number): string | null {
  if (held === null || held >= total || total === 0) return null;
  const skipped = total - held;
  return `${device} has ${held} of these ${total} songs. The other ${skipped === 1 ? 'one' : skipped} will be skipped.`;
}

/** R3: marked on a song the speaker cannot open. */
export const notOn = (speakerName: string) => `Not on ${speakerName}`;

/** R1: the device that should make the sound when nothing is playing: an online device holding
 * the most songs, the most recently seen first among equals; null when no online device holds any. */
export function bestHolder(devices: readonly DeviceHolding[], exceptId?: string | null): DeviceHolding | null {
  const able = devices.filter((device) => device.online && device.songs > 0 && device.device_id !== exceptId);
  able.sort((one, other) => other.songs - one.songs || other.last_seen_at - one.last_seen_at);
  return able[0] ?? null;
}

/** What a speaker does when the session's programme and its own mix differ (ADR-0475 R4): it
 * sends its own when its mix changed since the two last agreed, and takes the session's when its
 * own mix has not changed (another device changed what is coming up). */
export function programmeTurn(mine: readonly number[], session: readonly number[], lastAgreed: string | null): 'agree' | 'publish' | 'adopt' {
  const own = mine.join(',');
  if (own === session.join(',')) return 'agree';
  return lastAgreed !== null && lastAgreed === own ? 'adopt' : 'publish';
}
