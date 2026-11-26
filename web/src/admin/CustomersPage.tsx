import { FormEvent, useState } from 'react';
import { bytes } from './adminApi';
import { BulkGrant } from './BulkGrant';
import { CustomerRecord } from './CustomerRecord';
import { useLoad } from './parts';
import { AdminRoute, adminPath, go, setQuery } from './route';
import { useConsole } from './safety';
import { AdminTable, Badge, Empty, Problem, Section, Time, words } from './ui';

export type CustomerRow = {
  id: string; email: string | null; workspace_id: string | null; plan_id: string; status: string; created_at: number;
  committed_bytes: number | null; limit_bytes: number | null; recent_failures: number; mode: 'hosted' | 'browser';
  device_songs: number | null; devices: number | null; staff: boolean;
};

export function planBadge(plan: string) {
  return <Badge tone={plan === 'free' ? 'neutral' : 'ok'}>{words(plan)}</Badge>;
}

export function statusBadge(status: string) {
  return <Badge tone={status === 'active' ? 'ok' : 'bad'}>{words(status)}</Badge>;
}

/** Library and storage in words that are true for where the account's music lives (doc 07b §7B.4). */
export function libraryWords(row: Pick<CustomerRow, 'mode' | 'committed_bytes' | 'limit_bytes' | 'device_songs' | 'devices'>) {
  const stored = row.committed_bytes ?? 0;
  if (row.mode === 'hosted') return `${bytes(stored)} of ${bytes(row.limit_bytes ?? 0)}`;
  const songs = row.device_songs ?? 0;
  const devices = row.devices ?? 0;
  const local = songs ? `${songs.toLocaleString()} songs on ${devices} device${devices === 1 ? '' : 's'}` : 'No songs reported by devices yet';
  return stored > 0 ? `${local}; cloud library off, ${bytes(stored)} still stored` : local;
}

/** Customers: search, then open a record. The list never loads everyone (searches are audited). */
export function CustomersPage({ route }: { route: AdminRoute }) {
  const { api } = useConsole();
  const id = route.rest[0];
  if (id) return <CustomerRecord userId={id} tab={route.rest[1] ?? 'overview'} />;
  return <CustomerSearch query={route.query.get('q') ?? ''} api={api} />;
}

function CustomerSearch({ query, api }: { query: string; api: ReturnType<typeof useConsole>['api'] }) {
  const [text, setText] = useState(query);
  const found = useLoad(() => (query ? api<{ accounts: CustomerRow[] }>(`/admin/accounts?limit=25&q=${encodeURIComponent(query)}`) : Promise.resolve({ accounts: [] as CustomerRow[] })), [api, query]);
  const submit = (event: FormEvent) => { event.preventDefault(); setQuery({ q: text.trim() || undefined }); };
  const rows = found.data?.accounts ?? [];
  return (
    <div className="admin-page">
      <Section title="Find a customer" tour="customer-search" help="Search by email (or part of it), user id, workspace id. Searches are audited and limited so this page can't export customers.">
        <form className="admin-filters" role="search" onSubmit={submit}>
          <label>Email, user or workspace id<input value={text} onChange={(event) => setText(event.target.value)} autoFocus /></label>
          <button className="primary">Search</button>
        </form>
      </Section>
      <Problem error={found.error} onRetry={() => void found.reload()} />
      <div data-tour="customer-table">
        <AdminTable caption="Customers" rows={rows} rowKey={(r) => r.id} loading={!found.data && !!query}
          onOpen={(r) => go(adminPath('customers', [r.id]))} openLabel={(r) => `Open ${r.email ?? r.id}`}
          empty={query ? <Empty title="No customers match.">Try the full email, or paste a user or workspace id.</Empty> : <Empty title="Search to begin.">The list starts empty on purpose: it never shows every customer at once.</Empty>}
          cols={[
            { key: 'email', label: 'Email', sort: (r) => r.email ?? '', render: (r) => <>{r.email ?? r.id}{r.staff && <> <Badge>Staff</Badge></>}</> },
            { key: 'mode', label: 'Music', sort: (r) => r.mode, help: 'On devices: their music stays on their devices (the default). Cloud library: the cloud.hosted_media grant.', render: (r) => <Badge tone={r.mode === 'hosted' ? 'warn' : 'neutral'}>{r.mode === 'hosted' ? 'Cloud library' : 'On devices'}</Badge> },
            { key: 'plan_id', label: 'Plan', sort: (r) => r.plan_id, render: (r) => planBadge(r.plan_id) },
            { key: 'status', label: 'Status', sort: (r) => r.status, render: (r) => statusBadge(r.status) },
            { key: 'library', label: 'Library', help: 'Cloud library accounts: stored of allowed. Accounts with music on their devices: what their devices report, not stored by SelectaDJ.', render: (r) => <span title={r.mode === 'browser' ? 'Not stored by SelectaDJ' : undefined}>{libraryWords(r)}</span> },
            { key: 'created_at', label: 'Joined', sort: (r) => r.created_at, render: (r) => <Time at={r.created_at} /> },
            { key: 'recent_failures', label: 'Failed jobs (24 h)', numeric: true, optional: true, sort: (r) => r.recent_failures },
          ]} />
      </div>
      <BulkGrant />
    </div>
  );
}
