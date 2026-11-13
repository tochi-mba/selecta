import { useEffect, useState } from 'react';
import { PATHS, useBusiness } from '../context';
import type { ZoneSchedule } from '../types';

export function SchedulesPage() {
  const { org, venues, client, go } = useBusiness();
  const [schedules, setSchedules] = useState<Record<string, ZoneSchedule>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all(venues.flatMap((venue) => venue.zones.map(async (zone) => {
      const schedule = await client.schedule(zone.id);
      return [zone.id, schedule] as const;
    }))).then((rows) => {
      if (live) { setSchedules(Object.fromEntries(rows)); setError(''); }
    }).catch(() => { if (live) setError("Schedules couldn't be loaded. Try again."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [venues, client]);
  return <section className="biz biz-stack">
    <h1>Schedules</h1>
    <p className="biz-quiet">Review what each zone plays throughout the day. Open a venue to edit its schedule.</p>
    {loading && <p role="status">Loading schedules</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !venues.length && <p>No venues yet. Add a venue to set its music schedule.</p>}
    {venues.map((venue) => <section key={venue.id} className="biz-card">
      <h2>{venue.name}</h2>
      {!venue.zones.length && <p>No zones yet</p>}
      <ul>{venue.zones.map((zone) => <li key={zone.id}>
        <strong>{zone.name}</strong>: {schedules[zone.id] ? schedules[zone.id].dayparts.map((part) => part.name).join(', ') || 'No blocks set' : loading ? 'Loading' : 'Unavailable'}
      </li>)}</ul>
      <button type="button" onClick={() => go(PATHS.venue(org.id, venue.id, 'schedule'))}>Open venue schedule</button>
    </section>)}
  </section>;
}
