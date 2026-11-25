import { FormEvent, useState } from 'react';
import { bytes, when } from './adminApi';
import { planBadge, statusBadge } from './CustomersPage';
import { LucyAllowance } from './LucyUsage';
import { useLoad } from './parts';
import { adminPath, go } from './route';
import { ActionButton, careful, REASONS, useConsole, write } from './safety';
import { StorageMode } from './StorageMode';
import { SignInsPanel } from './SignIns';
import { StripeLive } from './StripeLive';
import { AdminTable, Badge, CopyId, Empty, Problem, Section, Skeleton, Time, words } from './ui';

type Customer = {
  user: { id: string; email: string | null; created_at: number; suspended_at: number | null; timezone: string | null };
  workspace_id: string | null; version: string; read_at: number; staff_roles: string[]; deletion_pending: boolean;
  entitlement?: { plan: string; source: string; paid_plan: string; valid_until: number | null };
  storage?: { used_bytes: number; limit_bytes: number; state: string };
  overrides?: { id: string; plan_id: string; reason: string; actor: string; expires_at: number; created_at: number; revoked_at: number | null }[];
  valid_takedown_notices?: number; uploads_restricted?: boolean;
  subscriptions?: { stripe_subscription_id: string; status: string; price_id: string | null; current_period_end: number | null; cancel_at_period_end: boolean; past_due_since: number | null }[];
  stripe_customer_ids?: string[];
  stripe_events?: { event_id: string; type: string; status: string; received_at: number }[];
  devices?: { id: string; name: string | null; kind: string | null; last_seen_at: number | null; signed_out_at: number | null }[];
  rooms?: { open: number; total: number };
  lucy?: { turns_30d: number };
  jobs?: { id: string; type: string; state: string; error_class: string | null; created_at: number; waiting_reason?: string | null }[];
  activity: { id: string; created_at: number; actor_email: string | null; actor_id: string; action: string; result: string; reason: string | null }[];
  notes: { id: string; author: string; body: string; created_at: number }[];
};

const TABS = [['overview', 'Overview'], ['configuration', 'Configuration'], ['billing', 'Billing'], ['devices', 'Devices and rooms'], ['sign-ins', 'Sign-ins'], ['activity', 'Staff activity'], ['notes', 'Notes']] as const;
const SOURCE: Record<string, string> = { stripe: 'a paid subscription', override: 'a staff override', grace: 'payment grace', default: 'the free plan', free: 'the free plan' };

/** One customer (Stripe's customer page shape): identity and the main actions on top, the
 * changing things in the wide column, the stable facts with copyable ids on the right. */
