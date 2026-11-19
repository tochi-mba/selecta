// Pure translations between the business pages' view models (types.ts) and the wire shapes the
// server routes speak. client.ts calls the routes; this file only reshapes, so each mapping is
// tested on its own (clientAdapters.test.ts). Where the server has no field for something the
// page shows, the mapping says so in a comment rather than inventing it.

import type { ContentRules, Daypart, Holiday, Member, Role, WeekHours, ZoneSchedule } from './types';

const DAYS: (keyof WeekHours)[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Minutes after midnight as HH:MM; overnight closes (past 1440) wrap to the next day. */
export function clockOf(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

export function minutesOf(clock: string): number {
  const [hours, minutes] = clock.split(':').map((part) => Number(part));
  return (hours || 0) * 60 + (minutes || 0);
}

/** WeekHours as `PUT /business/venues/{id}/hours` periods (weekday 0 is Monday). */
export function hoursBody(hours: WeekHours) {
  const periods = DAYS.flatMap((day, weekday) => (hours[day] ?? []).map((span) => ({
    weekday, opens: clockOf(span.open), closes: clockOf(span.close), all_day: span.open === 0 && span.close >= 1440,
  })));
  return { periods };
}

/** One holiday as a `POST /business/venues/{id}/hour-exceptions` body. */
export function exceptionBody(holiday: Holiday) {
  return {
    date: holiday.date,
    closed: holiday.closed,
    periods: holiday.closed ? [] : (holiday.spans ?? []).map((span) => [clockOf(span.open), clockOf(span.close)]),
    note: holiday.label ?? '',
  };
}

export type ServerPerson = { id: string; name: string | null; email: string; role: Role; venue_ids: string[] | null; pin_set?: boolean };
export type ServerInvite = { id: string; email: string; role: Role; venue_ids: string[] | null; created_at: number; expires_at: number };
export type PeopleAnswer = { people: ServerPerson[]; invitations: ServerInvite[]; seats: { included: number; paid: number; held: number } };

export function membersOf(answer: PeopleAnswer): Member[] {
  return (answer.people ?? []).map((person) => ({
    id: person.id, name: person.name || person.email, email: person.email, role: person.role,
    venue_ids: person.venue_ids, pin_set: person.pin_set,
  }));
}

const ENERGY_WORD: Record<Daypart['energy'], number> = { calm: 25, steady: 50, lifted: 70, peak: 90 };

/** The daypart word nearest a 0 to 100 energy level. */
export function energyWord(level: unknown): Daypart['energy'] {
  const value = typeof level === 'number' ? level : 50;
  return (Object.entries(ENERGY_WORD) as [Daypart['energy'], number][])
    .reduce((best, item) => (Math.abs(item[1] - value) < Math.abs(best[1] - value) ? item : best))[0];
}

type Block = { start: string; name: string; crates?: string[]; energy?: number | null };
export type ProgrammeAnswer = { version_id: string | null; created_by?: string | null; created_at?: number | null; programme: { weekly: Record<string, Block[]>; replacements?: Record<string, Block[]> } };

/** A zone's weekly programme as the page's one-day schedule (Monday's blocks; the page edits
 * one day and saves it to every weekday). `version` is the programme version's time, which the
 * apply route compares to spot someone else's change. */
export function scheduleOf(zoneId: string, answer: ProgrammeAnswer): ZoneSchedule {
  const weekly = answer.programme?.weekly ?? {};
  const blocks = weekly['0'] ?? Object.values(weekly)[0] ?? [];
  const starts = blocks.map((block) => minutesOf(block.start));
  return {
    zone_id: zoneId,
    version: answer.created_at ?? 0,
    updated_by: answer.created_by ?? null,
    updated_at: answer.created_at ?? null,
    dayparts: blocks.map((block, index) => ({
      id: String(index), name: block.name, start: starts[index], end: starts[index + 1] ?? 1440,
      energy: energyWord(block.energy), crate_ids: block.crates ?? [],
    })),
  };
}

/** The page's dayparts as a weekly programme body: the same blocks every weekday. */
export function programmeBody(dayparts: Daypart[]) {
  const blocks = [...dayparts].sort((a, b) => a.start - b.start).map((part) => ({
    start: clockOf(part.start), name: part.name, crates: part.crate_ids ?? [], energy: ENERGY_WORD[part.energy],
  }));
  return { weekly: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((day) => [String(day), blocks])), replacements: {} };
}

/** The apply route takes dayparts as minutes; the page's dayparts already are. */
export function applyParts(dayparts: Daypart[]) {
  return dayparts.map(({ name, start, end, energy, crate_ids }) => ({ name, start, end, energy, crate_ids: crate_ids ?? [] }));
}

type RuleValues = { filter_mode?: 'off' | 'no_explicit' | 'clean_only' | null; crate_ids?: string[] | null; bpm_min?: number | null; bpm_max?: number | null; energy_max?: number | null };
export type VenueRulesAnswer = {
  venue: RuleValues | null;
  zones: Record<string, { rules: RuleValues | null; dayparts?: unknown[] }>;
  volume: Record<string, { cap: number; quiet_hours: { start: string; end: string; cap: number }[] }>;
  version?: number;
};
export type BlockEntry = { id: string; kind: string; value: string; label: string; scope: string; scope_id: string };

/** Venue rules plus the organisation blocklist as the page's ContentRules. The server has no
 * "explicit blocked by day only" mode, so it never comes back as `block_daytime`. */
export function rulesOf(answer: VenueRulesAnswer, entries: BlockEntry[], venueId: string): ContentRules {
  const mode = answer.venue?.filter_mode;
  const volume = answer.volume ?? {};
  return {
    explicit: mode === 'off' ? 'allow' : 'block',
    blocklist: entries
      .filter((entry) => (entry.kind === 'song' || entry.kind === 'artist') && (entry.scope === 'organisation' || (entry.scope === 'venue' && entry.scope_id === venueId)))
      .map((entry) => ({ kind: entry.kind as 'song' | 'artist', id: entry.value, label: entry.label })),
    allowed_crates: Object.entries(answer.zones ?? {})
      .filter(([, zone]) => zone.rules?.crate_ids?.length)
      .map(([zoneId, zone]) => ({ zone_id: zoneId, daypart_id: null, crate_ids: zone.rules!.crate_ids ?? [] })),
    brand: { bpm_min: answer.venue?.bpm_min ?? null, bpm_max: answer.venue?.bpm_max ?? null, energy_max: answer.venue?.energy_max ?? null },
    volume_caps: Object.fromEntries(Object.entries(volume).map(([zoneId, item]) => [zoneId, Math.round(item.cap * 100)])),
    quiet_hours: Object.entries(volume).flatMap(([zoneId, item]) => (item.quiet_hours ?? []).map((quiet) => ({
      zone_id: zoneId, start: minutesOf(quiet.start), end: minutesOf(quiet.end), cap: Math.round(quiet.cap * 100),
    }))),
  };
}

/** ContentRules as a `PUT /business/venues/{id}/content/rules` body. `block_daytime` saves as
 * `no_explicit` (the stricter rule) because the server has no daytime-only mode. */
export function rulesBody(rules: ContentRules, zoneIds: string[]) {
  const crates = new Map(rules.allowed_crates.filter((item) => !item.daypart_id).map((item) => [item.zone_id, item.crate_ids]));
  const zones = Object.fromEntries(zoneIds.map((zoneId) => [zoneId, crates.get(zoneId)?.length ? { crate_ids: crates.get(zoneId) } : {}]));
  const capped = new Set([...Object.keys(rules.volume_caps), ...rules.quiet_hours.map((quiet) => quiet.zone_id)]);
  const volume = Object.fromEntries([...capped].filter((zoneId) => zoneIds.includes(zoneId)).map((zoneId) => [zoneId, {
    cap: Math.min(1, Math.max(0, (rules.volume_caps[zoneId] ?? 100) / 100)),
    quiet_hours: rules.quiet_hours.filter((quiet) => quiet.zone_id === zoneId).map((quiet) => ({
      start: clockOf(quiet.start), end: clockOf(quiet.end), cap: Math.min(1, Math.max(0, quiet.cap / 100)),
    })),
  }]));
  const brand = rules.brand ?? {};
  return {
    venue: { filter_mode: rules.explicit === 'allow' ? 'off' : 'no_explicit', bpm_min: brand.bpm_min ?? null, bpm_max: brand.bpm_max ?? null, energy_max: brand.energy_max ?? null },
    zones,
    volume,
  };
}

/** Which blocklist entries to add and which to remove, comparing the page's list to the server's. */
export function blocklistDiff(wanted: ContentRules['blocklist'], current: BlockEntry[], venueId: string) {
  const mine = current.filter((entry) => entry.scope === 'venue' && entry.scope_id === venueId);
  const key = (kind: string, value: string) => `${kind}:${value}`;
  const have = new Map(mine.map((entry) => [key(entry.kind, entry.value), entry]));
  const orgWide = new Set(current.filter((entry) => entry.scope === 'organisation').map((entry) => key(entry.kind, entry.value)));
  const want = new Set(wanted.map((item) => key(item.kind, item.id)));
  return {
    add: wanted.filter((item) => !have.has(key(item.kind, item.id)) && !orgWide.has(key(item.kind, item.id)))
      .map((item) => ({ kind: item.kind, value: item.id, label: item.label, scope: 'venue', scope_id: venueId })),
    remove: mine.filter((entry) => !want.has(key(entry.kind, entry.value))).map((entry) => entry.id),
  };
}
