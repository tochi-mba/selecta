// The Venues list (ADR-0453 D2, D7): every venue with its status, region, zones and licence, a
// link into S3, and Add venue for owners and admins within the trial and pilot limits.

import { useState } from 'react';
import { Dialog, Status } from '../../ui/controls';
import { DataTable } from '../../ui/DataTable';
import { showToast } from '../../ui/toasts';
import { ZoneStatus } from '../components/ZoneStatus';
import { CONSOLE_COPY } from '../copy/console';
import { PATHS, useBusiness } from '../context';
import { daysUntil, zoneRank, zoneShownState } from '../state';
import { isoDayWords } from '../time';
import type { Org, Venue } from '../types';
import { VenueForm } from '../forms/VenueForm';
import { arrangeVenues, changeBlocked } from './consoleLogic';
import { GuardedAction } from './Guarded';
import './console.css';

/** Why Add venue is not allowed for this organisation right now, or null. */
export function addVenueBlocked(org: Org, venueCount: number, now: number, offline: boolean): string | null {
  const blocked = changeBlocked({ org, now, offline });
  if (blocked) return blocked;
  if (org.role !== 'owner' && org.role !== 'admin') return CONSOLE_COPY.viewerReadOnly;
  if (org.billing.plan === 'trial' && venueCount >= 1) return CONSOLE_COPY.trialOneVenue;
  const pilot = org.pilot;
  if (pilot && pilot.status !== 'converted' && venueCount >= pilot.allowance.venues) return CONSOLE_COPY.pilotVenueLimit(pilot.allowance.venues);
  return null;
}

function worstZone(venue: Venue, now: number) {
  let worst: Venue['zones'][number] | undefined;
  for (const zone of venue.zones) {
    if (!worst || zoneRank(zoneShownState(zone, venue, now)) < zoneRank(zoneShownState(worst, venue, now))) worst = zone;
  }
  return worst;
}

function licenceCell(venue: Venue, now: number) {
  if (!venue.licence) return <Status kind="needs-action">{CONSOLE_COPY.licenceMissing}</Status>;
  const day = isoDayWords(venue.licence.expires_on);
  if (daysUntil(venue.licence.expires_on, now) < 0) return <Status kind="needs-action">{CONSOLE_COPY.licencePassed(day)}</Status>;
  return <span>{CONSOLE_COPY.licenceEnds(day)}</span>;
}

export function VenuesPage() {
  const { org, venues, now, offline, client, go, refresh } = useBusiness();
  const [adding, setAdding] = useState(false);
  const blocked = addVenueBlocked(org, venues.length, now, offline);
  const rows = arrangeVenues(venues, { sort: 'name', region: '', status: 'all', tag: '', query: '' }, now);
  const showAdd = org.role === 'owner' || org.role === 'admin';
  return <div className="biz hq">
    <div className="hq-title biz-row">
      <h1>{CONSOLE_COPY.venuesHeading}</h1>
      {showAdd && <GuardedAction reason={blocked} run={() => setAdding(true)}>{CONSOLE_COPY.addVenue}</GuardedAction>}
    </div>
    <DataTable<Venue>
      caption={CONSOLE_COPY.venuesCaption}
      rows={rows}
      rowKey={(venue) => venue.id}
      stacked="auto"
      empty={showAdd ? CONSOLE_COPY.addFirstVenue : CONSOLE_COPY.noAccess}
      onPick={(venue) => go(PATHS.venue(org.id, venue.id))}
      pickLabel={(venue) => `${CONSOLE_COPY.openVenue} ${venue.name}`}
      columns={[
        { key: 'name', label: CONSOLE_COPY.venueColumn, render: (venue) => venue.name },
        { key: 'status', label: CONSOLE_COPY.venueStatus, render: (venue) => {
          const zone = worstZone(venue, now);
          return zone ? <ZoneStatus state={zoneShownState(zone, venue, now)} zone={zone} venue={venue} now={now} /> : CONSOLE_COPY.noZone;
        } },
        { key: 'region', label: CONSOLE_COPY.regionLabel, render: (venue) => venue.region ?? '' },
        { key: 'zones', label: CONSOLE_COPY.zonesColumn, numeric: true, render: (venue) => String(venue.zones.length) },
        { key: 'licence', label: CONSOLE_COPY.licenceColumn, render: (venue) => licenceCell(venue, now) },
      ]}
    />
    {adding && <Dialog title={CONSOLE_COPY.addVenueTitle} onClose={() => setAdding(false)}>
      <VenueForm disabled={blocked} onSave={async (body) => {
        const venue = await client.createVenue(org.id, body);
        setAdding(false);
        showToast(CONSOLE_COPY.venueAdded(venue?.name ?? body.name));
        await refresh();
        if (venue?.id) go(PATHS.venue(org.id, venue.id));
      }} />
    </Dialog>}
  </div>;
}
