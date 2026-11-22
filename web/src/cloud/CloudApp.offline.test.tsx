import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { cloudAccount } from '../test/cloudAccount';
import type { Account } from './api';

// CloudApp when the connection or the sign-in is gone (plan "Nothing is lost", cloud.offline_shell
// and section 6): the account this device last saw opens a local-first shell offline, only for
// the last person signed in here, and every way out forgets it; a sign-in that ended says the
// import is kept.

const SIGNED_IN = { id: 'user-1', email: 'listener@example.test', emailVerified: true };
const auth = vi.hoisted(() => {
  class LoginRequiredError extends Error {}
  const state = { user: null as unknown, signIn: vi.fn(), signOut: vi.fn(), LoginRequiredError, noTokenFor: 0 };
  // one function for the whole run, as AuthKit's own is stable
  const getAccessToken = async () => {
    if (state.noTokenFor > 0) { state.noTokenFor -= 1; throw new LoginRequiredError('No access token available'); }
    return 'token';
  };
  return { ...state, state, getAccessToken };
});
vi.mock('@workos-inc/authkit-react', () => ({
  LoginRequiredError: auth.LoginRequiredError,
  useAuth: () => ({
    isLoading: false, user: auth.state.user, getAccessToken: auth.getAccessToken,
    signIn: auth.state.signIn, signUp: vi.fn(), signOut: auth.state.signOut,
  }),
}));

const { CloudApp } = await import('./CloudApp');
const { configureConnection, reportOffline } = await import('./connection');
const { rememberAccount, rememberedAccount } = await import('./offlineCache');
const { importMarkerKey } = await import('./importSession');

const localFirst = (): Account => ({
  ...cloudAccount(),
  experience: { local_first: true, hosted: false },
  features: { 'cloud.local_first': true, 'cloud.account_states': true },
});

let account: Account;
let offline = false;

beforeEach(() => {
  configureConnection({ reset: true, probe: async () => !offline });
  offline = false;
  account = cloudAccount();
  auth.state.user = SIGNED_IN;
  auth.state.noTokenFor = 0;
  auth.state.signOut.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (offline) throw new TypeError('Failed to fetch');
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/account') return json(account);
    if (url === '/api/events') throw new TypeError('blocked');
    return new Response('{}', { status: 404 });
  }));
});

describe('CloudApp offline and after a sign-in ends', () => {
  it('keeps the account the server answered, for the person signed in', async () => {
    render(<CloudApp />);
    await waitFor(() => expect(rememberedAccount('user-1')?.value.workspace.id).toBe(account.workspace.id));
    expect(rememberedAccount('someone-else')).toBeNull();
  });

  it('with cloud.offline_shell off, keeps nothing for an offline open', async () => {
    setFlags({ 'cloud.offline_shell': false });
    render(<CloudApp />);
    await screen.findByRole('heading', { level: 1 });
    await new Promise((settle) => setTimeout(settle, 50));
    expect(rememberedAccount()).toBeNull();
  });

  it('sign out forgets the kept account first', async () => {
    window.history.replaceState({}, '', '/account');
    render(<CloudApp />);
    await waitFor(() => expect(rememberedAccount()).not.toBeNull());
    const buttons = await screen.findAllByRole('button', { name: 'Sign out' });
    await userEvent.click(buttons[0]);
    expect(auth.state.signOut).toHaveBeenCalled();
    expect(rememberedAccount()).toBeNull();
    window.history.replaceState({}, '', '/');
  });

  it('opened offline with no sign-in: a local-first account opens this device’s shell from the kept account', async () => {
    rememberAccount('user-1', localFirst());
    auth.state.user = null;
    offline = true;
    act(() => reportOffline());
    render(<CloudApp />);
    expect(await screen.findByText(/you’ll be signed in again when the connection is back/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create your account' })).toBeNull();
  });

  it('opened offline with no sign-in: any other account waits on a plain page that opens by itself', async () => {
    rememberAccount('user-1', cloudAccount());
    auth.state.user = null;
    offline = true;
    act(() => reportOffline());
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'You’re offline' })).toBeInTheDocument();
    expect(screen.getByText(/Everything on this device is kept, and this page opens by itself when you’re back online/)).toBeInTheDocument();
  });

  it('opened offline with nothing kept: the welcome page, as before', async () => {
    auth.state.user = null;
    offline = true;
    act(() => reportOffline());
    render(<CloudApp />);
    expect(await screen.findByRole('button', { name: 'Create your account' })).toBeInTheDocument();
  });

  it('a sign-in that ended says so, keeps everything, and says the import is kept', async () => {
    auth.state.noTokenFor = 5;
    localStorage.setItem(importMarkerKey('ws-1'), JSON.stringify({ version: 1, folder: 'Music', startedAt: 1, total: 9, registered: 3, kept: true }));
    render(<CloudApp />);
    expect(await screen.findByRole('heading', { name: 'Sign in again to carry on' }, { timeout: 4_000 })).toBeInTheDocument();
    expect(screen.getByText(/any import in progress, which carries on after you sign in/)).toBeInTheDocument();
    expect(localStorage.getItem(importMarkerKey('ws-1'))).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(auth.state.signIn).toHaveBeenCalled();
  });
});
