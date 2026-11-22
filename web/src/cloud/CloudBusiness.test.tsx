import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudAccount } from '../test/cloudAccount';
import { org as fixtureOrg, scenario } from '../business/fixtures';
import type { Overview } from '../business/types';
import type { Account } from './api';
import { isBusinessPath } from './cloudRoutes';

// The business workspace inside the real Cloud app (ADR-0453 D2): `/b/{org}` mounts BusinessApp
// as its own chunk only when the account has `business.workspaces` on; off, nothing business
// is fetched and the address is an ordinary unknown one.

// AuthKit's getAccessToken keeps its identity across renders, so the mock does too.
const auth = vi.hoisted(() => ({ user: { id: 'user-1', email: 'listener@example.test', emailVerified: true } as unknown, token: async () => 'token' }));
vi.mock('@workos-inc/authkit-react', () => ({
  LoginRequiredError: class LoginRequiredError extends Error {},
  useAuth: () => ({ isLoading: false, user: auth.user, getAccessToken: auth.token, signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn() }),
}));

const { CloudApp, businessShown } = await import('./CloudApp');

let account: Account;
let overview: Overview;
const requests: string[] = [];

beforeEach(() => {
  account = cloudAccount();
  overview = scenario('normal');
  requests.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? 'GET'} ${url}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/account') return json(account);
    if (url.startsWith('/api/business/orgs/') && url.endsWith('/overview')) return json(overview);
    if (url === '/api/workspaces') return json({ workspaces: [{ id: 'ws-1', name: 'My music', kind: 'personal', role: 'owner', pilot_until: null }, { id: 'crown', name: 'The Crown Group', kind: 'business', role: 'owner', pilot_until: null }] });
    if (url.startsWith('/api/zones/') && url.endsWith('/requests')) return json([]);
    if (url === '/api/zones/holding') return json({ zone_id: null });
    if (url === '/api/events') throw new TypeError('blocked');
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => { window.history.replaceState({}, '', '/'); });

describe('business routes in the Cloud app', () => {
  it('knows the business addresses', () => {
    expect(isBusinessPath('/b/crown')).toBe(true);
    expect(isBusinessPath('/b/crown/v/camden/control')).toBe(true);
    expect(isBusinessPath('/business/join')).toBe(true);
    expect(isBusinessPath('/bar')).toBe(false);
    expect(isBusinessPath('/library')).toBe(false);
  });

  it('shows the business workspace only when the server says the flag is on', () => {
    expect(businessShown(account)).toBe(false);
    expect(businessShown({ ...account, features: { 'business.workspaces': false } })).toBe(false);
    expect(businessShown({ ...account, features: { 'business.workspaces': true } })).toBe(true);
  });

  it('with the flag off, /b/{org} fetches nothing business and opens no organisation', async () => {
    window.history.replaceState({}, '', '/b/crown');
    render(<CloudApp />);
    await waitFor(() => expect(requests).toContain('GET /api/account'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests.some((line) => line.includes('/api/business/'))).toBe(false);
    expect(screen.queryByRole('heading', { name: /Staff controls/ })).toBeNull();
  });

  it('with the flag on, a staff member lands on the staff controls (S4)', async () => {
    account = { ...cloudAccount(), features: { 'business.workspaces': true } };
    overview = { ...overview, org: fixtureOrg({ role: 'staff', venue_scope: ['camden'] }) };
    window.history.replaceState({}, '', '/b/crown');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'Staff controls: Camden' }, { timeout: 4000 })).toBeInTheDocument();
    expect(requests).toContain('GET /api/business/orgs/crown/overview');
    expect(window.location.pathname).toBe('/b/crown/v/camden/control');
    // Staff have no workspace navigation: their whole app is S4.
    expect(screen.queryByRole('navigation', { name: /business/i })).toBeNull();
  });

  it('with the flag on, an owner sees the organisation navigation', async () => {
    account = { ...cloudAccount(), features: { 'business.workspaces': true } };
    window.history.replaceState({}, '', '/b/crown/people');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'People' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'People' }).length + screen.queryAllByRole('button', { name: 'People' }).length).toBeGreaterThan(0);
  });

  it('/business/start shows the pilot contact form only with business.start on', async () => {
    window.history.replaceState({}, '', '/business/start');
    const { unmount } = render(<CloudApp />);
    await waitFor(() => expect(requests).toContain('GET /api/account'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('heading', { name: 'SelectaDJ for Business' })).toBeNull();
    unmount();
    account = { ...cloudAccount(), features: { 'business.start': true } };
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'SelectaDJ for Business' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/in private pilot/)).toBeInTheDocument();
  });
});
