import { useState } from 'react';
import { useBusiness, PATHS } from '../context';
import { BusinessDetailsForm } from './BusinessDetailsForm';
import { OpeningHoursEditor } from '../forms/OpeningHoursEditor';
import { VenueForm } from '../forms/VenueForm';
import { ZoneListEditor } from '../forms/ZoneListEditor';
import { LicenceAttestationForm } from '../forms/LicenceAttestationForm';
import { PairingCodeEntry } from '../forms/PairingCodeEntry';
import { SETUP_COPY, STEP_COPY, SERVICE_COPY } from '../copy/onboarding';
import type { SetupStepId, WeekHours, Holiday } from '../types';
import { LocalSetupGuide, localFirstOn } from '../localFirst/ReadinessPanel';
import { inspectVenue } from '../localFirst/readiness';

const steps: SetupStepId[] = ['business', 'venue', 'hours', 'zones', 'licence', 'music', 'pair', 'service'];
const emptyHours = (): WeekHours => ({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] });

export function OnboardingPage() {
  const { org, venues, client, now, refresh, go, readOnly, offline } = useBusiness();
  const setup = org.setup;
  const current = setup?.current ?? 'business';
  const venue = venues.find((v) => v.id === setup?.venue_id) ?? venues[0];
  const [hours, setHours] = useState<WeekHours>(() => venue?.hours ?? emptyHours());
  const [holidays, setHolidays] = useState<Holiday[]>(() => venue?.holidays ?? []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const disabled = readOnly ? SETUP_COPY.readOnly : offline ? SETUP_COPY.offline : null;
  const localFirst = localFirstOn(org.features);
  const activationReady = venue ? inspectVenue(venue, now, offline).activationReady : false;
  const localGuide = (stage: 'music' | 'pair' | 'service') => venue ? <LocalSetupGuide venue={venue} now={now} offline={offline} stage={stage}
    onOpenTab={(tab) => go(PATHS.venue(org.id, venue.id, tab))} onRefresh={refresh} /> : <p>Add the venue before connecting its music.</p>;
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
        allowance={org.pilot?.allowance.zones ?? null} extraPrice={org.billing.plan === 'trial' ? null : '£25'}
        disabled={disabled} onAdd={async (name) => { await client.addZone(org.id, venue.id, name); await refresh(); }}
        onRename={async (id, name) => { await client.renameZone(org.id, venue.id, id, name); await refresh(); }} />
        <button type="button" disabled={!!disabled || busy || !venue.zones.length} onClick={() => { void advance(true); }}>Continue</button>
      </>}
      {current === 'licence' && venue && <LicenceAttestationForm initial={venue.licence} now={now} disabled={disabled}
        onSave={async (licence) => { await client.saveLicence(org.id, venue.id, licence); await advance(true); }} />}
      {current === 'music' && <><p>{localFirst ? 'Music remains on authorised local devices. Cloud storage is not a music source.' : 'Add music to the organisation library before the first service.'}</p>
        {localFirst && localGuide('music')}
        <button type="button" onClick={() => go(localFirst && venue ? PATHS.venue(org.id, venue.id, 'devices') : PATHS.section(org.id, 'library'))}>{localFirst ? 'Manage local music sources' : 'Open business library'}</button>
        <button type="button" disabled={!!disabled || busy} onClick={() => { void advance(true); }}>Continue</button>
      </>}
      {current === 'pair' && venue && <>{localFirst && localGuide('pair')}<PairingCodeEntry zones={venue.zones} onPair={async (code, zone_id, name) => {
        const device = await client.pair({ code, zone_id, name }); await refresh(); return device;
      }} />
        <button type="button" disabled={!!disabled || busy} onClick={() => { void advance(true); }}>Continue</button>
      </>}
      {current === 'service' && <><p>{localFirst ? 'Verify the engine, authorised recordings, real speaker, fallback and offline rehearsal in every zone before service.' : "Review each zone's schedule before your first service."}</p>
        {localFirst && localGuide('service')}
        {localFirst && !activationReady && <p role="alert">Activation is blocked until every zone has current verified local playback readiness. Refresh after the on-site checks.</p>}
        {venue && <button type="button" onClick={() => go(PATHS.venue(org.id, venue.id, 'schedule'))}>Open schedule</button>}
        <button type="button" disabled={!!disabled || busy || (localFirst && !activationReady)} onClick={() => { void advance(true); }}>{SERVICE_COPY.finish}</button>
      </>}
      {!venue && current !== 'business' && current !== 'venue' && <p>{SETUP_COPY.noVenueYet}</p>}
    </div>
    {error && <p role="alert">{error}</p>}
    {current !== 'service' && <button type="button" disabled={!!disabled || busy} onClick={() => { void advance(false); }}>{SETUP_COPY.skip}</button>}
  </section>;
}
