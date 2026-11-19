// The organisation billing page (ADR-0447 BZ-0447-14). The plan, invoices and usage come with the
// organisation; the billing details (prices, a cost check before adding, PO number, cost centres,
// how you pay, the cost breakdown CSV and any planned dunning stop) come from the business
// billing routes, which only owners and admins may read. The page sits behind `business.billing`.

import { FormEvent, useState } from 'react';
import { BILLING_COPY as COPY } from '../copy/console';
import { PATHS, useBusiness } from '../context';
import { canManageBilling } from '../state';
import { dayWords, money, venueTime } from '../time';
import type { BillingSummary, CostPreview, Org } from '../types';
import { useLoad } from '../venue/useVenue';
import { CheckoutCard, useCheckoutReturn } from './CheckoutCard';
import { DowngradeCard, TransferCard } from './PlanChanges';
import './console.css';

const day = (epoch: number) => dayWords(epoch);
const readerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function BillingPage() {
  const { org, go } = useBusiness();
  if (!canManageBilling(org)) {
    return <section className="biz biz-stack"><h1>{COPY.title}</h1><p className="biz-quiet">{COPY.noRights}</p></section>;
  }
  return <section className="biz biz-stack">
    <h1>{COPY.title}</h1>
    <PlanCard org={org} />
    <BillingDetails />
    <InvoicesCard org={org} />
    <div className="biz-row"><button type="button" onClick={() => go(PATHS.section(org.id, 'settings'))}>{COPY.settings}</button></div>
  </section>;
}

function PlanCard({ org }: { org: Org }) {
  const billing = org.billing;
  const cash = (minor: number) => money(minor, billing.currency);
  const lines = billing.lines ?? [];
  const interval = lines[0]?.interval ?? 'month';
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unit_amount, 0);
  return <section className="biz-card" aria-labelledby="biz-billing-plan">
    <h2 id="biz-billing-plan">{COPY.plan}: {COPY.planNames[billing.plan] ?? billing.plan}</h2>
    <p>{COPY.paymentStatus}: <strong>{COPY.statusWords[billing.status] ?? billing.status}</strong></p>
    {billing.grace_ends_at && billing.status !== 'ok' && <p role="alert">{COPY.graceEnds(day(billing.grace_ends_at))}</p>}
    {billing.trial_ends_at && <p>{COPY.trialEnds(day(billing.trial_ends_at))}</p>}
    {org.pilot && org.pilot.status !== 'converted' && <p>{org.pilot.status === 'ended' ? COPY.pilotEnded : COPY.pilotFree(day(org.pilot.ends_at))}</p>}
    <p>{COPY.seats(org.seats.included, org.seats.paid, org.seats.held)}</p>
    {billing.storage && <p>{COPY.storage}: {COPY.storageWords(`${Math.round(billing.storage.used_bytes / 1e9)} GB`, `${Math.round(billing.storage.limit_bytes / 1e9)} GB`)}</p>}
    {lines.length > 0 && <div className="biz-table-wrap"><table className="biz-table">
      <caption>{COPY.linesCaption}</caption>
      <thead><tr><th scope="col">{COPY.item}</th><th scope="col">{COPY.quantity}</th><th scope="col">{COPY.price}</th></tr></thead>
      <tbody>{lines.map((line) => <tr key={line.item}>
        <th scope="row">{COPY.itemNames[line.item] ?? line.item}</th><td>{line.quantity}</td><td>{COPY.perInterval(cash(line.unit_amount), line.interval)}</td>
      </tr>)}</tbody>
    </table></div>}
    {lines.length > 0 && <p><strong>{COPY.grandTotal(COPY.perInterval(cash(total), interval))}</strong></p>}
  </section>;
}

