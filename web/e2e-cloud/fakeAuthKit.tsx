import type { ReactNode } from 'react';

// Test only: stands in for @workos-inc/authkit-react in the cloud browser-test build
// (vite.cloud-e2e.config.ts). The signed-in person is whoever the test names in localStorage
// `selecta-e2e-user`; their access token is `e2e:<name>`, which the test server's fake token
// verifier accepts (tests/e2e_cloud_server.py). Nothing here talks to WorkOS.

const KEY = 'selecta-e2e-user';

/** The same name AuthKit exports, so the app's `instanceof` checks build and run here too. The
 * fake never throws it: a test signs out by clearing the stored name. */
export class LoginRequiredError extends Error {
  constructor(message = 'No access token available') {
    super(message);
    this.name = 'LoginRequiredError';
  }
}

export function AuthKitProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// One set of functions for the page's life, as AuthKit gives: a new getAccessToken on every
// render would make every hook that depends on it start over.
const name = () => localStorage.getItem(KEY);
const getAccessToken = async () => `e2e:${name() ?? 'nobody'}`;
const signIn = async () => {};
const signUp = async () => {};
const signOut = ({ returnTo }: { returnTo?: string } = {}) => {
  localStorage.removeItem(KEY);
  window.location.assign(returnTo ?? '/');
};

// The same user object for as long as the name stays the same, as AuthKit keeps its user in state:
// a new object on every render made every hook that depends on the user run again, and CloudApp
// read /api/account in a loop until the rate limits (cloud.rate_limits) answered 429.
type User = { id: string; email: string; emailVerified: boolean };
let kept: { who: string; user: User } | null = null;
function userOf(who: string | null): User | null {
  if (!who) return null;
  if (kept?.who !== who) kept = { who, user: { id: `user_${who}`, email: `${who}@example.test`, emailVerified: true } };
  return kept.user;
}

export function useAuth() {
  return {
    isLoading: false,
    user: userOf(name()),
    getAccessToken,
    signIn,
    signUp,
    signOut,
  };
}
