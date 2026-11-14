/** Venue policy is evaluated on the speaker device, even during temporary internet loss.
 * These cached policy facts cannot authorise expired rights, unknown metadata or missing music.
 * Local instants are resolved with Intl; UTC is never treated as the venue's local day.
 */
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type OpeningWindow = { day: Weekday; startMinute: number; endMinute: number };
export type Daypart = { startMinute: number; endMinute: number; allowExplicit: boolean; blockedArtists?: readonly string[] };
export type VenuePolicy = {
  timezone: string;
  rightsAttested: boolean;
  rightsUntilEpochMs: number | null;
  revision: string;
  allowExplicit: boolean;
  blockedArtists: readonly string[];
  openings: readonly OpeningWindow[];
  dayparts: readonly Daypart[];
};
export type RecordingPolicyFacts = {
  id: string;
  artist: string;
  explicit: boolean | null;
  locallyAuthorised: boolean;
  exactRevisionVerified: boolean;
  blocked: boolean;
};

const DAYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const stamp = (time: number, timezone: string) => {
  const fields = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(time);
  const part = (name: string) => fields.find((field) => field.type === name)?.value ?? '';
  const day = part('weekday').toLowerCase().slice(0, 3) as Weekday;
  const index = DAYS.indexOf(day);
  if (index < 0) throw new Error('Invalid local day');
  return { index, minute: Number(part('hour')) * 60 + Number(part('minute')) };
};
const minuteOk = (value: number) => Number.isInteger(value) && value >= 0 && value <= 2880;

export function venueOpen(policy: VenuePolicy, epochMs: number): boolean {
  const local = stamp(epochMs, policy.timezone);
  return policy.openings.some(({ day, startMinute, endMinute }) => {
    if (!minuteOk(startMinute) || !minuteOk(endMinute) || endMinute <= startMinute) return false;
    const index = DAYS.indexOf(day);
    if (index < 0) return false;
    const minute = local.minute + (index === local.index ? 0 : (index + 1) % 7 === local.index ? 1440 : -99999);
    return minute >= startMinute && minute < endMinute;
  });
}

function daypartActive(part: Daypart, minute: number): boolean {
  if (!minuteOk(part.startMinute) || !minuteOk(part.endMinute)) return false;
  const end = part.endMinute;
  return end > part.startMinute
    ? minute >= part.startMinute && minute < end
    : minute >= part.startMinute || minute < end;
}

export function recordingAllowed(
  policy: VenuePolicy, recording: RecordingPolicyFacts, epochMs: number,
  options: { requireOpen?: boolean } = {},
): boolean {
  if (!policy.rightsAttested || !policy.revision || (policy.rightsUntilEpochMs !== null && epochMs >= policy.rightsUntilEpochMs)
    || !recording.id || !recording.locallyAuthorised || !recording.exactRevisionVerified
    || recording.explicit === null || recording.blocked) return false;
  if (options.requireOpen !== false && !venueOpen(policy, epochMs)) return false;
  const { minute } = stamp(epochMs, policy.timezone);
  const parts = policy.dayparts.filter((part) => daypartActive(part, minute));
  if (recording.explicit && (!policy.allowExplicit || parts.some((part) => !part.allowExplicit))) return false;
  const artist = recording.artist.trim().toLocaleLowerCase();
  return ![...policy.blockedArtists, ...parts.flatMap((part) => part.blockedArtists ?? [])]
    .some((blocked) => blocked.trim().toLocaleLowerCase() === artist);
}

export function publicRoomCatalogue(
  policy: VenuePolicy, recordings: readonly (RecordingPolicyFacts & { title: string })[], epochMs: number,
): { id: string; title: string; artist: string }[] {
  // Only opaque canonical metadata IDs; reject paths, URLs and control characters.
  const safeId = /^[A-Za-z0-9_-]{1,64}$/;
  const privateValue = /(?:[\\/]|https?:|file:|r2:|s3:|[\x00-\x1f\x7f])/i;
  return recordings.filter((rec) => recordingAllowed(policy, rec, epochMs) && safeId.test(rec.id)
    && rec.title.length > 0 && rec.title.length <= 160 && rec.artist.length <= 160
    && !privateValue.test(rec.title) && !privateValue.test(rec.artist))
    .map(({ id, title, artist }) => ({ id, title, artist }));
}
