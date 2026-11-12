import { describe, expect, it, vi } from 'vitest';
import { authKitConfig, BLOCKED_MESSAGES, blockedCode, callbackProblem, followReturnTo, MISSING_AUTH_DOMAIN, refusalMessage, safeReturnPath, withoutCallbackError } from './authConfig';

const origin = 'https://app.selecta.test';

describe('AuthKit configuration', () => {
  it('turns development mode on only for vite dev', () => {
    expect(authKitConfig({ DEV: true })).toEqual({ devMode: true, apiHostname: undefined });
    expect(authKitConfig({ DEV: false, VITE_WORKOS_API_HOSTNAME: 'auth.selecta.app' })).toEqual({ devMode: false, apiHostname: 'auth.selecta.app' });
  });

  it('refuses a production build without a custom auth domain instead of falling back to dev mode', () => {
    expect(authKitConfig({ DEV: false })).toEqual({ error: MISSING_AUTH_DOMAIN });
    expect(authKitConfig({ DEV: false, VITE_WORKOS_API_HOSTNAME: '   ' })).toEqual({ error: MISSING_AUTH_DOMAIN });
    expect(authKitConfig({})).toEqual({ error: MISSING_AUTH_DOMAIN });
  });
});

describe('the path followed after sign-in', () => {
  it('follows only same-origin paths', () => {
    expect(safeReturnPath('/library?view=all#top', origin)).toBe('/library?view=all#top');
    expect(safeReturnPath('/account/billing', origin)).toBe('/account/billing');
  });

  it('refuses other origins and tricks that leave the site', () => {
    for (const bad of ['https://evil.test/', '//evil.test/x', '/\\evil.test', 'javascript:alert(1)', 'library', '', '/\nx', 42, null]) {
      expect(safeReturnPath(bad, origin)).toBeNull();
    }
  });

  it('sends anything unsafe to the home page and leaves a missing returnTo alone', () => {
    const replaceState = vi.fn();
    const dispatchEvent = vi.fn();
    const win = { location: { origin }, history: { replaceState }, dispatchEvent } as unknown as Window;
    followReturnTo({ returnTo: '//evil.test' }, win);
    expect(replaceState).toHaveBeenLastCalledWith({}, '', '/');
    followReturnTo({ returnTo: '/library' }, win);
    expect(replaceState).toHaveBeenLastCalledWith({}, '', '/library');
    replaceState.mockClear();
    followReturnTo(undefined, win);
    followReturnTo({}, win);
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe('account refusals', () => {
  it('replaces the app with a plain page for states that leave nothing to do but sign in or wait', () => {
    for (const code of ['verified_email_required', 'account_deleting', 'session_revoked', 'token_invalid', 'token_expired']) {
      expect(blockedCode(code)).toBe(code);
      expect(BLOCKED_MESSAGES[blockedCode(code)!].title.length).toBeGreaterThan(5);
    }
    expect(blockedCode(undefined)).toBeNull();
  });

  it('keeps a suspended account in the app, read-only, and says so where an action is refused', () => {
    expect(blockedCode('account_suspended')).toBeNull();
    expect(refusalMessage('account_suspended')).toMatch(/suspended.*view.*download/i);
  });

  it('says plainly when a workspace is unavailable or setup is unfinished, and nothing for other codes', () => {
    expect(blockedCode('workspace_not_found')).toBeNull();
    expect(refusalMessage('workspace_not_found')).toMatch(/workspace/i);
    expect(refusalMessage('not_onboarded')).toMatch(/set/i);
    expect(refusalMessage('flag_off')).toBeNull();
    expect(refusalMessage(undefined)).toBeNull();
  });

  it('uses only the final codes, never the retired ones', () => {
    for (const retired of ['invalid_session', 'onboarding_required', 'account_deleted', 'workspace_forbidden']) {
      expect(blockedCode(retired)).toBeNull();
      expect(refusalMessage(retired)).toBeNull();
    }
  });
});

describe('coming back from AuthKit without signing in', () => {
  it('says what happened in our own words, never the address text', () => {
    expect(callbackProblem('?error=access_denied&error_description=Click%20evil.test')).toBe('Sign-in was cancelled. Choose Sign in to try again.');
    expect(callbackProblem('?error=expired')).toMatch(/That link has expired/);
    expect(callbackProblem('?error=password_reset_token_expired')).toMatch(/Forgot password\?/);
    expect(callbackProblem('?error=server_error&error_description=Click%20evil.test')).toBe('Sign-in didn’t finish. Choose Sign in to try again.');
    expect(callbackProblem('?code=abc&state=x')).toBeNull();
    expect(callbackProblem('')).toBeNull();
  });

  it('takes only the error parameters off the address', () => {
    expect(withoutCallbackError('/library', '?error=access_denied&error_description=x&error_uri=y&state=z')).toBe('/library');
    expect(withoutCallbackError('/library', '?view=grid&error=x', '#top')).toBe('/library?view=grid#top');
  });
});
