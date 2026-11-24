import type { DeviceHolding } from './controller';

// ADR-0475, the revised R1 and the default speaker: which device makes the sound when one must
// be chosen. One pure function, so every way of starting music (Make a Mix, My Mixes, a room,
// Play on the play bar, Listen) is decided by the same rule. The server applies the same order
// to a room's library (src/selecta/playback/default_speaker.py).
//
// 1. The session's speaker, while it is online (playing or paused).
// 2. Else the default speaker, when it is online and holds at least one song of what is about to
//    play (all of the music when nothing is named). It wins even when another device holds more.
// 3. Else the only online device that holds some of it.
// 4. Else, with two or more, the person chooses (the picker), never silently.
// 5. Else nobody: no Play, and the devices that had music with when each was last seen.

/** A device as the rule reads it. `needsFolder`: open, but its music folder must be allowed
 * again, so it holds nothing now (never suggested, never usable). */
export type Candidate = DeviceHolding & { needsFolder?: boolean };

export type PickerOption = { device: Candidate; held: number | null; usable: boolean; why: string | null };

export type Choice =
  | { kind: 'speaker'; deviceId: string }
  | { kind: 'default'; device: Candidate; held: number | null; whole: Candidate | null }
  | { kind: 'only'; device: Candidate; defaultAway: Candidate | null }
  | { kind: 'ask'; options: PickerOption[]; suggested: string; defaultAway: Candidate | null }
  | { kind: 'none'; away: Candidate[] };

export type Situation = {
  devices: readonly Candidate[];
  /** The session's speaker and whether it is online now. */
  speaker: { deviceId: string; online: boolean } | null;
  defaultId: string | null;
  thisDeviceId: string | null;
  /** What is about to play, by song id; empty when not known (judged by all the music). */
  mixIds: readonly number[];
  /** Each reporting device's song ids. */
  ids: ReadonlyMap<string, ReadonlySet<number>>;
};

/** How many songs of what is about to play a device holds; its whole count when nothing is named
 * or it has not said which; null when it has said nothing at all. */
export function heldOf(device: Candidate, situation: Pick<Situation, 'mixIds' | 'ids'>): number | null {
  if (device.needsFolder) return 0;
  const songs = situation.ids.get(device.device_id);
  if (!situation.mixIds.length) return device.songs;
  if (!songs) return device.reported_at === null ? null : 0;
  return situation.mixIds.filter((id) => songs.has(id)).length;
}

const usable = (device: Candidate, situation: Situation) => {
  const held = heldOf(device, situation);
  return device.online && !device.needsFolder && device.songs > 0 && (held === null || held > 0);
};

/** Why a listed device cannot be chosen now, in the person's words; null when it can. */
export function whyNot(device: Candidate, situation: Situation): string | null {
  if (!device.online) return `${device.name} isn’t open right now.`;
  if (device.needsFolder) return `${device.name} needs its music folder allowed again.`;
  if (!device.songs) return `${device.name} has no music connected.`;
  if (heldOf(device, situation) === 0) return `${device.name} has none of these songs.`;
  return null;
}

/** The picker's order: most of what is about to play, then this device, then most recently
 * active. Unusable devices follow, disabled with their reason. */
export function pickerOrder(situation: Situation): PickerOption[] {
  const rank = (device: Candidate) => heldOf(device, situation) ?? 0;
  const listed = situation.devices.filter((device) => device.songs > 0 || device.needsFolder);
  const sorted = [...listed].sort((one, other) => rank(other) - rank(one)
    || Number(other.device_id === situation.thisDeviceId) - Number(one.device_id === situation.thisDeviceId)
    || other.last_seen_at - one.last_seen_at);
  const options = sorted.map((device) => ({ device, held: heldOf(device, situation), usable: usable(device, situation), why: whyNot(device, situation) }));
  return [...options.filter((option) => option.usable), ...options.filter((option) => !option.usable)];
}

export function whereToPlay(situation: Situation): Choice {
  if (situation.speaker?.online) return { kind: 'speaker', deviceId: situation.speaker.deviceId };
  const byId = (id: string | null) => situation.devices.find((device) => device.device_id === id) ?? null;
  const preferred = byId(situation.defaultId);
  const able = situation.devices.filter((device) => usable(device, situation));
  if (preferred && able.includes(preferred)) {
    const held = heldOf(preferred, situation);
    const total = situation.mixIds.length;
    // the default holds part of it: still the one, with the device that has it all named
    const whole = total && held !== null && held < total
      ? able.find((device) => device !== preferred && heldOf(device, situation) === total) ?? null : null;
    return { kind: 'default', device: preferred, held, whole };
  }
  const defaultAway = preferred && !able.includes(preferred) ? preferred : null;
  if (able.length === 1) return { kind: 'only', device: able[0], defaultAway };
  if (able.length > 1) {
    const options = pickerOrder(situation);
    return { kind: 'ask', options, suggested: options[0].device.device_id, defaultAway };
  }
  return { kind: 'none', away: situation.devices.filter((device) => device.songs > 0 && !device.online) };
}

/** Said once when the music starts somewhere other than the default. */
export const becauseWords = (device: string, preferred: string) => `Playing on ${device} because ${preferred} isn’t open.`;
/** The picker's note when the default cannot play now. */
export const defaultAwayWords = (preferred: string) => `Your default speaker, ${preferred}, isn’t open. Choose another for now.`;
/** Rule 5. */
export const NOBODY_OPEN = 'None of your devices with music is open right now.';

/** What tells two devices with the same name apart, wherever a choice is offered. */
export function telling(device: Candidate, all: readonly Candidate[], thisDeviceId: string | null, now: number): string | null {
  if (device.device_id === thisDeviceId) return 'This device';
  if (all.filter((one) => one.name === device.name).length < 2) return null;
  const minutes = Math.max(0, Math.round((now - device.last_seen_at) / 60));
  return minutes < 2 ? 'Open now' : `Last seen ${minutes < 90 ? `${minutes} minutes` : `${Math.round(minutes / 60)} hours`} ago`;
}
