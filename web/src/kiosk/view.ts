// The kiosk's view of its zone, and the client-side allowlist that builds it (ADR-0453 D4,
// ADR-0445). The server view is already built from an allowlist; this is the second fence, so a
// server mistake can never put billing, licence, seat, pilot, audit, staff names or error detail
// on a screen customers see. Only the fields below survive, with their types checked; anything
// else, including unknown states, is dropped.
//
// Field names follow ADR-0453's kiosk brief; the names the server draft uses
// (src/selecta/audit/business_invariants.py CUSTOMER_FIELDS["kiosk"]) are read as aliases:
// now_playing -> now, up_next -> next, problem_code -> diagnostic_code,
// screen_sleep -> screen_sleep_when_closed.

/** The zone states the server may send. Anything else is dropped. */
export const ZONE_STATES = [
  'unpaired', // the manager unpaired this player
  'closed', // outside opening hours
  'empty', // paired zone with no playable songs (D3 Empty)
  'stopped', // playback stopped at close (after grace or a pilot end): Closed like any night
  'zone_paused', // a paused extra zone (D3 Plan locked): Closed
  'starting', // warming, first songs downloading
  'open', // in service
  'paused', // paused by staff
  'silent', // the server hears no sound from this player (D3 Silent zone)
  'problem', // the player needs looking at
  'updating', // a new version is being applied
] as const;
export type ZoneState = (typeof ZONE_STATES)[number];

export type KioskSong = { title: string; artist: string };

export type KioskView = {
  venue_name?: string;
  zone_name?: string;
  state?: ZoneState;
  now?: KioskSong | null;
  next?: KioskSong | null;
  /** Venue-local opening time, "10:00". */
  opens_at?: string | null;
  theme?: 'dark' | 'light';
  screen_sleep_when_closed?: boolean;
  burn_in?: boolean;
  /** A short staff code such as "K-204"; never error text. */
  diagnostic_code?: string | null;
  saved_hours_ahead?: number;
  last_sync_at?: number | null;
  device_name?: string;
  network?: 'online' | 'offline' | 'unknown';
  version?: string;
  pins_on?: boolean;
};

export const VIEW_FIELDS = [
  'venue_name', 'zone_name', 'state', 'now', 'next', 'opens_at', 'theme', 'screen_sleep_when_closed',
  'burn_in', 'diagnostic_code', 'saved_hours_ahead', 'last_sync_at', 'device_name', 'network',
  'version', 'pins_on',
] as const;

const ALIASES: Record<string, (typeof VIEW_FIELDS)[number]> = {
  now_playing: 'now',
  up_next: 'next',
  problem_code: 'diagnostic_code',
  screen_sleep: 'screen_sleep_when_closed',
};

const MAX_TEXT = 200;
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_TEXT) : undefined;
const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** A song keeps only its title and artist. An `up_next` list gives its first song. */
function song(value: unknown): KioskSong | null | undefined {
  if (value === null) return null;
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || typeof first !== 'object') return Array.isArray(value) ? null : undefined;
  const raw = first as Record<string, unknown>;
  const title = text(raw.title);
  if (!title) return undefined;
  return { title, artist: text(raw.artist) ?? '' };
}

/** "10:00" or "9:30"; anything that isn't a plain venue-local time is dropped. */
function clock(value: unknown): string | null | undefined {
  if (value === null) return null;
  const raw = text(value);
  return raw && /^([01]?\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : undefined;
}

/** "K-204": letters, a dash and digits only, so a stack trace can never slip through. */
function code(value: unknown): string | null | undefined {
  if (value === null) return null;
  const raw = text(value);
  return raw && /^[A-Z]{1,3}-\d{1,4}$/.test(raw) ? raw : undefined;
}

/** Keep only the allowlisted kiosk fields, with checked types. Never throws. */
export function sanitiseKioskView(input: unknown): KioskView {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const name = (VIEW_FIELDS as readonly string[]).includes(key) ? key : ALIASES[key];
    if (name && !(name in raw && key !== name)) raw[name] = value;
  }
  const view: KioskView = {};
  const put = <K extends keyof KioskView>(key: K, value: KioskView[K] | undefined) => {
    if (value !== undefined) view[key] = value;
  };
  put('venue_name', text(raw.venue_name));
  put('zone_name', text(raw.zone_name));
  put('state', (ZONE_STATES as readonly unknown[]).includes(raw.state) ? (raw.state as ZoneState) : undefined);
  put('now', song(raw.now));
  put('next', song(raw.next));
  put('opens_at', clock(raw.opens_at));
  put('theme', raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : undefined);
  put('screen_sleep_when_closed', bool(raw.screen_sleep_when_closed));
  put('burn_in', bool(raw.burn_in));
  put('diagnostic_code', code(raw.diagnostic_code));
  const hours = num(raw.saved_hours_ahead);
  put('saved_hours_ahead', hours === undefined ? undefined : Math.max(0, Math.min(48, hours)));
  put('last_sync_at', raw.last_sync_at === null ? null : num(raw.last_sync_at));
  put('device_name', text(raw.device_name));
  put('network', raw.network === 'online' || raw.network === 'offline' || raw.network === 'unknown' ? raw.network : undefined);
  put('version', text(raw.version)?.slice(0, 40));
  put('pins_on', bool(raw.pins_on));
  return view;
}
