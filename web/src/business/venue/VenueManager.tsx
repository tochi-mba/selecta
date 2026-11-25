import { useRef, useState, type FormEvent } from 'react';
import { INDICATOR_CLASS, useSlidingIndicator } from '../../feel/indicator';
import { DrawnTick, useMotionOn } from '../../views/feelPieces';
import { timeZones } from '../forms/VenueForm';
import { businessOn, PATHS } from '../context';
import { VENUE_TABS, type VenueTab } from '../copy/venue';
import { LicenceAttestationForm } from '../forms/LicenceAttestationForm';
import { NowTab } from './NowTab';
import { RulesTab } from './RulesTab';
import { ScheduleTab, TodayTab } from './ScheduleTabs';
import { HoursTab } from './HoursTab';
import { VenueUploads } from './VenueUploads';
import { useVenueView } from './useVenue';
import { PeoplePage } from './PeoplePage';
import { RequestsPage } from './RequestsPage';
import { VenueActivity } from './VenueActivity';
import { KioskPlayers } from './KioskPlayers';
import { PlayerAlerts } from './PlayerAlerts';
import { IsrcCoverage, PlayLogExport } from '../settings/PlayLogExport';

const SCHEDULE_TABS: VenueTab[] = ['today', 'schedule', 'hours'];

export function VenueManager({ venueId, tab }: { venueId: string; tab?: string }) {
  const { ctx, venue, disabled } = useVenueView(venueId);
  // Today, Schedule and Hours ride on business.schedules (ADR-0444); off, they are not drawn.
  const schedulesOn = businessOn(ctx.org.features, 'business.schedules');
  // Upload music for this venue rides on business.entitlements (ADR-0448 per-venue storage).
  const entitlementsOn = businessOn(ctx.org.features, 'business.entitlements');
  const chosen = tab && tab in VENUE_TABS && (schedulesOn || !SCHEDULE_TABS.includes(tab as VenueTab)) ? tab as VenueTab : 'now';
  const [error, setError] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsMessage, setDetailsMessage] = useState('');
  // A save that lands draws a tick beside "Venue details saved." (ADR-0477); keyed to draw again.
  const [detailsSaved, setDetailsSaved] = useState(0);
  const moving = useMotionOn();
  // The section strip's line slides to the chosen section; aria-current still carries the choice.
  const sections = useRef<HTMLElement>(null);
  useSlidingIndicator(sections, '[aria-current="page"]');
  // kiosk pairing and health ride on business.kiosk (ADR-0445); off, the tab shows tablets only
  const kioskOn = businessOn(ctx.org.features, 'business.kiosk');
  if (!venue) return <section className="biz biz-stack"><h1>Venue unavailable</h1><p>This venue does not exist or is outside your access.</p></section>;
  return <section className="biz biz-stack">
    <header className="biz-row"><div><h1>{venue.name}</h1><p>{venue.address}</p></div>
      <button type="button" onClick={() => ctx.go(PATHS.venues(ctx.org.id))}>All venues</button>
    </header>
    {disabled && <p className="biz-quiet">{disabled}</p>}
    {ctx.bizApi && (ctx.org.role === 'owner' || ctx.org.role === 'admin') && <details>
      <summary>Edit venue details</summary>
      <form className="biz-row" key={venue.id} onSubmit={async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (disabled || savingDetails || !ctx.bizApi) return;
        const fields = new FormData(event.currentTarget);
        const name = String(fields.get('name') ?? '').trim();
        if (!name) { setDetailsMessage('Enter a venue name.'); return; }
        setSavingDetails(true);
        setDetailsMessage('');
        try {
          await ctx.bizApi.updateVenue(venue.id, { name, timezone: String(fields.get('timezone')) });
          await ctx.refresh();
          setDetailsMessage('Venue details saved.');
          setDetailsSaved((count) => count + 1);
        } catch {
          setDetailsMessage("Venue details couldn't be saved. Try again.");
        } finally {
          setSavingDetails(false);
        }
      }}>
        <fieldset className="biz-row" disabled={Boolean(disabled) || savingDetails}>
          <label>Venue name <input name="name" required defaultValue={venue.name} /></label>
          <label>Time zone <select name="timezone" defaultValue={venue.time_zone}>
            {[...new Set([venue.time_zone, ...timeZones()])].map((zone) => <option key={zone}>{zone}</option>)}
          </select></label>
          <button type="submit">Save venue details</button>
        </fieldset>
        <p role="status">{moving && detailsSaved > 0 && detailsMessage === 'Venue details saved.' && <DrawnTick key={detailsSaved} className="biz-saved-tick" />}{detailsMessage}</p>
      </form>
    </details>}
    {kioskOn && <PlayerAlerts venueId={venue.id} />}
    <nav ref={sections} className="biz-row" aria-label="Venue sections">
      {(Object.keys(VENUE_TABS) as VenueTab[]).filter((key) => key !== 'requests' || businessOn(ctx.org.features, 'business.rooms')).filter((key) => key !== 'rules' || businessOn(ctx.org.features, 'business.content_controls')).filter((key) => schedulesOn || !SCHEDULE_TABS.includes(key)).filter((key) => key !== 'music' || (entitlementsOn && ctx.api != null)).map((key) => <button key={key} type="button" aria-current={key === chosen ? 'page' : undefined} onClick={() => ctx.go(PATHS.venue(ctx.org.id, venue.id, key))}>{VENUE_TABS[key]}</button>)}
      <span className={INDICATOR_CLASS} aria-hidden="true" />
    </nav>
    {chosen === 'now' && <NowTab venue={venue} disabled={disabled} />}
    {chosen === 'today' && <TodayTab venue={venue} />}
    {chosen === 'schedule' && <ScheduleTab venue={venue} disabled={disabled} />}
    {chosen === 'hours' && <HoursTab venue={venue} disabled={disabled} />}
    {chosen === 'music' && <VenueUploads venueId={venue.id} disabled={disabled} />}
    {chosen === 'rules' && <RulesTab venue={venue} disabled={disabled} />}
    {chosen === 'requests' && <RequestsPage venueId={venue.id} />}
    {chosen === 'people' && <PeoplePage venueId={venue.id} />}
    {chosen === 'devices' && <section className="biz-card"><h2>{kioskOn ? 'Players and tablets' : 'Tablets'}</h2>
      <ul>{ctx.devices.filter((d) => d.kind !== 'kiosk' && (!d.zone_id || venue.zones.some((z) => z.id === d.zone_id))).map((device) => <li key={device.id}>{device.name} ({device.online ? 'online' : 'offline'})</li>)}</ul>
      {kioskOn && <KioskPlayers venue={venue} disabled={!!disabled} />}
    </section>}
    {chosen === 'licence' && <section className="biz-card"><h2>Music licence</h2>
      <LicenceAttestationForm initial={venue.licence} now={ctx.now} disabled={disabled} onSave={async (licence) => {
        setError('');
        try { await ctx.client.saveLicence(ctx.org.id, venue.id, licence); await ctx.refresh(); }
        catch { setError("The licence couldn't be saved. Try again."); }
      }} />
      {error && <p role="alert">{error}</p>}
    </section>}
    {chosen === 'log' && <>
      <PlayLogExport venueId={venue.id} />
      <IsrcCoverage venueId={venue.id} />
      <VenueActivity venueId={venue.id} />
    </>}
  </section>;
}
