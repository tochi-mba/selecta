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

// What the site says for each refusal code the API uses (spec §7A.3).
//
// Some leave nothing to do but sign in again or wait, so a plain page replaces the app. The rest
// leave the app usable and are said where the action failed. A suspended account stays in the
// app, read-only: it can look at and download its data, sign out and delete itself.
export type BlockedCode = 'verified_email_required' | 'account_deleting' | 'session_revoked' | 'token_invalid' | 'token_expired';

const SIGN_IN_AGAIN = { title: 'Sign in again', detail: 'Your sign-in is no longer valid. Sign in again to continue.' };

export const BLOCKED_MESSAGES: Record<BlockedCode, { title: string; detail: string }> = {
  verified_email_required: {
    title: 'Verify your email',
    detail: 'Open the verification email we sent you, then come back and refresh this page.',
  },
  account_deleting: {
    title: 'This account is being deleted',
    detail: 'It will be erased when the 30-day recovery window ends. To keep it, contact SelectaDJ support before then.',
  },
  session_revoked: {
    title: 'You were signed out',
    detail: 'This session was ended, for example by "Sign out everywhere" or a password reset. Sign in again to continue.',
  },
  token_invalid: SIGN_IN_AGAIN,
  token_expired: SIGN_IN_AGAIN,
};

export const SUSPENDED_NOTICE = 'This account is suspended. You can still view your library, download your data, sign out or delete your account.';

const REFUSAL_MESSAGES: Record<string, string> = {
  account_suspended: SUSPENDED_NOTICE,
  workspace_not_found: 'That workspace isn’t available to this account.',
  not_onboarded: 'Finish setting up your account first.',
};

export function blockedCode(code: string | undefined): BlockedCode | null {
  return code && Object.hasOwn(BLOCKED_MESSAGES, code) ? (code as BlockedCode) : null;
}

export function refusalMessage(code: string | undefined): string | null {
  return code && Object.hasOwn(REFUSAL_MESSAGES, code) ? REFUSAL_MESSAGES[code] : null;
}

// When AuthKit sends the person back without signing them in (Google sign-in cancelled, a reset
// or verification link that expired, the hosted page refusing the request), the address carries
// `error`. The welcome screen says what happened in our own words, never the address's text, and
// the parameters are taken off the address so a refresh starts clean.
const CALLBACK_PROBLEMS: Record<string, string> = {
  access_denied: 'Sign-in was cancelled. Choose Sign in to try again.',
  expired: 'That link has expired. Sign in again, or choose Forgot password? to get a new one.',
};
const CALLBACK_PROBLEM = 'Sign-in didn’t finish. Choose Sign in to try again.';

export function callbackProblem(search: string): string | null {
  const error = new URLSearchParams(search).get('error');
  if (!error) return null;
  if (Object.hasOwn(CALLBACK_PROBLEMS, error)) return CALLBACK_PROBLEMS[error];
  return /expired/i.test(error) ? CALLBACK_PROBLEMS.expired : CALLBACK_PROBLEM;
}

/** The address without AuthKit's callback error parameters. */
export function withoutCallbackError(path: string, search: string, hash = ''): string {
  const query = new URLSearchParams(search);
  for (const name of ['error', 'error_description', 'error_uri', 'state']) query.delete(name);
  const rest = query.toString();
  return `${path}${rest ? `?${rest}` : ''}${hash}`;
}
