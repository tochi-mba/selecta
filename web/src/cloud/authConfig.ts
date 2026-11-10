// How the Cloud site talks to AuthKit, kept apart from the components so the rules are testable.
//
// - Development mode (refresh token in localStorage) is on only for `vite dev`.
// - A production build must name the custom auth domain, so AuthKit keeps the refresh token in
//   an HttpOnly cookie there; without it the site shows a configuration error instead of quietly
//   falling back to development mode.
// - After sign-in, only a same-origin path is followed; anything else goes to the home page.
// - The access token itself is never stored by us: AuthKit keeps it in memory.

export type AuthEnv = { DEV?: boolean; VITE_WORKOS_API_HOSTNAME?: string };
export type AuthKitConfig = { devMode: boolean; apiHostname: string | undefined };

export const MISSING_AUTH_DOMAIN =
  'This build has no custom sign-in domain. Set VITE_WORKOS_API_HOSTNAME (for example auth.selecta.app) and rebuild. Without it, sign-in would keep tokens in browser storage.';

export function authKitConfig(env: AuthEnv): AuthKitConfig | { error: string } {
  const apiHostname = (env.VITE_WORKOS_API_HOSTNAME ?? '').trim();
  const devMode = env.DEV === true;
  if (!devMode && !apiHostname) return { error: MISSING_AUTH_DOMAIN };
  return { devMode, apiHostname: apiHostname || undefined };
}

// A path on this site, or null. Rejects other origins, protocol-relative `//host`, backslash
// tricks, control characters and anything that doesn't start with a single `/`.
export function safeReturnPath(value: unknown, origin: string): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return null;
  }
  let url: URL;
  try { url = new URL(value, origin); } catch { return null; }
  if (url.origin !== origin) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

// AuthKit's `onRedirectCallback`: move to the `returnTo` path carried in `state`, if it is one of
// ours, without reloading the page (which would drop the in-memory token).
export function followReturnTo(state: unknown, win: Window = window) {
  if (!state || typeof state !== 'object' || !('returnTo' in state)) return;
  const path = safeReturnPath((state as { returnTo: unknown }).returnTo, win.location.origin) ?? '/';
  win.history.replaceState({}, '', path);
  win.dispatchEvent(new PopStateEvent('popstate'));
}

// The account states the API refuses with, and what the site says about each.
export type BlockedCode = 'verified_email_required' | 'account_deleting' | 'account_suspended' | 'session_revoked';

export const BLOCKED_MESSAGES: Record<BlockedCode, { title: string; detail: string }> = {
  verified_email_required: {
    title: 'Verify your email',
    detail: 'Open the verification email we sent you, then come back and refresh this page.',
  },
  account_deleting: {
    title: 'This account is being deleted',
    detail: 'It will be erased when the 30-day recovery window ends. To keep it, contact Selecta support before then.',
  },
  account_suspended: {
    title: 'This account is suspended',
    detail: 'You can still sign out or delete your account. Contact Selecta support if you think this is a mistake.',
  },
  session_revoked: {
    title: 'You were signed out',
    detail: 'This session was ended, for example by "Sign out everywhere" or a password reset. Sign in again to continue.',
  },
};

export function blockedCode(code: string | undefined): BlockedCode | null {
  return code && code in BLOCKED_MESSAGES ? (code as BlockedCode) : null;
}
