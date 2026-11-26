import { FormEvent, ReactNode, useState } from 'react';
import { AdminError, Reading, when } from './adminApi';
import { ActionButton, careful, REASONS, useConsole, write } from './safety';
import { Badge } from './ui';

// The Workers page's actions (doc 07b §7B.5), each through the console's tiers: pausing a pool and
// asking the autoscaler for a worker are Careful (they run at once and offer Undo); retrying many
// failed jobs is Careful after a count; cancelling jobs that waited too long is Delayed (15
// minutes, cancellable) with the count typed to confirm. The server enforces every rule.

export type Fail = { error: string };
export type Verdict = { state: 'working' | 'idle' | 'waiting' | 'failing' | 'paused'; label: string; why: string };
export type Pool = {
  pool: string; does: string; workers_seen: number; last_heartbeat: number | null; slots: number; slots_in_use: number;
  queued: number; running: number; failed_24h: number; succeeded_24h: number; oldest_queued_at: number | null;
  oldest_wait_s: number | null; recent: { outcome: string; error_class: string | null; at: number }[];
  paused: { target: string; since: number | null; reason: string; from_page: boolean } | null;
  autoscale_size: Reading; verdict: Verdict;
  retry_scheduled?: number; retry_overdue?: number; oldest_job_type?: string | null; stuck?: boolean;
};
export type ScaleRequest = { pool: string; workers: number; until: number; by: string; at: number; reason: string };
export type Autoscaler = { running: boolean; healthy: boolean; last_tick: Reading; token_on_api: boolean; settings: string[]; sizes: Record<string, Reading>; requests: ScaleRequest[] };

export function failed<T>(value: T | Fail | undefined): value is Fail {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'error' in (value as object);
}

export const POOL_NAMES: Record<string, string> = { 'cpu-light': 'CPU light', 'cpu-heavy': 'CPU heavy', export: 'Export', gpu: 'GPU' };
export const poolName = (pool: string) => POOL_NAMES[pool] ?? pool;

