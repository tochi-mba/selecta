import { FormEvent, useState } from 'react';
import { pressKey, when } from './adminApi';
import { useLoad } from './parts';
import { AdminRoute, adminPath, go, setQuery } from './route';
import { ActionButton, careful, REASONS, useConsole, write } from './safety';
import { AdminTable, Badge, Empty, Problem, Section, Time, words } from './ui';

type Person = { user_id: string; email: string | null; suspended: boolean; last_session: number | null; mfa: string;
  roles: { id: string; role: string; scope: string; expires_at: number | null; reason: string; since: number; active: boolean }[] };
type Session = { id: string; user_id: string; email: string; issued_at: number; expires_at: number; you: boolean };
type Action = { id: string; description: string; reason: string; proposer_id: string; execute_after: number; payload_hash: string };
type Event = { id: string; time: string; actor_id: string | null; action: string; result: string; resource_type: string | null; resource_id: string | null; reason: string | null };
type Alert = { id: string; kind: string; summary: string; created_at: number; acknowledged_at: number | null };

const TABS = [['staff', 'Staff'], ['roles', 'Roles'], ['sessions', 'Admin sessions'], ['actions', 'Waiting actions'], ['audit', 'Audit log'], ['alerts', 'Alerts']] as const;

/** Staff and security (doc 07b §7B.4): staff, roles, sessions, waiting actions, audit, alerts. */
export function StaffPage({ route }: { route: AdminRoute }) {
  const tab = (TABS.map(([id]) => id) as string[]).includes(route.rest[0] ?? '') ? route.rest[0] : 'staff';
  return (
    <div className="admin-page">
      <nav className="admin-tabs" aria-label="Staff and security sections">
        {TABS.map(([id, label]) => <a key={id} href={adminPath('security', [id])} aria-current={tab === id ? 'page' : undefined} onClick={(event) => { event.preventDefault(); go(adminPath('security', [id])); }}>{label}</a>)}
      </nav>
      {tab === 'staff' && <Staff />}
      {tab === 'roles' && <Roles q={route.query.get('q') ?? ''} />}
      {tab === 'sessions' && <Sessions />}
      {tab === 'actions' && <Actions />}
      {tab === 'audit' && <Audit route={route} />}
      {tab === 'alerts' && <Alerts />}
    </div>
  );
}

function Staff() {
  const ctx = useConsole();
  const data = useLoad(() => ctx.api<{ staff: Person[]; sessions: Session[] }>('/admin/staff'), [ctx.api]);
  const revoke = (person: Person, role: Person['roles'][number]) => ctx.ask({
    action: 'role.revoke', title: `Take ${words(role.role)} from ${person.email}`, button: `Revoke ${words(role.role)} from ${person.email}`,
    consequences: [`${person.email} loses every power of ${words(role.role)} at once.`, 'Their admin sessions end now.', 'Their own customer account is not touched.'],
    confirmText: person.email ?? person.user_id, confirmLabel: `Type ${person.email} to confirm`, reasons: REASONS.staff, irreversible: false,
    run: async (reason, confirm) => { await write(ctx.api, { path: `/admin/staff/roles/${role.id}/revoke`, body: { reason, confirm } }); ctx.toast({ text: `${words(role.role)} revoked from ${person.email}.`, tone: 'ok' }); await data.reload(); },
    done: 'Revoked.',
  });
  return (
    <>
      <Problem error={data.error} onRetry={() => void data.reload()} />
      <Section title="Staff" tour="staff-list" help="Everyone with a staff role. MFA is required by the WorkOS staff organization's sign-in policy; check it there until the WorkOS connection reads it live.">
        <AdminTable caption="Staff" rows={data.data?.staff ?? []} rowKey={(p) => p.user_id} loading={!data.data}
          empty={<Empty title="No staff yet.">Run selecta admin bootstrap-owner once to make the first Owner.</Empty>}
          cols={[{ key: 'email', label: 'Person', sort: (p) => p.email ?? '', render: (p) => <>{p.email}{p.suspended && <> <Badge tone="bad">Customer account suspended</Badge></>}</> },
            { key: 'roles', label: 'Roles', render: (p) => <ul className="admin-plain">{p.roles.map((r) => <li key={r.id}><Badge tone={r.active ? 'ok' : 'neutral'}>{words(r.role)}</Badge> {r.scope !== 'platform:*' && r.scope}{r.expires_at ? <> until <Time at={r.expires_at} /></> : ''} <ActionButton permission={r.role === 'owner' ? 'security.owners.assign' : 'security.roles.assign'} danger onPress={() => revoke(p, r)} label={`Revoke ${r.role} from ${p.email}`}>Revoke…</ActionButton></li>)}</ul> },
            { key: 'last_session', label: 'Last in the console', render: (p) => <Time at={p.last_session} /> }]} />
      </Section>
      {ctx.can('security.roles.assign') && <AddStaff onDone={() => void data.reload()} />}
    </>
  );
}

