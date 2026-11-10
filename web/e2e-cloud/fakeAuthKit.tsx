import type { ReactNode } from 'react';

// Test only: stands in for @workos-inc/authkit-react in the cloud browser-test build
// (vite.cloud-e2e.config.ts). The signed-in person is whoever the test names in localStorage
// `selecta-e2e-user`; their access token is `e2e:<name>`, which the test server's fake token
// verifier accepts (tests/e2e_cloud_server.py). Nothing here talks to WorkOS.

const KEY = 'selecta-e2e-user';

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

export function useAuth() {
  const who = name();
  return {
    isLoading: false,
    user: who ? { id: `user_${who}`, email: `${who}@example.test`, emailVerified: true } : null,
    getAccessToken,
    signIn,
    signUp,
    signOut,
  };
}
