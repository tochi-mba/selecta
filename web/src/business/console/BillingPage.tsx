import { PATHS, useBusiness } from '../context';

export function BillingPage() {
  const { org, go } = useBusiness();
  const billing = org.billing;
  const currency = billing.currency;
  const money = (amount: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount / 100);
  const canManage = org.role === 'owner' || org.role === 'admin';
  return <section className="biz biz-stack">
    <h1>Billing</h1>
    <p>Current plan: <strong>{billing.plan.replaceAll('_', ' ')}</strong></p>
    <p>Payment status: <strong>{billing.status.replaceAll('_', ' ')}</strong></p>
    {billing.grace_ends_at && billing.status !== 'ok' && <p role="alert">Payment grace ends {new Date(billing.grace_ends_at * 1000).toLocaleDateString()}.</p>}
    {billing.trial_ends_at && <p>Trial ends {new Date(billing.trial_ends_at * 1000).toLocaleDateString()}.</p>}
    {org.pilot && org.pilot.status !== 'converted' && <p>This organisation is in a pilot, ending {new Date(org.pilot.ends_at * 1000).toLocaleDateString()}.</p>}
    <section className="biz-card"><h2>Plan usage</h2>
      <p>Seats: {org.seats.included} included, {org.seats.paid} paid, {org.seats.held} held</p>
      {billing.storage && <p>Storage: {Math.round(billing.storage.used_bytes / 1048576)} MB of {Math.round(billing.storage.limit_bytes / 1048576)} MB</p>}
      <ul>{(billing.lines ?? []).map((line, index) => <li key={index}>{line.quantity} {line.item}, {money(line.unit_amount)} per {line.interval}</li>)}</ul>
    </section>
    <section className="biz-card"><h2>Invoices</h2>
      {!billing.invoices?.length && <p>No invoices yet.</p>}
      <ul>{(billing.invoices ?? []).map((invoice) => <li key={invoice.id}>
        {invoice.number}: {money(invoice.amount)} ({invoice.status}), {new Date(invoice.issued_at * 1000).toLocaleDateString()}
        {invoice.url && <a href={invoice.url} target="_blank" rel="noopener noreferrer"> View invoice</a>}
      </li>)}</ul>
    </section>
    {!canManage && <p className="biz-quiet">Only an owner or admin can change billing settings.</p>}
    {canManage && <button type="button" onClick={() => go(PATHS.section(org.id, 'settings'))}>Organisation settings</button>}
  </section>;
}