function AddStaff({ onDone }: { onDone: () => void }) {
  const ctx = useConsole();
  const [email, setEmail] = useState('');
  const [found, setFound] = useState<{ id: string; label: string } | null>(null);
  const [role, setRole] = useState('support');
  const [days, setDays] = useState('');
  const [scope, setScope] = useState('platform:*');
  const [error, setError] = useState('');
  const held = new Set(ctx.me.permissions);
  const roles = Object.entries(ctx.me.role_matrix ?? {}).filter(([id]) => id !== 'owner');
  const find = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setFound(null);
    try {
      const answer = await ctx.api<{ results: { kind: string; id: string; label: string }[] }>(`/admin/lookup?q=${encodeURIComponent(email.trim())}`);
      const person = answer.results.find((r) => r.kind === 'customer');
      if (!person) setError('No SelectaDJ account uses that email. Ask them to sign in once first, then search again.');
      else setFound({ id: person.id, label: person.label });
    } catch (problem) { setError((problem as Error).message); }
  };
  const give = () => {
    if (!found) return;
    const title = ctx.me.role_matrix?.[role]?.title ?? role;
    ctx.ask({
      action: 'role.assign', title: `Give ${found.label} the ${title} role`, button: `Give ${title} to ${found.label}`,
      consequences: [ctx.me.role_matrix?.[role]?.purpose ?? '', days ? `It ends by itself in ${days} days.` : 'It lasts until someone revokes it.', 'They must also be in the WorkOS staff organization to enter the console.'],
      confirmText: found.label, confirmLabel: `Type ${found.label} to confirm`, reasons: REASONS.staff, irreversible: false,
      run: async (reason, confirm) => {
        await ctx.api('/admin/staff/roles', { method: 'POST', headers: { 'Idempotency-Key': pressKey() }, body: JSON.stringify({ user_id: found.id, role, scope, reason, confirm, expires_at: days ? Date.now() / 1000 + Number(days) * 86_400 : null }) });
        ctx.toast({ text: `${found.label} is now ${title}. Revoke undoes it.`, tone: 'ok' }); setFound(null); setEmail(''); onDone();
      },
      done: 'Given.',
    });
  };
  return (
    <Section title="Add a staff member" tour="add-staff" help="They need a SelectaDJ account first (they sign in once). You can only give a role whose every power you hold yourself.">
      <form className="admin-inline-form" onSubmit={(event) => void find(event)}>
        <label>Their SelectaDJ email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <button>Find</button>
      </form>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {found && <>
        <p>Found <strong>{found.label}</strong>. Choose a role:</p>
        <div className="admin-role-cards" role="radiogroup" aria-label="Role">
          {roles.map(([id, info]) => {
            const allowed = info.permissions.every((p) => held.has(p));
            return (
              <label key={id} className={`admin-role-card ${role === id ? 'chosen' : ''}`}>
                <input type="radio" name="role" value={id} checked={role === id} disabled={!allowed} onChange={() => { setRole(id); setScope('platform:*'); }} />
                <strong>{info.title}</strong><span>{info.purpose}</span><small className="admin-soft">{info.cannot}</small>
                {!allowed && <small className="admin-soft">You can’t give this: it holds powers you don’t.</small>}
              </label>
            );
          })}
        </div>
        <div className="admin-inline-form">
          <label>Scope<select value={scope} onChange={(event) => setScope(event.target.value)}><option value="platform:*">All of SelectaDJ</option>{['support', 'billing'].includes(role) && <option value="workspace:">One workspace (type its id next)</option>}</select></label>
          {scope.startsWith('workspace:') && <label>Workspace id<input value={scope.slice(10)} onChange={(event) => setScope(`workspace:${event.target.value.trim()}`)} /></label>}
          <label>Ends after (days, optional)<input type="number" min={1} max={366} value={days} onChange={(event) => setDays(event.target.value)} /></label>
        </div>
        <ActionButton permission="security.roles.assign" onPress={give}>Give the {ctx.me.role_matrix?.[role]?.title} role…</ActionButton>
      </>}
    </Section>
  );
}

