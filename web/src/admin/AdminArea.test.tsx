// The staff console against a fake admin API: entering, view mode, the safety tiers, the
// customer pages, Staff and security, help, tours, the palette and the Flags page.
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminArea, { adminPageFor, PAGES } from './AdminArea';
import { libraryWords } from './CustomersPage';
import { paramsFor } from './FlagsPage';
import { HELP, PLAYBOOKS, TOURS } from './help';
import { Fresh, useLoad } from './parts';
import { parseAdmin } from './route';

type Call = { method: string; path: string; body: unknown; headers: Headers };
const OWNER = ['platform.dashboard.read', 'jobs.read', 'jobs.retry', 'jobs.cancel', 'workers.read', 'workers.drain', 'accounts.list', 'accounts.read_metadata', 'accounts.suspend',
  'accounts.restore', 'accounts.configure', 'billing.overrides.create', 'billing.subscriptions.read', 'models.read', 'security.audit.read', 'security.roles.assign', 'security.sessions.revoke',
  'flags.read', 'flags.kill_switch', 'flags.rules.propose', 'flags.rules.apply', 'flags.preview_self', 'flags.user_override', 'platform.emergency_controls.manage',
  'platform.incidents.manage', 'legal.takedowns.read', 'legal.takedowns.manage', 'support.cases.manage', 'audit.read', 'security.owners.assign', 'business.pilots.create'];
const fresh = { value: 3, as_of: 100, age_s: 5, state: 'fresh' };
const MATRIX = {
  owner: { title: 'Owner', permissions: OWNER, purpose: 'Runs SelectaDJ.', cannot: 'Nothing.' },
  admin: { title: 'Admin', permissions: OWNER.filter((p) => p !== 'security.owners.assign'), purpose: 'Runs SelectaDJ day to day.', cannot: 'Can’t make Owners.' },
  support: { title: 'Support', permissions: ['platform.dashboard.read', 'accounts.list', 'accounts.read_metadata', 'support.cases.manage'], purpose: 'Helps customers.', cannot: 'Can’t suspend.' },
  billing: { title: 'Billing', permissions: ['platform.dashboard.read', 'accounts.list', 'accounts.read_metadata', 'billing.overrides.create'], purpose: 'Looks after money.', cannot: 'Can’t suspend.' },
};

let calls: Call[] = [];
let permissions = OWNER;
let preferences: Record<string, unknown> = { welcome: { done: true } };
let changeAnswer: Record<string, unknown> = { applied: true, version: 7, action_id: null, execute_after: null, warnings: [] };
let sessionAnswer: [number, unknown] = [201, { id: 'session-1', expires_at: 4_000_000_000 }];

