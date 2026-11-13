// Times in the venue's own time zone (ADR-0453 D7, D15): every time a manager reads is venue
// time, with the zone abbreviation added when it differs from the reader's.

const viewerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function zoneName(epochSeconds: number, timeZone: string) {
  const part = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' }).formatToParts(new Date(epochSeconds * 1000)).find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

/** "14:32", or "14:32 EST" when the venue is in another zone from the reader. */
export function venueTime(epochSeconds: number, timeZone: string, reader = viewerZone()): string {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(epochSeconds * 1000));
  if (sameOffset(epochSeconds, timeZone, reader)) return time;
  return `${time} ${zoneName(epochSeconds, timeZone)}`;
}

function sameOffset(epochSeconds: number, a: string, b: string) {
  const fmt = (zone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', day: '2-digit', hourCycle: 'h23' }).format(new Date(epochSeconds * 1000));
  try { return fmt(a) === fmt(b); } catch { return false; }
}

/** "3 December" in the venue's zone (or the reader's when none). */
export function dayWords(epochSeconds: number, timeZone = viewerZone()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'long' }).format(new Date(epochSeconds * 1000));
}

/** "3 December" from an ISO date, without moving it across zones. */
export function isoDayWords(isoDate: string): string {
  return dayWords(Date.parse(`${isoDate}T12:00:00Z`) / 1000, 'UTC');
}

/** "Sat 10:00" in venue time. */
export function weekdayTime(epochSeconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(epochSeconds * 1000));
}

/** Minutes after midnight as "18:00"; values past 1440 are the next day ("02:00 next day"). */
export function clock(minutes: number, nextDayWords = true): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const text = `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
  return minutes >= 1440 && nextDayWords ? `${text} next day` : text;
}

/** "2 minutes", "1 hour 5 minutes". */
export function duration(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${rest} minute${rest === 1 ? '' : 's'}` : ''}`;
}

/** Money in the organisation's currency, from minor units. */
export function money(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
}
