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
export type Holdings = { devices: DeviceHolding[]; server_time: number; device_id?: string; song_ids?: number[] };

/** R9: one wording for where a song will make sound when it is not this device. */
export const playsOn = (speakerName: string) => `Plays on ${speakerName}`;
/** R4: the speaker has no file for this song, so adding it would only be skipped. */
export const notOnSpeaker = (speakerName: string) => `${speakerName} can’t play this: its file isn’t there.`;
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
