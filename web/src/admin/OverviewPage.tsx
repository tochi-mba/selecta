import { useState } from 'react';
import { DataTable } from '../ui/DataTable';
import { AdminFetch, Metric, post, Reading, when } from './adminApi';
import { Command, Failure, Fresh, Panel, useLoad } from './parts';

type Overview = { now: number; refreshed: Reading; metrics: Metric[]; emergency: { control: string; target: string }[]; alerts: { id: string; kind: string; summary: string; created_at: number }[] };
type ControlState = { target: string; engaged: boolean; reason: string; changed_at: number; release_action_id: string | null };
type Control = { control: string; description: string; targets: string[]; states: ControlState[] };

const SECTIONS: { title: string; prefix: string }[] = [
  { title: 'Service health', prefix: 'health.' },
  { title: 'Jobs', prefix: 'jobs.' },
  { title: 'Workers', prefix: 'workers.' },
  { title: "Today's spend", prefix: 'spend.' },
  { title: 'Accounts and incidents', prefix: 'accounts.' },
];

function label(metric: Metric) {
  const parts = Object.entries(metric.labels).map(([key, value]) => `${key} ${value}`);
  return parts.length ? `${metric.name} (${parts.join(', ')})` : metric.name;
}

export function OverviewPage({ api, can }: { api: AdminFetch; can: (permission: string) => boolean }) {
  const overview = useLoad(() => api<Overview>('/admin/overview'), [api]);
  const metrics = overview.data?.metrics ?? [];
  const other = metrics.filter((m) => !SECTIONS.some((s) => m.name.startsWith(s.prefix)));
  return (
    <div className="admin-page">
      <Failure error={overview.error} />
      {overview.data && <p className="admin-note">Aggregates refreshed: <Fresh reading={overview.data.refreshed} format={(value) => when(value)} /></p>}
      <div className="admin-grid">
        {SECTIONS.map((section) => {
          const rows = metrics.filter((m) => m.name.startsWith(section.prefix)).concat(section.prefix === 'accounts.' ? other : []);
          return (
            <Panel key={section.prefix} title={section.title}>
              <DataTable caption={section.title} rows={rows} rowKey={label} empty="No measurements yet."
                columns={[{ key: 'name', label: 'Measure', render: label }, { key: 'value', label: 'Value', render: (m) => <Fresh reading={m} /> }]} />
            </Panel>
          );
        })}
      </div>
      <Panel title="Recent alerts">
        <DataTable caption="Recent alerts" rows={overview.data?.alerts ?? []} rowKey={(a) => a.id} empty="No alerts."
          columns={[{ key: 'created_at', label: 'When', render: (a) => when(a.created_at) }, { key: 'kind', label: 'Kind' }, { key: 'summary', label: 'What happened' }]} />
      </Panel>
      <EmergencyControls api={api} canManage={can('platform.emergency_controls.manage')} onChange={() => void overview.reload()} />
    </div>
  );
}

export function EmergencyControls({ api, canManage, onChange, only }: { api: AdminFetch; canManage: boolean; onChange?: () => void; only?: string[] }) {
  const controls = useLoad(() => api<{ controls: Control[] }>('/admin/emergency'), [api]);
  const [notice, setNotice] = useState('');
  const act = async (control: string, command: 'engage' | 'release', target: string, reason: string) => {
    const result = await api<{ action?: { execute_after: number } }>(`/admin/emergency/${control}/${command}`, post({ reason, target }));
    setNotice(command === 'release' ? `Release queued. It runs after ${when(result.action?.execute_after)} unless cancelled.` : `${control} is engaged.`);
    await controls.reload(); onChange?.();
  };
  const list = (controls.data?.controls ?? []).filter((c) => !only || only.includes(c.control));
  return (
    <Panel title="Emergency controls">
      <p className="admin-note">Engaging is instant and alerts every Owner. Turning a control off waits 15 minutes as a dangerous action.</p>
      <Failure error={controls.error} />
      {notice && <p role="status">{notice}</p>}
      <ul className="admin-controls">
        {list.map((control) => (
          <li key={control.control}>
            <div><strong>{control.control}</strong><p>{control.description}</p></div>
            {control.targets.map((target) => {
              const state = control.states.find((s) => s.target === target);
              const engaged = state?.engaged ?? false;
              return (
                <div key={target} className="admin-control-target">
                  <span>{target === '*' ? 'Everywhere' : target}: {engaged ? <b className="admin-engaged">Engaged</b> : 'Off'}</span>
                  {canManage && !engaged && <Command danger label={`Engage ${control.control}${target === '*' ? '' : ` for ${target}`}`} run={(reason) => act(control.control, 'engage', target, reason)} />}
                  {canManage && engaged && !state?.release_action_id && <Command label={`Release ${control.control}${target === '*' ? '' : ` for ${target}`}`} note="This waits 15 minutes before it runs." run={(reason) => act(control.control, 'release', target, reason)} />}
                  {engaged && state?.release_action_id && <small>Release waiting (action {state.release_action_id.slice(0, 8)})</small>}
                </div>
              );
            })}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
