import { useState } from 'react';
import { DrawnTick, useMotionOn } from '../../views/feelPieces';
import { PATHS, useBusiness } from '../context';
import { SETTINGS_COPY } from '../copy/shell';
import { BusinessDetailsForm } from '../onboarding/BusinessDetailsForm';
import { ExtendGrace, RetentionCard, TermsCard } from './LicensingCards';
import { PlayLogExport } from './PlayLogExport';
import { daysUntil, LICENCE_WARN_DAYS } from '../state';
import { isoDayWords } from '../time';
import type { Venue } from '../types';

/** One venue's licence in words: none yet, valid, ending soon or past its date. */
export function licenceWords(venue: Venue, now: number): string {
  const ends = venue.licence?.expires_on;
  if (!ends) return SETTINGS_COPY.noLicence;
  const days = daysUntil(ends, now);
  const day = isoDayWords(ends);
  if (days < 0) return SETTINGS_COPY.licenceExpired(day);
  return days <= LICENCE_WARN_DAYS ? SETTINGS_COPY.licenceExpiring(day) : SETTINGS_COPY.licenceOk(day);
}

export function SettingsPage() {
  const { org, venues, client, refresh, go, readOnly, offline, now } = useBusiness();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  // Each save that lands draws a tick beside its words (ADR-0477); keyed by this count to draw again.
  const [saves, setSaves] = useState(0);
  const moving = useMotionOn();
  const canEdit = org.role === 'owner' || org.role === 'admin';
  const disabled = readOnly ? SETTINGS_COPY.readOnly : offline ? SETTINGS_COPY.offline : !canEdit ? SETTINGS_COPY.notAdmin : null;
  return <section className="biz biz-stack"><h1>{SETTINGS_COPY.title}</h1>
    <TermsCard />
    <section className="biz-card"><h2>{SETTINGS_COPY.detailsHeading}</h2>
      <BusinessDetailsForm initial={{ name: org.name, country: org.country }} disabled={disabled} submitLabel={SETTINGS_COPY.saveDetails}
        onSave={async (details) => {
          setError(''); setSaved(false);
          try { await client.saveBusinessDetails(org.id, details); await refresh(); setSaved(true); setSaves((count) => count + 1); }
          catch { setError(SETTINGS_COPY.detailsFailed); }
        }} />
      {saved && <p role="status">{moving && <DrawnTick key={saves} className="biz-saved-tick" />}{SETTINGS_COPY.detailsSaved}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
    <section className="biz-card" aria-labelledby="biz-settings-licences"><h2 id="biz-settings-licences">{SETTINGS_COPY.licencesHeading}</h2>
      <p>{SETTINGS_COPY.licencesIntro}</p>
      {!venues.length && <p>{SETTINGS_COPY.noVenues}</p>}
      {Boolean(venues.length) && <ul>{venues.map((venue) => <li key={venue.id}>
        {venue.name}: {licenceWords(venue, now)}{' '}
        <button type="button" onClick={() => go(PATHS.venue(org.id, venue.id, 'licence'))}>{SETTINGS_COPY.openLicence(venue.name)}</button>
        {venue.licence?.expires_on && daysUntil(venue.licence.expires_on, now) < 0 && <ExtendGrace venue={venue} />}
      </li>)}</ul>}
    </section>
    <PlayLogExport />
    <RetentionCard />
    {Boolean(venues.length) && <section className="biz-card" aria-labelledby="biz-settings-rules"><h2 id="biz-settings-rules">{SETTINGS_COPY.rulesHeading}</h2>
      <p>{SETTINGS_COPY.rulesIntro}</p>
      <ul>{venues.map((venue) => <li key={venue.id}>
        <button type="button" onClick={() => go(PATHS.venue(org.id, venue.id, 'rules'))}>{SETTINGS_COPY.openRules(venue.name)}</button>
      </li>)}</ul>
    </section>}
    <section className="biz-card"><h2>{SETTINGS_COPY.managementHeading}</h2>
      <p>{SETTINGS_COPY.orgLine(org.name)}</p>
      <p>{SETTINGS_COPY.countryLine(org.country)}</p>
      <p>{SETTINGS_COPY.roleLine(org.role.replaceAll('_', ' '))}</p>
      <button type="button" onClick={() => go(PATHS.section(org.id, 'people'))}>{SETTINGS_COPY.peopleLink}</button>
      <button type="button" onClick={() => go(PATHS.section(org.id, 'billing'))}>{SETTINGS_COPY.billingLink}</button>
    </section>
  </section>;
}
