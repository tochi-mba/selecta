// The venue's 90-day activity log (ADR-0452 BZ-0452-12): skips, steers, volume changes and
// approved requests, newest first, read from `GET /api/business/venues/{id}/activity`. Without
// the typed routes (the e2e harness) it shows the overview's activity lines for this venue.

import { useBusiness } from '../context';
import { VENUE_COPY } from '../copy/venue';
import type { ActivityEntry } from '../types';
import { useLoad } from './useVenue';

export function VenueActivity({ venueId }: { venueId: string }) {
  const { bizApi, activity } = useBusiness();
  const lines = useLoad<ActivityEntry[]>(
    async () => (bizApi ? bizApi.venueActivity(venueId) : activity.filter((item) => item.venue_id === venueId)),
    [bizApi, venueId],
  );
  return <section className="biz-card"><h2>{VENUE_COPY.playLogHeading}</h2>
    <h3>{VENUE_COPY.activityHeading}</h3>
    <p className="biz-quiet">{VENUE_COPY.activityIntro}</p>
    {lines.loading && !lines.data && <p role="status">{VENUE_COPY.activityLoading}</p>}
    {Boolean(lines.error) && <p role="alert">{VENUE_COPY.activityFailed} <button type="button" onClick={() => { void lines.reload(); }}>{VENUE_COPY.activityRetry}</button></p>}
    {lines.data && !lines.data.length && <p>{VENUE_COPY.activityEmpty}</p>}
    {Boolean(lines.data?.length) && <ul>{lines.data!.map((item) => <li key={item.id} data-lift="row">
      <time dateTime={new Date(item.at * 1000).toISOString()}>{new Date(item.at * 1000).toLocaleString()}</time>: {item.words}
    </li>)}</ul>}
  </section>;
}
