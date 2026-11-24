import { Metric, money, Reading } from './adminApi';
import { METRICS } from './help';
import { useLoad } from './parts';
import { adminPath, go } from './route';
import { careful, useConsole } from './safety';
import { Badge, Empty, Problem, Section, Skeleton, Time, WhatsThis } from './ui';

type Business = {
  as_of: number; source: string; signups: Record<string, number>; paying: number; past_due: number;
  disputes_lost: number; mrr_minor: Record<string, number>; churn_30d: number | null;
  stuck_stripe_events: number; waiting_actions: number; open_alerts: number;
};
type Overview = {
  now: number; refreshed: Reading; metrics: Metric[]; emergency: { control: string; target: string }[];
  alerts: { id: string; kind: string; summary: string; created_at: number; acknowledged_at: number | null }[];
  business: Business; headline: { level: 'ok' | 'partial' | 'problem'; text: string; unknown: string[] };
};
type Check = { id: string; label: string; link: string; done: boolean; checked_by: string };

function name(metric: Metric) {
  const base = METRICS[metric.name]?.name ?? metric.name;
  const labels = Object.values(metric.labels);
  return labels.length ? `${base} (${labels.join(', ')})` : base;
}

function value(metric: Metric) {
  if (metric.state === 'unknown' || metric.value === null) return null;
  if (metric.name.startsWith('health.')) return metric.value >= 1 ? 'Healthy' : 'Down';
  const unit = METRICS[metric.name]?.unit;
  if (unit === 'USD') return `$${metric.value.toFixed(2)}`;
  if (unit === 's') return metric.value >= 120 ? `${Math.round(metric.value / 60)} min` : `${Math.round(metric.value)} s`;
  return metric.value.toLocaleString();
}

/** The five-second page (doc 07b §7B.4): one sentence, a few numbers, then detail one click away. */
export function OverviewPage() {
  const { api, can } = useConsole();
  const overview = useLoad(() => api<Overview>('/admin/overview'), [api]);
  const data = overview.data;
  const metrics = data?.metrics ?? [];
  const health = metrics.filter((m) => m.name.startsWith('health.'));
  const measured = metrics.filter((m) => !m.name.startsWith('health.') && m.state !== 'unknown');
  const unknown = metrics.filter((m) => !m.name.startsWith('health.') && m.state === 'unknown');
  const b = data?.business;
  return (
    <div className="admin-page">
      <Problem error={overview.error} onRetry={() => void overview.reload()} />
      {!data && !overview.error && <Skeleton rows={6} label="Loading the overview" />}
      {data && b && <>
        <p className={`admin-headline ${data.headline.level}`} data-tour="headline" role="status">
          {data.headline.text} <small className="admin-soft">Checked <Time at={data.now} />.</small>
        </p>
        {data.emergency.length > 0 && <p className="admin-warning">Emergency controls on: {data.emergency.map((e) => `${e.control}${e.target === '*' ? '' : ` (${e.target})`}`).join(', ')}. <a href={adminPath('emergency')} onClick={(event) => { event.preventDefault(); go(adminPath('emergency')); }}>Open Emergency</a></p>}
        <div className="admin-kpis" data-tour="kpis">
          <Kpi label="Paying customers" value={b.paying.toLocaleString()} help={b.source} link={adminPath('billing')} />
          <Kpi label="Monthly recurring revenue" value={Object.entries(b.mrr_minor).map(([c, v]) => money(v, c)).join(' + ') || money(0, 'gbp')} help={`${b.source} Monthly amounts, yearly plans divided by 12.`} />
          <Kpi label="Churn, 30 days" value={b.churn_30d === null ? 'No paying customers yet' : `${(b.churn_30d * 100).toFixed(1)}%`} help="Subscriptions that ended in the last 30 days, over those paying at the start." />
          <Kpi label="Sign-ups" value={`${b.signups.today} today · ${b.signups['7d']} this week`} help="New SelectaDJ accounts, from our own records." link={adminPath('customers')} />
          <Kpi label="Past due" value={b.past_due.toLocaleString()} tone={b.past_due ? 'warn' : undefined} help="Stripe could not take a payment; the customer keeps their plan during grace while Stripe retries." link={adminPath('billing', ['past_due'])} />
          <Kpi label="Stuck Stripe events" value={b.stuck_stripe_events.toLocaleString()} tone={b.stuck_stripe_events ? 'bad' : undefined} help="Stripe webhooks received but not processed after 15 minutes." link={adminPath('billing', ['events'])} />
          <Kpi label="Waiting dangerous actions" value={b.waiting_actions.toLocaleString()} help="Actions that wait 15 minutes before they run, and can be cancelled." link={adminPath('security', ['actions'])} />
          <Kpi label="Open alerts" value={b.open_alerts.toLocaleString()} tone={b.open_alerts ? 'warn' : undefined} help="Alerts nobody has acknowledged yet." link={adminPath('security', ['alerts'])} />
        </div>
        {can('security.owners.assign') && <Checklist />}
        <Section title="Services" help="Each service is measured by whatever talks to it. Unknown means nothing has reported it: the line under it says what feeds it.">
          <ul className="admin-health">{health.map((m) => (
            <li key={`${m.name}${JSON.stringify(m.labels)}`}>
              <span>{name(m)}</span>
              {value(m) ? <Badge tone={m.value && m.value >= 1 ? 'ok' : 'bad'}>{value(m)}</Badge> : <Badge>Not reporting</Badge>}
              {m.state === 'stale' && <Badge tone="warn">Stale</Badge>}
              {m.state === 'unknown' && <small className="admin-soft">{METRICS[m.name]?.feeds ?? 'Nothing reports this yet.'}</small>}
            </li>
          ))}</ul>
        </Section>
        <Section title="Work and accounts">
          <dl className="admin-numbers">{measured.map((m) => <div key={`${m.name}${JSON.stringify(m.labels)}`}><dt>{name(m)}</dt><dd>{value(m)}{m.state === 'stale' && <Badge tone="warn">Stale</Badge>}</dd></div>)}</dl>
          {unknown.length > 0 && <p className="admin-soft">Not reporting yet: {unknown.map(name).join(', ')}. See System for what connects them.</p>}
        </Section>
        <Section title="Recent alerts" actions={<a href={adminPath('security', ['alerts'])} onClick={(event) => { event.preventDefault(); go(adminPath('security', ['alerts'])); }}>All alerts</a>}>
          {data.alerts.length === 0 ? <Empty title="No alerts.">When a staff member is refused something that looks like an attack, an emergency control changes or a limit is reached, it appears here. None is good news.</Empty>
            : <ul className="admin-list">{data.alerts.slice(0, 5).map((a) => <li key={a.id}><Time at={a.created_at} /> {a.summary} {a.acknowledged_at ? <Badge>Seen</Badge> : <Badge tone="warn">New</Badge>}</li>)}</ul>}
        </Section>
      </>}
    </div>
  );
}

