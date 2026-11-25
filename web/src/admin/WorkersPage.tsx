import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { RollingCount } from '../views/feelPieces';
import { AdminError, Reading } from './adminApi';
import { Workers } from './JobsPage';
import { adminPath, go } from './route';
import { useConsole } from './safety';
import { AdminTable, Badge, Empty, Problem, Section, Skeleton, Time, WhatsThis } from './ui';
import { Autoscaler, BudgetForm, ExpireQueued, Fail, failed, Pool, PoolActions, poolName, RetryFailed, waited } from './WorkersActions';

// The Workers page (doc 07b §7B.4, Workers): hosted processing at a glance. One read every 30
// seconds while the tab is open (`useVisiblePoll`); when a read fails the last good numbers stay,
// marked with their time. Each section can fail on its own and says so; the rest stays current.

type Gateway = { configured: boolean; setting: string; workers_last_seen: number | null; state: string; detail: string; checked_at?: number };
type Storage = { state: 'ok' | 'local' | 'problem' | 'not_configured'; problems: string[]; how?: string };
type Flag = { id: string; about: string; on: boolean; note: string | null };
type Waiting = { workspace_id: string; jobs: number; waiting_since: number | null; user_id: string | null; email: string | null };
type Customers = { hosted_accounts: number; accounts_waiting: number; songs_waiting: number; longest_s: number | null; top: Waiting[]; can_open: boolean };
type PoolCost = { pool: string; rate_per_hour: number | null; seconds_today: number; seconds_month: number; usd_today: number | null; usd_month: number | null };
type Cost = {
  pools: PoolCost[]; usd_today: number; usd_month: number; projected_usd: number; as_of: number; month: string;
  budget: { monthly_usd: number | null; warn_percent: number; status: 'unset' | 'ok' | 'near' | 'projected_over' | 'over'; set_at: number | null; version: string };
};
type Status = {
  now: number; pools: Pool[] | Fail; customers: Customers | Fail; cost: Cost | Fail;
  pieces: { gateway: Gateway | Fail; autoscaler: Autoscaler | Fail; storage: Storage | Fail; flags: Flag[] | Fail };
};

const usd = (value: number | null | undefined) => value === null || value === undefined ? 'no rate' : `$${value.toFixed(value < 10 ? 2 : 0)}`;
const hours = (seconds: number) => seconds < 3600 ? `${Math.round(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} h`;

export function WorkersPage() {
  const { api, can } = useConsole();
  const [data, setData] = useState<Status | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const latest = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const next = await api<Status>('/admin/hosted/status');
      if (mine !== latest.current) return;
      setData(next); setReadAt(Date.now() / 1000); setError('');
    } catch (problem) {
      if (mine === latest.current) setError(problem instanceof AdminError ? problem.message : (problem as Error).message);
    }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useVisiblePoll(load, 30_000);
  if (!data) return error ? <Problem error={error} onRetry={() => void load()} /> : <Skeleton rows={8} label="Loading hosted processing" />;
  const pools = failed(data.pools) ? null : data.pools;
  const auto = failed(data.pieces.autoscaler) ? null : data.pieces.autoscaler;
  const paused = (pools ?? []).filter((p) => p.paused);
  return (
    <div className="admin-page">
      <Headline pools={data.pools} />
      <p className="admin-soft admin-asof" role="status">
        {error ? <><Badge tone="warn">Stale</Badge> As of <Time at={readAt} />. The last read failed: {error} <button type="button" className="quiet" onClick={() => void load()}>Try again</button></>
          : <>Checked <Time at={readAt} />; reads again every 30 seconds.</>}
      </p>
      {paused.map((p) => (
        <p key={p.pool} className="admin-pause-banner" role="status">
          <strong>{poolName(p.pool)} is paused</strong>{p.paused?.target === '*' ? ' (every pool, from Emergency)' : ''}{p.paused?.since && <> since <Time at={p.paused.since} /></>}: {p.paused?.reason || 'no reason given'}. Workers claim nothing new from it; running work finishes. {p.queued > 0 && `${p.queued} jobs wait meanwhile.`}
        </p>
      ))}
      <Section title="Pools" tour="workers-pools" help="One worker pool per kind of work. Each card says in one word whether it is fine, then the numbers behind that word.">
        {failed(data.pools) ? <Problem error={data.pools.error} onRetry={() => void load()} />
          : <ul className="admin-pools">{data.pools.map((pool) => <PoolCard key={pool.pool} pool={pool} autoscaler={auto} onChange={() => void load()} />)}</ul>}
      </Section>
      <Pieces pieces={data.pieces} />
      <CustomersSection customers={data.customers} />
      <CostSection cost={data.cost} onChange={() => void load()} />
      {(can('jobs.retry') || can('jobs.cancel')) && (
        <Section title="Many jobs at once" tour="workers-bulk" help="Each counts first and says how many jobs and accounts it would touch. Retry runs at once; cancelling waits 15 minutes and can be cancelled.">
          <div className="admin-bulks">
            <RetryFailed onChange={() => void load()} />
            <ExpireQueued pools={(pools ?? []).map((p) => p.pool)} onChange={() => void load()} />
          </div>
        </Section>
      )}
      {can('workers.read') && <Workers api={api} canDrain={can('workers.drain')} />}
      <Explainer />
    </div>
  );
}

