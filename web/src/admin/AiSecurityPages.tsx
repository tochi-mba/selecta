import { FormEvent, useState } from 'react';
import { DataTable } from '../ui/DataTable';
import { AdminFetch, post, when } from './adminApi';
import { EmergencyControls } from './OverviewPage';
import { Command, Failure, Panel, useLoad } from './parts';

type Deployment = { id: string; provider: string; model_id: string; min_tier: string; status: string; rollout_percent: number; fallback_id: string | null; per_turn_cost_cap_usd: number; emergency_disabled: boolean };
type Routing = { routing_version: number; map: Record<string, Record<string, string[]>>; lucy_disabled: boolean; deployments: Deployment[] };

export function AiPage({ api, can }: { api: AdminFetch; can: (permission: string) => boolean }) {
  const routing = useLoad(() => api<Routing>('/admin/ai'), [api]);
  const rows = Object.entries(routing.data?.map ?? {}).flatMap(([tier, classes]) => Object.entries(classes).map(([cls, ids]) => ({ tier, cls, ids })));
  return (
    <div className="admin-page">
      <Failure error={routing.error} />
      {routing.data?.lucy_disabled && <p className="admin-error" role="status">Lucy is switched off by an emergency control.</p>}
      <Panel title={`Tier routing (version ${routing.data?.routing_version ?? '...'})`}>
        <DataTable caption="Tier to deployment" rows={rows} rowKey={(r) => `${r.tier}/${r.cls}`} empty="No routing."
          columns={[{ key: 'tier', label: 'Tier' }, { key: 'cls', label: 'Request class' }, { key: 'ids', label: 'Deployments, in order', render: (r) => r.ids.join(' then ') }]} />
      </Panel>
      <Panel title="Deployments">
        <DataTable caption="Deployments" rows={routing.data?.deployments ?? []} rowKey={(d) => d.id} empty="No deployments."
          columns={[{ key: 'id', label: 'Deployment' }, { key: 'model_id', label: 'Model' }, { key: 'min_tier', label: 'Lowest tier' },
            { key: 'status', label: 'Status', render: (d) => d.emergency_disabled ? 'disabled (emergency)' : d.status },
            { key: 'rollout_percent', label: 'Rollout %', numeric: true }, { key: 'fallback_id', label: 'Falls back to', render: (d) => d.fallback_id ?? 'built-in' },
            { key: 'per_turn_cost_cap_usd', label: 'Cost cap per turn ($)', numeric: true }]} />
      </Panel>
      <EmergencyControls api={api} canManage={can('platform.emergency_controls.manage')} onChange={() => void routing.reload()} only={['lucy.disabled', 'lucy.deployment_disabled']} />
    </div>
  );
}

type Security = {
  staff: string[];
  assignments: { id: string; user_id: string; email: string | null; role: string; scope: string; reason: string; created_at: number; expires_at: number | null; active: boolean }[];
  sessions: { id: string; user_id: string; issued_at: number; expires_at: number }[];
  grants: { id: string; staff_user_id: string; workspace_id: string; support_case_id: string; expires_at: number }[];
};
type AuditEvent = { id: string; time: string; actor_id: string | null; action: string; result: string; resource_type: string | null; resource_id: string | null; reason: string | null };
type Action = { id: string; kind: string; description: string; reason: string; proposer_id: string; execute_after: number; payload_hash: string; status: string };

