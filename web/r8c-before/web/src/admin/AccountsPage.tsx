import { FormEvent, useState } from 'react';
import { DataTable } from '../ui/DataTable';
import { AdminFetch, bytes, post, when } from './adminApi';
import { Command, Failure, Panel, useLoad } from './parts';

type Row = { id: string; email: string | null; workspace_id: string | null; plan_id: string; status: string; committed_bytes: number | null; recent_failures: number; created_at: number };
type Detail = {
  user: { id: string; email: string | null; created_at: number; suspended_at: number | null };
  workspace_id: string | null;
  entitlement?: { plan: string; source: string; paid_plan: string; valid_until: number | null };
  storage?: { used_bytes: number; limit_bytes: number; state: string };
  overrides?: { id: string; plan_id: string; reason: string; expires_at: number; revoked_at: number | null }[];
  valid_takedown_notices?: number;
  uploads_restricted?: boolean;
};
type Notice = { id: string; workspace_id: string; asset_id: string; complainant: string; work: string; status: string; received_at: number; due_by: number; overdue: boolean };
const PLANS = ['free', 'standard', 'premium'];

export function AccountsPage({ api, can }: { api: AdminFetch; can: (permission: string) => boolean }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const accounts = useLoad(() => api<{ accounts: Row[] }>(`/admin/accounts?limit=25${query ? `&q=${encodeURIComponent(query)}` : ''}`), [api, query]);
  return (
    <div className="admin-page">
      <Panel title="Find accounts">
        <p className="admin-note">Metadata only: email, plan, status and storage. Searches are audited and limited, so this page can't export accounts.</p>
        <form className="admin-filters" aria-label="Account search" onSubmit={(event: FormEvent) => { event.preventDefault(); setQuery(text.trim()); }}>
          <label>Email, user or workspace id<input value={text} onChange={(event) => setText(event.target.value)} /></label>
          <button className="primary">Search</button>
        </form>
        <Failure error={accounts.error} />
        <DataTable caption="Accounts" rows={accounts.data?.accounts ?? []} rowKey={(a) => a.id} onPick={(a) => setPicked(a.id)} pickLabel={(a) => `Open ${a.email ?? a.id}`}
          empty="No accounts match."
          columns={[{ key: 'email', label: 'Email', render: (a) => a.email ?? a.id }, { key: 'plan_id', label: 'Plan' }, { key: 'status', label: 'Status' },
            { key: 'committed_bytes', label: 'Storage', numeric: true, render: (a) => bytes(a.committed_bytes ?? 0) },
            { key: 'recent_failures', label: 'Failed jobs (24 h)', numeric: true }]} />
      </Panel>
      {picked && <AccountDetail api={api} userId={picked} can={can} />}
      {can('legal.takedowns.read') && <Takedowns api={api} canManage={can('legal.takedowns.manage')} />}
    </div>
  );
}

