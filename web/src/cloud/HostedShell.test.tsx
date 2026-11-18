import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flagOn, setAccountFeatures, setFlags } from '../flags';
import { cloudAccount } from '../test/cloudAccount';
import type { Account } from './api';
import { hostedRoute, NO_PLAYER, NOT_IN_HOSTED } from './HostedShell';

// `cloud.hosted_shell`: the hosted pages inside the shared shell, and with it off the legacy rail
// untouched (CloudApp.test.tsx pins the rail byte for byte).

// The shell is a lazy chunk: its first load in a busy run takes longer than the default second.
configure({ asyncUtilTimeout: 10_000 });

const auth = vi.hoisted(() => ({ user: { id: 'user-1', email: 'listener@example.test', emailVerified: true } as unknown, signOut: vi.fn() }));
vi.mock('@workos-inc/authkit-react', () => ({
  useAuth: () => ({ isLoading: false, user: auth.user, getAccessToken: async () => 'token', signIn: vi.fn(), signUp: vi.fn(), signOut: auth.signOut }),
}));
// Listen stands in for a page that fails to draw, when the test asks it to.
const broken = vi.hoisted(() => ({ listen: false }));
vi.mock('../rooms/CloudListen', () => ({
  CloudListen: () => {
    if (broken.listen) throw new Error('drawing failed');
    return <section aria-label="Cloud listen">listen page</section>;
  },
}));

const { CloudApp } = await import('./CloudApp');

let account: Account;
const hosted = (features: Record<string, boolean> = {}): Account => ({
  ...cloudAccount(),
  experience: { local_first: false, hosted: true },
  features: { 'cloud.hosted_shell': true, ...features },
});

beforeEach(() => {
  broken.listen = false;
  auth.signOut.mockReset();
  account = hosted();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/account') return json(account);
    if (url === '/api/events') throw new TypeError('blocked');
    if (url.startsWith('/api/uploads')) return json({ uploads: [] });
    if (url.startsWith('/api/assets?')) return json({ assets: [], next_cursor: null });
    if (url === '/api/account/lucy') return json({ enabled: true, phases: { chat: true, proposals: true, commit: true, memory: false, voice: false }, privacy: { share_lyrics: false, share_history: false }, tier: 'Lucy Basic', usage: { used: 0, limit: 40, fair_use: false, resets_at: null } });
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  setAccountFeatures(null);
  setFlags(null);
  window.history.replaceState({}, '', '/');
});

describe('hosted Cloud on the shared shell', () => {
  it('draws the hosted pages in the shared navigation, with no legacy rail and no My Mixes', async () => {
    render(<CloudApp />);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const name of ['Listen', 'Make a Mix', 'Library']) expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'My Mixes' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Cloud workspace' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('Your library starts here.')).toBeInTheDocument();
    // no player: the shell's mini player and the local-only buttons are not there
    expect(screen.queryByRole('complementary', { name: 'Now playing' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Requests/ })).toBeNull();
  });

  it('serves the account places from More, with the rail’s account controls on Account', async () => {
    render(<CloudApp />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'More' }))[0]);
    const more = await screen.findByRole('navigation', { name: 'More' });
    for (const name of ['Account', 'Plan & billing', 'Add music']) expect(within(more).getByRole('link', { name })).toBeInTheDocument();
    expect(within(more).queryByRole('link', { name: 'This device' })).toBeNull();
    await userEvent.click(within(more).getByRole('link', { name: 'Account' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Account' })).toBeInTheDocument();
    const signedIn = screen.getByRole('region', { name: 'Signed in as' });
    expect(signedIn).toHaveTextContent('listener@example.test');
    for (const name of ['Sign out everywhere…', 'Delete account…']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });

  it('opens Make a Mix as its own page and leaves a page switched off out of the navigation', async () => {
    window.history.replaceState({}, '', '/mixes');
    account = hosted({ 'cloud.stored_media': false, 'cloud.uploads': false });
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Make a Mix' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Library' })).toBeNull();
  });

  it('keeps the shell and its navigation when a page fails to draw', async () => {
    broken.listen = true;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.history.replaceState({}, '', '/listen');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'Listen stopped working.' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    quiet.mockRestore();
  });

  it('hands the switched-off flags back when it closes', async () => {
    const { unmount } = render(<CloudApp />);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(flagOn('cloud.local_first')).toBe(false);
    unmount();
    await waitFor(() => expect(flagOn('requests')).toBe(true));
  });
});

describe('the legacy frame with cloud.hosted_shell off', () => {
  it('keeps a failing page inside its Section, under the rail', async () => {
    account = { ...cloudAccount(), features: { 'cloud.hosted_shell': false } };
    broken.listen = true;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.history.replaceState({}, '', '/listen');
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'Listen stopped working.' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Cloud workspace' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    quiet.mockRestore();
  });
});

describe('hosted routing', () => {
  const more = [{ id: 'account' as const }, { id: 'billing' as const }, { id: 'uploads' as const }];
  const all = () => true;
  it('names every hosted address, keeps /uploads and says not found for the rest', () => {
    expect(hostedRoute('/', more, all).view).toBe('home');
    expect(hostedRoute('/listen/', more, all).view).toBe('listen');
    expect(hostedRoute('/mixes', more, all).route).toEqual({ page: 'mixes', tab: 'browse' });
    expect(hostedRoute('/uploads', more, all).view).toEqual({ more: 'uploads' });
    expect(hostedRoute('/account/billing', more, all).view).toEqual({ more: 'billing' });
    expect(hostedRoute('/listening', more, all).view).toEqual({ missing: '/listening' });
  });

  it('shows the overview at the address of a page or place that is off', () => {
    expect(hostedRoute('/library', more, (what) => what !== 'library')).toMatchObject({ view: 'home', redirect: '/' });
    expect(hostedRoute('/mixes', more, (what) => what !== 'mixes')).toMatchObject({ view: 'home', redirect: '/' });
    expect(hostedRoute('/account/devices', more, all)).toMatchObject({ view: 'home', redirect: '/' });
  });

  it('switches off what this shell cannot serve, and gives the shell a silent player', async () => {
    expect(NOT_IN_HOSTED['cloud.local_first']).toBe(false);
    expect(NO_PLAYER.getSpectrum()).toBeNull();
    await expect(NO_PLAYER.togglePause()).resolves.toBeUndefined();
  });
});
