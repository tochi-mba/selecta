// Manager-only notices (ADR-0453 D3, D4, D7, D8): ManagerNotice, the two state banners, the
// Needs attention list, the silent-zone alert and the pilot badge. Customer-facing bundles never
// import this file (customerSeparation.test.ts).

import { ReactNode, useEffect, useRef } from 'react';
import { announce, Status, StatusKind } from '../../ui/controls';
import { groupWords, stateWords, StateContext } from '../copy/states';
import type { BusinessState, StateKind } from '../state';
import { dayWords, duration } from '../time';
import type { Pilot, Venue } from '../types';

const KIND_STATUS: Record<StateKind, StatusKind> = {
  silent_zone: 'blocked', long_pause: 'paused', licence_expired: 'needs-action', payment_grace_final: 'needs-action',
  pilot_ended: 'needs-action', offline: 'unavailable', licence_expiring: 'warning', payment_grace: 'warning',
  pilot_ending: 'warning', over_seats: 'needs-action', degraded: 'recovering', plan_locked: 'unavailable',
};

const KIND_LABEL: Record<StateKind, string> = {
  silent_zone: 'Silent', long_pause: 'Paused', licence_expired: 'Needs you', payment_grace_final: 'Needs you',
  pilot_ended: 'Pilot ended', offline: 'Offline', licence_expiring: 'Licence', payment_grace: 'Payment',
  pilot_ending: 'Pilot', over_seats: 'Seats', degraded: 'Slower', plan_locked: 'Plan',
};

/** The one component every manager-only notice uses (D4). `tone` picks the mark, never colour alone. */
export function ManagerNotice({ kind = 'warning', children, action, line = false }: { kind?: StatusKind; children: ReactNode; action?: ReactNode; line?: boolean }) {
  if (line) return <p className="biz-manager-line" data-manager-notice=""><Status kind={kind}>Note</Status> <span>{children}</span>{action}</p>;
  return <div className="biz-notice" data-manager-notice="" role="status"><Status kind={kind} /><p>{children}</p>{action && <div className="biz-notice-actions">{action}</div>}</div>;
}

/** Up to two banners, highest severity first (D3). */
export function StateBanners({ banners, ctx, actions }: { banners: BusinessState[]; ctx: StateContext; actions?: (state: BusinessState) => ReactNode }) {
  if (!banners.length) return null;
  return <div className="biz-banners">
    {banners.filter((state) => state.kind !== 'silent_zone').map((state) => (
      <ManagerNotice key={state.key} kind={KIND_STATUS[state.kind]} action={actions?.(state)}>{stateWords(state, ctx)}</ManagerNotice>
    ))}
  </div>;
}

/** Everything below the top two, grouped by kind once a kind has more than three entries. */
export function NeedsAttentionList({ items, ctx, loading, actions, headingLevel = 2 }: { items: BusinessState[]; ctx: StateContext; loading?: boolean; actions?: (state: BusinessState) => ReactNode; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const groups = new Map<StateKind, BusinessState[]>();
  for (const item of items) groups.set(item.kind, [...(groups.get(item.kind) ?? []), item]);
  return <aside className="biz-attention" aria-labelledby="biz-attention-title">
    <Heading id="biz-attention-title">Needs attention</Heading>
    {loading ? <p className="biz-quiet">Checking venues</p> : !items.length ? <p className="biz-quiet">Nothing needs you right now.</p> : (
      <ul>
        {[...groups.entries()].map(([kind, list]) => list.length > 3 ? (
          <li key={kind}><details><summary><Status kind={KIND_STATUS[kind]}>{KIND_LABEL[kind]}</Status> {groupWords(kind, list.length)}</summary>
            <ul>{list.map((item) => <li key={item.key}>{stateWords(item, ctx)}{actions?.(item)}</li>)}</ul></details></li>
        ) : list.map((item) => (
          <li key={item.key}><Status kind={KIND_STATUS[kind]}>{KIND_LABEL[kind]}</Status> <span>{stateWords(item, ctx)}</span>{actions?.(item)}</li>
        )))}
      </ul>
    )}
  </aside>;
}

/** Silent zones at the top of S2 and S3 (D7, D8). Never pulses; announced assertively once per
 * new silent zone; clears itself when the zone is no longer in the list. */
export function SilentZoneAlert({ silent, venues, now, scope, onOpenVenue, steps }: {
  silent: BusinessState[]; venues: Venue[]; now: number; scope: 'hq' | 'venue';
  onOpenVenue?: (venueId: string) => void; steps?: (zoneName: string) => ReactNode;
}) {
  const told = useRef(new Set<string>());
  useEffect(() => {
    for (const state of silent) {
      if (told.current.has(state.key)) continue;
      told.current.add(state.key);
      const venue = venues.find((item) => item.id === state.venue_id);
      const zone = venue?.zones.find((item) => item.id === state.zone_id);
      announceAssertive(`${zone?.name ?? 'A zone'}${venue && scope === 'hq' ? ` at ${venue.name}` : ''} is silent`);
    }
  }, [silent, venues, scope]);
  if (!silent.length) return null;
  return <section className="biz-silent" aria-labelledby="biz-silent-title">
    <h2 id="biz-silent-title"><Status kind="blocked">Silent</Status> {silent.length === 1 ? 'A zone is silent' : `${silent.length} zones are silent`}</h2>
    <ul>{silent.map((state) => {
      const venue = venues.find((item) => item.id === state.venue_id);
      const zone = venue?.zones.find((item) => item.id === state.zone_id);
      return <li key={state.key}>
        <p><strong>{zone?.name}{scope === 'hq' && venue ? ` at ${venue.name}` : ''}</strong> has been silent for {duration(now - (state.since ?? now))}.{zone?.last_report ? ` Last report: ${zone.last_report}.` : ''}</p>
        {steps && zone && steps(zone.name)}
        <div className="biz-row">
          {scope === 'hq' && venue && onOpenVenue && <button onClick={() => onOpenVenue(venue.id)}>Open venue</button>}
          {venue?.phone && <a className="biz-button" href={`tel:${venue.phone.replace(/\s+/g, '')}`}>Call venue</a>}
        </div>
      </li>;
    })}</ul>
  </section>;
}

/** The single assertive announcement allowed on business pages (D5). */
export function announceAssertive(words: string) {
  const region = document.getElementById('biz-assertive');
  if (region) { region.textContent = ''; window.setTimeout(() => { region.textContent = words; }, 30); }
  else announce(words);
}

export function AssertiveRegion() {
  return <div id="biz-assertive" className="visually-hidden" role="alert" aria-live="assertive" aria-atomic="true" />;
}

export function PilotBadge({ pilot, now }: { pilot?: Pilot | null; now: number }) {
  if (!pilot || pilot.status === 'converted') return null;
  const ended = pilot.status === 'ended' || pilot.ends_at <= now;
  return <span className="biz-pilot-badge" data-pilot-badge=""><Status kind={ended ? 'needs-action' : 'planned'}>{ended ? 'Pilot ended' : `Pilot until ${dayWords(pilot.ends_at)}`}</Status></span>;
}

export function kindStatus(kind: StateKind): StatusKind { return KIND_STATUS[kind]; }