function AccountDetail({ api, userId, can }: { api: AdminFetch; userId: string; can: (p: string) => boolean }) {
  const detail = useLoad(() => api<Detail>(`/admin/accounts/${userId}`), [api, userId]);
  const [plan, setPlan] = useState('premium');
  const [days, setDays] = useState(30);
  const account = detail.data;
  const command = async (name: string, reason: string) => { await api(`/admin/accounts/${userId}/${name}`, post({ reason })); await detail.reload(); };
  const override = async (reason: string) => {
    await api('/admin/overrides', post({ workspace_id: account?.workspace_id, plan_id: plan, reason, expires_at: Date.now() / 1000 + days * 86_400 }));
    await detail.reload();
  };
  const revoke = async (id: string, reason: string) => { await api(`/admin/overrides/${id}?reason=${encodeURIComponent(reason)}`, { method: 'DELETE' }); await detail.reload(); };
  const lift = async (reason: string) => { await api(`/admin/upload-restrictions/${account?.workspace_id}/lift`, post({ reason })); await detail.reload(); };
  return (
    <Panel title={account?.user.email ?? 'Account'}>
      <Failure error={detail.error} />
      {account && <>
        <dl className="admin-facts">
          <dt>Status</dt><dd>{account.user.suspended_at ? `Suspended since ${when(account.user.suspended_at)}` : 'Active'}</dd>
          <dt>Plan</dt><dd>{account.entitlement ? `${account.entitlement.plan} (from ${account.entitlement.source}; Stripe says ${account.entitlement.paid_plan})` : 'none'}</dd>
          <dt>Storage</dt><dd>{account.storage ? `${bytes(account.storage.used_bytes)} of ${bytes(account.storage.limit_bytes)} (${account.storage.state})` : 'none'}</dd>
          <dt>Valid takedown notices</dt><dd>{account.valid_takedown_notices ?? 0}{account.uploads_restricted ? ', uploads suspended' : ''}</dd>
        </dl>
        <div className="admin-actions" aria-label="Account commands">
          {can('accounts.suspend') && !account.user.suspended_at && <Command danger label="Suspend" note="The account becomes read-only." run={(r) => command('suspend', r)} />}
          {can('accounts.restore') && account.user.suspended_at && <Command label="Restore" run={(r) => command('restore', r)} />}
          {can('legal.takedowns.manage') && account.uploads_restricted && <Command label="Lift upload restriction" run={lift} />}
        </div>
        {can('billing.overrides.create') && account.workspace_id && <div className="admin-inline-form" aria-label="New entitlement override">
          <h3>Entitlement override</h3>
          <label>Plan<select value={plan} onChange={(event) => setPlan(event.target.value)}>{PLANS.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label>Days<input type="number" min={1} max={366} value={days} onChange={(event) => setDays(Number(event.target.value))} /></label>
          <Command label="Grant override" run={override} />
        </div>}
        <DataTable caption="Overrides" rows={account.overrides ?? []} rowKey={(o) => o.id} empty="No overrides."
          columns={[{ key: 'plan_id', label: 'Plan' }, { key: 'reason', label: 'Reason' }, { key: 'expires_at', label: 'Expires', render: (o) => when(o.expires_at) },
            { key: 'revoked_at', label: 'State', render: (o) => o.revoked_at ? 'Revoked' : can('billing.overrides.create') ? <Command label="Revoke" run={(r) => revoke(o.id, r)} /> : 'Active' }]} />
      </>}
    </Panel>
  );
}

function Takedowns({ api, canManage }: { api: AdminFetch; canManage: boolean }) {
  const notices = useLoad(() => api<{ notices: Notice[] }>('/admin/takedowns'), [api]);
  const [form, setForm] = useState({ workspace_id: '', asset_id: '', complainant: '', work: '' });
  const [error, setError] = useState('');
  const logNotice = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    try { await api('/admin/takedowns', post(form)); setForm({ workspace_id: '', asset_id: '', complainant: '', work: '' }); await notices.reload(); }
    catch (problem) { setError((problem as Error).message); }
  };
  const decide = async (id: string, command: string, reason: string) => { await api(`/admin/takedowns/${id}/${command}`, post({ reason })); await notices.reload(); };
  return (
    <Panel title="Copyright notices">
      <Failure error={notices.error || error} />
      {canManage && <form className="admin-filters" aria-label="Log a notice" onSubmit={(event) => void logNotice(event)}>
        {(['workspace_id', 'asset_id', 'complainant', 'work'] as const).map((key) => (
          <label key={key}>{{ workspace_id: 'Workspace', asset_id: 'Asset', complainant: 'Complainant', work: 'Work' }[key]}
            <input required value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>
        ))}
        <button className="primary">Log notice</button>
      </form>}
      <DataTable caption="Notices" rows={notices.data?.notices ?? []} rowKey={(n) => n.id} empty="No notices."
        columns={[{ key: 'received_at', label: 'Received', render: (n) => when(n.received_at) }, { key: 'work', label: 'Work' }, { key: 'complainant', label: 'From' },
          { key: 'status', label: 'Status', render: (n) => n.overdue ? `${n.status} (overdue since ${when(n.due_by)})` : n.status },
          { key: 'decide', label: 'Decision', render: (n) => canManage && n.status === 'received' ? <span className="admin-actions">
            <Command danger label="Act on notice" note="Hides the asset and starts its deletion." run={(r) => decide(n.id, 'act', r)} />
            <Command label="Reject" run={(r) => decide(n.id, 'reject', r)} /></span> : null }]} />
    </Panel>
  );
}
