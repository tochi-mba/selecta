// Venue management routes (ADR-0453 D8): connect the existing venue tabs and validated editors.
// Reads and writes stay scoped through BusinessContext's workspace-bound client.
import { useEffect, useState } from 'react';
import { Problem } from '../../ui/controls';
import { showToast } from '../../ui/toasts';
import { PATHS } from '../context';
import { LicenceAttestationForm } from '../forms/LicenceAttestationForm';
import { OpeningHoursEditor } from '../forms/OpeningHoursEditor';
import { VenueForm } from '../forms/VenueForm';
import { ZoneListEditor } from '../forms/ZoneListEditor';
import type { Holiday, WeekHours } from '../types';
import { NowTab } from './NowTab';
import { RulesTab } from './RulesTab';
import { ScheduleTab, TodayTab } from './ScheduleTabs';
import { useVenueView } from './useVenue';

const EMPTY_HOURS: WeekHours = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
const TABS = [
  ['now', 'Now'], ['today', 'Today'], ['schedule', 'Schedule'],
  ['rules', 'Music rules'], ['details', 'Details'], ['hours', 'Opening hours'],
  ['zones', 'Zones'], ['licence', 'Music licence'],
] as const;

export function VenueManager({ venueId, tab }: { venueId: string; tab?: string }) {
  const { ctx, venue, disabled } = useVenueView(venueId);
  const [hours, setHours] = useState<WeekHours>(EMPTY_HOURS);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    setHours(venue?.hours ?? EMPTY_HOURS);
    setHolidays(venue?.holidays ?? []);
  }, [venue?.id, venue?.hours, venue?.holidays]);
  if (!venue) return <section className="biz-stack"><h1>Venue not found</h1><Problem>This venue is unavailable or outside your access.</Problem></section>;
  const current = TABS.some(([id]) => id === tab) ? tab : 'now';
  const save = async (action: () => Promise<unknown>) => {
    setError('');
    try { await action(); await ctx.refresh(); showToast('Saved'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save. Try again.'); }
  };
  const included = ctx.org.billing.plan === 'trial' ? 1 : 1;
  const price = ctx.org.billing.lines?.find((line) => line.item === 'zone');
  const extraPrice = price && ctx.org.billing.plan !== 'trial'
    ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: ctx.org.billing.currency }).format(price.unit_amount / 100)
    : null;
  return <section className="biz-stack" aria-label={venue.name}>
    <header className="biz-row"><h1>{venue.name}</h1><span className="biz-quiet">{venue.address}</span></header>
    <nav aria-label="Venue pages" className="biz-row">
      {TABS.map(([id, label]) => <button key={id} type="button"
        aria-current={current === id ? 'page' : undefined}
        onClick={() => ctx.go(PATHS.venue(ctx.org.id, venue.id, id))}>{label}</button>)}
    </nav>
    {error && <p role="alert" className="warn">{error}</p>}
    {current === 'now' && <NowTab venue={venue} disabled={disabled} />}
    {current === 'today' && <TodayTab venue={venue} />}
    {current === 'schedule' && <ScheduleTab venue={venue} disabled={disabled} />}
    {current === 'rules' && <RulesTab venue={venue} disabled={disabled} />}
    {current === 'details' && <VenueForm initial={venue} disabled={disabled}
      onSave={(value) => save(() => ctx.client.updateVenue(ctx.org.id, venue.id, value))} />}
    {current === 'hours' && <div className="biz-stack">
      <OpeningHoursEditor hours={hours} holidays={holidays}
        onChange={(next, closed) => { setHours(next); setHolidays(closed); }} disabled={disabled} />
      <button type="button" disabled={Boolean(disabled)}
        onClick={() => void save(() => ctx.client.saveHours(ctx.org.id, venue.id, hours, holidays))}>Save opening hours</button>
    </div>}
    {current === 'zones' && <ZoneListEditor zones={venue.zones} included={included} extraPrice={extraPrice}
      allowance={ctx.org.pilot?.status !== 'converted' ? ctx.org.pilot?.allowance.zones : undefined}
      disabled={disabled}
      onAdd={(name) => save(() => ctx.client.addZone(ctx.org.id, venue.id, name))}
      onRename={(id, name) => save(() => ctx.client.renameZone(ctx.org.id, venue.id, id, name))} />}
    {current === 'licence' && <LicenceAttestationForm initial={venue.licence} now={ctx.now} disabled={disabled}
      onSave={(license) => save(() => ctx.client.saveLicence(ctx.org.id, venue.id, license))} />}
  </section>;
}
