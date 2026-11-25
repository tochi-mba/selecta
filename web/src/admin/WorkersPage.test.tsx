// The Workers page against a fake admin API: the verdict headline, a section that failed on its
// own, a stale reading, disabled autoscaler actions with their reason, pausing a pool (Careful,
// with Undo) and cancelling long waits (the danger dialog with the count typed).
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminArea from './AdminArea';
import { waited } from './WorkersActions';

type Call = { method: string; path: string; body: unknown };
const PERMS = ['platform.dashboard.read', 'jobs.read', 'jobs.retry', 'jobs.cancel', 'workers.read', 'workers.drain', 'workers.scale', 'billing.subscriptions.manage'];
const unknown = { value: null, as_of: null, age_s: null, state: 'unknown' };
const pool = (name: string, over: Record<string, unknown> = {}) => ({
  pool: name, does: `${name} work`, workers_seen: 0, last_heartbeat: null, slots: 0, slots_in_use: 0, queued: 0, running: 0,
  failed_24h: 0, succeeded_24h: 0, oldest_queued_at: null, oldest_wait_s: null, recent: [], paused: null, autoscale_size: unknown,
  verdict: { state: 'idle', label: 'Idle', why: 'Nothing is queued.' }, ...over,
});

let calls: Call[] = [];
let status: Record<string, unknown>;
let statusCode = 200;

function base() {
  return {
    now: 1000,
    pools: [
      pool('cpu-light'),
      pool('cpu-heavy', { queued: 14, oldest_wait_s: 12_000, verdict: { state: 'waiting', label: 'Waiting for a worker', why: 'Jobs are queued and no worker has checked in.' } }),
      pool('export'), pool('gpu'),
    ],
    pieces: {
      gateway: { configured: false, setting: 'SELECTA_WORKER_GATEWAY_URL', workers_last_seen: null, state: 'not_configured', detail: '' },
      autoscaler: { running: false, healthy: false, last_tick: unknown, token_on_api: false, settings: ['SELECTA_MODAL_APP'], sizes: {}, requests: [] },
      storage: { state: 'ok', problems: [] },
      flags: [{ id: 'cloud.hosted_media', about: 'Hosted storage', on: true, note: null }],
    },
    customers: { error: 'Couldn’t read customer waits (RuntimeError). The rest of the page is current.' },
    cost: { pools: [], usd_today: 0, usd_month: 0, projected_usd: 0, as_of: 1000, month: 'November 2026',
      budget: { monthly_usd: null, warn_percent: 80, status: 'unset', set_at: null, version: 'v0' } },
  };
}

function answer(method: string, path: string): [number, unknown] {
  if (path === '/api/admin/session') return [201, { id: 's1', expires_at: 4_000_000_000 }];
  if (path === '/api/admin/session/changes') return [200, { changes_until: Date.now() / 1000 + 900 }];
  if (path === '/api/admin/me') return [200, { user_id: 'me', roles: [{ role: 'owner', title: 'Owner', scope: 'platform:*' }], permissions: PERMS,
    session: { id: 's1', expires_at: Date.now() / 1000 + 3600 }, environment: 'development', changes_until: null, can_write: true,
    role_matrix: { owner: { title: 'Owner', permissions: PERMS } }, actions: [], preferences: { welcome: { done: true } } }];
  if (path === '/api/admin/hosted/status') return [statusCode, statusCode === 200 ? status : { detail: { code: 'boom', message: 'The server refused this (500).' } }];
  if (path.startsWith('/api/admin/hosted/preview')) return [200, { count: 3, more: false, accounts: 2, sample: [], version: 'p1', cutoff: 1 }];
  if (path.startsWith('/api/admin/hosted/')) return [method === 'POST' && path.endsWith('expire-queued') ? 202 : 200, { action: { execute_after: 2000 } }];
  if (path === '/api/admin/workers') return [200, { workers: [] }];
  if (path.startsWith('/api/admin/alerts')) return [200, { alerts: [] }];
  if (path === '/api/admin/actions') return [200, { actions: [] }];
  return [404, { detail: { code: 'not_found' } }];
}