function Headline({ pools }: { pools: Pool[] | Fail }) {
  if (failed(pools)) return <p className="admin-headline problem" data-tour="workers-headline" role="status">The pool numbers couldn’t be read. The rest of the page is current.</p>;
  const worst = (state: string) => pools.filter((p) => p.verdict.state === state);
  const never = pools.every((p) => p.last_heartbeat === null);
  const queued = pools.reduce((n, p) => n + p.queued, 0);
  let level: 'ok' | 'partial' | 'problem' = 'ok';
  let text: string;
  const problems: string[] = [];
  if (worst('waiting').length) {
    const p = worst('waiting')[0];
    problems.push(`${worst('waiting').map((x) => poolName(x.pool)).join(' and ')}: waiting for a worker. ${p.queued} jobs queued, the oldest for ${waited(p.oldest_wait_s)}, and no worker is taking them.`);
  }
  if (worst('failing').length) problems.push(`${worst('failing').map((p) => poolName(p.pool)).join(' and ')}: failing; the latest attempts all failed.`);
  if (problems.length) {
    level = 'problem';
    text = problems.join(' ');
  } else if (never) {
    level = 'partial';
    text = queued ? `No worker has ever checked in, and ${queued} jobs are waiting.` : 'No worker has ever checked in. Nothing is waiting yet.';
  } else if (worst('paused').length) {
    level = 'partial';
    text = `${worst('paused').map((p) => poolName(p.pool)).join(' and ')} paused by staff; the other pools are fine.`;
  } else if (worst('working').length) {
    text = 'Hosted processing is working.';
  } else {
    text = 'Every pool is idle: nothing is waiting.';
  }
  return <p className={`admin-headline ${level}`} data-tour="workers-headline" role="status">{text}</p>;
}

