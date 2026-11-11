import { expect, test, type Page, type Route } from '@playwright/test';
import { fixClock } from './harness';
import { PAGES, resetMix } from './helpers';

/**
 * UI/UX polish ADR-0046 P0132: deterministic pixel baselines for every route in the surface inventory
 * (helpers.ts PAGES, docs/adr/mp-0272-surface-inventory.json) and for the loading, empty, failed and
 * recovered states, in both themes at a phone and a desktop width.
 *
 * Determinism controls:
 * - the made-up library from tests/e2e_server.py (SELECTA_E2E_STRESS unset) and a reset current mix;
 * - the page clock installed at harness.ts FIXED_NOW before load, so dates and "x minutes ago" never move;
 * - reduced motion plus `animations: 'disabled'` and a hidden caret;
 * - nothing is played, so no audio-driven animation runs.
 * Masks (documented, each hides only live or audio-derived pixels):
 * - `canvas`: spectrum, waveform and visualizer drawings come from audio analysis;
 * - `time`, `.tabular-time`: elapsed and remaining times;
 * - `.toast-stack`: notices that depend on background job timing.
 *
 * Baselines are written with `--update-snapshots` and committed beside this file. Never refresh them
 * blindly: P0133 is a person comparing every difference, including the state shots below.
 */

const DISPLAYS = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;
const SCHEMES = ['light', 'dark'] as const;
const LIBRARY = /\/api\/library\?/;

const masks = (page: Page) => [page.locator('canvas'), page.locator('time'), page.locator('.tabular-time'), page.locator('.toast-stack')];

async function shot(page: Page, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    mask: masks(page),
    maxDiffPixelRatio: 0.002,
  });
}

const slug = (path: string) => path.replace(/^\//, '').replace(/\//g, '-') || 'home';

test.beforeEach(async ({ page, request }) => {
  await resetMix(request);
  await fixClock(page);
});

for (const display of DISPLAYS) {
  for (const scheme of SCHEMES) {
    const at = `${display.width}-${scheme}`;

    test(`P0132 every inventory route at ${display.width}px in ${scheme}`, async ({ page }) => {
      await page.setViewportSize(display);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      for (const path of PAGES) {
        await page.goto(path);
        await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeAttached();
        await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
        await shot(page, `${at}-${slug(path)}`);
      }
    });

    test(`P0132 loading, empty, failed and recovered Library at ${display.width}px in ${scheme}`, async ({ page }) => {
      await page.setViewportSize(display);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });

      const held: Route[] = [];
      await page.route(LIBRARY, (route) => void held.push(route));
      await page.goto('/library');
      await expect(page.locator('main .skeleton[aria-label="Loading your songs"]')).toHaveAttribute('data-revealed', 'true');
      await shot(page, `${at}-library-loading`);
      await page.unroute(LIBRARY);
      for (const route of held.splice(0)) await route.fallback();

      await page.goto('/library?q=nothing-is-called-this');
      await expect(page.getByText(/Nothing matches/)).toBeVisible();
      await shot(page, `${at}-library-empty`);

      let fail = true;
      await page.route(LIBRARY, (route) => (fail ? route.fulfill({ status: 500, json: { detail: 'Internal Server Error' } }) : route.fallback()));
      await page.goto('/library');
      const problem = page.locator('main .problem[role="alert"]');
      await expect(problem).toBeVisible();
      await shot(page, `${at}-library-failed`);

      fail = false;
      await problem.getByRole('button', { name: 'Try again' }).click();
      await expect(page.locator('.library-rows li').first()).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
      await shot(page, `${at}-library-recovered`);
      await page.unroute(LIBRARY);
    });
  }
}
