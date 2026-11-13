// Who is really in the room, for the host's panel (ADR-0416). The server marks each guest and
// screen `online` from its own heartbeat (a guest page reads the room every 5 s, a screen every
// 3 s) and only counts check-ins since it last started, so the first poll after a restart says
// everyone is away until their pages reconnect. Times are measured against the server's `now`,
// so a host whose clock is off still reads "last seen 5 min ago" correctly.

export type PresenceGuest = { id: string; nickname: string; status: string; last_seen_at?: number; online?: boolean };
export type PresenceScreen = { id: string; label: string; last_seen_at: number | null; online: boolean };

/** Away longer than this and a guest moves into the collapsed "Left or away" group. */
export const GONE_AFTER_S = 30 * 60;

export function ago(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 60) return 'just now';
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ago`;
}

export function clockTime(epoch: number): string {
  const when = new Date(epoch * 1000);
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
}

export type GuestGroups<G extends PresenceGuest> = { here: G[]; away: G[]; gone: G[] };

/** Guests still in the room (active or waiting to be let in), split by presence. */
export function groupGuests<G extends PresenceGuest>(guests: G[], now: number): GuestGroups<G> {
  const groups: GuestGroups<G> = { here: [], away: [], gone: [] };
  for (const guest of guests) {
    if (guest.status !== 'active' && guest.status !== 'pending') continue;
    if (guest.online) groups.here.push(guest);
    else if (guest.last_seen_at !== undefined && now - guest.last_seen_at > GONE_AFTER_S) groups.gone.push(guest);
    else groups.away.push(guest);
  }
  return groups;
}

export function guestsHeading(groups: GuestGroups<PresenceGuest>): string {
  const away = groups.away.length + groups.gone.length;
  if (!groups.here.length && !away) return 'Guests (0)';
  return away ? `Guests (${groups.here.length} here, ${away} away)` : `Guests (${groups.here.length} here)`;
}

export function guestPresence(guest: PresenceGuest, now: number): string {
  if (guest.online) return 'Here now';
  if (guest.last_seen_at === undefined) return 'Away';
  return `Away · last seen ${ago(now - guest.last_seen_at)}`;
}

export function screenPresence(screen: PresenceScreen): string {
  if (screen.online) return `${screen.label} · showing now`;
  if (screen.last_seen_at === null) return `${screen.label} · offline, not seen yet`;
  return `${screen.label} · offline since ${clockTime(screen.last_seen_at)}`;
}

/** What changed between two polls, in words a screen reader can say politely. */
export function presenceChanges(
  before: { guests: PresenceGuest[]; screens: PresenceScreen[] } | null,
  after: { guests: PresenceGuest[]; screens: PresenceScreen[] },
): string[] {
  if (!before) return [];
  const said: string[] = [];
  const was = new Map(before.guests.map((guest) => [guest.id, guest]));
  for (const guest of after.guests) {
    const old = was.get(guest.id);
    const inRoom = guest.status === 'active' || guest.status === 'pending';
    if (!inRoom) continue;
    if (!old) { if (guest.online) said.push(`${guest.nickname} joined.`); continue; }
    if (Boolean(old.online) !== Boolean(guest.online)) said.push(guest.online ? `${guest.nickname} is back.` : `${guest.nickname} is away.`);
  }
  const screens = new Map(before.screens.map((screen) => [screen.id, screen]));
  for (const screen of after.screens) {
    const old = screens.get(screen.id);
    if (old && old.online !== screen.online) said.push(screen.online ? `${screen.label} is showing again.` : `${screen.label} went offline.`);
  }
  return said;
}
