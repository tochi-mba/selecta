import { useState } from 'react';
import { businessOn, useBusiness, PATHS } from '../context';
import { BusinessDetailsForm } from './BusinessDetailsForm';
import { OpeningHoursEditor } from '../forms/OpeningHoursEditor';
import { emptyWeek } from '../forms/hours';
import { VenueForm } from '../forms/VenueForm';
import { ZoneListEditor } from '../forms/ZoneListEditor';
import { LicenceAttestationForm } from '../forms/LicenceAttestationForm';
import { PairingCodeEntry } from '../forms/PairingCodeEntry';
import { Boundary } from '../pricing/BusinessPricing';
import { MUSIC_COPY, SETUP_COPY, STEP_COPY, SERVICE_COPY } from '../copy/onboarding';
import type { SetupStepId, WeekHours, Holiday } from '../types';

const steps: SetupStepId[] = ['business', 'venue', 'hours', 'zones', 'licence', 'music', 'pair', 'service'];

export function OnboardingPage() {
  const { org, venues, client, now, refresh, go, readOnly, offline } = useBusiness();
  const setup = org.setup;
  const current = setup?.current ?? 'business';
  const venue = venues.find((v) => v.id === setup?.venue_id) ?? venues[0];
  const [hours, setHours] = useState<WeekHours>(() => venue?.hours ?? emptyWeek());
  const [holidays, setHolidays] = useState<Holiday[]>(() => venue?.holidays ?? []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const disabled = readOnly ? SETUP_COPY.readOnly : offline ? SETUP_COPY.offline : null;
  const advance = async (done: boolean, venueId?: string) => {
    setError(''); setBusy(true);
    try {
      const next = steps[steps.indexOf(current) + 1];
      await client.saveSetup(org.id, {
        venue_id: venueId ?? venue?.id,
        done: done ? [...new Set([...(setup?.done ?? []), current])] : setup?.done ?? [],
        skipped: done ? (setup?.skipped ?? []).filter((step) => step !== current) : [...new Set([...(setup?.skipped ?? []), current])],
        current: next ?? current,
      });
      await refresh();
      if (!next) go(PATHS.hq(org.id));
    } catch { setError(SETUP_COPY.saveFailed); }
    finally { setBusy(false); }
  };
  return <section className="biz biz-stack"><h1>{SETUP_COPY.title}</h1>
    {current === 'business' && <Boundary />}
    <ol aria-label={SETUP_COPY.checklist}>{steps.map((step) => <li key={step} aria-current={step === current ? 'step' : undefined}>
      {STEP_COPY[step].title}{setup?.done.includes(step) ? ' (done)' : setup?.skipped.includes(step) ? ' (skipped)' : ''}
    </li>)}</ol>
    <div className="biz-card"><h2>{STEP_COPY[current].title}</h2><p>{STEP_COPY[current].why}</p>
      {current === 'business' && <BusinessDetailsForm initial={{ name: org.name, country: org.country }} submitLabel="Save and continue" disabled={disabled}
        onSave={async (details) => { await client.saveBusinessDetails(org.id, details); await advance(true); }} />}
      {current === 'venue' && <VenueForm disabled={disabled} onSave={async (body) => {
        const created = await client.createVenue(org.id, body); await advance(true, created.id);
      }} />}
      {current === 'hours' && venue && <>
        <OpeningHoursEditor hours={hours} holidays={holidays} disabled={disabled} onChange={(next, days) => { setHours(next); setHolidays(days); }} />
        <button type="button" disabled={!!disabled || busy} onClick={async () => {
          try { await client.saveHours(org.id, venue.id, hours, holidays); await advance(true); }
          catch { setError(SETUP_COPY.saveFailed); }
        }}>Save hours and continue</button>
      </>}
      {current === 'zones' && venue && <><ZoneListEditor zones={venue.zones} included={1}
        allowance={org.pilot?.allowance?.zones ?? null} extraPrice={org.billing.plan === 'trial' ? null : '£25'}
        disabled={disabled} onAdd={async (name) => { await client.addZone(org.id, venue.id, name); await refresh(); }}
        onRename={async (id, name) => { await client.renameZone(org.id, venue.id, id, name); await refresh(); }} />
        <button type="button" disabled={!!disabled || busy || !venue.zones.length} onClick={() => { void advance(true); }}>Continue</button>
      </>}
      {current === 'licence' && venue && <LicenceAttestationForm initial={venue.licence} now={now} disabled={disabled}
        onSave={async (licence) => { await client.saveLicence(org.id, venue.id, licence); await advance(true); }} />}
      {current === 'music' && <><p>{MUSIC_COPY.intro}</p>
        <button type="button" onClick={() => go(PATHS.section(org.id, 'library'))}>{MUSIC_COPY.libraryLink}</button>
        <button type="button" disabled={!!disabled || busy} onClick={() => { void advance(true); }}>Continue</button>
      </>}
      {current === 'pair' && venue && <>{businessOn(org.features, 'business.kiosk') ? <PairingCodeEntry zones={venue.zones} onPair={async (code, zone_id, name) => {
        const device = await client.pair({ code, zone_id, name }); await refresh(); return device;
      }} /> : <p className="biz-quiet">Players can be paired once kiosk players are switched on for your organisation.</p>}
        <button type="button" disabled={!!disabled || busy} onClick={() => { void advance(true); }}>Continue</button>
      </>}
      {current === 'service' && <><p>Review each zone's schedule before your first service.</p>
        {venue && <button type="button" onClick={() => go(PATHS.venue(org.id, venue.id, 'schedule'))}>Open schedule</button>}
        <button type="button" disabled={!!disabled || busy} onClick={() => { void advance(true); }}>{SERVICE_COPY.finish}</button>
      </>}
      {!venue && current !== 'business' && current !== 'venue' && <p>{SETUP_COPY.noVenueYet}</p>}
    </div>
    {error && <p role="alert">{error}</p>}
    {current !== 'service' && <button type="button" disabled={!!disabled || busy} onClick={() => { void advance(false); }}>{SETUP_COPY.skip}</button>}
  </section>;
}
