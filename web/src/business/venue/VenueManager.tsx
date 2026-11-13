import { useState } from 'react';
import { PATHS } from '../context';
import { VENUE_TABS, type VenueTab } from '../copy/venue';
import { LicenceAttestationForm } from '../forms/LicenceAttestationForm';
import { PairingCodeEntry } from '../forms/PairingCodeEntry';
import { NowTab } from './NowTab';
import { RulesTab } from './RulesTab';
import { ScheduleTab, TodayTab } from './ScheduleTabs';
import { useVenueView } from './useVenue';
import { PeoplePage } from './PeoplePage';
import { RequestsPage } from './RequestsPage';

export function VenueManager({ venueId, tab }: { venueId: string; tab?: string }) {
  const { ctx, venue, disabled } = useVenueView(venueId);
  const chosen = tab && tab in VENUE_TABS ? tab as VenueTab : 'now';
  const [error, setError] = useState('');
  if (!venue) return <section className="biz biz-stack"><h1>Venue unavailable</h1><p>This venue does not exist or is outside your access.</p></section>;
  return <section className="biz biz-stack">
    <header className="biz-row"><div><h1>{venue.name}</h1><p>{venue.address}</p></div>
      <button type="button" onClick={() => ctx.go(PATHS.venues(ctx.org.id))}>All venues</button>
    </header>
    {disabled && <p className="biz-quiet">{disabled}</p>}
    <nav className="biz-row" aria-label="Venue sections">
      {(Object.keys(VENUE_TABS) as VenueTab[]).map((key) => <button key={key} type="button" aria-current={key === chosen ? 'page' : undefined} onClick={() => ctx.go(PATHS.venue(ctx.org.id, venue.id, key))}>{VENUE_TABS[key]}</button>)}
    </nav>
    {chosen === 'now' && <NowTab venue={venue} disabled={disabled} />}
    {chosen === 'today' && <TodayTab venue={venue} />}
    {chosen === 'schedule' && <ScheduleTab venue={venue} disabled={disabled} />}
    {chosen === 'rules' && <RulesTab venue={venue} disabled={disabled} />}
    {chosen === 'requests' && <RequestsPage venueId={venue.id} />}
    {chosen === 'people' && <PeoplePage venueId={venue.id} />}
    {chosen === 'devices' && <section className="biz-card"><h2>Players and tablets</h2>
      <ul>{ctx.devices.filter((d) => !d.zone_id || venue.zones.some((z) => z.id === d.zone_id)).map((device) => <li key={device.id}>{device.name} ({device.online ? 'online' : 'offline'})</li>)}</ul>
      {!disabled && <PairingCodeEntry zones={venue.zones} onPair={async (code, zone_id, name) => {
        const device = await ctx.client.pair({ code, zone_id, name });
        await ctx.refresh();
        return device;
      }} isReady={(id) => ctx.devices.some((d) => d.id === id && d.online)} />}
    </section>}
    {chosen === 'licence' && <section className="biz-card"><h2>Music licence</h2>
      <LicenceAttestationForm initial={venue.licence} now={ctx.now} disabled={disabled} onSave={async (licence) => {
        setError('');
        try { await ctx.client.saveLicence(ctx.org.id, venue.id, licence); await ctx.refresh(); }
        catch { setError("The licence couldn't be saved. Try again."); }
      }} />
      {error && <p role="alert">{error}</p>}
    </section>}
    {chosen === 'log' && <section className="biz-card"><h2>Play log</h2>
      <p>Recent venue activity</p>
      <ul>{ctx.activity.filter((item) => item.venue_id === venue.id).map((item) => <li key={item.id}>{new Date(item.at * 1000).toLocaleString()}: {item.words}</li>)}</ul>
    </section>}
  </section>;
}