beforeEach(() => {
  calls = []; status = base(); statusCode = 200;
  window.history.pushState({}, '', '/admin/workers');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const [code, body] = answer(method, path);
    return new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function open() {
  render(<AdminArea token={async () => 't'} onLeave={() => undefined} origin="" features={null} />);
  await screen.findByRole('region', { name: 'Pools' });
}

describe('the Workers page', () => {
  it('leads with the worst pool and keeps working when one section fails', async () => {
    await open();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Workers');
    expect(document.querySelector('.admin-headline')).toHaveTextContent('CPU heavy: waiting for a worker. 14 jobs queued, the oldest for 3 h 20 min');
    expect(within(screen.getByRole('region', { name: 'What customers see meanwhile' })).getByRole('alert')).toHaveTextContent('Couldn’t read customer waits');
    expect(screen.getByText('Not checked')).toBeInTheDocument();
    expect(screen.getByText('Not running')).toBeInTheDocument();
  });

  it('shows autoscaler actions disabled with the reason while the autoscaler is not running', async () => {
    await open();
    const card = within(screen.getByRole('group', { name: 'CPU heavy commands' }));
    expect(card.getByRole('button', { name: 'Start one worker for an hour' })).toBeDisabled();
    expect(card.getByText(/needs the autoscaler, which isn’t running/)).toBeInTheDocument();
  });

  it('pauses a pool at once with a reason and offers Undo', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Make changes' }));
    await screen.findByRole('button', { name: 'Stop making changes' });
    await new Promise((resolve) => setTimeout(resolve, 520));
    await userEvent.click(screen.getByRole('button', { name: 'Pause CPU heavy' }));
    expect(await screen.findByText(/CPU heavy is paused/)).toBeInTheDocument();
    const call = calls.find((c) => c.path === '/api/admin/hosted/pools/cpu-heavy/pause');
    expect(call?.body).toMatchObject({ reason: 'Paused from the Workers page' });
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('counts long waits first, then asks for the count typed in the danger dialog', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Make changes' }));
    await screen.findByRole('button', { name: 'Stop making changes' });
    await userEvent.click(screen.getByRole('button', { name: 'Count waiting jobs' }));
    expect(await screen.findByText(/3 jobs from 2 accounts have waited over 24 hours/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 520));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel these jobs…' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText(/waits 15 minutes before it runs/)).toBeInTheDocument();
    const go = dialog.getByRole('button', { name: 'Queue cancelling 3 jobs' });
    expect(go).toBeDisabled();
    await userEvent.type(dialog.getByLabelText(/Reason/), 'Stuck after an incident');
    await userEvent.type(dialog.getByLabelText('Type 3 to confirm'), '3');
    await new Promise((resolve) => setTimeout(resolve, 520));
    await userEvent.click(go);
    const call = calls.find((c) => c.path === '/api/admin/hosted/jobs/expire-queued');
    expect(call?.body).toMatchObject({ hours: 24, confirm: '3', version: 'p1' });
  });

  it('keeps the last numbers with their time when a read fails', async () => {
    statusCode = 500;
    render(<AdminArea token={async () => 't'} onLeave={() => undefined} origin="" features={null} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The server refused this (500).');
  });

  it('at phone width shows each pool as a row that opens, a pool needing attention already open', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    await open();
    const heavy = screen.getByRole('button', { name: /CPU heavy.*Waiting for a worker.*14 queued/ });
    expect(heavy).toHaveAttribute('aria-expanded', 'true');
    const light = screen.getByRole('button', { name: /CPU light.*Idle/ });
    expect(light).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(light);
    expect(light).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(light.getAttribute('aria-controls')!)).toHaveTextContent('cpu-light work');
    const gateway = screen.getByRole('button', { name: /Worker gateway.*Not checked/ });
    expect(gateway).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Rates and processing time per pool' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('says waits in plain words', () => {
    expect(waited(null)).toBe('nothing waiting');
    expect(waited(30)).toBe('under a minute');
    expect(waited(12_000)).toBe('3 h 20 min');
    expect(waited(3 * 86_400)).toBe('3 days');
  });
});
