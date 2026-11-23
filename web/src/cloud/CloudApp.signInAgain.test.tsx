import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudAccount } from '../test/cloudAccount';
import type { Account } from './api';

// "Sign in again to carry on" when AuthKit has a user but no token: the screen heals by itself
// the moment a token is back, its button tries quietly before it redirects, a page that is open
// is not replaced for a short miss, and each miss leaves a trail with no secret in it.

const SIGNED_IN = { id: 'user-1', email: 'listener@example.test', emailVerified: true };
const auth = vi.hoisted(() => {
  class LoginRequiredError extends Error {}
  const state = { user: null as unknown, signIn: vi.fn(), signOut: vi.fn(), tokens: true, asked: 0 };
  // one function for the whole run, as AuthKit's own is stable
  const getAccessToken = async () => {
    state.asked += 1;
    if (!state.tokens) throw new LoginRequiredError('No access token available');
    return 'token';
  };
  return { state, getAccessToken, LoginRequiredError };
});
vi.mock('@workos-inc/authkit-react', () => ({
  LoginRequiredError: auth.LoginRequiredError,
  useAuth: () => ({
    isLoading: false, user: auth.state.user, getAccessToken: auth.getAccessToken,
    signIn: auth.state.signIn, signUp: vi.fn(), signOut: auth.state.signOut,
  }),
}));

const { CloudApp } = await import('./CloudApp');
const { configureConnection } = await import('./connection');
const { AUTH_TRAIL_KEY, noteAuthProblem, noteSessionEnded, resetAuthTrail, sessionEnded } = await import('./authTrail');

let account: Account;
const SCREEN = { name: 'Sign in again to carry on' };
const shown = () => screen.findByRole('heading', SCREEN, { timeout: 15_000 });
const gone = () => waitFor(() => expect(screen.queryByRole('heading', SCREEN)).toBeNull(), { timeout: 5_000 });

beforeEach(() => {
  configureConnection({ reset: true });
  resetAuthTrail();
  sessionStorage.clear();
  account = cloudAccount();
  auth.state.user = SIGNED_IN;
  auth.state.tokens = true;
  auth.state.asked = 0;
  auth.state.signIn.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/account') return json(account);
    if (url === '/api/events') throw new TypeError('blocked');
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => { vi.restoreAllMocks(); });

describe('Sign in again, when AuthKit has a user but no token', () => {
  it('goes away by itself when the token is back and the window gets focus', async () => {
    auth.state.tokens = false;
    render(<CloudApp />);
    await shown();
    auth.state.tokens = true;
    window.dispatchEvent(new Event('focus'));
    await gone();
    expect(auth.state.signIn).not.toHaveBeenCalled();
  }, 30_000);

  it('goes away by itself on its own timer, with nothing pressed', async () => {
    auth.state.tokens = false;
    render(<CloudApp />);
    await shown();
    auth.state.tokens = true;
    // the first quiet ask comes about three seconds after the screen appears
    await waitFor(() => expect(screen.queryByRole('heading', SCREEN)).toBeNull(), { timeout: 8_000 });
    expect(auth.state.signIn).not.toHaveBeenCalled();
  }, 30_000);

  it('asks again when another tab stores a new AuthKit refresh token', async () => {
    auth.state.tokens = false;
    render(<CloudApp />);
    await shown();
    auth.state.tokens = true;
    window.dispatchEvent(new StorageEvent('storage', { key: 'workos:refresh-token:client_1', newValue: 'x' }));
    await gone();
  }, 30_000);

  it('the button tries quietly first: a token that is back opens the app with no redirect', async () => {
    auth.state.tokens = false;
    render(<CloudApp />);
    await shown();
    auth.state.tokens = true;
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    await gone();
    expect(auth.state.signIn).not.toHaveBeenCalled();
  }, 30_000);

  it('the button starts the sign-in only when AuthKit still says one is needed', async () => {
    auth.state.tokens = false;
    render(<CloudApp />);
    await shown();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(auth.state.signIn).toHaveBeenCalledTimes(1));
  }, 30_000);

  it('a page that is open is not replaced for a short miss, and says it is renewing', async () => {
    const view = render(<CloudApp />);
    await screen.findByRole('heading', { level: 1 });
    auth.state.tokens = false;
    // AuthKit hands over a new user object (as when the user record changed on another device),
    // which reads the account again
    const before = auth.state.asked;
    auth.state.user = { ...SIGNED_IN };
    view.rerender(<CloudApp />);
    await waitFor(() => expect(auth.state.asked).toBeGreaterThan(before), { timeout: 10_000 });
    // the quiet line shows from the second miss, about a second and a half later
    expect(await screen.findByText(/Renewing your sign-in/, undefined, { timeout: 8_000 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', SCREEN)).toBeNull();
    auth.state.tokens = true;
    await waitFor(() => expect(screen.queryByText(/Renewing your sign-in/)).toBeNull(), { timeout: 10_000 });
    expect(screen.queryByRole('heading', SCREEN)).toBeNull();
  }, 40_000);
});

describe('the sign-in trail', () => {
  const trail = () => JSON.parse(sessionStorage.getItem(AUTH_TRAIL_KEY) ?? '[]') as Record<string, unknown>[];

  it('keeps the name, message, status and isTransient, and nothing else from the error', () => {
    const error = Object.assign(new Error('invalid_grant'), { name: 'RefreshError', status: 400, isTransient: false, token: 'secret', refreshToken: 'secret' });
    noteAuthProblem('getAccessToken', error);
    const [entry] = trail();
    expect(entry).toMatchObject({ where: 'getAccessToken', name: 'RefreshError', message: 'invalid_grant', status: 400, isTransient: false });
    expect(JSON.stringify(trail())).not.toContain('secret');
    expect(Object.keys(entry).sort()).toEqual(['at', 'isTransient', 'message', 'name', 'status', 'where']);
  });

  it('counts a run of the same failure on one entry and says it once in the console', () => {
    for (let index = 0; index < 5; index += 1) noteAuthProblem('getAccessToken', new auth.LoginRequiredError('No access token available'));
    expect(trail()).toHaveLength(1);
    expect(trail()[0]).toMatchObject({ times: 5 });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('keeps only the last 20', () => {
    for (let index = 0; index < 30; index += 1) noteAuthProblem(`place ${index}`, new Error('x'));
    expect(trail()).toHaveLength(20);
    expect(trail()[19]).toMatchObject({ where: 'place 29' });
  });

  it('records the one real sign-out: AuthKit saying the session could not be renewed', () => {
    expect(sessionEnded()).toBe(false);
    noteSessionEnded();
    expect(sessionEnded()).toBe(true);
    expect(trail()[0]).toMatchObject({ where: 'authkit.onRefreshFailure' });
  });
});
