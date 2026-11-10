import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudAccount } from '../test/cloudAccount';
import type { Account } from './api';

vi.mock('@workos-inc/authkit-react', () => ({
  useAuth: () => ({
    isLoading: false,
    user: { id: 'user-1', email: 'listener@example.test', emailVerified: true },
    getAccessToken: async () => 'token',
    signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(),
  }),
}));

const { CloudApp, pageFor } = await import('./CloudApp');

let account: Account;
const requests: string[] = [];
/** What /api/events answers: null is a blocked stream, so the page polls. */
let events: string | null = null;

beforeEach(() => {
  account = cloudAccount();
  requests.length = 0;
  events = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? 'GET'} ${url}`);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/account') return json(account);
    if (url === '/api/events') {
      if (events === null) throw new TypeError('blocked');
      return new Response(events, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    if (url.startsWith('/api/uploads')) return json({ uploads: [] });
    if (url.startsWith('/api/assets?')) return json({ assets: [], next_cursor: null });
    if (url === '/api/account/lucy') return json({ enabled: true, phases: { chat: true, proposals: true, commit: true, memory: false, voice: false }, privacy: { share_lyrics: false, share_history: false }, tier: 'Lucy Basic', usage: { used: 0, limit: 40, fair_use: false, resets_at: null } });
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => { window.history.replaceState({}, '', '/'); });

describe('the Cloud app', () => {
  it('maps addresses to pages', () => {
    expect(pageFor('/account/billing')).toBe('billing');
    expect(pageFor('/account')).toBe('settings');
    expect(pageFor('/library')).toBe('library');
    expect(pageFor('/listen')).toBe('listen');
    expect(pageFor('/upload')).toBe('uploads');
    expect(pageFor('/')).toBe('home');
  });

  it('shows the over-quota banner everywhere and pauses uploads, not the library', async () => {
    account = cloudAccount({ used: 12e9, limit: 10e9 });
    render(<CloudApp />);
    expect(await screen.findByRole('alert')).toHaveTextContent('You’re 2.0 GB over Free’s 10.0 GB');
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Cloud workspace' })).getByRole('button', { name: 'Add music' }));
    expect(screen.getByRole('button', { name: 'Start upload' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Manage storage' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your library');
    expect(window.location.pathname).toBe('/library');
  });

  it('says it is polling when the event stream is blocked', async () => {
    render(<CloudApp />);
    expect(await screen.findByText(/Live updates are paused on this network/)).toBeInTheDocument();
  });

  it('confirms a return from Checkout from the server, not the address', async () => {
    window.history.replaceState({}, '', '/account/billing?checkout=success&session_id=cs_1');
    render(<CloudApp />);
    expect(await screen.findByText('Confirming your payment…')).toBeInTheDocument();
    expect(screen.queryByText(/You’re on/)).toBeNull();
    account = cloudAccount({ plan: 'premium', limit: 100e9 });
    await waitFor(() => expect(screen.getByText(/You’re on Premium/)).toBeInTheDocument(), { timeout: 5000 });
  });

  it('puts Download my data and Lucy’s own settings on the Account page', async () => {
    window.history.replaceState({}, '', '/account');
    render(<CloudApp />);
    expect(await screen.findByRole('button', { name: 'Download my data' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Lucy Basic' })).toBeInTheDocument();
    expect(requests).toContain('GET /api/account/lucy');
  });

  it('closes up around a feature switched off for this account: no menu entry, page or button', async () => {
    account = { ...cloudAccount(), features: { 'cloud.uploads': false } };
    window.history.replaceState({}, '', '/library');
    render(<CloudApp />);
    const menu = await screen.findByRole('navigation', { name: 'Cloud workspace' });
    await waitFor(() => expect(within(menu).queryByRole('button', { name: 'Add music' })).toBeNull());
    expect(within(menu).queryByRole('button', { name: 'Library' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your music workspace');
    expect(screen.queryByRole('button', { name: 'Upload tracks' })).toBeNull();
    expect(screen.queryByText('Your library starts here.')).toBeNull();
    expect(requests.filter((asked) => asked.includes('/api/assets') || asked.includes('/api/uploads'))).toEqual([]);
  });

  it('reads its decisions again when the stream says the flags changed', async () => {
    events = 'event: selecta\ndata: {"topic":"flags.changed","payload":{"version":7}}\n\n';
    render(<CloudApp />);
    const menu = await screen.findByRole('navigation', { name: 'Cloud workspace' });
    expect(await within(menu).findByRole('button', { name: 'Add music' })).toBeInTheDocument();
    account = { ...cloudAccount(), features: { 'cloud.uploads': false } };
    await waitFor(() => expect(within(menu).queryByRole('button', { name: 'Add music' })).toBeNull(), { timeout: 5000 });
  });

  it('shows Rooms on the overview as an invitation, a teaser naming the plan, or not at all', async () => {
    account = { ...cloudAccount({ plan: 'premium' }), features: { rooms: true } };
    const { unmount } = render(<CloudApp />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open a room' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Listen');
    unmount();
    window.history.replaceState({}, '', '/');

    account = { ...cloudAccount(), features: { rooms: false }, feature_locks: { rooms: 'premium' } };
    const teaser = render(<CloudApp />);
    expect(await screen.findByText('PREMIUM FEATURE')).toBeInTheDocument();
    expect(screen.getByText(/Rooms are part of Premium/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Explore Premium' })).toBeInTheDocument();
    teaser.unmount();

    account = { ...cloudAccount(), features: { rooms: false } };
    render(<CloudApp />);
    expect(await screen.findByText('CURRENT PLAN')).toBeInTheDocument();
    expect(screen.queryByText('Host a request room')).toBeNull();
  });
});
