import { describe, expect, it, vi } from 'vitest';
import { authKitConfig, BLOCKED_MESSAGES, blockedCode, followReturnTo, MISSING_AUTH_DOMAIN, safeReturnPath } from './authConfig';

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
  it('has a plain message for each account state the API refuses with', () => {
    for (const code of ['verified_email_required', 'account_deleting', 'account_suspended', 'session_revoked']) {
      expect(blockedCode(code)).toBe(code);
      expect(BLOCKED_MESSAGES[blockedCode(code)!].title.length).toBeGreaterThan(5);
    }
    expect(blockedCode('workspace_not_found')).toBeNull();
    expect(blockedCode(undefined)).toBeNull();
  });
});