function Fig({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return <div><dt>{label}<WhatsThis label={label}>{help}</WhatsThis></dt><dd>{children}</dd></div>;
}

const VERDICT_TONE = { working: 'ok', idle: 'neutral', waiting: 'bad', failing: 'bad', paused: 'warn' } as const;

function PoolCard({ pool, autoscaler, onChange }: { pool: Pool; autoscaler: Autoscaler | null; onChange: () => void }) {
  const size = pool.autoscale_size;
  return (
    <li className={`admin-pool ${pool.verdict.state}`} data-lift="row">
      <div className="admin-pool-head">
        <h3>{poolName(pool.pool)} <code className="admin-soft">{pool.pool}</code></h3>
        <Badge tone={VERDICT_TONE[pool.verdict.state]}>{pool.verdict.label}</Badge>
      </div>
      <p className="admin-soft">Runs {pool.does}.</p>
      <p>{pool.verdict.why}</p>
      <dl className="admin-numbers">
        <Fig label="Workers seen" help="Workers that checked in with the gateway in the last two minutes."><RollingCount value={pool.workers_seen} format={(n) => n.toLocaleString()} /></Fig>
        <Fig label="Last heartbeat" help="When any worker of this pool last checked in."><Time at={pool.last_heartbeat} /></Fig>
        <Fig label="Slots in use" help="Jobs being worked on now, of the slots the workers seen offer.">{pool.slots_in_use} of {pool.slots}</Fig>
        <Fig label="Queued" help="Jobs waiting for a worker, including retries waiting for their time."><RollingCount value={pool.queued} format={(n) => n.toLocaleString()} /></Fig>
        <Fig label="Running" help="Jobs a worker holds now.">{pool.running.toLocaleString()}</Fig>
        <Fig label="Failed, 24 h" help="Jobs that ran out of attempts in the last 24 hours. Open Jobs to read why.">
          <span className={pool.failed_24h ? 'admin-tone-bad' : undefined}>{pool.failed_24h.toLocaleString()}</span>
          {pool.failed_24h > 0 && <> <a href={adminPath('jobs')} onClick={(event) => { event.preventDefault(); go(adminPath('jobs')); }}>Open Jobs</a></>}
        </Fig>
        <Fig label="Oldest wait" help="How long the oldest queued job has waited."><span className={pool.oldest_wait_s && pool.oldest_wait_s > 600 ? 'admin-tone-warn' : undefined}>{waited(pool.oldest_wait_s)}</span></Fig>
        <Fig label="Autoscaler asks for" help="How many workers the autoscaler last set this pool to. Unknown while it isn’t running.">{size.state === 'unknown' ? <span className="admin-soft">not running</span> : `${size.value ?? 0} worker${size.value === 1 ? '' : 's'}`}</Fig>
      </dl>
      {pool.recent.length > 0 && <p className="admin-soft">Last attempts: {pool.recent.map((a) => a.outcome === 'succeeded' ? 'ok' : (a.error_class ?? a.outcome)).join(', ')}.</p>}
      <PoolActions pool={pool} autoscaler={autoscaler} onChange={onChange} />
    </li>
  );
}

type Piece = { name: string; badge: ReactNode; means: ReactNode; todo: ReactNode; extra?: ReactNode };

function gatewayPiece(g: Gateway): Piece {
  const last = g.workers_last_seen ? <>Workers last reached it <Time at={g.workers_last_seen} />.</> : 'No worker has ever reached it.';
  const byState: Record<string, [ReactNode, ReactNode, ReactNode]> = {
    ok: [<Badge tone="ok">Ready</Badge>, <>Workers can register, claim jobs and fetch songs through it, and its database schema matches the API’s. {last}</>, 'Nothing.'],
    not_configured: [<Badge>Not checked</Badge>, <>The API doesn’t know the gateway’s address, so it can’t ask it. {last}</>, <>Set <code>{g.setting}</code> on the API service to the gateway’s public address (the value the workers use), then redeploy.</>],
    unreachable: [<Badge tone="bad">Not answering</Badge>, <>Workers can’t register or claim jobs, so every job waits. {last}</>, 'Open the worker-gateway service in Render: check it is deployed and running, then read its logs.'],
    not_ready: [<Badge tone="bad">Not ready</Badge>, <>It answers, but its database can’t be reached or its migrations are behind. {last}</>, <>Check <code>SELECTA_GATEWAY_DATABASE_URL</code> on the gateway and run <code>selecta db upgrade</code>.</>],
    schema_mismatch: [<Badge tone="bad">Different schema</Badge>, <>The gateway and the API run different deploys, so claims and completions can fail. {last}</>, 'Deploy the same commit to the API and the gateway.'],
  };
  const [badge, means, todo] = byState[g.state] ?? byState.unreachable;
  return { name: 'Worker gateway', badge, means, todo, extra: g.configured && <small className="admin-soft">{g.detail}{g.checked_at && <> Checked <Time at={g.checked_at} />.</>}</small> };
}

function autoscalerPiece(a: Autoscaler): Piece {
  const token = <small className="admin-soft">Modal token on this API service: {a.token_on_api ? 'yes' : 'no'} (the autoscaler itself runs on the maintenance service; the value is never shown).</small>;
  if (a.running && a.healthy) return { name: 'Autoscaler', badge: <Badge tone="ok">Running</Badge>, means: <>It starts and stops Modal workers as work arrives. Last pass <Time at={a.last_tick.as_of} />.</>, todo: 'Nothing.', extra: token };
  if (a.running) return { name: 'Autoscaler', badge: <Badge tone="bad">Modal refused</Badge>, means: <>Its last pass (<Time at={a.last_tick.as_of} />) couldn’t scale a pool on Modal.</>, todo: 'Read the maintenance service’s logs for “Couldn’t scale the … pool” and check the Modal app is deployed.', extra: token };
  return {
    name: 'Autoscaler', badge: <Badge tone="warn">Not running</Badge>,
    means: 'Nothing starts workers: every Modal function is set to zero containers, so queued jobs wait until someone starts one by hand.',
    todo: <>Set {a.settings.map((s, i) => <span key={s}>{i ? ', ' : ''}<code>{s}</code></span>)} on the maintenance service (<code>selecta maintain</code>) and keep the <code>cloud.autoscale</code> flag on (launch-operator-checklist, section 5).</>,
    extra: token,
  };
}

function storagePiece(s: Storage): Piece {
  const link = <a href={adminPath('system')} onClick={(event) => { event.preventDefault(); go(adminPath('system')); }}>Open System</a>;
  if (s.state === 'ok') return { name: 'Object storage', badge: <Badge tone="ok">Reachable</Badge>, means: 'Every bucket exists and the API can write to it, so uploads, analysis files and exports can be stored.', todo: 'Nothing.' };
  if (s.state === 'local') return { name: 'Object storage', badge: <Badge>Local disk</Badge>, means: s.how ?? 'The local stack keeps files on disk.', todo: 'Nothing on a local stack.' };
  if (s.state === 'not_configured') return { name: 'Object storage', badge: <Badge tone="bad">Not configured</Badge>, means: 'Nothing can be uploaded or stored, so workers have nothing to work on.', todo: <>{s.how} {link}</> };
  return { name: 'Object storage', badge: <Badge tone="bad">Problem</Badge>, means: s.problems.join(' '), todo: <>Fix the bucket named. {link}</> };
}

function Pieces({ pieces }: { pieces: Status['pieces'] }) {
  const list: (Piece | { name: string; error: string })[] = [
    failed(pieces.gateway) ? { name: 'Worker gateway', error: pieces.gateway.error } : gatewayPiece(pieces.gateway),
    failed(pieces.autoscaler) ? { name: 'Autoscaler', error: pieces.autoscaler.error } : autoscalerPiece(pieces.autoscaler),
    failed(pieces.storage) ? { name: 'Object storage', error: pieces.storage.error } : storagePiece(pieces.storage),
  ];
  return (
    <Section title="Around the workers" tour="workers-pieces" help="What workers need to process anything. Each line says what its state means and what to do about it.">
      <ul className="admin-pieces">{list.map((piece) => 'error' in piece
        ? <li key={piece.name} data-lift="row"><strong>{piece.name}</strong><Problem error={piece.error} /></li>
        : <li key={piece.name} data-lift="row">
          <div className="admin-pool-head"><strong>{piece.name}</strong>{piece.badge}</div>
          <p><span className="admin-soft">What this means: </span>{piece.means}</p>
          <p><span className="admin-soft">What to do: </span>{piece.todo}</p>
          {piece.extra}
        </li>)}
        <li data-lift="row">
          <strong>Hosted flags</strong>
          {failed(pieces.flags) ? <Problem error={pieces.flags.error} /> : <ul className="admin-health">{pieces.flags.map((f) => (
            <li key={f.id}><code>{f.id}</code><Badge tone={f.on ? 'ok' : 'warn'}>{f.on ? 'On' : 'Off'}</Badge><span>{f.about}{f.note && `. ${f.note}`}.</span></li>
          ))}</ul>}
          <p><span className="admin-soft">What to do: </span>a flag that is off here is off in the build; change it in Flags, or grant hosted storage to an account from its customer page.</p>
        </li>
      </ul>
    </Section>
  );
}

function CustomersSection({ customers }: { customers: Customers | Fail }) {
  return (
    <Section title="What customers see meanwhile" tour="workers-customers" help="Accounts with hosted storage and how long their songs have waited for processing. Their song card says “waiting for a worker” while nothing takes their jobs.">
      {failed(customers) ? <Problem error={customers.error} /> : <>
        <div className="admin-kpis">
          <Kpi label="Accounts with hosted storage" help="Accounts granted hosted storage and processing (cloud.hosted_media) from their customer page." value={customers.hosted_accounts} />
          <Kpi label="Accounts waiting" help="Accounts with hosted work queued or running now." value={customers.accounts_waiting} tone={customers.accounts_waiting ? 'warn' : undefined} />
          <Kpi label="Songs waiting for analysis" help="Song analyses not finished yet. A song can’t join a server mix until it is analysed." value={customers.songs_waiting} />
          <div className="admin-kpi"><span className="admin-kpi-label">Longest wait<WhatsThis label="Longest wait">The longest any account’s oldest unfinished job has waited.</WhatsThis></span><strong className={customers.longest_s && customers.longest_s > 3600 ? 'admin-tone-bad' : undefined}>{customers.longest_s ? waited(customers.longest_s) : 'none'}</strong></div>
        </div>
        {customers.hosted_accounts === 0 && customers.top.length === 0
          ? <Empty title="No account has hosted storage yet.">Grant it from a customer’s page: Configuration, Storage mode. Their uploads then queue analysis here.</Empty>
          : customers.top.length === 0 ? <Empty title="Nobody is waiting.">When an account’s songs wait for a worker, the longest waits are listed here.</Empty>
          : <AdminTable caption="Accounts waiting longest" rows={customers.top} rowKey={(r) => r.workspace_id} sortKey="wsort"
            onOpen={customers.can_open ? (r) => r.user_id && go(adminPath('customers', [r.user_id])) : undefined}
            openLabel={(r) => `Open ${r.email ?? r.workspace_id}`} empty={null}
            cols={[
              { key: 'who', label: 'Account', render: (r) => r.email ?? <code>{r.workspace_id.slice(0, 13)}</code> },
              { key: 'jobs', label: 'Jobs waiting', numeric: true, sort: (r) => r.jobs },
              { key: 'since', label: 'Waiting since', render: (r) => <Time at={r.waiting_since} />, sort: (r) => r.waiting_since ?? 0 },
            ]} />}
        {!customers.can_open && customers.top.length > 0 && <p className="admin-soft">Opening a customer needs the Support, Billing or Admin role; workspace ids are shown instead.</p>}
      </>}
    </Section>
  );
}

function Kpi({ label, help, value, tone }: { label: string; help: string; value: number; tone?: 'warn' | 'bad' }) {
  return <div className="admin-kpi"><span className="admin-kpi-label">{label}<WhatsThis label={label}>{help}</WhatsThis></span><strong className={tone ? `admin-tone-${tone}` : undefined}><RollingCount value={value} format={(n) => n.toLocaleString()} /></strong></div>;
}

const BUDGET_WORDS = {
  unset: ['neutral', 'No budget set'], ok: ['ok', 'Within budget'], near: ['warn', 'Near the budget'],
  projected_over: ['warn', 'On course to go over'], over: ['bad', 'Over budget'],
} as const;

function CostSection({ cost, onChange }: { cost: Cost | Fail; onChange: () => void }) {
  if (failed(cost)) return <Section title="Cost" tour="workers-cost"><Problem error={cost.error} /></Section>;
  const b = cost.budget;
  const [tone, label] = BUDGET_WORDS[b.status];
  return (
    <Section title="Cost (estimate)" tour="workers-cost" help="Processing seconds the workers reported, times each pool’s hourly rate in infra/workers/pools.json. Modal also bills start-up and idle container time, so its invoice is the truth; this is for noticing trends early."
      actions={<BudgetForm current={b.monthly_usd} warn={b.warn_percent} version={b.version} onChange={onChange} />}>
      <div className="admin-kpis">
        <div className="admin-kpi"><span className="admin-kpi-label">Today, estimated</span><strong>{usd(cost.usd_today)}</strong></div>
        <div className="admin-kpi"><span className="admin-kpi-label">{cost.month}, estimated</span><strong>{usd(cost.usd_month)}</strong></div>
        <div className="admin-kpi"><span className="admin-kpi-label">Whole month at this pace<WhatsThis label="Whole month at this pace">This month so far, scaled to the whole month.</WhatsThis></span><strong>{usd(cost.projected_usd)}</strong></div>
        <div className="admin-kpi"><span className="admin-kpi-label">Monthly budget</span><strong>{b.monthly_usd ? `$${b.monthly_usd.toLocaleString()}` : 'None'}</strong><Badge tone={tone}>{label}</Badge></div>
      </div>
      {(b.status === 'over' || b.status === 'near' || b.status === 'projected_over') && <p className="admin-warning" role="status">
        {b.status === 'over' ? `The estimate for ${cost.month} is over the $${b.monthly_usd} budget.` : b.status === 'near' ? `The estimate has passed ${b.warn_percent}% of the $${b.monthly_usd} budget.` : `At this pace ${cost.month} ends near ${usd(cost.projected_usd)}, over the $${b.monthly_usd} budget.`} Look at which pool grows below; pausing a pool stops new work in it.
      </p>}
      <AdminTable caption="Processing per pool" rows={cost.pools} rowKey={(p) => p.pool} sortKey="csort" empty={null}
        cols={[
          { key: 'pool', label: 'Pool', render: (p) => poolName(p.pool) },
          { key: 'rate', label: 'Rate an hour', numeric: true, render: (p) => usd(p.rate_per_hour), help: 'One worker of the pool for an hour, from infra/workers/pools.json.' },
          { key: 'today', label: 'Processing today', numeric: true, render: (p) => hours(p.seconds_today), sort: (p) => p.seconds_today },
          { key: 'usd_today', label: 'Today', numeric: true, render: (p) => usd(p.usd_today) },
          { key: 'month', label: 'This month', numeric: true, render: (p) => hours(p.seconds_month), sort: (p) => p.seconds_month },
          { key: 'usd_month', label: 'Month', numeric: true, render: (p) => usd(p.usd_month), sort: (p) => p.usd_month ?? 0 },
        ]} />
      <p className="admin-soft">Days and months are UTC. Figures as of <Time at={cost.as_of} /> (counted at most every two minutes).</p>
    </Section>
  );
}

function Explainer() {
  return (
    <Section title="How hosted processing works" tour="workers-explainer">
      <details className="admin-explainer">
        <summary>Read it once: from upload to export, and which pool does what</summary>
        <ol className="admin-steps">
          <li><strong>Upload.</strong> A customer with hosted storage uploads songs straight to object storage (R2). The API checks each file and queues its analysis.</li>
          <li><strong>Analysis</strong> (<code>analyse.song</code>, CPU heavy): tempo, beat grid, key, sections, loudness. A song joins a server mix only once analysed.</li>
          <li><strong>Transitions</strong> (<code>seam.render</code>, CPU heavy): each hand-off of a server mix is planned and rendered the local app’s way.</li>
          <li><strong>Playback files</strong> (<code>play.proxy</code>, CPU light): a lossless file per song, cut at the transitions, played gaplessly in the browser.</li>
          <li><strong>Export</strong> (<code>export.render</code>, Export pool): one file of the whole mix, up to two hours of work.</li>
          <li><strong>Stems</strong> (GPU pool): not deployed; waits for the Demucs licence decision.</li>
        </ol>
        <p>Workers are Modal functions. Each registers with the <strong>worker gateway</strong>, claims jobs from its pool, fetches and stores files through short-lived signed links, and reports back. Nothing starts them unless the <strong>autoscaler</strong> (part of <code>selecta maintain</code>) has the Modal token; it scales each pool to the work waiting and to zero when idle, so idle costs nothing.</p>
      </details>
    </Section>
  );
}