function answer(method: string, path: string): [number, unknown] {
  if (path === '/api/admin/session') return sessionAnswer;
  if (path === '/api/admin/session/changes') return [200, { changes_until: method === 'POST' ? Date.now() / 1000 + 900 : null }];
  if (path.startsWith('/api/admin/me/preferences/')) return [200, {}];
  if (path === '/api/admin/me') return [200, { user_id: 'me', email: 'me@example.test', roles: [{ role: 'owner', title: 'Owner', scope: 'platform:*', purpose: 'Runs SelectaDJ.', cannot: 'Nothing.' }], permissions,
    session: { id: 'session-1', expires_at: Date.now() / 1000 + 3600 }, environment: 'staging', changes_until: null, can_write: true, role_matrix: MATRIX,
    permission_info: { 'accounts.suspend': 'Suspend an account.', 'flags.read': 'See flags.' }, actions: [], preferences }];
  if (path === '/api/admin/overview') return [200, { now: 105, refreshed: fresh, emergency: [], alerts: [{ id: 'a1', kind: 'flags.kill_switch', summary: 'Kill switch on rooms', created_at: 90, acknowledged_at: null }],
    metrics: [{ name: 'jobs.failed_24h', labels: {}, ...fresh }, { name: 'health.modal', labels: {}, value: null, as_of: null, age_s: null, state: 'unknown' }, { name: 'health.postgres', labels: {}, value: 1, as_of: 100, age_s: 5, state: 'fresh' }],
    business: { as_of: 105, source: 'Our copy of Stripe.', signups: { today: 2, '7d': 9, '30d': 30 }, paying: 4, past_due: 1, disputes_lost: 0, mrr_minor: { gbp: 3996 }, churn_30d: 0.2, stuck_stripe_events: 0, waiting_actions: 0, open_alerts: 1 },
    headline: { level: 'problem', text: '3 failed jobs today; 1 open alerts.', unknown: ['modal'] } }];
  if (path === '/api/admin/checklist') return [200, { items: [{ id: 'mfa', label: 'Turn on two-factor sign-in', link: 'help:mfa', done: false, checked_by: 'you' }] }];
  if (path.startsWith('/api/admin/alerts')) return [200, { alerts: [] }];
  if (path === '/api/admin/actions') return [200, { actions: [] }];
  if (path === '/api/admin/emergency') return [200, { controls: [{ control: 'app.read_only', description: 'Read-only app.', targets: ['*'], states: [] }] }];
  if (path.startsWith('/api/admin/emergency/')) return [200, { control: {} }];
  if (path.startsWith('/api/admin/accounts?')) return [200, { accounts: [{ id: 'u1', email: 'listener@example.test', workspace_id: 'w1', plan_id: 'free', status: 'active', committed_bytes: 0, limit_bytes: 0, recent_failures: 0, created_at: 1, mode: 'browser', device_songs: 2918, devices: 2, staff: false }] }];
  if (path === '/api/admin/customers/u1') return [200, { user: { id: 'u1', email: 'listener@example.test', created_at: 1, suspended_at: null, timezone: null }, workspace_id: 'w1', version: 'v1', read_at: 100,
    staff_roles: [], deletion_pending: false, entitlement: { plan: 'free', source: 'default', paid_plan: 'free', valid_until: null }, storage: { used_bytes: 0, limit_bytes: 0, state: 'ok' }, overrides: [], activity: [], notes: [], subscriptions: [], stripe_customer_ids: [] }];
  if (path.startsWith('/api/admin/customers/u1/')) return [200, {}];
  if (path.startsWith('/api/admin/lookup')) return [200, { results: [{ kind: 'customer', id: 'u2', label: 'new@example.test' }] }];
  if (path === '/api/admin/staff') return [200, { staff: [{ user_id: 'me', email: 'me@example.test', suspended: false, last_session: 100, mfa: 'policy', roles: [{ id: 'r1', role: 'owner', scope: 'platform:*', expires_at: null, reason: 'founder', since: 1, active: true }] }], sessions: [] }];
  if (path === '/api/admin/staff/roles') return [201, { id: 'r2' }];
  if (path === '/api/admin/flags') return [200, { flags: [{ id: 'rooms', area: 'Cloud services', label: 'Rooms', about: 'Request rooms.', core: false, targetable: true, build_on: true, kind: 'release', requires: [], rules: [] },
    { id: 'core.library', area: 'Library', label: 'Library', about: 'Your songs.', core: true, targetable: false, build_on: true, kind: 'release', requires: [], rules: [] }] }];
  if (path.startsWith('/api/admin/flags/history')) return [200, { versions: [{ version: 4, flag_id: 'rooms', change: 'rules', author: 'me', reason: 'earlier', created_at: 50, rules: [{ kind: 'kill_switch', params: {}, enabled: true }] }] }];
  if (path === '/api/admin/flags/rooms/impact') return [200, { accounts: 10, flags: { rooms: { total: 10, changed: 4, turned_on: 0, turned_off: 4, by_plan: {} } }, dependents: ['rooms.votes'], broad: true, rules: [] }];
  if (path === '/api/admin/flags/rooms/change' || path === '/api/admin/flags/rollback') return [200, changeAnswer];
  return [404, { detail: { code: 'not_found' } }];
}

beforeEach(() => {
  calls = [];
  permissions = OWNER;
  preferences = { welcome: { done: true } };
  sessionAnswer = [201, { id: 'session-1', expires_at: 4_000_000_000 }];
  changeAnswer = { applied: true, version: 7, action_id: null, execute_after: null, warnings: [] };
  window.history.pushState({}, '', '/admin');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init.headers) });
    const [status, body] = answer(method, path);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const token = async () => 'staff-token';