function Kpi({ label, value, help, link, tone }: { label: string; value: string; help: string; link?: string; tone?: 'warn' | 'bad' }) {
  const body = <><span className="admin-kpi-label">{label}<WhatsThis label={label}>{help}</WhatsThis></span><strong className={tone ? `admin-tone-${tone}` : undefined}>{value}</strong></>;
  return link
    ? <div className="admin-kpi">{body}<a href={link} onClick={(event) => { event.preventDefault(); go(link); }}>Details</a></div>
    : <div className="admin-kpi">{body}</div>;
}

/** The first-Owner setup checklist, while anything is left. */
function Checklist() {
  const ctx = useConsole();
  const list = useLoad(() => ctx.api<{ items: Check[] }>('/admin/checklist'), [ctx.api]);
  const items = list.data?.items ?? [];
  if (!items.length || items.every((i) => i.done)) return null;
  const mark = async (id: string) => {
    const done = items.filter((i) => i.done && i.checked_by === 'you').map((i) => i.id);
    await careful(ctx, () => ctx.api('/admin/me/preferences/checklist', { method: 'PUT', body: JSON.stringify({ value: { done: [...done, id] } }) }), 'Marked as done.');
    await list.reload();
  };
  return (
    <Section title="Setup checklist" tour="checklist" help="Things to do once before launch. Items the server can check tick themselves; mark the others when done.">
      <ul className="admin-checklist">{items.map((item) => (
        <li key={item.id}>
          <Badge tone={item.done ? 'ok' : 'neutral'}>{item.done ? 'Done' : 'To do'}</Badge>
          {item.link.startsWith('/') ? <a href={item.link} onClick={(event) => { event.preventDefault(); go(item.link); }}>{item.label}</a> : <span>{item.label}</span>}
          {!item.done && item.checked_by === 'you' && <button type="button" className="quiet" onClick={() => void mark(item.id)}>Mark done</button>}
        </li>
      ))}</ul>
    </Section>
  );
}
