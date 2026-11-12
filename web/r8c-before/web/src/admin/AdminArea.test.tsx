// The staff console against a fake admin API (there is no Cloud browser-test server yet, so this
// is the walkthrough): entering a session, the six pages, and that every action is a command
// with a reason sent to the server.
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from '../ui/DataTable';
import AdminArea, { adminPageFor } from './AdminArea';
import { paramsFor } from './FlagsPage';
import { Fresh, useLoad } from './parts';

type Call = { method: string; path: string; body: unknown; headers: Headers };
const OWNER = ['platform.dashboard.read', 'jobs.read', 'jobs.retry', 'jobs.cancel', 'workers.read', 'workers.drain', 'accounts.list', 'accounts.read_metadata', 'accounts.suspend',
  'accounts.restore', 'billing.overrides.create', 'models.read', 'security.audit.read', 'flags.read', 'flags.kill_switch', 'flags.rules.propose', 'flags.rules.apply',
  'flags.preview_self', 'flags.user_override', 'platform.emergency_controls.manage', 'legal.takedowns.read', 'legal.takedowns.manage'];
const fresh = { value: 3, as_of: 100, age_s: 5, state: 'fresh' };

let calls: Call[] = [];
let permissions = OWNER;
let changeAnswer: Record<string, unknown> = { applied: true, version: 7, action_id: null, execute_after: null, warnings: [] };

function answer(method: string, path: string): [number, unknown] {
  if (path === '/api/admin/session') return [201, { id: 'session-1', expires_at: 4_000_000_000 }];
  if (path === '/api/admin/me') return [200, { user_id: 'me', roles: [{ role: 'owner', title: 'Owner', scope: 'platform:*' }], permissions, session: { id: 'session-1', expires_at: 4_000_000_000 } }];
  if (path === '/api/admin/overview') return [200, { now: 105, refreshed: { value: 100, as_of: 100, age_s: 5, state: 'fresh' }, emergency: [], alerts: [{ id: 'a1', kind: 'flags.kill_switch', summary: 'Kill switch on rooms', created_at: 90 }],
    metrics: [{ name: 'jobs.waiting', labels: { pool: 'gpu', lane: 'standard' }, ...fresh }, { name: 'workers.live', labels: { pool: 'gpu' }, value: 2, as_of: 1, age_s: 300, state: 'stale' },
      { name: 'health.modal', labels: {}, value: null, as_of: null, age_s: null, state: 'unknown' }] }];
  if (path === '/api/admin/emergency') return [200, { controls: [{ control: 'app.read_only', description: 'Read-only app.', targets: ['*'], states: [] }] }];
  if (path.startsWith('/api/admin/emergency/')) return [200, { control: {} }];
  if (path.startsWith('/api/admin/jobs?') || path === '/api/admin/jobs') return [200, { jobs: [{ id: 'job-1', workspace_id: 'w1', type: 'analyse.song', pool: 'cpu-heavy', lane: 'standard', state: 'queued', attempt_count: 0, created_at: 100, est_cost_s: 40, actual_cost_s: null, error_class: null, error_detail: null }] }];
  if (path === '/api/admin/jobs/job-1') return [200, { job: { id: 'job-1', workspace_id: 'w1', type: 'analyse.song', state: 'queued', est_cost_s: 40, actual_cost_s: null, error_class: null }, attempts: [], depends_on: [], needed_by: [] }];
  if (path.startsWith('/api/admin/jobs/job-1/')) return [200, { job: { id: 'job-1', state: 'blocked' } }];
  if (path === '/api/admin/workers') return [200, { workers: [{ id: 'worker-1', pool: 'gpu', slots: 1, last_seen: fresh, hold: null }] }];
  if (path.startsWith('/api/admin/workers/')) return [200, { hold: 'drain' }];
  if (path.startsWith('/api/admin/accounts?')) return [200, { accounts: [{ id: 'u1', email: 'listener@example.test', workspace_id: 'w1', plan_id: 'free', status: 'active', committed_bytes: 5_000_000, recent_failures: 0, created_at: 1 }] }];
  if (path === '/api/admin/accounts/u1') return [200, { user: { id: 'u1', email: 'listener@example.test', created_at: 1, suspended_at: null }, workspace_id: 'w1', entitlement: { plan: 'free', source: 'default', paid_plan: 'free', valid_until: null }, storage: { used_bytes: 1, limit_bytes: 10, state: 'ok' }, overrides: [], valid_takedown_notices: 0, uploads_restricted: false }];
  if (path === '/api/admin/overrides' || path.startsWith('/api/admin/accounts/u1/')) return [200, {}];
  if (path === '/api/admin/takedowns' && method === 'GET') return [200, { notices: [{ id: 'n1', workspace_id: 'w1', asset_id: 'a1', complainant: 'Label', work: 'Song', status: 'received', received_at: 1, due_by: 2, overdue: true }] }];
  if (path.startsWith('/api/admin/takedowns')) return [200, { notice: {} }];
  if (path === '/api/admin/ai') return [200, { routing_version: 3, lucy_disabled: false, map: { premium: { planning: ['opus'] } }, deployments: [{ id: 'opus', provider: 'anthropic', model_id: 'claude', min_tier: 'premium', status: 'active', rollout_percent: 100, fallback_id: null, per_turn_cost_cap_usd: 1, emergency_disabled: false }] }];
  if (path === '/api/admin/security') return [200, { staff: ['me'], assignments: [{ id: 'r1', user_id: 'me', email: 'me@example.test', role: 'owner', scope: 'platform:*', reason: 'founder', created_at: 1, expires_at: null, active: true }], sessions: [], grants: [] }];
  if (path === '/api/admin/actions') return [200, { actions: [{ id: 'act-1', kind: 'flags.rules.broad', description: 'Broad flag rule', reason: 'tier off', proposer_id: 'me', execute_after: 200, payload_hash: 'h'.repeat(64), status: 'pending' }] }];
  if (path.startsWith('/api/admin/audit')) return [200, { events: [{ id: 'e1', time: '2026-11-10T00:00:00', actor_id: 'me', action: 'flags.rules.change', result: 'success', resource_type: 'flag', resource_id: 'rooms', reason: 'incident' }] }];
  if (path === '/api/admin/flags') return [200, { flags: [{ id: 'rooms', area: 'Cloud services', label: 'Rooms', about: 'Request rooms.', core: false, targetable: true, build_on: true, kind: 'release', requires: [], rules: [] },
    { id: 'core.library', area: 'Library', label: 'Library', about: 'Your songs.', core: true, targetable: false, build_on: true, kind: 'release', requires: [], rules: [] }] }];
  if (path.startsWith('/api/admin/flags/history')) return [200, { versions: [{ version: 4, flag_id: 'rooms', change: 'rules', author: 'me', reason: 'earlier', created_at: 50, rules: [{ kind: 'kill_switch', params: {}, enabled: true }] }] }];
  if (path === '/api/admin/flags/rooms/impact') return [200, { accounts: 10, flags: { rooms: { total: 10, changed: 4, turned_on: 0, turned_off: 4, by_plan: { free: { total: 6, changed: 4, turned_on: 0, turned_off: 4 } } } }, dependents: ['rooms.votes'], broad: true, rules: [] }];
  if (path === '/api/admin/flags/rooms/change' || path === '/api/admin/flags/rollback') return [200, changeAnswer];
  if (path.startsWith('/api/admin/flags/explain/')) return [200, { user_id: 'u1', plan: 'free', rule_version: 9, flags: [{ flag_id: 'rooms', on: false, reason: 'plan_locked', steps: [{ layer: 'plan', on: false, reason: 'plan_locked', detail: 'free does not include it' }] }] }];
  return [404, { detail: { code: 'not_found' } }];
}