const last = (path: string) => [...calls].reverse().find((call) => call.path === path);
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/api/admin/session') && !c.path.startsWith('/api/admin/me/'));

async function enter(path = '/admin', features: Record<string, boolean> | null = null) {
  window.history.pushState({}, '', path);
  render(<AdminArea token={token} onLeave={() => undefined} origin="" email="me@example.test" features={features} />);
  return within(await screen.findByRole('navigation', { name: 'Console pages' }));
}

async function makeChanges() {
  await userEvent.click(screen.getByRole('button', { name: 'Make changes' }));
  await screen.findByRole('button', { name: 'Stop making changes' });
}

describe('entering the console', () => {
  it('enters by itself and sends the admin session with every request', async () => {
    await enter();
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/admin/session' });
    expect(last('/api/admin/me')?.headers.get('X-Admin-Session')).toBe('session-1');
    expect(screen.getByRole('note')).toHaveTextContent('Staging');
  });

  it('says who is signed in and offers a fresh sign-in when one is needed', async () => {
    sessionAnswer = [401, { detail: { code: 'fresh_sign_in_required' } }];
    const again = vi.fn();
    render(<AdminArea token={token} onLeave={() => undefined} origin="" email="me@example.test" onSignInAgain={again} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Enter console' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again');
    expect(screen.getByText('me@example.test')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(again).toHaveBeenCalled();
  });

  it('shows only the pages the roles can read, and hides a page whose flag is off', async () => {
    permissions = ['platform.dashboard.read', 'jobs.read', 'accounts.list', 'flags.read', 'business.pilots.create'];
    const nav = await enter('/admin', { 'business.pilots': false });
    expect(nav.getAllByRole('link').map((a) => a.textContent)).toEqual(['Overview', 'Customers', 'Jobs', 'Workers', 'Flags', 'Emergency', 'Communications', 'System']);
  });

  it('hides Workers when its flag is off and the rest of the sidebar closes up', async () => {
    permissions = ['platform.dashboard.read', 'jobs.read', 'flags.read'];
    const nav = await enter('/admin', { 'admin.workers': false });
    expect(nav.getAllByRole('link').map((a) => a.textContent)).toEqual(['Overview', 'Jobs', 'Flags', 'Emergency', 'Communications', 'System']);
  });

  it('reads the page, record and filters from the address', () => {
    expect(adminPageFor('/admin/flags')).toBe('flags');
    expect(adminPageFor('/admin/accounts')).toBe('customers');
    expect(adminPageFor('/admin/nonsense')).toBe('overview');
    const route = parseAdmin('/admin/customers/u1/billing', '?q=jo');
    expect(route).toMatchObject({ page: 'customers', rest: ['u1', 'billing'] });
    expect(route.query.get('q')).toBe('jo');
  });

  it('shows the welcome on a first visit and remembers a skip on the server', async () => {
    preferences = {};
    await enter();
    expect(await screen.findByRole('region', { name: 'Welcome to the staff console' })).toHaveTextContent('Runs SelectaDJ.');
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(last('/api/admin/me/preferences/welcome')?.method).toBe('PUT'));
    expect(screen.queryByRole('region', { name: 'Welcome to the staff console' })).toBeNull();
  });
});

describe('the Overview', () => {
  it('leads with one sentence and plain names, and explains what is not reporting', async () => {
    await enter();
    expect(await screen.findByText(/3 failed jobs today/)).toBeInTheDocument();
    expect(screen.getByText('Workers (Modal)')).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.queryByText('health.postgres')).toBeNull();
    expect(screen.getByText(/Reported by the worker autoscaler/)).toBeInTheDocument();
    expect(await screen.findByText('Turn on two-factor sign-in')).toBeInTheDocument();
  });
});

