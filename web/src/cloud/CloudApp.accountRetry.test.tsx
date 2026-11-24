import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudAccount } from '../test/cloudAccount';
import type { Account } from './api';

// An account read that fails with a 500 while this device has a kept account showed the kept one
// and never asked again: a 500 does not take the connection down, so "back online" never came.

const SIGNED_IN = { id: 'user-1', email: 'listener@example.test', emailVerified: true };
const auth = vi.hoisted(() => {
  class LoginRequiredError extends Error {}
  const state = { user: null as unknown, signIn: vi.fn(), signOut: vi.fn() };
  return { LoginRequiredError, state, getAccessToken: async () => 'token' };
});
vi.mock('@workos-inc/authkit-react', () => ({
  LoginRequiredError: auth.LoginRequiredError,
  useAuth: () => ({ isLoading: false, user: auth.state.user, getAccessToken: auth.getAccessToken, signIn: auth.state.signIn, signUp: vi.fn(), signOut: auth.state.signOut }),
}));

const { ACCOUNT_RETRY, CloudApp } = await import('./CloudApp');
const { configureConnection, getConnection } = await import('./connection');
const { rememberAccount } = await import('./offlineCache');
const { setFlags } = await import('../flags');

let kept: Account;
let accountReads = 0;
let failing = true;
const timing = { ...ACCOUNT_RETRY };

beforeEach(() => {
  configureConnection({ reset: true, probe: async () => true });
  setFlags({ 'cloud.offline_shell': true });
  ACCOUNT_RETRY.firstMs = 30;
  ACCOUNT_RETRY.maxMs = 60;
  kept = cloudAccount();
  accountReads = 0;
  failing = true;
  auth.state.user = SIGNED_IN;
  rememberAccount('user-1', kept);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/account') {
      accountReads += 1;
      return failing ? json({ detail: 'boom' }, 500) : json({ ...kept, workspace: { ...kept.workspace, name: 'Read again' } });
    }
    if (url === '/api/events') throw new TypeError('blocked');
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => { Object.assign(ACCOUNT_RETRY, timing); vi.unstubAllGlobals(); });

describe('an account read that fails while the connection is fine', () => {
  it('is asked again by itself until it answers', async () => {
    render(<CloudApp />);
    // one read is tried three times by the request layer; a fourth can only be the retry's (the
    // page's own ten-second poll has not come round yet)
    await waitFor(() => expect(accountReads).toBeGreaterThan(3), { timeout: 8_000 });
    expect(getConnection().status).toBe('online');
    failing = false;
    const before = accountReads;
    await waitFor(() => expect(accountReads).toBeGreaterThan(before), { timeout: 8_000 });
    const settled = accountReads;
    // once it has answered, nothing keeps asking
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(accountReads).toBe(settled);
  }, 40_000);
});
