// What one zone shows in the HQ grid and on a phone card (D7): its name, its state as a mark plus
// words (stale health reads Not reporting, closed wins over device problems), the song when it
// plays, and while offline the time this state was last known.

import { Status } from '../../ui/controls';
import { NowPlayingTile, ZoneStatus } from '../components/ZoneStatus';
import { CONSOLE_COPY } from '../copy/console';
import { zoneShownState } from '../state';
import { venueTime } from '../time';
import type { Venue, Zone } from '../types';
import { needsYou } from './consoleLogic';

const SHOWS_SONG = new Set(['playing', 'playing_saved', 'quiet_hours']);

export function ZoneCellBody({ zone, venue, now, offline, updatedAt }: { zone: Zone; venue: Venue; now: number; offline?: boolean; updatedAt?: number | null }) {
  const state = zoneShownState(zone, venue, now);
  const asOf = venue.health_at ?? updatedAt ?? null;
  return <div className="hq-zone" data-zone-state={state}>
    <span className="hq-zone-name biz-clamp" title={zone.name}>{zone.name}</span>
    <ZoneStatus state={state} zone={zone} venue={venue} now={now} />
    {SHOWS_SONG.has(state) && <NowPlayingTile zone={zone} />}
    {offline && asOf != null && <span className="biz-quiet hq-as-of">{CONSOLE_COPY.asOf(venueTime(asOf, venue.time_zone))}</span>}
  </div>;
}

export function NeedsYouMark({ venue, now }: { venue: Venue; now: number }) {
  if (!needsYou(venue, now)) return null;
  return <span className="hq-needs-you"><Status kind="needs-action">{CONSOLE_COPY.statusWords.needs_you}</Status></span>;
}