function Roles({ q }: { q: string }) {
  const ctx = useConsole();
  const [text, setText] = useState(q);
  const matrix = ctx.me.role_matrix ?? {};
  const perms = Object.entries(ctx.me.permission_info ?? {}).filter(([name, about]) => !text || `${name} ${about}`.toLowerCase().includes(text.toLowerCase()));
  const roles = Object.entries(matrix);
  return (
    <Section title="Roles and what they can do" tour="role-matrix" help="Generated from the code’s role registry, so it is always true. Search a power, such as suspend, to see who holds it.">
      <form className="admin-filters" role="search" onSubmit={(event) => { event.preventDefault(); setQuery({ q: text || undefined }); }}>
        <label>Who can…<input value={text} onChange={(event) => setText(event.target.value)} placeholder="suspend, refund, flags" /></label>
      </form>
      <div className="admin-table" role="region" aria-label="Role matrix" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">Power</th>{roles.map(([id, r]) => <th key={id} scope="col">{r.title}</th>)}</tr></thead>
          <tbody>{perms.map(([name, about]) => <tr key={name}><th scope="row"><span>{about}</span><br /><code className="admin-soft">{name}</code></th>{roles.map(([id, r]) => <td key={id}>{r.permissions.includes(name) ? <Badge tone="ok">Yes</Badge> : ''}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </Section>
  );
}

function Sessions() {
  const ctx = useConsole();
  const data = useLoad(() => ctx.api<{ sessions: Session[] }>('/admin/staff'), [ctx.api]);
  const end = (s: Session) => careful(ctx, () => write(ctx.api, { path: `/admin/staff/sessions/${s.id}/end`, body: { reason: 'Ended from the console' } }).then(() => data.reload()), `Ended ${s.email}'s admin session.`);
  return (
    <Section title="Admin sessions" help="Each lasts at most an hour from a fresh sign-in. Ending one signs that person out of the console only.">
      <AdminTable caption="Admin sessions" rows={data.data?.sessions ?? []} rowKey={(s) => s.id} loading={!data.data}
        empty={<Empty title="Nobody is in the console." />}
        cols={[{ key: 'email', label: 'Person', render: (s) => <>{s.email}{s.you && <> <Badge>You</Badge></>}</> }, { key: 'issued_at', label: 'Started', render: (s) => <Time at={s.issued_at} /> }, { key: 'expires_at', label: 'Ends', render: (s) => <Time at={s.expires_at} /> },
          { key: 'end', label: '', render: (s) => (s.you ? null : <ActionButton permission="security.sessions.revoke" onPress={() => void end(s)}>End session</ActionButton>) }]} />
    </Section>
  );
}

function Actions() {
  const ctx = useConsole();
  const data = useLoad(() => ctx.api<{ actions: Action[] }>('/admin/actions'), [ctx.api]);
  const cancel = (a: Action) => careful(ctx, () => write(ctx.api, { path: `/admin/actions/${a.id}/cancel`, body: { reason: 'Cancelled from the console' } }).then(() => data.reload()), `Cancelled: ${a.description}`);
  const run = (a: Action) => careful(ctx, () => write(ctx.api, { path: `/admin/actions/${a.id}/execute`, body: {} }).then(() => data.reload()), `Ran: ${a.description}`);
  return (
    <Section title="Waiting dangerous actions" help="The most dangerous actions wait 15 minutes, alert every Owner, and can be cancelled. When due they run on their own, or here.">
      <AdminTable caption="Waiting actions" rows={data.data?.actions ?? []} rowKey={(a) => a.id} loading={!data.data}
        empty={<Empty title="Nothing is waiting.">Owner assignments, account deletions, mass overrides and releases of emergency controls wait here for 15 minutes.</Empty>}
        cols={[{ key: 'description', label: 'Action' }, { key: 'reason', label: 'Why' }, { key: 'execute_after', label: 'Runs', render: (a) => <Time at={a.execute_after} /> },
          { key: 'do', label: '', render: (a) => <span className="admin-actions"><ActionButton permission="platform.dashboard.read" onPress={() => void cancel(a)}>Cancel</ActionButton>{a.execute_after <= Date.now() / 1000 && <ActionButton permission="platform.dashboard.read" onPress={() => void run(a)}>Run now</ActionButton>}</span> }]} />
    </Section>
  );
}

function Audit({ route }: { route: AdminRoute }) {
  const ctx = useConsole();
  const q = { actor_id: route.query.get('actor') ?? '', action: route.query.get('action') ?? '', result: route.query.get('result') ?? '' };
  const [form, setForm] = useState(q);
  const query = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
  const data = useLoad(() => ctx.api<{ events: Event[] }>(`/admin/audit?limit=100${query ? `&${query}` : ''}`), [ctx.api, query]);
  const exportCsv = () => careful(ctx, async () => {
    const text = await ctx.api<string>('/admin/audit-export', { method: 'POST', headers: { 'Idempotency-Key': pressKey() }, body: JSON.stringify({ ...q, actor_id: q.actor_id || null, action: q.action || null, result: q.result || null }) });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    link.download = 'selectadj-audit.csv'; link.click();
  }, 'Exported up to 5,000 rows of the current filter. The export itself is audited.');
  return (
    <Section title="Audit log" tour="audit" actions={<ActionButton permission="audit.read" onPress={() => void exportCsv()}>Export CSV</ActionButton>}>
      <form className="admin-filters" role="search" onSubmit={(event) => { event.preventDefault(); setQuery({ actor: form.actor_id || undefined, action: form.action || undefined, result: form.result || undefined }); }}>
        <label>Who (user id)<input value={form.actor_id} onChange={(e) => setForm({ ...form, actor_id: e.target.value })} /></label>
        <label>Action starts with<input value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} placeholder="admin.account" /></label>
        <label>Result<select value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })}><option value="">Any</option><option value="success">Success</option><option value="allow">Allowed</option><option value="deny">Refused</option><option value="failure">Failed</option></select></label>
        <button className="primary">Filter</button>
      </form>
      <Problem error={data.error} />
      <AdminTable caption="Audit events" rows={data.data?.events ?? []} rowKey={(e) => e.id} loading={!data.data}
        empty={<Empty title="No events match.">Every staff action and every refusal is recorded here; try a wider filter.</Empty>}
        cols={[{ key: 'time', label: 'When', render: (e) => <span title={e.time}>{when(Date.parse(e.time) / 1000)}</span> }, { key: 'actor_id', label: 'Who' }, { key: 'action', label: 'What' },
          { key: 'result', label: 'Result', render: (e) => <Badge tone={e.result === 'deny' ? 'bad' : 'neutral'}>{words(e.result)}</Badge> }, { key: 'resource', label: 'On', render: (e) => [e.resource_type, e.resource_id].filter(Boolean).join(' ') }, { key: 'reason', label: 'Why' }]} />
    </Section>
  );
}

function Alerts() {
  const ctx = useConsole();
  const data = useLoad(() => ctx.api<{ alerts: Alert[] }>('/admin/alerts?limit=50'), [ctx.api]);
  const ack = (a: Alert) => careful(ctx, () => write(ctx.api, { path: `/admin/alerts/${a.id}/acknowledge` }).then(() => data.reload()), 'Alert acknowledged.');
  return (
    <Section title="Alerts">
      <AdminTable caption="Alerts" rows={data.data?.alerts ?? []} rowKey={(a) => a.id} loading={!data.data}
        empty={<Empty title="No alerts.">When a staff member is refused something that looks like an attack, an emergency control changes or a limit is reached, it appears here.</Empty>}
        cols={[{ key: 'created_at', label: 'When', render: (a) => <Time at={a.created_at} /> }, { key: 'kind', label: 'Kind', render: (a) => words(a.kind) }, { key: 'summary', label: 'What happened' },
          { key: 'ack', label: '', render: (a) => (a.acknowledged_at ? <Badge>Seen</Badge> : <ActionButton permission="platform.dashboard.read" onPress={() => void ack(a)}>Acknowledge</ActionButton>) }]} />
    </Section>
  );
}
