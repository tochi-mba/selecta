import { lazyPage as lazy } from './ui/staleBuild';

/**
 * S3-0073-06: the pages that are not needed to start listening load as their own chunks.
 *
 * Make a Mix, Listen and Library stay in the first download, and so do the player (player.ts) and
 * the audio owner (audio/focus.ts, audio/mediaSession.ts): App imports those statically, so the
 * code that schedules seams and gapless hand-overs is always loaded before any page is, and a page
 * that arrives late can never hold up or reschedule the music. Only page code is split here; no
 * loader below may point at the player or the audio modules (routeChunks.test.ts holds that).
 *
 * The editor, My Mixes, Discover and Workspace are fetched once the first page has painted, while
 * the browser is idle, so moving to them is as quick as before and only the first load gets lighter.
 */

export const ROUTE_CHUNKS = {
  mix: () => import('./views/Mix'),
  myMixes: () => import('./views/MyMixes'),
  links: () => import('./views/Links'),
  workshop: () => import('./views/Workshop'),
} as const;

export const Mix = lazy(() => ROUTE_CHUNKS.mix().then((module) => ({ default: module.Mix })));
export const MyMixes = lazy(() => ROUTE_CHUNKS.myMixes().then((module) => ({ default: module.MyMixes })));
export const Links = lazy(() => ROUTE_CHUNKS.links().then((module) => ({ default: module.Links })));
export const Workshop = lazy(() => ROUTE_CHUNKS.workshop().then((module) => ({ default: module.Workshop })));

/** The split page an address shows, if it is one of them. Aliases resolve the way router.ts does,
 * which is repeated here in short so this file need not import the router. */
function chunkFor(path: string) {
  const bare = (path.split('?')[0].replace(/\/+$/, '') || '/').replace(/^\/workspace(?=\/|$)/, '/workshop');
  if (bare === '/mix/current/edit' || /^\/mixes\/drafts\/\d+\/edit$/.test(bare)) return Mix;
  if (bare === '/mixes/mine' || bare === '/my-mixes') return MyMixes;
  if (bare === '/discover' || bare.startsWith('/discover/') || bare.startsWith('/explore/words') || bare.startsWith('/explore/harmonic')) return Links;
  if (bare === '/workshop' || bare.startsWith('/workshop/')) return Workshop;
  return null;
}

/** Null when the page at this address can be drawn at once; otherwise a promise that resolves when
 * its code has arrived (never rejects). A page transition waits on it for a moment, so the new page
 * is captured as itself and not as its loading skeleton. Pages only: nothing here loads audio. */
export function routeReady(path: string): Promise<void> | null {
  const page = chunkFor(path);
  if (!page || page.loaded()) return null;
  return page.preload();
}

let warmed = false;

/** Fetch every split page in the background, once, after the first page has painted. */
export function warmRouteChunks(): void {
  if (warmed || typeof window === 'undefined') return;
  warmed = true;
  const load = () => {
    for (const loader of Object.values(ROUTE_CHUNKS)) void loader().catch(() => undefined);
  };
  const idle = (window as Window & { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(load, { timeout: 2000 });
  else window.setTimeout(load, 200);
}
