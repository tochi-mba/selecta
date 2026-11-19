// The business checkout (ADR-0447 BZ-0447-04, -06): the owner confirms they buy for a business,
// accepts the versioned business terms, gives the invoice details and VAT number, picks monthly
// or yearly and whether to start with the trial, then enters the card on Stripe's own page.
// Coming back with `?checkout=done&session_id=...` finishes the subscription on the server.

import { FormEvent, useEffect, useRef, useState } from 'react';
import { BILLING_COPY as COPY } from '../copy/console';
import { useBusiness } from '../context';
import type { BillingSummary } from '../types';

type Field = 'company_name' | 'line1' | 'line2' | 'city' | 'postal_code' | 'country' | 'tax_id';

/** Where the browser goes for the card; a seam for tests. */
export const navigate = { to: (url: string) => window.location.assign(url) };

/** Finishes a checkout the owner just came back from, once, then tidies the address bar. */
export function useCheckoutReturn(onDone: () => Promise<void>) {
  const { client } = useBusiness();
  const [status, setStatus] = useState('');
  const once = useRef(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const state = query.get('checkout');
    if (!state || once.current) return;
    once.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    if (state === 'cancelled') { setStatus(COPY.cancelled); return; }
    const session = query.get('session_id');
    if (state !== 'done' || !session) return;
    setStatus(COPY.finishing);
    client.completeCheckout(session)
      .then(async () => { setStatus(COPY.finished); await onDone(); })
      .catch((problem: Error) => setStatus(problem.message));
  }, [client, onDone]);
  return status;
}

export function CheckoutCard({ summary }: { summary: BillingSummary }) {
  const { client, org } = useBusiness();
  const [fields, setFields] = useState<Record<Field, string>>({ company_name: org.name, line1: '', line2: '', city: '', postal_code: '', country: org.country, tax_id: '' });
  const [business, setBusiness] = useState(false);
  const [terms, setTerms] = useState(false);
  const [interval, setPayEvery] = useState<'month' | 'year'>('month');
  const [trial, setTrial] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const offer = summary.checkout;
  if (!offer.selling) return <section className="biz-card"><p className="biz-quiet">{COPY.checkoutOff}</p></section>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!business || !terms) { setStatus(COPY.needConfirm); return; }
    setBusy(true);
    setStatus(COPY.goingToStripe);
    try {
      const answer = await client.startCheckout({
        business_confirmed: true, terms_version: offer.terms_version, company_name: fields.company_name,
        billing_address: { line1: fields.line1, ...(fields.line2 ? { line2: fields.line2 } : {}), city: fields.city, postal_code: fields.postal_code, country: fields.country.toUpperCase() },
        ...(fields.tax_id ? { tax_id: fields.tax_id } : {}), interval, trial: trial && offer.trial_available,
      });
      if (answer.blocked || !answer.url) { setStatus(answer.message ?? COPY.detailsUnavailable); return; }
      navigate.to(answer.url);
    } catch (problem) {
      setStatus((problem as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const input = (key: Field, label: string, extra: { required?: boolean; maxLength?: number } = {}) => <label className="biz-field">{label}
    <input value={fields[key]} required={extra.required ?? true} maxLength={extra.maxLength ?? 200} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />
  </label>;
  return <form className="biz-card" onSubmit={submit} aria-labelledby="biz-billing-checkout">
    <h2 id="biz-billing-checkout">{COPY.checkoutTitle}</h2>
    <p className="biz-quiet">{COPY.checkoutIntro}</p>
    <label><input type="checkbox" checked={business} onChange={(event) => setBusiness(event.target.checked)} />{COPY.businessConfirm}</label>
    <label><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} />{COPY.termsAccept(offer.terms_version)}</label>
    {input('company_name', COPY.companyName, { maxLength: 256 })}
    {input('line1', COPY.line1)}
    {input('line2', COPY.line2, { required: false })}
    <div className="biz-row">{input('city', COPY.city, { maxLength: 100 })}{input('postal_code', COPY.postalCode, { maxLength: 20 })}{input('country', COPY.country, { maxLength: 2 })}</div>
    {input('tax_id', COPY.vatNumber, { required: false, maxLength: 64 })}
    <fieldset>
      <legend>{COPY.intervalLegend}</legend>
      <label><input type="radio" name="biz-interval" checked={interval === 'month'} onChange={() => setPayEvery('month')} />{COPY.monthly}</label>
      <label><input type="radio" name="biz-interval" checked={interval === 'year'} onChange={() => setPayEvery('year')} />{COPY.yearly}</label>
    </fieldset>
    {offer.trial_available && <label><input type="checkbox" checked={trial} onChange={(event) => setTrial(event.target.checked)} />{COPY.trialChoice(offer.trial.days)}</label>}
    <div className="biz-row"><button type="submit" disabled={busy}>{busy ? COPY.goingToStripe : COPY.continueToStripe}</button></div>
    <p role="status" aria-live="polite">{status}</p>
  </form>;
}
