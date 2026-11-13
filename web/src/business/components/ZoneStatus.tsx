// A zone's state in words and a mark (ADR-0453 D7): used by the HQ grid, venue cards and S3.

import { Status, StatusKind } from '../../ui/controls';
import { MANAGER_COPY } from '../copy/states';
import { duration, venueTime } from '../time';
import type { Venue, Zone, ZonePlayState } from '../types';

const MARK: Record<ZonePlayState, StatusKind> = {
  playing: 'ready', paused_by_staff: 'paused', closed: 'planned', quiet_hours: 'ready', playing_saved: 'ready',
  silent: 'blocked', not_paired: 'needs-action', not_reporting: 'unavailable', plan_paused: 'unavailable',
};

/** The words a zone state reads as. Never colour alone; the mark comes with the words. */
export function zoneWords(state: ZonePlayState, zone: Zone, venue: Venue, now: number): string {
  switch (state) {
    case 'playing': return 'Playing';
    case 'paused_by_staff': return `Paused by ${zone.paused_by ?? 'staff'}${zone.state_since ? ` for ${duration(now - zone.state_since)}` : ''}`;
    case 'closed': return venue.next_open_at ? `Closed. Opens ${venueTime(venue.next_open_at, venue.time_zone)}` : 'Closed';
    case 'quiet_hours': return 'Quiet hours';
    case 'playing_saved': return 'Playing from saved music';
    case 'silent': return `Silent${zone.state_since ? ` for ${duration(now - zone.state_since)}` : ''}`;
    case 'not_paired': return 'Not paired';
    case 'not_reporting': return MANAGER_COPY.notReporting;
    case 'plan_paused': return 'Paused by plan';
  }
}

export function ZoneStatus({ state, zone, venue, now }: { state: ZonePlayState; zone: Zone; venue: Venue; now: number }) {
  return <Status kind={MARK[state]}>{zoneWords(state, zone, venue, now)}</Status>;
}

/** Song and artist, two lines each at most, full text in the accessible name and tooltip (D5). */
export function NowPlayingTile({ zone }: { zone: Zone }) {
  if (!zone.now) return null;
  const full = `${zone.now.title} by ${zone.now.artist}`;
  return <span className="biz-now" title={full} aria-label={`Now playing ${full}`}>
    <span className="biz-now-title">{zone.now.title}</span>
    <span className="biz-now-artist">{zone.now.artist}</span>
  </span>;
}
