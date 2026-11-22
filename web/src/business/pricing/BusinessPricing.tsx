// The SelectaDJ for Business pricing page (ADR-0441 BZ-0441-04, -05). CloudApp shows it at
// `/business/pricing` only when the server says `business.signups` is on for this account (named
// pilots until Gate S); off, the address is not found and nothing here is fetched. It shows the
// per-venue price ex VAT, extra zones and seats, the annual price, the volume discount, the
// Enterprise threshold and a live total for N venues, M zones and S seats, plus the product
// boundary: own music, own licences, no audio to guests, personal and business kept apart.

import { useCallback, useEffect, useId, useState } from 'react';
import type { Api } from '../../cloud/api';
import { BOUNDARY_COPY, PRICING_COPY as COPY } from '../copy/pricing';
import { Currency, Interval, money, Pricing, quote } from './pricingTotal';

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; pricing: Pricing };

export function Boundary() {
  return (
    <section className="biz-card" aria-labelledby="biz-boundary-title">
      <h2 id="biz-boundary-title">{BOUNDARY_COPY.title}</h2>
      <ul>
        <li>{BOUNDARY_COPY.ownMusic}</li>
        <li>{BOUNDARY_COPY.ownLicence}</li>
        <li>{BOUNDARY_COPY.noGuestAudio}</li>
        <li>{BOUNDARY_COPY.separate}</li>
      </ul>
    </section>
  );
}

function NumberField({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (n: number) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="biz-pricing-field">
      <span>{label}</span>
      <input id={id} type="number" inputMode="numeric" min={min} max={500} value={value}
        onChange={(event) => onChange(Math.max(min, Math.min(500, Math.floor(Number(event.target.value) || 0))))} />
    </label>
  );
}

export function Calculator({ pricing }: { pricing: Pricing }) {
  const [venues, setVenues] = useState(1);
  const [zones, setZones] = useState(1);
  const [seats, setSeats] = useState(3);
  const [interval, setInterval] = useState<Interval>('month');
  const q = quote(pricing, venues, zones, seats, interval);
  const c = pricing.currency;
  return (
    <section className="biz-card" aria-labelledby="biz-calc-title">
      <h2 id="biz-calc-title">{COPY.calculator}</h2>
      <div className="biz-pricing-fields">
        <NumberField label={COPY.venues} value={venues} min={1} onChange={setVenues} />
        <NumberField label={COPY.zones} value={zones} min={1} onChange={setZones} />
        <NumberField label={COPY.seats} value={seats} min={0} onChange={setSeats} />
        <fieldset className="biz-pricing-interval">
          <legend>{COPY.billing}</legend>
          <label><input type="radio" name="biz-interval" checked={interval === 'month'} onChange={() => setInterval('month')} /> {COPY.monthly}</label>
          <label><input type="radio" name="biz-interval" checked={interval === 'year'} onChange={() => setInterval('year')} /> {COPY.yearly}</label>
        </fieldset>
      </div>
      {q.enterprise
        ? <p role="status" data-testid="pricing-enterprise">{COPY.enterprise(pricing.enterprise_min_venues)}</p>
        : (
          <dl className="biz-pricing-quote" aria-live="polite">
            <dt>{COPY.venueLine(Math.floor(venues))}</dt><dd>{money(q.lines.venues, c)}</dd>
            {q.extraZones > 0 && <><dt>{COPY.extraZones(q.extraZones)}</dt><dd>{money(q.lines.zones, c)}</dd></>}
            {q.extraSeats > 0 && <><dt>{COPY.extraSeats(q.extraSeats)}</dt><dd>{money(q.lines.seats, c)}</dd></>}
            {q.discount > 0 && <><dt>{COPY.subtotal}</dt><dd>{money(q.subtotal, c)}</dd><dt>{COPY.discount(q.percentOff)}</dt><dd>-{money(q.discount, c)}</dd></>}
            <dt><strong>{COPY.total(interval)}</strong></dt><dd><strong data-testid="pricing-total">{money(q.total, c)}</strong></dd>
          </dl>
        )}
    </section>
  );
}

function Prices({ pricing }: { pricing: Pricing }) {
  const c = pricing.currency;
  return (
    <>
      <section className="biz-card" aria-labelledby="biz-price-title">
        <h2 id="biz-price-title"><span data-testid="pricing-venue">{money(pricing.venue.month, c)}</span> {COPY.perVenue}</h2>
        <p>{money(pricing.venue.year, c)} {COPY.perVenueYear}</p>
        <p>{COPY.includes(pricing.included_zones, pricing.included_seats)}</p>
        <ul>
          <li>{COPY.extraZone}: {money(pricing.extra_zone.month, c)} {COPY.perMonth} ({money(pricing.extra_zone.year, c)} {COPY.perYear})</li>
          <li>{COPY.extraSeat}: {money(pricing.extra_seat.month, c)} {COPY.perMonth} ({money(pricing.extra_seat.year, c)} {COPY.perYear})</li>
          <li>{COPY.volume(pricing.volume.min_venues, pricing.volume.percent_off)}</li>
          <li>{COPY.enterprise(pricing.enterprise_min_venues)}</li>
          <li>{COPY.trial(pricing.trial.days)}</li>
        </ul>
        <p className="biz-quiet">{COPY.exVat}</p>
      </section>
      <Calculator pricing={pricing} />
    </>
  );
}

export default function BusinessPricing({ api, onLeave }: { api: Api; onLeave: () => void }) {
  const [currency, setCurrency] = useState<Currency>('GBP');
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const fetchPrices = useCallback(() => {
    setLoad({ state: 'loading' });
    api<{ pricing: Pricing }>(`/business/pricing?currency=${currency}`)
      .then((body) => setLoad({ state: 'ready', pricing: body.pricing }))
      .catch(() => setLoad({ state: 'failed' }));
  }, [api, currency]);
  useEffect(fetchPrices, [fetchPrices]);
  const currencyId = useId();

  return (
    <main className="biz biz-pricing">
      <header className="biz-stack">
        <h1>{COPY.title}</h1>
        <p>{COPY.lead}</p>
        <label htmlFor={currencyId} className="biz-pricing-field">
          <span>{COPY.currency}</span>
          <select id={currencyId} value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>
            <option value="GBP">GBP</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </label>
      </header>
      {load.state === 'loading' && <p role="status">{COPY.loading}</p>}
      {load.state === 'failed' && <p role="alert">{COPY.failed} <button className="biz-button" onClick={fetchPrices}>{COPY.retry}</button></p>}
      {load.state === 'ready' && <Prices pricing={load.pricing} />}
      <Boundary />
      <p><button className="biz-button" onClick={onLeave}>{COPY.back}</button></p>
    </main>
  );
}
