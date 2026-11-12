import { lazy } from 'react';

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
