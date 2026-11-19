// Licensing settings (ADR-0449): how long play logs are kept (the owner decides), the business
// terms acceptance, and the owner's one-off licence grace extension. Behind `business.licensing`.

import { FormEvent, useState } from 'react';
import { EXPORT_COPY as COPY } from '../copy/console';
import { businessOn, useBusiness } from '../context';
import { dayWords } from '../time';
import type { Venue } from '../types';
import { useLoad } from '../venue/useVenue';

export function RetentionCard() {
  const { org, client } = useBusiness();
  const on = businessOn(org.features, 'business.licensing');
  const kept = useLoad(() => (on ? client.playLogRetention() : Promise.resolve(null)), [client, on]);
  const [days, setDays] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  if (!on || !kept.data) return null;
  const owner = org.role === 'owner';
  const save = async (event: FormEvent) => {
    event.preventDefault();
    try { setStatus(COPY.retentionSaved((await client.setPlayLogRetention(Number(days ?? kept.data!.days))).days)); await kept.reload(); }
    catch (problem) { setStatus((problem as Error).message); }
  };
  return <form className="biz-card" onSubmit={save}>
    <label className="biz-field">{COPY.retentionLabel}
      <input type="number" min={1} max={3650} disabled={!owner} value={days ?? String(kept.data.days)} onChange={(event) => setDays(event.target.value)} />
    </label>
    <p className="biz-quiet">{COPY.retentionNote(Math.round(kept.data.default_days / 365))}</p>
    {owner && <div className="biz-row"><button type="submit">{COPY.retentionSave}</button></div>}
    <p role="status" aria-live="polite">{status}</p>
  </form>;
}

export function TermsCard() {
  const { org, client } = useBusiness();
  const on = businessOn(org.features, 'business.licensing');
  const access = useLoad(() => (on ? client.termsAccess() : Promise.resolve(null)), [client, on]);
  const [status, setStatus] = useState('');
  if (!on || !access.data) return null;
  const terms = access.data;
  const accept = async () => {
    try { access.set(await client.acceptTerms()); setStatus(''); } catch (problem) { setStatus((problem as Error).message); }
  };
  return <section className="biz-card" aria-labelledby="biz-terms">
    <h2 id="biz-terms">{COPY.termsTitle}</h2>
    {terms.accepted ? <p>{COPY.termsAccepted(terms.current_version)}</p> : <>
      <p role="alert">{COPY.termsNeeded(terms.current_version)}</p>
      <p><a href={terms.terms_path} target="_blank" rel="noopener noreferrer">{COPY.termsRead}</a></p>
      {terms.can_accept ? <button type="button" onClick={() => void accept()}>{COPY.termsAccept}</button> : <p>{COPY.termsAskOwner}</p>}
    </>}
    <p role="status" aria-live="polite">{status}</p>
  </section>;
}

export function ExtendGrace({ venue }: { venue: Venue }) {
  const { org, client } = useBusiness();
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('');
  if (!businessOn(org.features, 'business.licensing') || org.role !== 'owner') return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try { setStatus(COPY.extended(dayWords((await client.extendLicenceGrace(venue.id, reason)).extended_until))); }
    catch (problem) { setStatus((problem as Error).message); }
  };
  return <form className="biz-row" onSubmit={submit} aria-label={COPY.extendTitle(venue.name)}>
    <label className="biz-field">{COPY.extendReason}<input value={reason} required minLength={3} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>
    <button type="submit">{COPY.extendButton}</button>
    <span role="status" aria-live="polite">{status}</span>
  </form>;
}
