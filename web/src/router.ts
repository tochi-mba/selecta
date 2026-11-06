import { useSyncExternalStore } from 'react';

/** Real addresses for every page, so Back, Forward, reloading and sharing a link all do what you'd
 * expect. Nothing here touches playback: moving around never restarts the music. */

export type Route =
  | { page: 'listen' }
  | { page: 'mixes'; tab: 'browse' | 'mine' }
  | { page: 'edit'; draft: number | null }
  | { page: 'library' }
  | { page: 'discover'; tab: 'words' | 'harmonic' }
  | { page: 'workshop'; tab: WorkshopTab }
  | { page: 'listening' }
  | { page: 'missing'; path: string };

export type WorkshopTab = 'overview' | 'analysis' | 'storage' | 'sources' | 'learning' | 'diagnostics';
const WORKSHOP_TABS: WorkshopTab[] = ['overview', 'analysis', 'storage', 'sources', 'learning', 'diagnostics'];

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/mixes') return { page: 'mixes', tab: 'browse' };
  if (path === '/mixes/mine') return { page: 'mixes', tab: 'mine' };
  if (path === '/listen') return { page: 'listen' };
  if (path === '/library') return { page: 'library' };
  if (path === '/discover' || path === '/discover/words') return { page: 'discover', tab: 'words' };
  if (path === '/discover/harmonic') return { page: 'discover', tab: 'harmonic' };
  if (path === '/workshop') return { page: 'workshop', tab: 'overview' };
  if (path === '/listening') return { page: 'listening' };
  if (path === '/mix/current/edit') return { page: 'edit', draft: null };
  const workshop = /^\/workshop\/([a-z]+)$/.exec(path);
  if (workshop && WORKSHOP_TABS.includes(workshop[1] as WorkshopTab)) {
    return { page: 'workshop', tab: workshop[1] as WorkshopTab };
  }
  const draft = /^\/mixes\/drafts\/(\d+)\/edit$/.exec(path);
  if (draft) return { page: 'edit', draft: Number(draft[1]) };
  return { page: 'missing', path };
}

export function pathOf(route: Route): string {
  switch (route.page) {
    case 'listen': return '/listen';
    case 'mixes': return route.tab === 'mine' ? '/mixes/mine' : '/mixes';
    case 'edit': return route.draft === null ? '/mix/current/edit' : `/mixes/drafts/${route.draft}/edit`;
    case 'library': return '/library';
    case 'discover': return route.tab === 'harmonic' ? '/discover/harmonic' : '/discover';
    case 'workshop': return route.tab === 'overview' ? '/workshop' : `/workshop/${route.tab}`;
    case 'listening': return '/listening';
    case 'missing': return route.path;
  }
}

const listeners = new Set<() => void>();
function changed() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('popstate', changed);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('popstate', changed);
  };
}

const whereNow = () => `${window.location.pathname}${window.location.search}`;

function rememberScroll() {
  try {
    window.history.replaceState({ ...(window.history.state ?? {}), scroll: window.scrollY }, '');
  } catch {
    // a browser limiting how often this happens just loses its place, nothing more
  }
}

/** Go somewhere. Going where you already are doesn't add to the history. */
export function navigate(to: string | Route, options: { replace?: boolean } = {}) {
  const path = typeof to === 'string' ? to : pathOf(to);
  if (path === whereNow()) return;
  rememberScroll();
  if (options.replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  changed();
}

/** Change what's in the address without it counting as going anywhere, for filters and searches. */
export function setQuery(values: Record<string, string | null | undefined>) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  const path = `${window.location.pathname}${query ? `?${query}` : ''}`;
  if (path === whereNow()) return;
  window.history.replaceState(window.history.state, '', path);
  changed();
}

export function useLocationText(): string {
  return useSyncExternalStore(subscribe, whereNow);
}

export function useRoute(): Route {
  const text = useLocationText();
  return parseRoute(text.split('?')[0]);
}

export function useQueryParam(name: string): string | null {
  const text = useLocationText();
  return new URLSearchParams(text.split('?')[1] ?? '').get(name);
}

/** Where to pick up after Back or Forward, if there's somewhere to go back to. */
export function savedScroll(): number {
  const state = window.history.state as { scroll?: number } | null;
  return state?.scroll ?? 0;
}