/** "4 min", "2 h 10 min", "3 days": how long something has waited, in words. */
export function waited(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return 'nothing waiting';
  if (seconds < 60) return 'under a minute';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) {
    const h = Math.floor(seconds / 3600); const m = Math.round((seconds % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.round(seconds / 86_400);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** A button that is disabled for a reason the console's permission rules don't know about. */
function Unavailable({ children, why }: { children: ReactNode; why: string }) {
  return <button type="button" disabled title={why}>{children}</button>;
}

/** Pause or resume one pool, and ask the autoscaler for a worker or for none. */
export function PoolActions({ pool, autoscaler, onChange }: { pool: Pool; autoscaler: Autoscaler | null; onChange: () => void }) {
  const ctx = useConsole();
  const name = poolName(pool.pool);
  const send = (command: string, reason: string) => write(ctx.api, { path: `/admin/hosted/pools/${pool.pool}/${command}`, body: { reason } }).then(onChange);
  const pause = () => careful(ctx, () => send('pause', 'Paused from the Workers page'), `${name} is paused: workers claim nothing new from it. Running work finishes.`, () => send('resume', 'Undo of a pause from the Workers page'));
  const resume = () => careful(ctx, () => send('resume', 'Resumed from the Workers page'), `${name} is taking jobs again.`);
  const request = autoscaler?.requests.find((r) => r.pool === pool.pool);
  const start = () => careful(ctx, () => send('start-test', 'One worker for a test hour'), `Asked the autoscaler for one ${name} worker until ${when(Date.now() / 1000 + 3600)}. It starts on the next pass, within a minute.`, () => send('release', 'Undo of a test worker request'));
  const stop = () => careful(ctx, () => send('stop', 'Stopped all workers from the Workers page'), `Asked the autoscaler to stop every ${name} worker for up to 24 hours. Queued jobs wait meanwhile.`, () => send('release', 'Undo of a stop request'));
  const release = () => careful(ctx, () => send('release', 'Handed back to the autoscaler'), `The autoscaler decides the ${name} pool by itself again.`);
  const noAutoscaler = 'The autoscaler isn’t running. See Autoscaler under Around the workers.';
  return (
    <div className="admin-actions" role="group" aria-label={`${name} commands`}>
      {pool.paused
        ? pool.paused.from_page
          ? <ActionButton permission="workers.drain" onPress={() => void resume()}>Resume {name}</ActionButton>
          : <small className="admin-soft">Drained from Emergency: release it there (waits 15 minutes).</small>
        : <ActionButton permission="workers.drain" onPress={() => void pause()}>Pause {name}</ActionButton>}
      {request
        ? <ActionButton permission="workers.scale" onPress={() => void release()}>Hand back to the autoscaler</ActionButton>
        : autoscaler?.running
          ? <>
            <ActionButton permission="workers.scale" onPress={() => void start()}>Start one worker for an hour</ActionButton>
            <ActionButton permission="workers.scale" onPress={() => void stop()}>Stop all workers</ActionButton>
          </>
          : <>
            <Unavailable why={noAutoscaler}>Start one worker for an hour</Unavailable>
            <Unavailable why={noAutoscaler}>Stop all workers</Unavailable>
            <small className="admin-soft admin-actions-why">Starting and stopping workers needs the autoscaler, which isn’t running (see Around the workers).</small>
          </>}
      {request && <Badge tone="warn">{request.workers ? `${request.workers} worker asked for` : 'Stopped by staff'} until {when(request.until)}</Badge>}
    </div>
  );
}

type Preview = { count: number; more: boolean; accounts: number; sample: string[]; version: string; errors?: [string, number][]; cutoff?: number };

const JOB_TYPES = ['analyse.song', 'seam.render', 'play.proxy', 'export.render', 'stems.window'];

/** Retry every failed job of one type (Careful): count first, then one press with the count on it. */
export function RetryFailed({ onChange }: { onChange: () => void }) {
  const ctx = useConsole();
  const [type, setType] = useState(JOB_TYPES[0]);
  const [found, setFound] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const count = async (event?: FormEvent) => {
    event?.preventDefault(); setError('');
    try { setFound(await ctx.api<Preview>(`/admin/hosted/preview?kind=retry_failed&type=${encodeURIComponent(type)}`)); }
    catch (problem) { setFound(null); setError(problem instanceof AdminError ? problem.message : (problem as Error).message); }
  };
  const retry = (preview: Preview) => careful(ctx, async () => {
    await write(ctx.api, { path: '/admin/hosted/jobs/retry-failed', body: { type, reason: `Retry failed ${type} jobs from the Workers page`, version: preview.version, read_at: Date.now() / 1000 } });
    setFound(null); onChange();
  }, `Retrying ${preview.count} failed ${type} jobs. They join the queue now.`);
  return (
    <div className="admin-bulk">
      <h3>Retry failed jobs of a type</h3>
      <p className="admin-soft">Every job of the type that failed in the last 7 days, at most 500. Retrying makes new attempts; it doesn’t undo anything. Fix the cause first, or they fail again.</p>
      <form className="admin-inline-form" onSubmit={(event) => void count(event)}>
        <label>Job type<select value={type} onChange={(event) => { setType(event.target.value); setFound(null); }}>{JOB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <button type="submit">Count failed jobs</button>
      </form>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {found && (found.count === 0
        ? <p role="status">No {type} job failed in the last 7 days. Nothing to retry.</p>
        : <div className="admin-dry-run" role="status">
          <p>{found.count}{found.more ? '+' : ''} failed {type} jobs from {found.accounts} account{found.accounts === 1 ? '' : 's'}.{found.errors?.length ? ` Errors: ${found.errors.map(([e, n]) => `${e} (${n})`).join(', ')}.` : ''}</p>
          {found.more ? <p className="admin-warning">Over 500: fix the cause, then retry from Jobs in parts.</p>
            : <ActionButton permission="jobs.retry" onPress={() => void retry(found)}>Retry {found.count} jobs</ActionButton>}
        </div>)}
    </div>
  );
}

/** Cancel jobs that have waited longer than N hours (Delayed): count, then the danger dialog. */
export function ExpireQueued({ pools, onChange }: { pools: string[]; onChange: () => void }) {
  const ctx = useConsole();
  const [hours, setHours] = useState(24);
  const [pool, setPool] = useState('');
  const [found, setFound] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const count = async (event?: FormEvent) => {
    event?.preventDefault(); setError('');
    try { setFound(await ctx.api<Preview>(`/admin/hosted/preview?kind=expire_queued&hours=${hours}${pool ? `&pool=${pool}` : ''}`)); }
    catch (problem) { setFound(null); setError(problem instanceof AdminError ? problem.message : (problem as Error).message); }
  };
  const ask = (preview: Preview) => ctx.ask({
    action: 'jobs.expire_queued', title: `Cancel ${preview.count} jobs waiting over ${hours} h`,
    button: `Queue cancelling ${preview.count} jobs`,
    consequences: [
      `${preview.count} queued jobs${pool ? ` in the ${poolName(pool)} pool` : ''} that have waited more than ${hours} hours are cancelled, from ${preview.accounts} account${preview.accounts === 1 ? '' : 's'}.`,
      'Those customers see the work as cancelled; they can start it again.',
      'It waits 15 minutes first, alerts every Owner, and can be cancelled from the bell until then. Jobs that start waiting after now are never included.',
    ],
    confirmText: String(preview.count), confirmLabel: `Type ${preview.count} to confirm`,
    reasons: ['No worker for days; the work is no longer wanted', 'Stuck after an incident', ...REASONS.incident.slice(0, 1)],
    irreversible: true, delayed: true,
    run: async (reason, confirm) => {
      const done = await write<{ action?: { execute_after: number } }>(ctx.api, { path: '/admin/hosted/jobs/expire-queued', body: { hours, pool: pool || null, reason, confirm, version: preview.version, read_at: Date.now() / 1000 } });
      ctx.toast({ text: `Queued: the jobs are cancelled after ${when(done.action?.execute_after)} unless someone cancels it.`, tone: 'ok' });
      setFound(null); onChange();
    },
    done: 'Queued.',
  });
  return (
    <div className="admin-bulk">
      <h3>Cancel jobs waiting too long</h3>
      <p className="admin-soft">For work nobody wants any more, after an outage. Fix the worker first if the work is still wanted. At most 500 at once.</p>
      <form className="admin-inline-form" onSubmit={(event) => void count(event)}>
        <label>Waiting longer than (hours)<input type="number" min={1} max={720} value={hours} onChange={(event) => { setHours(Number(event.target.value) || 1); setFound(null); }} /></label>
        <label>Pool<select value={pool} onChange={(event) => { setPool(event.target.value); setFound(null); }}><option value="">Every pool</option>{pools.map((p) => <option key={p} value={p}>{poolName(p)}</option>)}</select></label>
        <button type="submit">Count waiting jobs</button>
      </form>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {found && (found.count === 0
        ? <p role="status">No job has waited that long.</p>
        : <div className="admin-dry-run" role="status">
          <p>{found.count}{found.more ? '+' : ''} jobs from {found.accounts} account{found.accounts === 1 ? '' : 's'} have waited over {hours} hours.</p>
          <ActionButton permission="jobs.cancel" onPress={() => ask(found)}>Cancel these jobs…</ActionButton>
        </div>)}
    </div>
  );
}

/** The monthly budget (Careful, billing roles): a figure and when to warn. */
export function BudgetForm({ current, warn, version, onChange }: { current: number | null; warn: number; version: string; onChange: () => void }) {
  const ctx = useConsole();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(current ? String(current) : '');
  const [percent, setPercent] = useState(warn);
  const [reason, setReason] = useState('');
  if (!open) return <ActionButton permission="billing.subscriptions.manage" onPress={() => setOpen(true)}>{current ? 'Change budget' : 'Set budget'}</ActionButton>;
  const save = (event: FormEvent) => {
    event.preventDefault();
    const monthly = amount.trim() ? Number(amount) : null;
    void careful(ctx, async () => {
      await write(ctx.api, { path: '/admin/hosted/budget', method: 'PUT', body: { monthly_usd: monthly, warn_percent: percent, reason, version, read_at: Date.now() / 1000 } });
      setOpen(false); setReason(''); onChange();
    }, monthly ? `The cloud studio budget is $${monthly.toLocaleString()} a month, with a warning at ${percent}%.` : 'The cloud studio budget is cleared.');
  };
  return (
    <form className="admin-inline-form" onSubmit={save} aria-label="Set the monthly budget">
      <label>Monthly budget (USD)<input type="number" min={1} step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="None" /></label>
      <label>Warn at (% of budget)<input type="number" min={10} max={100} value={percent} onChange={(event) => setPercent(Number(event.target.value) || 80)} /></label>
      <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={2000} list="budget-reasons" /></label>
      <datalist id="budget-reasons">{['Monthly budget agreed', 'Beta spend limit', 'Raised for a launch'].map((r) => <option key={r} value={r} />)}</datalist>
      <button className="primary" disabled={!reason.trim()}>Save budget</button>
      <button type="button" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}
