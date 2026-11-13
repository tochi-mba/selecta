import type { Page } from './api';

// The Cloud site's addresses, matched exactly (ADR-0420, AV-0420-01).
//
// The first router asked whether the address *contained* a page's word, so `/listening` opened
// Listen, `/library-x` opened the Library and `/listen/account` opened Settings. This table names
// every address the site answers; anything else is an honest "page not found". A trailing slash
// is forgiven (`/library/` is the Library) and the query string and hash are kept for the page
// that reads them (Checkout's return, for example). Off (`cloud.account_states`), CloudApp keeps
// the old `pageFor` matching.

export const ACCOUNT_STATES_FLAG = 'cloud.account_states';

export type CloudRoute = { path: string; page: Page };

/** Every page address, canonical first. `/uploads` was answered by the old matching, so it stays. */
export const CLOUD_ROUTES: readonly CloudRoute[] = [
  { path: '/', page: 'home' },
  { path: '/listen', page: 'listen' },
  { path: '/library', page: 'library' },
  { path: '/upload', page: 'uploads' },
  { path: '/uploads', page: 'uploads' },
  { path: '/account', page: 'settings' },
  { path: '/account/billing', page: 'billing' },
];

/** The canonical address of each page. */
export const PAGE_PATHS: Record<Page, string> = {
  home: '/', listen: '/listen', library: '/library', uploads: '/upload', billing: '/account/billing', settings: '/account',
};

/** The path without trailing slashes (the root stays `/`). */
export function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** The page an address names, or null when no page has that address. */
export function routeFor(pathname: string): Page | null {
  const path = normalizePath(pathname);
  return CLOUD_ROUTES.find((route) => route.path === path)?.page ?? null;
}

/** The staff console and its own pages: `/admin` or `/admin/...`, never `/administer`. */
export function isAdminPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return path === '/admin' || path.startsWith('/admin/');
}

export type Resolved = { kind: 'page'; page: Page } | { kind: 'admin' } | { kind: 'not-found'; path: string };

/** What an address shows: a page, the staff console, or not found. */
export function resolveRoute(pathname: string): Resolved {
  if (isAdminPath(pathname)) return { kind: 'admin' };
  const page = routeFor(pathname);
  return page ? { kind: 'page', page } : { kind: 'not-found', path: pathname };
}
