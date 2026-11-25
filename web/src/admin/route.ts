// The console's addresses (doc 07b §7B.3): every page, tab, record and filter has a URL.
//   /admin/<page>/<rest...>?<filters>
// Reloading keeps it; the console re-enters when the sign-in is still fresh.

import type { AdminPage } from './AdminArea';

export type { AdminPage };

export type AdminRoute = { page: AdminPage; rest: string[]; query: URLSearchParams };

const ALIASES: Record<string, AdminPage> = { accounts: 'customers', staff: 'security' };

export const PAGE_IDS: AdminPage[] = ['overview', 'customers', 'billing', 'jobs', 'workers', 'ai', 'flags', 'content', 'covers', 'emergency', 'security', 'communications', 'system', 'pilots'];

export function parseAdmin(pathname: string, search = ''): AdminRoute {
  const parts = pathname.replace(/^\/admin\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const first = parts[0] ?? 'overview';
  const page = (PAGE_IDS as string[]).includes(first) ? first as AdminPage : ALIASES[first] ?? 'overview';
  return { page, rest: parts.slice(1), query: new URLSearchParams(search) };
}

export function adminPath(page: AdminPage, rest: string[] = [], query?: Record<string, string | undefined>) {
  const path = ['/admin', page, ...rest.map(encodeURIComponent)].join('/');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

/** Move within the console without a reload, and tell the console to redraw. */
export function go(path: string, replace = false) {
  if (`${window.location.pathname}${window.location.search}` === path) return;
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Set one query value on the current address (filters keep their state in the URL). */
export function setQuery(values: Record<string, string | undefined>) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value); else params.delete(key);
  }
  const text = params.toString();
  go(`${window.location.pathname}${text ? `?${text}` : ''}`, true);
}