export function CustomerRecord({ userId, tab }: { userId: string; tab: string }) {
  const ctx = useConsole();
  const record = useLoad(() => ctx.api<Customer>(`/admin/customers/${userId}`), [ctx.api, userId]);
  const r = record.data;
  if (record.error) return <div className="admin-page"><Problem error={record.error} onRetry={() => void record.reload()} /></div>;
  if (!r) return <div className="admin-page"><Skeleton rows={8} label="Loading the customer" /></div>;
  const email = r.user.email ?? r.user.id;
  const intent = { version: r.version, read_at: r.read_at };
  const reload = () => void record.reload();
  const signOut = () => careful(ctx, () => write(ctx.api, { path: `/admin/customers/${userId}/sign-out`, body: { reason: 'Signed out everywhere from the console', ...intent } }).then(reload), `Signed ${email} out on every device. They sign in again.`);
  const suspend = () => ctx.ask({
    action: 'account.suspend', title: `Suspend ${email}`, button: `Suspend ${email}`,
    consequences: [`${email} can sign in but can only read and sign out.`, 'Their jobs stop being processed.', 'Restore undoes it at any time.'],
    confirmText: email, confirmLabel: `Type ${email} to confirm`, reasons: REASONS.abuse, irreversible: false,
    run: async (reason, confirm) => { await write(ctx.api, { path: `/admin/customers/${userId}/suspend`, body: { reason, confirm, ...intent } }); ctx.toast({ text: `${email} is suspended. Restore undoes it.`, tone: 'ok' }); reload(); },
    done: 'Suspended.',
  });
  const restore = () => careful(ctx, () => write(ctx.api, { path: `/admin/customers/${userId}/restore`, body: { reason: 'Restored from the console', ...intent } }).then(reload), `${email} is active again.`);
  const remove = () => ctx.ask({
    action: 'account.delete', title: `Delete ${email}'s account`, button: `Queue deletion of ${email}`,
    consequences: [`After 15 minutes (unless cancelled), ${email} is signed out and their account is closed.`, 'Their data is erased after the deletion workflow’s recovery window, the same path as their own request.', 'Their subscription is cancelled by that workflow.'],
    confirmText: email, confirmLabel: `Type ${email} to confirm`, reasons: ['The customer asked for deletion in writing', 'Legal request'], irreversible: true, delayed: true,
    run: async (reason, confirm) => { await write(ctx.api, { path: `/admin/customers/${userId}/delete`, body: { reason, confirm, ...intent } }); ctx.toast({ text: `Deletion of ${email} is queued for 15 minutes; cancel it from the bell.`, tone: 'ok' }); reload(); },
    done: 'Queued.',
  });
  return (
    <div className="admin-record">
      <header className="admin-record-head" data-tour="customer-actions">
        <div>
          <h2>{email}</h2>
          <p>{r.entitlement && planBadge(r.entitlement.plan)} {statusBadge(r.user.suspended_at ? 'suspended' : 'active')} {r.staff_roles.length > 0 && <Badge>Staff: {r.staff_roles.map(words).join(', ')}</Badge>} {r.deletion_pending && <Badge tone="bad">Deletion waiting</Badge>}</p>
        </div>
        <div className="admin-actions">
          <ActionButton permission="security.sessions.revoke" onPress={() => void signOut()}>Sign out everywhere</ActionButton>
          {r.user.suspended_at
            ? <ActionButton permission="accounts.restore" onPress={() => void restore()}>Restore {email}</ActionButton>
            : <ActionButton permission="accounts.suspend" danger onPress={suspend}>Suspend…</ActionButton>}
        </div>
      </header>
      <nav className="admin-tabs" aria-label="Customer sections">
        {TABS.map(([id, label]) => <a key={id} href={adminPath('customers', [userId, id])} aria-current={tab === id ? 'page' : undefined} onClick={(event) => { event.preventDefault(); go(adminPath('customers', [userId, id])); }}>{label}</a>)}
      </nav>
      <div className="admin-record-body">
        <div className="admin-record-main">
          {tab === 'overview' && <><Overview r={r} userId={userId} onChange={reload} /><Jobs r={r} /></>}
          {tab === 'configuration' && <><StorageMode api={ctx.api} userId={userId} canChange={ctx.can('accounts.configure') && ctx.changesUntil !== null} /><LucyAllowance workspaceId={r.workspace_id} email={email} /></>}
          {tab === 'billing' && <><StripeLive userId={userId} email={email} /><Billing r={r} /></>}
          {tab === 'devices' && <Devices r={r} />}
          {tab === 'sign-ins' && <SignInsPanel userId={userId} />}
          {tab === 'activity' && <Activity r={r} />}
          {tab === 'notes' && <Notes r={r} userId={userId} onChange={reload} />}
        </div>
        <aside className="admin-record-facts" aria-label="Facts">
          <dl className="admin-facts">
            <div><dt>User id</dt><dd><CopyId id={r.user.id} label="user id" /></dd></div>
            <div><dt>Workspace</dt><dd><CopyId id={r.workspace_id} label="workspace id" /></dd></div>
            {(r.stripe_customer_ids ?? []).map((id) => <div key={id}><dt>Stripe customer</dt><dd><CopyId id={id} label="Stripe customer id" /> <a href={`https://dashboard.stripe.com/customers/${id}`} target="_blank" rel="noreferrer">Open in Stripe</a></dd></div>)}
            <div><dt>Joined</dt><dd><Time at={r.user.created_at} /></dd></div>
            <div><dt>Time zone</dt><dd>{r.user.timezone ?? 'not set'}</dd></div>
            {r.entitlement && <div><dt>Plan from</dt><dd>{SOURCE[r.entitlement.source] ?? r.entitlement.source}{r.entitlement.valid_until ? `, until ${when(r.entitlement.valid_until)}` : ''}</dd></div>}
          </dl>
          <div className="admin-danger-zone">
            <ActionButton permission="accounts.suspend" danger onPress={remove}>Delete account…</ActionButton>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Overview({ r, userId, onChange }: { r: Customer; userId: string; onChange: () => void }) {
  const ctx = useConsole();
  const [plan, setPlan] = useState('premium');
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState('');
  const grant = (event: FormEvent) => {
    event.preventDefault();
    void careful(ctx, async () => {
      const made = await write<{ override_id: string }>(ctx.api, { path: '/admin/overrides', body: { workspace_id: r.workspace_id, plan_id: plan, reason, expires_at: Date.now() / 1000 + days * 86_400, version: r.version, read_at: r.read_at } });
      setReason(''); onChange();
      return made;
    }, `Granted ${words(plan)} for ${days} days. It expires by itself.`);
  };
  const revoke = (id: string) => careful(ctx, () => ctx.api(`/admin/overrides/${id}?reason=${encodeURIComponent('Revoked from the console')}`, { method: 'DELETE' }).then(onChange), 'Override revoked; the account is back on its own plan.');
  return (
    <>
      <Section title="Plan and why">
        <p>{r.entitlement ? <>{planBadge(r.entitlement.plan)} from {SOURCE[r.entitlement.source] ?? r.entitlement.source}. Stripe says {words(r.entitlement.paid_plan)}.</> : 'No workspace yet.'}</p>
        {r.storage && <p>Cloud storage: {bytes(r.storage.used_bytes)} of {bytes(r.storage.limit_bytes)} ({words(r.storage.state)}). Lucy: {r.lucy?.turns_30d ?? 0} turns in 30 days.</p>}
        {r.uploads_restricted && <p className="admin-warning">Uploads restricted after {r.valid_takedown_notices} valid takedown notices.</p>}
      </Section>
      <Section title="Grant time" help="An entitlement override: the account gets this plan until it expires, then returns to its own plan. Not for your own workspace.">
        {ctx.can('billing.overrides.create') && ctx.changesUntil !== null ? (
          <form className="admin-inline-form" onSubmit={grant}>
            <label>Plan<select value={plan} onChange={(event) => setPlan(event.target.value)}>{['standard', 'premium'].map((p) => <option key={p} value={p}>{words(p)}</option>)}</select></label>
            <label>Days<input type="number" min={1} max={366} value={days} onChange={(event) => setDays(Number(event.target.value))} /></label>
            <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} list="grant-reasons" required /></label>
            <datalist id="grant-reasons">{REASONS.billing.map((x) => <option key={x} value={x} />)}</datalist>
            <button className="primary" disabled={!reason.trim()}>Grant {words(plan)} for {days} days</button>
          </form>
        ) : <p className="admin-soft">{ctx.can('billing.overrides.create') ? 'Press Make changes to grant time.' : ctx.needs('billing.overrides.create')}</p>}
        <AdminTable caption="Overrides" rows={r.overrides ?? []} rowKey={(o) => o.id} empty={<Empty title="No overrides.">Time granted by staff appears here with its expiry.</Empty>}
          cols={[{ key: 'plan_id', label: 'Plan', render: (o) => words(o.plan_id) }, { key: 'reason', label: 'Reason' }, { key: 'expires_at', label: 'Expires', render: (o) => <Time at={o.expires_at} /> },
            { key: 'state', label: 'State', render: (o) => o.revoked_at ? <Badge>Revoked</Badge> : <ActionButton permission="billing.overrides.create" onPress={() => void revoke(o.id)}>Revoke</ActionButton> }]} />
      </Section>
    </>
  );
}

function Jobs({ r }: { r: Customer }) {
  return (
    <Section title="Recent jobs" help="Background work for this customer: analysis, renders, exports.">
      <AdminTable caption="Recent jobs" rows={r.jobs ?? []} rowKey={(j) => j.id} empty={<Empty title="No jobs.">Browser accounts mostly do their work in the browser.</Empty>}
        cols={[{ key: 'type', label: 'Job', render: (j) => words(j.type) }, { key: 'state', label: 'State', render: (j) => <>{words(j.state)}{j.waiting_reason && <> <small className="admin-warning">{j.waiting_reason}</small></>}</> },
          { key: 'error_class', label: 'Error', render: (j) => j.error_class ?? '' }, { key: 'created_at', label: 'Started', render: (j) => <Time at={j.created_at} /> }]} />
    </Section>
  );
}

function Billing({ r }: { r: Customer }) {
  return (
    <Section title="Our copy of Stripe" help="What our database has from Stripe's webhooks. If it disagrees with Stripe, live, above, Stripe is right.">
      <AdminTable caption="Subscriptions" rows={r.subscriptions ?? []} rowKey={(s) => s.stripe_subscription_id} empty={<Empty title="No subscription.">This customer has never paid; they are on the free plan or a staff override.</Empty>}
        cols={[{ key: 'stripe_subscription_id', label: 'Subscription', render: (s) => <CopyId id={s.stripe_subscription_id} label="subscription id" /> }, { key: 'status', label: 'Status', render: (s) => <Badge tone={s.status === 'active' ? 'ok' : 'warn'}>{words(s.status)}</Badge> },
          { key: 'current_period_end', label: 'Renews', render: (s) => s.cancel_at_period_end ? <>Ends <Time at={s.current_period_end} /></> : <Time at={s.current_period_end} /> },
          { key: 'past_due_since', label: 'Past due since', render: (s) => s.past_due_since ? <Time at={s.past_due_since} /> : '' }]} />
      <h3>Stripe events</h3>
      <AdminTable caption="Stripe events" rows={r.stripe_events ?? []} rowKey={(e) => e.event_id} empty={<Empty title="No Stripe events for this customer." />}
        cols={[{ key: 'type', label: 'Event' }, { key: 'status', label: 'Status', render: (e) => <Badge tone={e.status === 'processed' ? 'ok' : 'warn'}>{words(e.status)}</Badge> }, { key: 'received_at', label: 'Received', render: (e) => <Time at={e.received_at} /> }]} />
    </Section>
  );
}

function Devices({ r }: { r: Customer }) {
  return (
    <Section title="Devices and rooms" help="Device names and when each was last seen; never tokens.">
      <AdminTable caption="Devices" rows={r.devices ?? []} rowKey={(d) => d.id} empty={<Empty title="No devices.">Devices appear when the customer opens SelectaDJ on them.</Empty>}
        cols={[{ key: 'name', label: 'Device', render: (d) => d.name ?? 'Unnamed' }, { key: 'kind', label: 'Kind', render: (d) => words(d.kind ?? '') }, { key: 'last_seen_at', label: 'Last seen', render: (d) => <Time at={d.last_seen_at} /> }, { key: 'signed_out_at', label: 'Signed out', render: (d) => d.signed_out_at ? <Time at={d.signed_out_at} /> : '' }]} />
      <p>Rooms: {r.rooms?.open ?? 0} open of {r.rooms?.total ?? 0}.</p>
    </Section>
  );
}

function Activity({ r }: { r: Customer }) {
  return (
    <Section title="What staff did to this customer">
      <AdminTable caption="Staff activity" rows={r.activity} rowKey={(a) => a.id} empty={<Empty title="No staff actions.">Every staff change to this customer is listed here, with who and why.</Empty>}
        cols={[{ key: 'created_at', label: 'When', render: (a) => <Time at={a.created_at} /> }, { key: 'actor', label: 'Who', render: (a) => a.actor_email ?? a.actor_id }, { key: 'action', label: 'Did', render: (a) => words(a.action.replace(/^admin\./, '')) }, { key: 'reason', label: 'Why' }]} />
    </Section>
  );
}

function Notes({ r, userId, onChange }: { r: Customer; userId: string; onChange: () => void }) {
  const ctx = useConsole();
  const [body, setBody] = useState('');
  const add = (event: FormEvent) => {
    event.preventDefault();
    void careful(ctx, () => write(ctx.api, { path: `/admin/customers/${userId}/notes`, body: { body } }).then(() => { setBody(''); onChange(); }), 'Note added.');
  };
  return (
    <Section title="Notes" help="Staff notes; the customer never sees them.">
      {ctx.can('support.cases.manage') && <form className="admin-inline-form" onSubmit={add}><label>New note<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} maxLength={4000} /></label><button className="primary" disabled={!body.trim() || ctx.changesUntil === null}>Add note</button></form>}
      {r.notes.length === 0 ? <Empty title="No notes yet.">Write what you did and why, so the next person knows.</Empty>
        : <ul className="admin-list">{r.notes.map((n) => <li key={n.id}><Time at={n.created_at} /> <strong>{n.author}</strong>: {n.body}</li>)}</ul>}
    </Section>
  );
}