beforeEach(() => {
  calls = [];
  permissions = OWNER;
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

async function enter() {
  render(<AdminArea token={token} onLeave={() => undefined} origin="" />);
  await userEvent.click(screen.getByRole('button', { name: 'Enter console' }));
  return within(await screen.findByRole('navigation', { name: 'Admin pages' }));
}

async function command(label: string, reason: string) {
  await userEvent.click(await screen.findByRole('button', { name: label }));
  await userEvent.type(screen.getByLabelText(`Reason for “${label}”`), reason);
  await userEvent.click(within(screen.getByRole('form', { name: label })).getByRole('button', { name: label }));
}

const last = (path: string) => [...calls].reverse().find((call) => call.path === path);

describe('entering the console', () => {
  it('starts an admin session and sends it with every request', async () => {
    await enter();
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/admin/session' });
    expect(last('/api/admin/me')?.headers.get('X-Admin-Session')).toBe('session-1');
    expect(last('/api/admin/me')?.headers.get('Authorization')).toBe('Bearer staff-token');
  });

  it('explains a refused entry instead of opening the pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: { code: 'fresh_sign_in_required' } }), { status: 401 })));
    render(<AdminArea token={token} onLeave={() => undefined} origin="" />);
    await userEvent.click(screen.getByRole('button', { name: 'Enter console' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again');
    expect(screen.queryByRole('navigation', { name: 'Admin pages' })).toBeNull();
  });

  it('shows only the pages the roles can read', async () => {
    permissions = ['platform.dashboard.read', 'jobs.read', 'accounts.list', 'flags.read'];
    const nav = await enter();
    expect(nav.getAllByRole('button').map((b) => b.textContent)).toEqual(['Overview', 'Jobs & workers', 'Accounts & billing', 'Flags']);
  });

  it('reads the page from the address', () => {
    expect(adminPageFor('/admin/flags')).toBe('flags');
    expect(adminPageFor('/admin')).toBe('overview');
    expect(adminPageFor('/admin/nonsense')).toBe('overview');
  });
});

describe('the six pages', () => {
  it('Overview shows each number with its freshness and engages a control with a reason', async () => {
    await enter();
    expect(await screen.findByText('jobs.waiting (pool gpu, lane standard)')).toBeInTheDocument();
    expect(screen.getByText('Stale: 5 min ago')).toBeInTheDocument();
    expect(screen.getAllByText('never measured').length).toBeGreaterThan(0);
    expect(screen.getByText('Kill switch on rooms')).toBeInTheDocument();
    await command('Engage app.read_only', 'database incident');
    await waitFor(() => expect(last('/api/admin/emergency/app.read_only/engage')?.body).toEqual({ reason: 'database incident', target: '*' }));
  });

  it('Jobs & workers searches, opens a job and quarantines it as a command', async () => {
    const nav = await enter();
    await userEvent.click(nav.getByRole('button', { name: 'Jobs & workers' }));
    await userEvent.type(await screen.findByLabelText('State'), 'queued');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(last('/api/admin/jobs?state=queued')).toBeDefined());
    await userEvent.click(await screen.findByRole('button', { name: 'Open job job-1' }));
    await command('Quarantine', 'bad output');
    await waitFor(() => expect(last('/api/admin/jobs/job-1/quarantine')?.body).toEqual({ reason: 'bad output' }));
    expect(await screen.findByText(/the job is now blocked/)).toBeInTheDocument();
    await command('Drain', 'deploy');
    await waitFor(() => expect(last('/api/admin/workers/worker-1/drain')?.body).toEqual({ reason: 'deploy' }));
  });

  it('Accounts & billing grants an override with an expiry and acts on a notice', async () => {
    const nav = await enter();
    await userEvent.click(nav.getByRole('button', { name: 'Accounts & billing' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open listener@example.test' }));
    await command('Grant override', 'service recovery');
    await waitFor(() => expect(last('/api/admin/overrides')?.body).toMatchObject({ workspace_id: 'w1', plan_id: 'premium', reason: 'service recovery' }));
    expect((last('/api/admin/overrides')?.body as { expires_at: number }).expires_at).toBeGreaterThan(Date.now() / 1000);
    expect(screen.getByText(/overdue since/)).toBeInTheDocument();
    await command('Act on notice', 'valid notice');
    await waitFor(() => expect(last('/api/admin/takedowns/n1/act')?.body).toEqual({ reason: 'valid notice' }));
  });

  it('AI routing lists the tier map and deployments', async () => {
    const nav = await enter();
    await userEvent.click(nav.getByRole('button', { name: 'AI routing' }));
    expect(await screen.findByText('Tier routing (version 3)')).toBeInTheDocument();
    expect(screen.getAllByText('opus').length).toBeGreaterThan(0);
  });

  it('Security hides approving your own action and searches the audit log', async () => {
    const nav = await enter();
    await userEvent.click(nav.getByRole('button', { name: 'Security' }));
    expect(await screen.findByText('Broad flag rule')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Result'), 'deny');
    await userEvent.click(within(screen.getByRole('form', { name: 'Audit search' })).getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(last('/api/admin/audit?limit=100&result=deny')).toBeDefined());
  });
});

describe('the Flags page', () => {
  async function openRooms() {
    const nav = await enter();
    await userEvent.click(nav.getByRole('button', { name: 'Flags' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open flag rooms' }));
  }

  it('previews a tier switch-off, then shows it queued as a broad change', async () => {
    changeAnswer = { applied: false, version: null, action_id: 'action-77', execute_after: 2_000_000_000, warnings: [] };
    await openRooms();
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'off_for_tier');
    await userEvent.click(screen.getByRole('button', { name: 'Preview impact' }));
    expect(await screen.findByText(/of 10 accounts change/)).toHaveTextContent('4 of 10 accounts change (4 lose it, 0 gain it)');
    expect(screen.getByText(/rooms\.votes/)).toBeInTheDocument();
    expect(screen.getByText(/wait 15 minutes/)).toBeInTheDocument();
    await command('Apply: Off for a tier', 'free tier abuse');
    await waitFor(() => expect(last('/api/admin/flags/rooms/change')?.body).toEqual({ action: 'off_for_tier', reason: 'free tier abuse', params: { plan: 'free' } }));
    expect(await screen.findByText(/This is a broad change, so it waits/)).toBeInTheDocument();
  });

  it('applies a kill switch at once and rolls back from history', async () => {
    await openRooms();
    await userEvent.click(screen.getByRole('button', { name: 'Preview impact' }));
    expect(await screen.findByText(/instant and alerts every Owner/)).toBeInTheDocument();
    await command('Apply: Off for everyone', 'incident');
    expect(await screen.findByText('Saved as version 7.')).toBeInTheDocument();
    await command('Restore version 4', 'back to before');
    await waitFor(() => expect(last('/api/admin/flags/rollback')?.body).toEqual({ version: 4, reason: 'back to before', before: false }));
  });

  it("undoes a version, including a flag's first change", async () => {
    await openRooms();
    await command('Undo version 4', 'never meant it');
    await waitFor(() => expect(last('/api/admin/flags/rollback')?.body).toEqual({ version: 4, reason: 'never meant it', before: true }));
  });

  it('explains what a user sees and why', async () => {
    const nav = await enter();
    await userEvent.click(nav.getByRole('button', { name: 'Flags' }));
    await userEvent.type(await screen.findByLabelText('User id'), 'u1');
    await userEvent.click(screen.getByRole('button', { name: 'Explain' }));
    expect(await screen.findByText('plan: no (plan_locked)')).toBeInTheDocument();
  });

  it('turns page fields into the API parameters for each action', () => {
    const form = { plan: 'standard', users: 'u1, u2  u3', percent: 25, from: '2030-01-01T00:00', until: '' };
    expect(paramsFor('off_for_users', form)).toEqual({ user_ids: ['u1', 'u2', 'u3'] });
    expect(paramsFor('rollout', form)).toEqual({ percent: 25, plans: ['standard'] });
    expect(paramsFor('schedule', form)).toMatchObject({ on: true, until: undefined });
    expect(paramsFor('kill_switch', form)).toEqual({});
  });

  it('says why a core flag cannot be targeted', async () => {
    const nav = await enter();
    await userEvent.click(nav.getByRole('button', { name: 'Flags' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open flag core.library' }));
    expect(screen.getByText(/core feature, so it can’t be targeted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview impact' })).toBeNull();
  });
});

describe('freshness and tables', () => {
  it('withholds an unknown value and labels a stale one', () => {
    render(<><Fresh reading={{ value: 9, as_of: 1, age_s: 900, state: 'unknown' }} /><Fresh reading={{ value: 4, as_of: 1, age_s: 180, state: 'stale' }} /></>);
    expect(screen.queryByText('9')).toBeNull();
    expect(screen.getByText('last measured 15 min ago')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Stale: 3 min ago')).toBeInTheDocument();
  });

  it('says so in words when a table is empty', () => {
    render(<DataTable caption="Things" rows={[]} rowKey={() => 'x'} columns={[{ key: 'a', label: 'A' }]} empty="No things yet." />);
    expect(screen.getByRole('table', { name: 'Things' })).toHaveTextContent('No things yet.');
  });
});

describe('admin pages that change under a request', () => {
  it('drops a flag impact preview when another flag is opened', async () => {
    const base = answer;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init.method ?? 'GET';
      calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init.headers) });
      let [status, body] = base(method, path);
      if (path === '/api/admin/flags') {
        const flags = (body as { flags: Record<string, unknown>[] }).flags;
        body = { flags: [...flags, { ...flags[0], id: 'export', label: 'Export', area: 'Cloud services' }] };
      }
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }));
    const nav = await enter();
    await userEvent.click(nav.getByRole('button', { name: 'Flags' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open flag rooms' }));
    await userEvent.click(screen.getByRole('button', { name: 'Preview impact' }));
    expect(await screen.findByLabelText('Impact preview')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open flag export' }));
    expect(await screen.findByText('Export (export)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Impact preview')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply: Off for everyone' })).toBeNull();
  });

  it('says why a waiting action did not run', async () => {
    const base = answer;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init.method ?? 'GET';
      calls.push({ method, path, body: undefined, headers: new Headers(init.headers) });
      const [status, body] = path === '/api/admin/actions/act-1/execute' ? [409, { detail: { code: 'not_ready' } }] : base(method, path);
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }));
    const nav = await enter();
    await userEvent.click(nav.getByRole('button', { name: 'Security' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Run now if due' }));
    expect(await screen.findByText(/still waiting for its delay/)).toBeInTheDocument();
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