export function SecurityPage({ api, can, me }: { api: AdminFetch; can: (permission: string) => boolean; me: string }) {
  const security = useLoad(() => api<Security>('/admin/security'), [api]);
  const actions = useLoad(() => api<{ actions: Action[] }>('/admin/actions'), [api]);
  const [filter, setFilter] = useState({ actor_id: '', action: '', result: '' });
  const [query, setQuery] = useState('');
  const events = useLoad(() => api<{ events: AuditEvent[] }>(`/admin/audit?limit=100${query}`), [api, query]);
  const [notice, setNotice] = useState('');
  const search = (event: FormEvent) => {
    event.preventDefault();
    const params = new URLSearchParams(Object.entries(filter).filter(([, v]) => v.trim()));
    setQuery(params.toString() ? `&${params}` : '');
  };
  const act = async (id: string, command: string, body: unknown) => {
    const result = await api<{ ok?: boolean; action?: { status: string } }>(`/admin/actions/${id}/${command}`, post(body));
    setNotice(`${command}: ${result.ok === false ? 'it did not run' : 'done'}.`);
    await actions.reload();
  };
  return (
    <div className="admin-page">
      {notice && <p role="status">{notice}</p>}
      <Panel title="Waiting dangerous actions">
        <Failure error={actions.error} />
        <DataTable caption="Dangerous actions" rows={actions.data?.actions ?? []} rowKey={(a) => a.id} empty="Nothing is waiting."
          columns={[{ key: 'description', label: 'Action' }, { key: 'reason', label: 'Reason' }, { key: 'execute_after', label: 'Runs after', render: (a) => when(a.execute_after) },
            { key: 'commands', label: 'Commands', render: (a) => <span className="admin-actions">
              {a.proposer_id !== me && <button onClick={() => void act(a.id, 'approve', { payload_hash: a.payload_hash })}>Approve</button>}
              <button onClick={() => void act(a.id, 'execute', {})}>Run now if due</button>
              <Command danger label="Cancel" run={(reason) => act(a.id, 'cancel', { reason })} />
            </span> }]} />
      </Panel>
      <Failure error={security.error} />
      <Panel title="Role assignments">
        <DataTable caption="Role assignments" rows={security.data?.assignments ?? []} rowKey={(a) => a.id} empty="No assignments."
          columns={[{ key: 'email', label: 'Person', render: (a) => a.email ?? a.user_id }, { key: 'role', label: 'Role' }, { key: 'scope', label: 'Scope' },
            { key: 'reason', label: 'Reason' }, { key: 'active', label: 'State', render: (a) => a.active ? 'Active' : 'Ended' }]} />
      </Panel>
      <Panel title="Admin sessions">
        <DataTable caption="Admin sessions" rows={security.data?.sessions ?? []} rowKey={(s) => s.id} empty="No live sessions."
          columns={[{ key: 'user_id', label: 'Person' }, { key: 'issued_at', label: 'Started', render: (s) => when(s.issued_at) }, { key: 'expires_at', label: 'Ends', render: (s) => when(s.expires_at) }]} />
      </Panel>
      <Panel title="Content access grants">
        <DataTable caption="Content access grants" rows={security.data?.grants ?? []} rowKey={(g) => g.id} empty="Nobody can hear customer audio right now."
          columns={[{ key: 'staff_user_id', label: 'Staff' }, { key: 'workspace_id', label: 'Workspace' }, { key: 'support_case_id', label: 'Case' }, { key: 'expires_at', label: 'Ends', render: (g) => when(g.expires_at) }]} />
      </Panel>
      {can('security.audit.read') && <Panel title="Audit log">
        <form className="admin-filters" aria-label="Audit search" onSubmit={search}>
          <label>Actor<input value={filter.actor_id} onChange={(e) => setFilter({ ...filter, actor_id: e.target.value })} /></label>
          <label>Action starts with<input value={filter.action} onChange={(e) => setFilter({ ...filter, action: e.target.value })} /></label>
          <label>Result<select value={filter.result} onChange={(e) => setFilter({ ...filter, result: e.target.value })}><option value="">any</option><option>allow</option><option>deny</option><option>success</option><option>failure</option></select></label>
          <button className="primary">Search</button>
        </form>
        <Failure error={events.error} />
        <DataTable caption="Audit events" rows={events.data?.events ?? []} rowKey={(e) => e.id} empty="No events match."
          columns={[{ key: 'time', label: 'When' }, { key: 'actor_id', label: 'Actor' }, { key: 'action', label: 'Action' }, { key: 'result', label: 'Result' },
            { key: 'resource_id', label: 'Resource', render: (e) => [e.resource_type, e.resource_id].filter(Boolean).join(' ') }, { key: 'reason', label: 'Reason' }]} />
      </Panel>}
    </div>
  );
}
