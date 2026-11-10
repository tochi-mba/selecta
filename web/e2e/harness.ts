import { Page } from '@playwright/test';

/**
 * T0013: the browser harness's shared clock and network-failure controls, so a spec never waits on
 * real time to see a poll, a timeout or a recovery, and never depends on a real outage.
 */

/** A fixed, known moment every spec can start from. */
export const FIXED_NOW = new Date('2026-01-05T10:00:00Z');

/** Freezes the page's clock (Date, timers, requestAnimationFrame) at a known moment before it loads.
 * Advance it with `page.clock.runFor(ms)`, which fires every timer due in that span, in order. */
export async function fixClock(page: Page, at: Date = FIXED_NOW) {
  await page.clock.install({ time: at });
}

export type Failure = 'offline' | 'server' | 'storage' | 'slow';

/** Makes matching API calls fail the way the real world does: no connection, a server fault, a full
 * disk, or an answer that never arrives. Returns a function that puts the network back. */
export async function failNetwork(page: Page, failure: Failure, pattern = '**/api/**') {
  await page.route(pattern, (route) => {
    if (failure === 'offline') return route.abort('internetdisconnected');
    if (failure === 'server') return route.fulfill({ status: 500, json: { detail: 'Internal Server Error' } });
    if (failure === 'storage') return route.fulfill({ status: 507, json: { detail: 'There isn’t enough free space to save that.', code: 'storage_full' } });
    return undefined; // 'slow': the request is held and never answered
  });
  return () => page.unroute(pattern);
}
