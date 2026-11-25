import { useSyncExternalStore } from 'react';
import { routeReady } from './routeChunks';
import { changeScene, navDirection, type NavDirection, type SharedElement } from './shell/sceneTransition';

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
  /** Lucy, under Make a Mix: a new conversation, or one by its id. */
  | { page: 'lucy'; conversation: string | null }
  | { page: 'missing'; path: string };

export type WorkshopTab = 'overview' | 'analysis' | 'storage' | 'sources' | 'learning' | 'diagnostics';
const WORKSHOP_TABS: WorkshopTab[] = ['overview', 'analysis', 'storage', 'sources', 'learning', 'diagnostics'];

/** Friendlier names for the same places. Every older address keeps working and keeps its meaning, so
 * nothing bookmarked or installed breaks, and no address is ever reinterpreted as something else. */
export const ALIASES: Record<string, string> = {
  '/make': '/mixes',
  '/make-a-mix': '/mixes',
  '/explore': '/mixes',
  '/explore/mixes': '/mixes',
  '/explore/words': '/discover',
  '/explore/harmonic': '/discover/harmonic',
  '/my-mixes': '/mixes/mine',
  '/workspace': '/workshop',
  '/studies': '/listening',
};

export function parseRoute(pathname: string): Route {
  const trimmed = pathname.replace(/\/+$/, '') || '/';
  const path = ALIASES[trimmed] ?? trimmed.replace(/^\/workspace\//, '/workshop/');
  if (path === '/' || path === '/mixes') return { page: 'mixes', tab: 'browse' };
  if (path === '/mixes/mine') return { page: 'mixes', tab: 'mine' };
  if (path === '/listen') return { page: 'listen' };
  if (path === '/library') return { page: 'library' };
  if (path === '/discover' || path === '/discover/words') return { page: 'discover', tab: 'words' };
  if (path === '/discover/harmonic') return { page: 'discover', tab: 'harmonic' };
  if (path === '/workshop') return { page: 'workshop', tab: 'overview' };
  if (path === '/listening') return { page: 'listening' };
  if (path === '/mix/current/edit') return { page: 'edit', draft: null };
  if (path === '/mixes/lucy') return { page: 'lucy', conversation: null };
  // local ids look like `cv_...`; Cloud's are UUIDs, with hyphens (ADR-0476)
  const conversation = /^\/mixes\/lucy\/([A-Za-z0-9_-]+)$/.exec(path);
  if (conversation) return { page: 'lucy', conversation: conversation[1] };
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
    case 'lucy': return route.conversation === null ? '/mixes/lucy' : `/mixes/lucy/${route.conversation}`;
    case 'missing': return route.path;
  }
}

const listeners = new Set<() => void>();
function changed() {
  for (const listener of listeners) listener();
}

const whereNow = () => `${window.location.pathname}${window.location.search}`;

/** Each history entry this router makes carries its place, `idx`, so Back and Forward can tell
 * which way they went. Entries made elsewhere (Cloud's own pushState) have none: going to one is a
 * jump, and the next push counts on from the last place known. */
function entryIndex(state: unknown = window.history.state): number | null {
  const idx = (state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' && Number.isFinite(idx) ? idx : null;
}

let lastIndex: number | null = null;
let lastPath: string | null = null;

function knownIndex(): number {
  return entryIndex() ?? lastIndex ?? 0;
}

/** Remember where the page is now, after any change this router makes or hears about. */
function settleHere(index: number | null = entryIndex()) {
  if (index !== null) lastIndex = index;
  lastPath = window.location.pathname;
}

function popped(event: PopStateEvent) {
  const from = lastIndex;
  const to = entryIndex(event.state);
  const samePage = lastPath === window.location.pathname;
  settleHere(to);
  // a query or a sheet's own entry (pushHistoryMark) changes no page, and a browser that already
  // animated the swap itself (a swipe back) must not get a second one
  if (samePage || (event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition) {
    changed();
    return;
  }
  const direction: NavDirection = from === null || to === null || from === to ? 'jump' : to < from ? 'back' : 'forward';
  const path = whereNow();
  changeScene(changed, document, window, { direction, ready: () => routeReady(path) });
}

function subscribe(listener: () => void) {
  if (!listeners.size) {
    settleHere();
    window.addEventListener('popstate', popped);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('popstate', popped);
  };
}

function rememberScroll() {
  try {
    window.history.replaceState({ ...(window.history.state ?? {}), scroll: window.scrollY }, '');
  } catch {
    // a browser limiting how often this happens just loses its place, nothing more
  }
}

/** A history entry at the same address whose state carries `mark`, so Back closes what the mark
 * stands for (the phone editor's sheets) instead of leaving the page. History stays owned here. */
export function pushHistoryMark(mark: Record<string, unknown>) {
  const idx = knownIndex() + 1;
  window.history.pushState({ ...(window.history.state ?? {}), ...mark, idx }, '');
  settleHere(idx);
}

export type NavigateOptions = {
  replace?: boolean;
  /** Elements on this page that travel to the next one, each with its name: `[[cover, 'mix-art']]`.
   * The next page names its element the same way, in CSS or with `data-vt="mix-art"`. */
  share?: readonly SharedElement[];
};

/** Go somewhere. Going where you already are doesn't add to the history. */
export function navigate(to: string | Route, options: NavigateOptions = {}) {
  const path = typeof to === 'string' ? to : pathOf(to);
  const from = whereNow();
  if (path === from) return;
  rememberScroll();
  const idx = options.replace ? knownIndex() : knownIndex() + 1;
  if (options.replace) window.history.replaceState({ idx }, '', path);
  else window.history.pushState({ idx }, '', path);
  settleHere(idx);
  // the address is already right; only the page swap may move, and only when asked for
  changeScene(changed, document, window, {
    direction: navDirection(from, whereNow()),
    ready: () => routeReady(path),
    share: options.share,
  });
}

/** Change what's in the address. Typing doesn't count as going anywhere, but a filter someone chose
 * does when `push` is set, so Back undoes it. */
export function setQuery(values: Record<string, string | null | undefined>, options: { push?: boolean } = {}) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  const path = `${window.location.pathname}${query ? `?${query}` : ''}`;
  if (path === whereNow()) return;
  if (options.push) {
    rememberScroll();
    const idx = knownIndex() + 1;
    window.history.pushState({ idx }, '', path);
    settleHere(idx);
  } else {
    window.history.replaceState(window.history.state, '', path);
  }
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
