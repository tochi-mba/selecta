// Now and Next for the chosen zone (ADR-0453 D10), and the S4 zone cards: silent ("Terrace is
// silent. Check the player is on", with Play here when this tablet can be a speaker) and plan
// locked ("Terrace isn't playing today", no plan words). Skeleton while the state is unknown.

import { Skeleton, Status } from '../../ui/controls';
import { STAFF_COPY, notTodayWords, pausedByWords, silentWords } from '../copy/staff';
import { NowPlayingTile, ZoneStatus } from '../components/ZoneStatus';
import { zoneShownState } from '../state';
import type { Venue, Zone } from '../types';
import { BigAction } from './BigAction';
import './staff.css';

export type ZoneLook = 'normal' | 'silent' | 'not_today';

export function zoneLook(zone: Zone, venue: Venue, now: number): ZoneLook {
  if (!zone.paid) return 'not_today';
  const shown = zoneShownState(zone, venue, now);
  if (venue.open_now && (shown === 'silent' || shown === 'not_paired')) return 'silent';
  return 'normal';
}

export function NowSkeleton() {
  return <section className="biz-staff-now" aria-label={STAFF_COPY.now} aria-busy="true"><Skeleton lines={3} label={STAFF_COPY.loading} /></section>;
}

export function StaffNow({ zone, venue, now, paused, pausedBy, onPlayHere }: {
  zone: Zone; venue: Venue; now: number; paused: boolean; pausedBy: string; onPlayHere?: (() => Promise<unknown>) | null;
}) {
  const look = zoneLook(zone, venue, now);
  if (look === 'not_today') {
    return <section className="biz-staff-card" aria-label={STAFF_COPY.now}><p>{notTodayWords(zone.name)}</p></section>;
  }
  if (look === 'silent') {
    return (
      <section className="biz-staff-card biz-staff-silent" aria-label={STAFF_COPY.now}>
        <p>{silentWords(zone.name)}</p>
        {onPlayHere && <BigAction run={onPlayHere}>{STAFF_COPY.playHere}</BigAction>}
      </section>
    );
  }
  const state = paused ? 'paused_by_staff' : zoneShownState(zone, venue, now);
  const progress = Math.round(Math.max(0, Math.min(1, zone.progress ?? 0)) * 100);
  return (
    <section className="biz-staff-now" aria-labelledby={`now-${zone.id}`}>
      <h2 id={`now-${zone.id}`}>{STAFF_COPY.now}</h2>
      {zone.now ? <NowPlayingTile zone={zone} /> : <p className="biz-quiet">{STAFF_COPY.nothingNow}</p>}
      {zone.now && <progress className="biz-staff-progress" max={100} value={progress} aria-label={STAFF_COPY.progress} />}
      <p className="biz-staff-line">
        {paused ? <Status kind="paused">{pausedByWords(pausedBy)}</Status> : <ZoneStatus state={state} zone={zone} venue={venue} now={now} />}
      </p>
      <p className="biz-staff-next">
        <strong>{STAFF_COPY.next}: </strong>
        {zone.next ? `${zone.next.title} by ${zone.next.artist}` : STAFF_COPY.nothingNext}
      </p>
    </section>
  );
}
