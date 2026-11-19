// Browser-only fixtures for the business UI. This entry is bundled only when
// SELECTA_CLOUD_E2E or SELECTA_BUSINESS_E2E is set; it never ships to customers.
// Invented data is labelled as such, not presented as live venue or billing state.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { arrangeVenues, DEFAULT_OPTIONS } from '../console/consoleLogic';
import { VenueHealthGrid } from '../console/VenueHealthGrid';
import { NOW, scenario, stressVenues, type Scenario } from '../fixtures';
import '../business.css';

const CASES: Scenario[] = [
  'normal', 'empty', 'silent', 'long_pause', 'over_seats',
  'licence_expiring', 'licence_expired', 'grace', 'grace_final',
  'grace_ended', 'plan_locked', 'pilot', 'pilot_ending',
  'pilot_ended', 'degraded', 'stress',
];

// `?grid=500`: the HQ health grid over 500 invented venues with a search box and a sort, for the
// ADR-0454 UI test "500 venues grid sorts and searches under 100 ms". After each change the time
// from the input to the grid's committed render goes on `data-arrange-ms` on the grid section.
function GridStress({ count }: { count: number }) {
  const venues = useMemo(() => stressVenues(count), [count]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'severity' | 'name' | 'region'>('severity');
  const started = useRef(0);
  const section = useRef<HTMLElement>(null);
  const shown = useMemo(() => arrangeVenues(venues, { ...DEFAULT_OPTIONS, query, sort }, NOW), [venues, query, sort]);
  useLayoutEffect(() => {
    if (started.current) section.current?.setAttribute('data-arrange-ms', String(performance.now() - started.current));
  }, [shown]);
  return (
    <main className="biz" style={{ padding: '1rem' }}>
      <h1>Venue grid fixture: {count} invented venues</h1>
      <label htmlFor="grid-search">Search venues</label>
      <input id="grid-search" value={query} onChange={(event) => { started.current = performance.now(); setQuery(event.target.value); }} />
      <label htmlFor="grid-sort">Sort</label>
      <select id="grid-sort" value={sort} onChange={(event) => { started.current = performance.now(); setSort(event.target.value as typeof sort); }}>
        <option value="severity">severity</option><option value="name">name</option><option value="region">region</option>
      </select>
      <section ref={section} aria-label="Venue grid"><VenueHealthGrid venues={shown} now={NOW} /></section>
    </main>
  );
}

function BusinessHarness() {
  const grid = Number(new URLSearchParams(location.search).get('grid') ?? 0);
  return grid > 0 ? <GridStress count={grid} /> : <ScenarioHarness />;
}

function ScenarioHarness() {
  const parameters = new URLSearchParams(location.search);
  const initial = parameters.get('scenario') as Scenario | null;
  const [selected, setSelected] = useState<Scenario>(
    initial && CASES.includes(initial) ? initial : 'normal',
  );
  const data = scenario(selected);
  return (
    <main className="biz" style={{ maxWidth: 1100, padding: '1.5rem', marginInline: 'auto' }}>
      <header>
        <p className="biz-quiet">Test fixture: invented data, no connected venue or account</p>
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
