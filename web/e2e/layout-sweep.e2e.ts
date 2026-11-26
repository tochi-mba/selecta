import { expect, Page, test } from '@playwright/test';
import { resetMix, rewriteJson } from './helpers';
import { LONG_TITLE, sweep, verdict } from './layoutSweep';

// The local app's layout sweep (plan "two places", phase 1; layoutSweep.ts says what is
// measured): every route in docs/adr/mp-0272-surface-inventory.json at 320, 390, 768, 1280 and
// 1920 px and a phone on its side, with the first song of the library and the mix given a long
// unbroken title. web/src/shell/layoutSweepCoverage.test.ts fails when a route is neither here
// nor in SKIPPED with its reason.

const ROUTES: [id: string, path: string][] = [
  ['route.listen', '/listen'],
  ['route.mixes', '/mixes'],
  ['route.mine', '/mixes/mine'],
  ['route.edit', '/mix/current/edit'],
  ['route.library', '/library'],
  ['route.discover.words', '/discover'],
  ['route.discover.harmonic', '/discover/harmonic'],
  ['route.lucy', '/mixes/lucy'],
  ['route.workshop.overview', '/workshop'],
  ['route.workshop.analysis', '/workshop/analysis'],
  ['route.workshop.sources', '/workshop/sources'],
  ['route.workshop.storage', '/workshop/storage'],
  ['route.workshop.learning', '/workshop/learning'],
  ['route.workshop.diagnostics', '/workshop/diagnostics'],
  ['route.listening', '/listening'],
  ['route.missing', '/no-such-place'],
];

/** Routes not swept here, and why. */
const SKIPPED: Record<string, string> = {
  'route.draft': 'needs a saved draft this server does not make; the draft editor is the same editor as route.edit, which is swept',
};

/** The first song of every list the pages read carries the long title. */
function lengthen(body: unknown): unknown {
  if (Array.isArray(body)) return body.map((item, index) => (index === 0 && item && typeof item === 'object' && 'title' in item ? { ...item, title: LONG_TITLE } : lengthen(item)));
  if (body && typeof body === 'object') return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, lengthen(value)]));
  return body;
}

async function withLongTitles(page: Page) {
  for (const route of ['**/api/library?**', '**/api/library', '**/api/mix', '**/api/mixes**']) {
    await page.route(route, (handled) => (handled.request().method() === 'GET' ? rewriteJson(handled, lengthen) : handled.fallback()));
  }
}

test.beforeEach(async ({ page, request }) => {
  await resetMix(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await withLongTitles(page);
});

for (const [id, path] of ROUTES) {
  test(`${id} (${path}) fits every width`, async ({ page }, testInfo) => {
    await page.goto(path);
    await expect(page.locator('main h1, main [role="heading"][aria-level="1"]').first()).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await verdict(testInfo, await sweep(page, testInfo, id));
  });
}

test('the skipped routes say why', () => {
  for (const [id, why] of Object.entries(SKIPPED)) expect(why.length, id).toBeGreaterThan(30);
});