function InvoicesCard({ org }: { org: Org }) {
  const invoices = org.billing.invoices ?? [];
  const cash = (minor: number) => money(minor, org.billing.currency);
  return <section className="biz-card" aria-labelledby="biz-billing-invoices">
    <h2 id="biz-billing-invoices">{COPY.invoicesCaption}</h2>
    {!invoices.length && <p className="biz-quiet">{COPY.noInvoices}</p>}
    {invoices.length > 0 && <div className="biz-table-wrap"><table className="biz-table">
      <thead><tr><th scope="col">{COPY.invoiceNumber}</th><th scope="col">{COPY.poNumber}</th><th scope="col">{COPY.amount}</th><th scope="col">{COPY.status}</th><th scope="col">{COPY.issued}</th></tr></thead>
      <tbody>{invoices.map((invoice) => <tr key={invoice.id}>
        <th scope="row">{invoice.url ? <a href={invoice.url} target="_blank" rel="noopener noreferrer" aria-label={COPY.viewInvoice(invoice.number)}>{invoice.number}</a> : invoice.number}</th>
        <td>{invoice.po_number || COPY.noPo}</td><td>{cash(invoice.amount)}</td>
        <td>{COPY.invoiceStatus[invoice.status] ?? invoice.status}</td><td>{day(invoice.issued_at)}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

function BillingDetails() {
  const { client } = useBusiness();
  const summary = useLoad<BillingSummary>(() => client.billingSummary(), [client]);
  const returned = useCheckoutReturn(summary.reload);
  if (summary.loading && !summary.data) return <p className="biz-quiet" role="status">{COPY.detailsLoading}</p>;
  if (!summary.data) return <p className="biz-quiet" role="status">{COPY.detailsUnavailable}</p>;
  const data = summary.data;
  return <>
    {returned && <p role="status">{returned}</p>}
    {data.banner && <DunningCard summary={data} />}
    {!data.subscribed && !data.enterprise && <CheckoutCard summary={data} />}
    {data.enterprise
      ? <section className="biz-card"><p>{COPY.enterprise}</p></section>
      : <><PricesCard summary={data} /><PreviewCard /></>}
    <InvoiceDetailsCard summary={data} onSaved={summary.reload} />
    {data.subscribed && <DowngradeCard summary={data} onChanged={summary.reload} />}
    <TransferCard summary={data} />
  </>;
}

function DunningCard({ summary }: { summary: BillingSummary }) {
  const names = new Map(summary.venues.map((venue) => [venue.venue_id, venue.name]));
  const when = (epoch: number) => `${day(epoch)} ${venueTime(epoch, readerZone())}`;
  return <section className="biz-card" role="alert">
    <p>{summary.banner?.message}</p>
    <ul>{(summary.banner?.stops ?? []).map((stop) => <li key={stop.venue_id}>
      {COPY.venueStops(names.get(stop.venue_id) ?? stop.venue_id, when(stop.stop_at))}
    </li>)}</ul>
  </section>;
}

function PricesCard({ summary }: { summary: BillingSummary }) {
  return <section className="biz-card">
    <div className="biz-table-wrap"><table className="biz-table">
      <caption>{COPY.pricesCaption(summary.interval)}</caption>
      <tbody>{summary.prices.map((price) => <tr key={price.item}>
        <th scope="row">{COPY.priceItems[price.item] ?? price.item}</th><td>{money(price.unit_amount, summary.currency)}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}

function PreviewCard() {
  const { client } = useBusiness();
  const [add, setAdd] = useState({ venues: 0, zones: 0, seats: 0 });
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const say = (preview: CostPreview) => preview.source === 'stripe'
    ? COPY.previewStripe(money(preview.charged_now_minor, preview.currency), money(preview.next_invoice_minor, preview.currency))
    : COPY.previewEstimate(money(preview.period_total_minor, preview.currency), preview.interval);
  const check = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try { setAnswer(say(await client.previewCost(add))); } catch (problem) { setAnswer((problem as Error).message); } finally { setBusy(false); }
  };
  const field = (key: keyof typeof add, label: string) => <label className="biz-field">{label}
    <input type="number" min={0} max={50} inputMode="numeric" value={add[key]}
      onChange={(event) => setAdd({ ...add, [key]: Math.max(0, Number(event.target.value) || 0) })} />
  </label>;
  return <form className="biz-card" onSubmit={check} aria-labelledby="biz-billing-preview">
    <h2 id="biz-billing-preview">{COPY.previewTitle}</h2>
    <p className="biz-quiet">{COPY.previewIntro}</p>
    <div className="biz-row">{field('venues', COPY.addVenues)}{field('zones', COPY.addZones)}{field('seats', COPY.addSeats)}</div>
    <div className="biz-row"><button type="submit" disabled={busy}>{busy ? COPY.previewing : COPY.previewButton}</button></div>
    <p role="status" aria-live="polite">{answer}</p>
  </form>;
}

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function InvoiceDetailsCard({ summary, onSaved }: { summary: BillingSummary; onSaved: () => Promise<void> }) {
  const { client } = useBusiness();
  const profile = summary.profile;
  const [po, setPo] = useState(profile?.po_number ?? '');
  const [centres, setCentres] = useState<Record<string, string>>(() => Object.fromEntries(summary.venues.map((venue) => [venue.venue_id, venue.cost_centre ?? ''])));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>, after: string = COPY.saved, refresh = true) => {
    setBusy(true);
    setStatus(refresh ? COPY.saving : COPY.downloading);
    try { await work(); setStatus(after); if (refresh) await onSaved(); } catch (problem) { setStatus((problem as Error).message); } finally { setBusy(false); }
  };
  const download = () => run(async () => { const file = await client.costBreakdown(); saveFile(file.filename, file.csv); }, '', false);
  return <section className="biz-card" aria-labelledby="biz-billing-invoice-details">
    <h2 id="biz-billing-invoice-details">{COPY.invoiceDetails}</h2>
    <p className="biz-quiet">{COPY.invoiceDetailsNote}</p>
    {profile
      ? <form className="biz-row" onSubmit={(event) => { event.preventDefault(); void run(() => client.savePoNumber(po)); }}>
        <label className="biz-field">{COPY.poNumber}<input value={po} maxLength={64} onChange={(event) => setPo(event.target.value)} /></label>
        <button type="submit" disabled={busy}>{COPY.save}</button>
      </form>
      : <p className="biz-quiet">{COPY.noProfile}</p>}
    {summary.venues.map((venue) => <form key={venue.venue_id} className="biz-row" onSubmit={(event) => { event.preventDefault(); void run(() => client.saveCostCentre(venue.venue_id, centres[venue.venue_id] ?? '')); }}>
      <label className="biz-field">{COPY.costCentre(venue.name)}<input value={centres[venue.venue_id] ?? ''} maxLength={64} onChange={(event) => setCentres({ ...centres, [venue.venue_id]: event.target.value })} /></label>
      <button type="submit" disabled={busy}>{COPY.save}</button>
    </form>)}
    {profile?.can_send_invoice && <fieldset>
      <legend>{COPY.collection}</legend>
      <label><input type="radio" name="biz-collection" checked={profile.collection_method === 'charge_automatically'} disabled={busy}
        onChange={() => void run(() => client.saveCollectionMethod('charge_automatically'))} />{COPY.byCard}</label>
      <label><input type="radio" name="biz-collection" checked={profile.collection_method === 'send_invoice'} disabled={busy}
        onChange={() => void run(() => client.saveCollectionMethod('send_invoice'))} />{COPY.byTransfer(profile.net_days ?? 30)}</label>
      <p className="biz-quiet">{COPY.transferNote}</p>
    </fieldset>}
    <div className="biz-row"><button type="button" onClick={() => void download()} disabled={busy}>{COPY.breakdown}</button></div>
    <p className="biz-quiet">{COPY.breakdownNote}</p>
    <p role="status" aria-live="polite">{status}</p>
  </section>;
}