describe('view mode and the safety tiers', () => {
  it('keeps changes disabled, saying why, until Make changes', async () => {
    await enter('/admin/customers/u1');
    const suspend = await screen.findByRole('button', { name: 'Suspend…' });
    expect(suspend).toBeDisabled();
    expect(screen.getAllByText('Press Make changes first').length).toBeGreaterThan(0);
    await makeChanges();
    expect(screen.getByRole('button', { name: 'Suspend…' })).toBeEnabled();
  });

  it('a dangerous action: Cancel has focus, Enter does nothing, the email must be typed', async () => {
    await enter('/admin/customers/u1');
    await makeChanges();
    await new Promise((resolve) => setTimeout(resolve, 520));
    await userEvent.click(screen.getByRole('button', { name: 'Suspend…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    const go = within(dialog).getByRole('button', { name: 'Suspend listener@example.test' });
    expect(go).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Breach of the terms of use');
    await userEvent.type(within(dialog).getByLabelText(/Type listener@example.test/), 'listener@example.test');
    fireEvent.keyDown(within(dialog).getByLabelText(/Type listener@example.test/), { key: 'Enter' });
    expect(last('/api/admin/customers/u1/suspend')).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 520));
    await userEvent.click(go);
    await waitFor(() => expect(last('/api/admin/customers/u1/suspend')?.body).toMatchObject({ reason: 'Breach of the terms of use', confirm: 'listener@example.test', version: 'v1' }));
    expect(last('/api/admin/customers/u1/suspend')?.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('a careful action runs at once and says what happened', async () => {
    await enter('/admin/customers/u1');
    await makeChanges();
    await new Promise((resolve) => setTimeout(resolve, 520));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(await screen.findByText(/Signed listener@example.test out on every device/)).toBeInTheDocument();
  });

  it('says which role is needed instead of hiding an action', async () => {
    permissions = ['platform.dashboard.read', 'accounts.list', 'accounts.read_metadata'];
    await enter('/admin/customers/u1');
    expect(await screen.findByRole('button', { name: 'Suspend…' })).toBeDisabled();
    expect(screen.getAllByText(/Needs the Admin role/).length).toBeGreaterThan(0);
  });
});

describe('customers', () => {
  it('shows the mode, the library in true words and plans as badges', async () => {
    await enter('/admin/customers?q=listener');
    expect(await screen.findByText('Browser')).toBeInTheDocument();
    expect(screen.getByText('2,918 songs on 2 devices')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(libraryWords({ mode: 'hosted', committed_bytes: 1_200_000_000, limit_bytes: 50_000_000_000, device_songs: 0, devices: 0 })).toBe('1.2 GB of 50.0 GB');
    expect(libraryWords({ mode: 'browser', committed_bytes: 1_200_000_000, limit_bytes: 0, device_songs: 3, devices: 1 })).toContain('Cloud storage off, 1.2 GB still stored');
  });

  it('starts empty and never lists everyone', async () => {
    await enter('/admin/customers');
    expect(await screen.findByText('Search to begin.')).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/api/admin/accounts'))).toBe(false);
  });
});

describe('staff and security', () => {
  it('adds a staff member with a role card and type-to-confirm', async () => {
    await enter('/admin/security/staff');
    await makeChanges();
    await userEvent.type(await screen.findByLabelText('Their SelectaDJ email'), 'new@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Find' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Support/ }));
    await new Promise((resolve) => setTimeout(resolve, 520));
    await userEvent.click(screen.getByRole('button', { name: /Give the Support role/ }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'New staff member');
    await userEvent.type(within(dialog).getByLabelText(/Type new@example.test/), 'new@example.test');
    await new Promise((resolve) => setTimeout(resolve, 520));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Give Support to new@example.test' }));
    await waitFor(() => expect(last('/api/admin/staff/roles')?.body).toMatchObject({ user_id: 'u2', role: 'support', scope: 'platform:*', confirm: 'new@example.test' }));
  });

  it('generates the role matrix from the code registry and searches it', async () => {
    await enter('/admin/security/roles');
    const table = await screen.findByRole('region', { name: 'Role matrix' });
    expect(within(table).getByText('Suspend an account.')).toBeInTheDocument();
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Power', 'Owner', 'Admin', 'Support', 'Billing']);
  });
});

describe('help, tours and the palette', () => {
  it('every page has help and a tour of three to six steps', () => {
    for (const page of PAGES) {
      expect(HELP[page.id]?.purpose, page.id).toBeTruthy();
      expect(TOURS[page.id].length, page.id).toBeGreaterThanOrEqual(3);
      expect(TOURS[page.id].length, page.id).toBeLessThanOrEqual(6);
    }
    expect(PLAYBOOKS.map((p) => p.id)).toEqual(['refund', 'sign-in', 'payment', 'incident', 'takedown', 'add-staff', 'flag', 'no-worker', 'undo']);
  });

  it('opens help with the ? key and a tour from it', async () => {
    await enter();
    await screen.findByText(/3 failed jobs today/);
    fireEvent.keyDown(window, { key: '?' });
    const help = await screen.findByRole('complementary', { name: 'Help for this page' });
    expect(within(help).getByText('Refund a customer')).toBeInTheDocument();
    await userEvent.click(within(help).getByRole('button', { name: 'Replay this page’s tour' }));
    expect(await screen.findByText(/Step 1 of/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog', { name: /The state of the service/ }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText(/Step 1 of/)).toBeNull());
  });

  it('the palette opens places and never makes a change', async () => {
    await enter();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const box = await screen.findByRole('combobox', { name: 'Search the console' });
    await userEvent.type(box, 'Go to Flags');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(window.location.pathname).toBe('/admin/flags'));
    expect(writes()).toEqual([]);
  });
});

describe('the Flags page', () => {
  async function command(label: string, reason: string) {
    await userEvent.click(await screen.findByRole('button', { name: label }));
    await userEvent.type(screen.getByLabelText(`Reason for “${label}”`), reason);
    await userEvent.click(within(screen.getByRole('form', { name: label })).getByRole('button', { name: label }));
  }

  it('previews a tier switch-off, then shows it queued as a broad change', async () => {
    changeAnswer = { applied: false, version: null, action_id: 'action-77', execute_after: 2_000_000_000, warnings: [] };
    await enter('/admin/flags');
    await userEvent.click(await screen.findByRole('button', { name: 'Open flag rooms' }));
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'off_for_tier');
    await userEvent.click(screen.getByRole('button', { name: 'Preview impact' }));
    expect(await screen.findByText(/of 10 accounts change/)).toBeInTheDocument();
    await command('Apply: Off for a tier', 'free tier abuse');
    await waitFor(() => expect(last('/api/admin/flags/rooms/change')?.body).toEqual({ action: 'off_for_tier', reason: 'free tier abuse', params: { plan: 'free' } }));
    expect(await screen.findByText(/This is a broad change, so it waits/)).toBeInTheDocument();
  });

  it('turns page fields into the API parameters for each action', () => {
    const form = { plan: 'standard', users: 'u1, u2  u3', percent: 25, from: '2030-01-01T00:00', until: '' };
    expect(paramsFor('off_for_users', form)).toEqual({ user_ids: ['u1', 'u2', 'u3'] });
    expect(paramsFor('rollout', form)).toEqual({ percent: 25, plans: ['standard'] });
    expect(paramsFor('kill_switch', form)).toEqual({});
  });
});

describe('freshness and loading', () => {
  it('withholds an unknown value and labels a stale one', () => {
    render(<><Fresh reading={{ value: 9, as_of: 1, age_s: 900, state: 'unknown' }} /><Fresh reading={{ value: 4, as_of: 1, age_s: 180, state: 'stale' }} /></>);
    expect(screen.queryByText('9')).toBeNull();
    expect(screen.getByText('Stale: 3 minutes ago')).toBeInTheDocument();
  });

  it('keeps the newest load when an older one answers last', async () => {
    const answers: Record<string, (value: string) => void> = {};
    const { result, rerender } = renderHook(({ id }) => useLoad(() => new Promise<string>((resolve) => { answers[id] = resolve; }), [id]), { initialProps: { id: 'a' } });
    rerender({ id: 'b' });
    await act(async () => { answers.b('b data'); });
    await act(async () => { answers.a('a data'); });
    expect(result.current.data).toBe('b data');
  });
});
