// A venue on a phone (D7): its name, the Needs you mark, every zone's state, and Open venue.

import { CONSOLE_COPY } from '../copy/console';
import type { Venue } from '../types';
import { NeedsYouMark, ZoneCellBody } from './ZoneCell';
import './console.css';

export function VenueHealthCard({ venue, now, offline, updatedAt, onOpen }: { venue: Venue; now: number; offline?: boolean; updatedAt?: number | null; onOpen?: (venueId: string) => void }) {
  const titleId = `hq-card-${venue.id}`;
  return <article className="biz-card hq-card" aria-labelledby={titleId} data-venue={venue.id}>
    <div className="hq-card-head">
      <h3 id={titleId} className="biz-clamp" title={venue.name}>{venue.name}</h3>
      <NeedsYouMark venue={venue} now={now} />
    </div>
    {venue.region && <p className="biz-quiet">{venue.region}</p>}
    <ul className="hq-card-zones">
      {venue.zones.map((zone) => <li key={zone.id}><ZoneCellBody zone={zone} venue={venue} now={now} offline={offline} updatedAt={updatedAt} /></li>)}
    </ul>
    {onOpen && <button type="button" className="hq-card-open" onClick={() => onOpen(venue.id)} aria-label={`${CONSOLE_COPY.openVenue} ${venue.name}`}>{CONSOLE_COPY.openVenue}</button>}
  </article>;
}
