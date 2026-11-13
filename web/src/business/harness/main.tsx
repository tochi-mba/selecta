// Browser-only fixtures for the business UI. This entry is bundled only when
// SELECTA_CLOUD_E2E or SELECTA_BUSINESS_E2E is set; it never ships to customers.
// Invented data is labelled as such, not presented as live venue or billing state.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { scenario, demoApi, NOW, type Scenario } from '../fixtures';
import { businessClient } from '../client';
import { BusinessContext } from '../context';
import { StaffControl } from '../staff/StaffControl';
import { HqLocalReadiness, VenueLocalReadiness } from '../localFirst/ReadinessPanel';
import '../business.css';

const CASES: Scenario[] = [
  'normal', 'empty', 'silent', 'long_pause', 'over_seats',
  'licence_expiring', 'licence_expired', 'grace', 'grace_final',
  'grace_ended', 'plan_locked', 'pilot', 'pilot_ending',
  'pilot_ended', 'degraded', 'stress', 'lf13_fleet',
];

function BusinessHarness() {
  const parameters = new URLSearchParams(location.search);
  const initial = parameters.get('scenario') as Scenario | null;
  const [selected, setSelected] = useState<Scenario>(
    initial && CASES.includes(initial) ? initial : 'normal',
  );
  const data = scenario(selected);
  const [openVenueId, setOpenVenueId] = useState<string | null>(null);
  const [staffMode, setStaffMode] = useState(false);
  const openVenue = data.venues.find((venue) => venue.id === openVenueId);
  return (
    <main className="biz" style={{ maxWidth: 1100, padding: '1.5rem', marginInline: 'auto' }}>
      <header>
        <p className="biz-quiet">Test fixture — invented data, no connected venue or account</p>
        <h1>SelectaDJ for Business · harness</h1>
        <label htmlFor="business-scenario">Scenario</label>
        <select
          id="business-scenario"
          value={selected}
          onChange={(event) => setSelected(event.target.value as Scenario)}
        >
          {CASES.map((kind) => <option key={kind} value={kind}>{kind.replaceAll('_', ' ')}</option>)}
        </select>
      </header>
      {selected === 'lf13_fleet' && (openVenue ? <div className="biz-stack">
        <button type="button" onClick={() => { setOpenVenueId(null); setStaffMode(false); }}>Back to HQ</button>
        <button type="button" onClick={() => setStaffMode((value) => !value)}>{staffMode ? 'Manager view' : 'Staff phone view'}</button>
        {staffMode ? <div className="lf13-staff-phone"><BusinessContext.Provider value={{
          org: { ...data.org, role: 'staff', venue_scope: [openVenue.id] }, venues: data.venues,
          devices: data.devices ?? [], activity: data.activity ?? [], now: NOW, offline: false,
          updatedAt: NOW, health: { stream: 'polling' }, loading: false, readOnly: false,
          client: businessClient(demoApi('lf13_fleet'), data.org.workspace_id),
          refresh: async () => {}, go: () => {},
        }}><StaffControl venueId={openVenue.id} /></BusinessContext.Provider></div>
          : <VenueLocalReadiness venue={openVenue} now={NOW} offline={false}
            onOpenTab={() => {}} onRefresh={() => {}} />}
      </div> : <HqLocalReadiness venues={data.venues} now={NOW} offline={false} onOpenVenue={setOpenVenueId} />)}
      <section aria-label="Organisation" className="biz-card">
        <h2>{data.org.name}</h2>
        <p>Billing: {data.org.billing.status} · Plan: {data.org.billing.plan}</p>
        <p>Venues: {data.venues.length}</p>
      </section>
      <section aria-label="Venues">
        <h2>Venue and speaker fixtures</h2>
        <div className="biz-stack">
          {data.venues.length === 0 && <p>No venues in this test scenario.</p>}
          {data.venues.map((venue) => (
            <article key={venue.id} className="biz-card">
              <h3>{venue.name}</h3>
              <p>{venue.open_now ? 'Open' : 'Closed'} · {venue.time_zone}</p>
              <ul>
                {venue.zones.map((zone) => (
                  <li key={zone.id}>
                    <strong>{zone.name}</strong>: {zone.state} · {zone.now?.title ?? 'No song playing'}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <section aria-label="Activity" className="biz-card">
        <h2>Fixture activity</h2>
        {!data.activity?.length
          ? <p>No activity.</p>
          : <ul>{data.activity?.map((item) => <li key={item.id}>{item.words}</li>)}</ul>}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<BusinessHarness />);
