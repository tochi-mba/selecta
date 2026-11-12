import { FormEvent, useState } from 'react';
import { DataTable } from '../ui/DataTable';
import { AdminFetch, post, Reading, when } from './adminApi';
import { Command, Failure, Fresh, Panel, useLoad } from './parts';

type Job = { id: string; workspace_id: string; type: string; pool: string; lane: string; state: string; attempt_count: number; error_class: string | null; error_detail: string | null; est_cost_s: number; actual_cost_s: number | null; created_at: number };
type Attempt = { id: string; worker_id: string | null; started_at: number; ended_at: number | null; outcome: string | null; error_class: string | null; cost_s: number | null; lease_expires_at: number | null };
type Detail = { job: Job; attempts: Attempt[]; depends_on: { id: string; state: string; type: string }[]; needed_by: string[] };
type Worker = { id: string; pool: string; slots: number; last_seen: Reading; hold: string | null };

export function JobsPage({ api, can }: { api: AdminFetch; can: (permission: string) => boolean }) {
  const [filters, setFilters] = useState({ job_id: '', workspace_id: '', type: '', state: '' });
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const jobs = useLoad(() => api<{ jobs: Job[] }>(`/admin/jobs${query}`), [api, query]);
  const search = (event: FormEvent) => {
    event.preventDefault();
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value.trim()));
    setQuery(params.toString() ? `?${params}` : '');
  };
  return (
    <div className="admin-page">
      <Panel title="Find jobs">
        <form className="admin-filters" onSubmit={search} aria-label="Job search">
          {(['job_id', 'workspace_id', 'type', 'state'] as const).map((key) => (
            <label key={key}>{{ job_id: 'Job id', workspace_id: 'Workspace', type: 'Type', state: 'State' }[key]}
              <input value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })} /></label>
          ))}
          <button className="primary">Search</button>
        </form>
        <Failure error={jobs.error} />
        <DataTable caption="Jobs" rows={jobs.data?.jobs ?? []} rowKey={(j) => j.id} onPick={(j) => setPicked(j.id)} pickLabel={(j) => `Open job ${j.id}`}
          empty="No jobs match."
          columns={[{ key: 'id', label: 'Job', render: (j) => j.id.slice(0, 13) }, { key: 'type', label: 'Type' }, { key: 'state', label: 'State' },
            { key: 'pool', label: 'Pool and lane', render: (j) => `${j.pool} / ${j.lane}` }, { key: 'attempt_count', label: 'Attempts', numeric: true },
            { key: 'created_at', label: 'Created', render: (j) => when(j.created_at) }]} />
      </Panel>
      {picked && <JobDetail api={api} jobId={picked} can={can} onChanged={() => void jobs.reload()} />}
      <Workers api={api} canDrain={can('workers.drain')} />
    </div>
  );
}

function JobDetail({ api, jobId, can, onChanged }: { api: AdminFetch; jobId: string; can: (p: string) => boolean; onChanged: () => void }) {
  const detail = useLoad(() => api<Detail>(`/admin/jobs/${jobId}`), [api, jobId]);
  const [notice, setNotice] = useState('');
  const run = async (command: string, reason: string) => {
    const result = await api<{ job: { id: string; state: string } }>(`/admin/jobs/${jobId}/${command}`, post({ reason }));
    setNotice(`${command}: the job is now ${result.job.state}${result.job.id !== jobId ? ` (new job ${result.job.id})` : ''}.`);
    await detail.reload(); onChanged();
  };
  const job = detail.data?.job;
  return (
    <Panel title={`Job ${jobId.slice(0, 13)}`}>
      <Failure error={detail.error} />
      {notice && <p role="status">{notice}</p>}
      {job && <>
        <dl className="admin-facts">
          <dt>Type</dt><dd>{job.type}</dd><dt>State</dt><dd>{job.state}</dd><dt>Workspace</dt><dd>{job.workspace_id}</dd>
          <dt>Cost</dt><dd>{job.actual_cost_s ?? 0} s of {job.est_cost_s} s estimated</dd>
          {job.error_class && <><dt>Error</dt><dd>{job.error_class}: {job.error_detail}</dd></>}
        </dl>
        <div className="admin-actions" aria-label="Job commands">
          {can('jobs.retry') && <Command label="Retry" run={(r) => run('retry', r)} />}
          {can('jobs.cancel') && <Command danger label="Cancel" run={(r) => run('cancel', r)} />}
          {can('jobs.cancel') && <Command label="Quarantine" note="Holds the job out of line for inspection." run={(r) => run('quarantine', r)} />}
          {can('jobs.retry') && <Command label="Release" note="Puts a quarantined job back in line." run={(r) => run('release', r)} />}
        </div>
        <h3>Depends on</h3>
        <DataTable caption="Prerequisites" rows={detail.data?.depends_on ?? []} rowKey={(d) => d.id} empty="Needs nothing."
          columns={[{ key: 'id', label: 'Job' }, { key: 'type', label: 'Type' }, { key: 'state', label: 'State' }]} />
        <p className="admin-note">{detail.data?.needed_by.length ?? 0} jobs wait on this one.</p>
        <h3>Attempts and leases</h3>
        <DataTable caption="Attempts" rows={detail.data?.attempts ?? []} rowKey={(a) => a.id} empty="Not started yet."
          columns={[{ key: 'worker_id', label: 'Worker' }, { key: 'started_at', label: 'Started', render: (a) => when(a.started_at) },
            { key: 'lease_expires_at', label: 'Lease until', render: (a) => when(a.lease_expires_at) }, { key: 'outcome', label: 'Outcome', render: (a) => a.outcome ?? 'running' },
            { key: 'cost_s', label: 'Cost (s)', numeric: true, render: (a) => String(a.cost_s ?? '') }]} />
      </>}
    </Panel>
  );
}

function Workers({ api, canDrain }: { api: AdminFetch; canDrain: boolean }) {
  const workers = useLoad(() => api<{ workers: Worker[] }>('/admin/workers'), [api]);
  const run = async (id: string, command: string, reason: string) => { await api(`/admin/workers/${id}/${command}`, post({ reason })); await workers.reload(); };
  return (
    <Panel title="Workers">
      <Failure error={workers.error} />
      <DataTable caption="Workers" rows={workers.data?.workers ?? []} rowKey={(w) => w.id} empty="No workers registered."
        columns={[{ key: 'id', label: 'Worker' }, { key: 'pool', label: 'Pool' }, { key: 'slots', label: 'Slots', numeric: true },
          { key: 'last_seen', label: 'Last seen', render: (w) => <Fresh reading={w.last_seen} format={(v) => when(v)} /> },
          { key: 'hold', label: 'Hold', render: (w) => w.hold ?? 'none' },
          { key: 'actions', label: 'Commands', render: (w) => canDrain ? <span className="admin-actions">
            {w.hold ? <Command label="Resume" run={(r) => run(w.id, 'resume', r)} /> : <>
              <Command label="Drain" run={(r) => run(w.id, 'drain', r)} />
              <Command danger label="Pause" note="Also asks its running work to give way." run={(r) => run(w.id, 'pause', r)} /></>}
          </span> : null }]} />
    </Panel>
  );
}
