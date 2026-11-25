import { money } from './adminApi';
import { useLoad } from './parts';
import { ActionButton, careful, REASONS, useConsole, write } from './safety';
import { AdminTable, Badge, CopyId, Empty, Problem, Section, Time, words } from './ui';

type Sub = { id: string; status: string; cancel_at_period_end: boolean; current_period_end: number | null };
type Invoice = { id: string; number: string | null; status: string; amount_due: number; amount_paid: number; currency: string; created: number; hosted_invoice_url: string | null; refundable: boolean };
type Live = { connected: boolean; needs?: string; link?: string; error?: string; version?: string; customers?: string[]; subscriptions?: Sub[]; invoices?: Invoice[]; cards?: { brand: string; last4: string }[] };

/** The customer's billing as Stripe has it now, with the Stripe actions (doc 07b §7B.13). */
export function StripeLive({ userId, email }: { userId: string; email: string }) {
  const ctx = useConsole();
  const live = useLoad(() => ctx.api<Live>(`/admin/customers/${userId}/stripe`), [ctx.api, userId]);
  const data = live.data;
  const base = `/admin/customers/${userId}`;
  const reload = () => void live.reload();
  if (live.error) return <Problem error={live.error} onRetry={reload} />;
  if (!data) return <p className="admin-soft" aria-busy="true">Asking Stripe…</p>;
  if (!data.connected) return <Section title="Stripe, live"><p>Not connected: add <code>{data.needs}</code> to the API service’s environment. <a href={data.link} target="_blank" rel="noreferrer">Stripe’s API keys page</a></p></Section>;
  if (data.error) return <Section title="Stripe, live"><Problem error={data.error} onRetry={reload} /></Section>;
  const cancelLater = (s: Sub, cancel: boolean) => careful(ctx,
    () => write(ctx.api, { path: `${base}/stripe/subscriptions/${s.id}/cancel-at-period-end`, body: { cancel, reason: cancel ? 'Customer asked to cancel' : 'Customer changed their mind' } }).then(reload),
    cancel ? `Set to end at the period end. They keep it until then.` : 'The cancellation is undone; it renews as normal.',
    () => write(ctx.api, { path: `${base}/stripe/subscriptions/${s.id}/cancel-at-period-end`, body: { cancel: !cancel, reason: 'Undo' } }).then(reload));
  const cancelNow = (s: Sub) => ctx.ask({
    action: 'subscription.cancel_now', title: `Cancel ${email}'s subscription now`, button: 'Cancel the subscription now',
    consequences: ['Stripe ends the subscription at once; no refund is made by this.', `${email} drops to their free plan straight away.`, 'To refund, refund the invoice separately.'],
    confirmText: s.id, confirmLabel: `Type ${s.id} to confirm`, reasons: REASONS.billing, irreversible: true,
    run: async (reason, confirm) => { await write(ctx.api, { path: `${base}/stripe/subscriptions/${s.id}/cancel-now`, body: { reason, confirm } }); ctx.toast({ text: 'Subscription cancelled in Stripe.', tone: 'ok' }); reload(); },
    done: 'Cancelled.',
  });
  const retry = (i: Invoice) => careful(ctx, () => write(ctx.api, { path: `${base}/stripe/invoices/${i.id}/retry`, body: { reason: 'Retry after the customer updated their card', read_at: Date.now() / 1000 } }).then(reload), `Asked Stripe to collect invoice ${i.number ?? i.id} again.`);
  const refund = (i: Invoice) => ctx.ask({
    action: 'refund.create', title: `Refund ${money(i.amount_paid, i.currency)} to ${email}`, button: `Refund ${money(i.amount_paid, i.currency)}`,
    consequences: [`Stripe returns ${money(i.amount_paid, i.currency)} to the card that paid invoice ${i.number ?? i.id}.`, 'Refunds take 5 to 10 days to reach the customer.', 'It does not cancel the subscription.'],
    confirmText: i.number ?? i.id, confirmLabel: `Type ${i.number ?? i.id} (the invoice number) to confirm`, reasons: ['Requested by the customer', 'Charged twice', 'Goodwill for an outage'], irreversible: true,
    run: async (reason, confirm) => {
      const made = await write<{ amount: number; currency: string; status: string }>(ctx.api, { path: `${base}/stripe/invoices/${i.id}/refund`, body: { reason, confirm, why: reason === 'Charged twice' ? 'duplicate' : 'requested_by_customer' } });
      ctx.toast({ text: `Refund of ${money(made.amount, made.currency)} is ${made.status} in Stripe.`, tone: 'ok' }); reload();
    },
    done: 'Refunded.',
  });
  const portal = () => careful(ctx, async () => {
    const made = await write<{ url: string }>(ctx.api, { path: `${base}/portal-link`, body: { reason: 'Customer asked to manage billing', return_url: `${window.location.origin}/account/billing`, read_at: Date.now() / 1000 } });
    await navigator.clipboard?.writeText(made.url).catch(() => undefined);
  }, 'A billing portal link is on your clipboard. Send it to the customer; it works once and expires.');
  return (
    <Section title="Stripe, live" help="Read from Stripe just now. Stripe is the source of truth; every change here is re-read from Stripe afterwards."
      actions={<ActionButton permission="billing.subscriptions.manage" onPress={() => void portal()}>Copy a billing portal link</ActionButton>}>
      <p className="admin-soft">{(data.customers ?? []).map((c) => <CopyId key={c} id={c} label="Stripe customer" />)} {(data.cards ?? []).map((c) => <Badge key={c.last4}>{words(c.brand)} ending {c.last4}</Badge>)}</p>
      <AdminTable caption="Subscriptions in Stripe" rows={data.subscriptions ?? []} rowKey={(s) => s.id} empty={<Empty title="No subscription in Stripe." />}
        cols={[{ key: 'id', label: 'Subscription', render: (s) => <CopyId id={s.id} label="subscription" /> }, { key: 'status', label: 'Status', render: (s) => <Badge tone={s.status === 'active' ? 'ok' : 'warn'}>{words(s.status)}</Badge> },
          { key: 'end', label: 'Period ends', render: (s) => <>{s.cancel_at_period_end && <Badge tone="warn">Ends then</Badge>} <Time at={s.current_period_end} /></> },
          { key: 'do', label: '', render: (s) => (s.status === 'canceled' ? null : <span className="admin-actions">
            <ActionButton permission="billing.subscriptions.manage" onPress={() => void cancelLater(s, !s.cancel_at_period_end)}>{s.cancel_at_period_end ? 'Undo the cancellation' : 'Cancel at period end'}</ActionButton>
            <ActionButton permission="billing.subscriptions.manage" danger onPress={() => cancelNow(s)}>Cancel now…</ActionButton></span>) }]} />
      <AdminTable caption="Invoices" rows={data.invoices ?? []} rowKey={(i) => i.id} empty={<Empty title="No invoices yet." />}
        cols={[{ key: 'number', label: 'Invoice', render: (i) => (i.hosted_invoice_url ? <a href={i.hosted_invoice_url} target="_blank" rel="noreferrer">{i.number ?? i.id}</a> : i.number ?? i.id) },
          { key: 'amount', label: 'Amount', numeric: true, render: (i) => money(i.amount_due, i.currency) }, { key: 'status', label: 'Status', render: (i) => <Badge tone={i.status === 'paid' ? 'ok' : i.status === 'open' ? 'warn' : 'neutral'}>{words(i.status)}</Badge> },
          { key: 'created', label: 'Date', render: (i) => <Time at={i.created} /> },
          { key: 'do', label: '', render: (i) => <span className="admin-actions">
            {i.status === 'open' && <ActionButton permission="billing.subscriptions.manage" onPress={() => void retry(i)}>Retry payment</ActionButton>}
            {i.status === 'paid' && i.refundable && i.amount_paid > 0 && <ActionButton permission="billing.refunds.create" danger onPress={() => refund(i)}>Refund…</ActionButton>}</span> }]} />
    </Section>
  );
}
