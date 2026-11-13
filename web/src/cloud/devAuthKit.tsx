/** Development-only AuthKit transport for the local WorkOS-compatible identity service.
 *
 * Vite aliases @workos-inc/authkit-react to this module ONLY with
 * vite.cloud-dev.config.ts. Production builds continue using the real SDK.
 * Sign-in uses S256 PKCE, one-time codes, and the actual local RS256 token
 * issuer; no test-only "e2e:*" identity can enter the Cloud API.
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

const REFRESH_KEY = 'selecta-cloud-dev:refresh';
const FLOW_KEY = 'selecta-cloud-dev:login';
const BASE = '/user_management';
type User = { id: string; email: string; emailVerified: boolean };
type Session = { user: User; accessToken: string; refreshToken: string };
type Flow = { state: string; verifier: string; returnTo: string };
type Auth = {
  isLoading: boolean;
  user: User | null;
  getAccessToken: () => Promise<string>;
  signIn: (options?: { state?: { returnTo?: string } }) => Promise<void>;
  signUp: () => Promise<void>;
  signOut: (options?: { returnTo?: string }) => void;
};
type Props = {
  clientId: string;
  children: ReactNode;
  apiHostname?: string;
  devMode?: boolean;
  onRedirectCallback?: (input: { state?: { returnTo?: string } }) => void;
};

const Context = createContext<Auth | null>(null);
let active: Session | null = null;
let refreshing: Promise<Session | null> | null = null;
let initializing: Promise<{ session: Session | null; returnTo: string | null }> | null = null;
let pendingReturn: string | null = null;

function random(): string {
  const data = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(data, (number) => number.toString(16).padStart(2, '0')).join('');
}

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function clearSession() {
  active = null;
  localStorage.removeItem(REFRESH_KEY);
}

async function exchange(clientId: string, fields: Record<string, string>): Promise<Session> {
  const response = await fetch(BASE + '/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, ...fields }),
  });
  const result: unknown = await response.json();
  if (!response.ok || !result || typeof result !== 'object') throw new Error('Local sign-in failed.');
  const data = result as Record<string, unknown>;
  const raw = data.user as Record<string, unknown> | undefined;
  if (!raw || typeof raw.id !== 'string' || typeof raw.email !== 'string'
    || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
    throw new Error('Local identity provider returned an invalid sign-in response.');
  }
  const session: Session = {
    user: { id: raw.id, email: raw.email, emailVerified: raw.email_verified === true },
    accessToken: data.access_token, refreshToken: data.refresh_token,
  };
  active = session;
  localStorage.setItem(REFRESH_KEY, session.refreshToken);
  return session;
}

function readFlow(): Flow | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(FLOW_KEY) ?? 'null') as Flow | null;
    if (data && typeof data.state === 'string' && typeof data.verifier === 'string') return data;
  } catch { /* malformed or stale flow */ }
  return null;
}

async function initialize(clientId: string) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returnedState = params.get('state');
  if (code !== null) {
    const flow = readFlow();
    sessionStorage.removeItem(FLOW_KEY);
    params.delete('code');
    params.delete('state');
    window.history.replaceState({}, '', window.location.pathname
      + (params.size ? '?' + params.toString() : '') + window.location.hash);
    // Reject a missing or mismatched CSRF state before exchanging the one-time code.
    if (!flow || !flow.verifier || !returnedState || flow.state !== returnedState) {
      throw new Error('Sign-in state mismatch.');
    }
    const session = await exchange(clientId, {
      grant_type: 'authorization_code', code, code_verifier: flow.verifier,
    });
    pendingReturn = flow.returnTo;
    return { session, returnTo: flow.returnTo };
  }
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return { session: null, returnTo: null };
  try {
    return {
      session: await exchange(clientId, { grant_type: 'refresh_token', refresh_token: refreshToken }),
      returnTo: null,
    };
  } catch {
    clearSession();
    return { session: null, returnTo: null };
  }
}

async function start(clientId: string, screen: 'sign-in' | 'sign-up', returnTo = '/') {
  const verifier = random() + random();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const state = random();
  sessionStorage.setItem(FLOW_KEY, JSON.stringify({ state, verifier, returnTo } satisfies Flow));
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: window.location.origin + '/',
    code_challenge_method: 'S256',
    code_challenge: base64url(digest),
    provider: 'authkit',
    state,
  });
  if (screen === 'sign-up') query.set('screen_hint', 'sign-up');
  window.location.assign(BASE + '/authorize?' + query.toString());
}

function tokenExpiry(token: string): number {
  try {
    const part = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
    const jwt = JSON.parse(atob(part)) as { exp?: number };
    return typeof jwt.exp === 'number' ? jwt.exp : 0;
  } catch { return 0; }
}

function accessToken(clientId: string): Promise<string> {
  if (!active) return Promise.reject(new Error('Sign in first.'));
  if (tokenExpiry(active.accessToken) > Date.now() / 1000 + 30) {
    return Promise.resolve(active.accessToken);
  }
  if (!refreshing) {
    refreshing = exchange(clientId, {
      grant_type: 'refresh_token', refresh_token: active.refreshToken,
    }).catch((error: unknown) => {
      clearSession();
      throw error;
    }).finally(() => { refreshing = null; });
  }
  return refreshing.then((session) => {
    if (!session) throw new Error('Session expired.');
    return session.accessToken;
  });
}

function signOut(options: { returnTo?: string } = {}) {
  const raw = options.returnTo ?? '/';
  const destination = new URL(raw, window.location.origin);
  const safe = destination.origin === window.location.origin ? destination.href : window.location.origin + '/';
  const token = active?.accessToken ?? '';
  let sessionId = '';
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))) as { sid?: string };
    sessionId = payload.sid ?? '';
  } catch { /* no current session */ }
  clearSession();
  if (sessionId) {
    const query = new URLSearchParams({ session_id: sessionId, return_to: safe });
    window.location.assign(BASE + '/sessions/logout?' + query.toString());
  } else {
    window.location.assign(safe);
  }
}

export function AuthKitProvider({ clientId, children, onRedirectCallback }: Props) {
  const [session, setSession] = useState<Session | null>(active);
  const [isLoading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    if (!initializing) initializing = initialize(clientId);
    void initializing.then(({ session: loaded }) => {
      if (!current) return;
      setSession(loaded);
      setLoading(false);
      if (pendingReturn !== null) {
        const returnTo = pendingReturn;
        pendingReturn = null;
        onRedirectCallback?.({ state: { returnTo } });
      }
    }).catch(() => {
      if (!current) return;
      clearSession();
      const target = new URL(window.location.href);
      target.searchParams.delete('code');
      target.searchParams.delete('state');
      target.searchParams.set('error', 'access_denied');
      window.history.replaceState({}, '', target.pathname + target.search + target.hash);
      setLoading(false);
      setSession(null);
    });
    return () => { current = false; };
  }, [clientId, onRedirectCallback]);

  const value = useMemo<Auth>(() => ({
    isLoading,
    user: session?.user ?? null,
    getAccessToken: () => accessToken(clientId),
    signIn: (options) => start(clientId, 'sign-in', options?.state?.returnTo ?? '/'),
    signUp: () => start(clientId, 'sign-up'),
    signOut,
  }), [clientId, isLoading, session]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(Context);
  if (!auth) throw new Error('Local AuthKitProvider is missing.');
  return auth;
}
