import { useLoad } from './parts';
import { AdminRoute, adminPath, go } from './route';
import { useConsole } from './safety';
import { AdminTable, Badge, CopyId, Empty, Problem, Section, Time, words } from './ui';

type Row = Record<string, unknown> & { problems?: string[]; stuck?: boolean; missing?: boolean };
type Billing = { view: string; as_of: number; source: string; rows: Row[] };

const VIEWS = [['reconciliation', 'Reconciliation'], ['past_due', 'Past due'], ['events', 'Stripe events'], ['disputes', 'Disputes'], ['prices', 'Prices']] as const;
const EMPTY: Record<string, [string, string]> = {
  reconciliation: ['No subscriptions yet.', 'When customers pay, their subscriptions appear here with anything that disagrees with Stripe first.'],
  past_due: ['Nobody is past due.', 'When Stripe cannot take a payment, the customer appears here while Stripe retries.'],
  events: ['No Stripe events yet.', 'Stripe’s webhooks appear here; stuck ones come first.'],
  disputes: ['No disputes.', 'A lost chargeback appears here with the customer it belongs to.'],
  prices: ['No prices configured.', 'Set SELECTA_STRIPE_PRICES to the price map; each price shows its plan here.'],
};

/** Billing (doc 07b §7B.4): our copy of Stripe, problems first. Money moves only in Stripe. */
export function BillingPage({ route }: { route: AdminRoute }) {
  const { api } = useConsole();
  const view = (VIEWS.map(([id]) => id) as string[]).includes(route.rest[0] ?? '') ? route.rest[0] : 'reconciliation';
  const data = useLoad(() => api<Billing>(`/admin/billing?view=${view}`), [api, view]);
  const rows = data.data?.rows ?? [];
  const customer = (row: Row) => (row.user_id ? <a href={adminPath('customers', [String(row.user_id)])} onClick={(event) => { event.preventDefault(); go(adminPath('customers', [String(row.user_id)])); }}>{String(row.email ?? row.user_id)}</a> : <span className="admin-soft">unknown</span>);
  const subCols = [
    { key: 'email', label: 'Customer', render: customer },
    { key: 'status', label: 'Status', render: (r: Row) => <Badge tone={r.status === 'active' ? 'ok' : 'warn'}>{words(String(r.status))}</Badge> },
    { key: 'stripe_subscription_id', label: 'Subscription', render: (r: Row) => <CopyId id={String(r.stripe_subscription_id)} label="subscription id" /> },
    { key: 'current_period_end', label: 'Period ends', render: (r: Row) => <Time at={r.current_period_end as number} /> },
  ];
  return (
    <div className="admin-page">
      <nav className="admin-tabs" aria-label="Billing views" data-tour="billing-tabs">
        {VIEWS.map(([id, label]) => <a key={id} href={adminPath('billing', [id])} aria-current={view === id ? 'page' : undefined} onClick={(event) => { event.preventDefault(); go(adminPath('billing', [id])); }}>{label}</a>)}
      </nav>
      <p className="admin-soft" data-tour="billing-source">{data.data?.source} {data.data && <>Read <Time at={data.data.as_of} />.</>}</p>
      <Problem error={data.error} onRetry={() => void data.reload()} />
      <Section title={VIEWS.find(([id]) => id === view)?.[1] ?? 'Billing'} tour="billing-table">
        <AdminTable caption={`Billing ${view}`} rows={rows} rowKey={(r) => String(r.stripe_subscription_id ?? r.event_id ?? r.price_id)} loading={!data.data}
          empty={<Empty title={EMPTY[view][0]}>{EMPTY[view][1]}</Empty>}
          cols={view === 'events' ? [
            { key: 'type', label: 'Event' },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={r.stuck ? 'bad' : r.status === 'processed' ? 'ok' : 'warn'}>{r.stuck ? 'Stuck' : words(String(r.status))}</Badge> },
            { key: 'attempts', label: 'Attempts', numeric: true },
            { key: 'received_at', label: 'Received', render: (r) => <Time at={r.received_at as number} /> },
          ] : view === 'prices' ? [
            { key: 'price_id', label: 'Price', render: (r) => <CopyId id={String(r.price_id)} label="price id" /> },
            { key: 'plan', label: 'Plan', render: (r) => (r.missing ? <Badge tone="bad">Not in the price map</Badge> : words(String(r.plan))) },
            { key: 'interval', label: 'Interval', render: (r) => words(String(r.interval ?? '')) },
            { key: 'in_use', label: 'In use', render: (r) => (r.in_use ? 'Yes' : 'No') },
          ] : view === 'reconciliation' ? [
            ...subCols,
            { key: 'problems', label: 'Disagrees with Stripe', render: (r) => (r.problems?.length ? <Badge tone="bad">{r.problems.join('; ')}</Badge> : <Badge tone="ok">Agrees</Badge>) },
          ] : [...subCols, { key: 'past_due_since', label: view === 'disputes' ? 'Dispute lost' : 'Past due since', render: (r) => <Time at={(r.past_due_since ?? r.dispute_lost_at) as number} /> }]} />
      </Section>
    </div>
  );
}
