// S3 Now (ADR-0453 D8): each zone with what is playing, what is next, the volume at its cap,
// requests waiting, and the venue's stay-open-late button within its allowance.

import { useEffect, useRef } from 'react';
import { idempotencyKey } from '../../cloud/api';
import { Action, announce } from '../../ui/controls';
import { showToast } from '../../ui/toasts';
import { ManagerNotice } from '../components/Notices';
import { NowPlayingTile, ZoneStatus } from '../components/ZoneStatus';
import { PATHS, useBusiness } from '../context';
import { VENUE_COPY } from '../copy/venue';
import { VolumeLimitSlider } from '../staff/VolumeLimitSlider';
import { zoneShownState } from '../state';
import { venueTime } from '../time';
import type { Venue, Zone } from '../types';

const ANNOUNCE_EVERY_S = 30;

/** Polite now-playing announcements, at most once every 30 seconds per zone (D5). */
function useNowAnnouncements(zones: Zone[], now: number) {
  const said = useRef(new Map<string, { song: string; at: number }>());
  useEffect(() => {
    for (const zone of zones) {
      if (!zone.now) continue;
      const song = `${zone.now.title} by ${zone.now.artist}`;
      const last = said.current.get(zone.id);
      if (!last) { said.current.set(zone.id, { song, at: now }); continue; }
      if (last.song === song || now - last.at < ANNOUNCE_EVERY_S) continue;
      said.current.set(zone.id, { song, at: now });
      announce(`${zone.name}: now playing ${song}`);
    }
  }, [zones, now]);
}

export function StayOpenLate({ venue, disabled }: { venue: Venue; disabled: string | null }) {
  const { client, org, now, refresh } = useBusiness();
  const late = venue.stay_open_late;
  const allowance = late?.allowance_minutes ?? 0;
  if (late?.until != null && late.until > now) return <p className="biz-quiet" role="status">{VENUE_COPY.stayLateOn(venueTime(late.until, venue.time_zone))}</p>;
  if (!allowance || venue.next_close_at == null) return <p className="biz-quiet">{VENUE_COPY.stayLateNone}</p>;
  const until = venue.next_close_at + allowance * 60;
  const reason = disabled ?? (!venue.open_now ? VENUE_COPY.stayLateClosed : null);
  return <div className="biz-row">
    <Action className="primary" disabled={reason != null} aria-describedby={reason ? `stay-late-why-${venue.id}` : undefined} run={async () => {
      await client.stayOpenLate(org.id, venue.id, allowance);
      showToast(VENUE_COPY.stayLateOn(venueTime(until, venue.time_zone)));
      await refresh();
    }}>{VENUE_COPY.stayLate(venueTime(until, venue.time_zone))}</Action>
    {reason && <span className="biz-quiet" id={`stay-late-why-${venue.id}`}>{reason}</span>}
  </div>;
}

export function ZoneCard({ venue, zone, disabled }: { venue: Venue; zone: Zone; disabled: string | null }) {
  const { client, now, org, go } = useBusiness();
  const shown = zoneShownState(zone, venue, now);
  const cap = zone.volume_cap ?? 100;
  const paidCount = venue.zones.filter((item) => item.paid).length;
  return <article className="biz-card venue-zone" aria-labelledby={`zone-${zone.id}`}>
    <h3 id={`zone-${zone.id}`} className="biz-clamp" title={zone.name}>{zone.name}</h3>
    <ZoneStatus state={shown} zone={zone} venue={venue} now={now} />
    {!zone.paid && <ManagerNotice kind="unavailable" action={org.role === 'owner' ? <button className="biz-button" onClick={() => go(PATHS.section(org.id, 'billing'))}>{VENUE_COPY.addZone}</button> : undefined}>{VENUE_COPY.planPaused(zone.name, paidCount)}</ManagerNotice>}
    <dl className="venue-facts">
      <div><dt>{VENUE_COPY.nowPlaying}</dt><dd>{zone.now ? <NowPlayingTile zone={zone} /> : <span className="biz-quiet">{VENUE_COPY.nothingPlaying}</span>}</dd></div>
      {zone.next && <div><dt>{VENUE_COPY.next}</dt><dd><span className="biz-clamp" title={`${zone.next.title} by ${zone.next.artist}`}>{zone.next.title} <span className="biz-quiet">{zone.next.artist}</span></span></dd></div>}
    </dl>
    <VolumeLimitSlider label={VENUE_COPY.volume(zone.name)} value={Math.min(zone.volume ?? 0, cap)} cap={cap} disabled={disabled}
      onChange={(level) => { void client.command(zone.id, { kind: 'volume', level: Math.min(level, cap) }, idempotencyKey()); }} />
    <p className="biz-quiet">{VENUE_COPY.capNote(cap)}</p>
    <p>{VENUE_COPY.requestsWaiting(zone.requests_waiting ?? 0)}</p>
  </article>;
}

export function NowTab({ venue, disabled }: { venue: Venue; disabled: string | null }) {
  const { now } = useBusiness();
  useNowAnnouncements(venue.zones, now);
  if (!venue.zones.length) return <div className="biz-card"><p>{VENUE_COPY.noZones}</p></div>;
  return <div className="biz-stack">
    <h2>{VENUE_COPY.zonesHeading}</h2>
    <div className="venue-zones">{venue.zones.map((zone) => <ZoneCard key={zone.id} venue={venue} zone={zone} disabled={disabled} />)}</div>
    <StayOpenLate venue={venue} disabled={disabled} />
  </div>;
}
