import { writeFileSync } from 'node:fs';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { fixClock, FIXED_NOW } from './harness';
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
 * Every capture is a review CANDIDATE, never a golden baseline (SF-0239-06,
 * tests/test_flow_screenshot_approval.py): the images and a manifest marked
 * candidate-not-independently-verified go to the test's output folder. A person approves the set and
 * records name, date, device and SHA in docs/adr/completion/visual-evidence.md before it becomes a
 * baseline; P0133 is that person comparing every difference, including the state shots below.
 */

const DISPLAYS = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;
const SCHEMES = ['light', 'dark'] as const;
const LIBRARY = /\/api\/library\?/;

const masks = (page: Page) => [page.locator('canvas'), page.locator('time'), page.locator('.tabular-time'), page.locator('.toast-stack')];

type Candidate = { name: string; width: number; scheme: string; screenshot: string };

async function shot(page: Page, info: TestInfo, taken: Candidate[], name: string, width: number, scheme: string) {
  const screenshot = `candidate-p0132-${name}.png`;
  const image = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide', mask: masks(page) });
  writeFileSync(info.outputPath(screenshot), image);
  taken.push({ name, width, scheme, screenshot });
}

function manifest(info: TestInfo, taken: Candidate[], part: string) {
  writeFileSync(info.outputPath(`p0132-manifest-${part}.json`), JSON.stringify({
    status: 'candidate-not-independently-verified',
    fixture: 'tests/e2e_server.py',
    fixedTime: FIXED_NOW.toISOString(),
    motion: 'reduced, animations disabled',
    masks: ['canvas', 'time', '.tabular-time', '.toast-stack'],
    candidates: taken,
  }, null, 2));
}

const slug = (path: string) => path.replace(/^\//, '').replace(/\//g, '-') || 'home';

test.beforeEach(async ({ page, request }) => {
  await resetMix(request);
  await fixClock(page);
});

for (const display of DISPLAYS) {
  for (const scheme of SCHEMES) {
    const at = `${display.width}-${scheme}`;

    test(`P0132 every inventory route at ${display.width}px in ${scheme}`, async ({ page }, info) => {
      const taken: Candidate[] = [];
      await page.setViewportSize(display);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      for (const path of PAGES) {
        await page.goto(path);
        await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeAttached();
        // The development control gallery deliberately displays busy controls and skeleton examples.
        // Wait only for real page work, leaving those static examples available to the candidate shot.
        await expect(page.locator('[aria-busy="true"]:not(.control-gallery *)')).toHaveCount(0, { timeout: 30_000 });
        await shot(page, info, taken, `${at}-${slug(path)}`, display.width, scheme);
      }
      expect(taken).toHaveLength(PAGES.length);
      manifest(info, taken, `${at}-routes`);
    });

    test(`P0132 loading, empty, failed and recovered Library at ${display.width}px in ${scheme}`, async ({ page }, info) => {
      const taken: Candidate[] = [];
      await page.setViewportSize(display);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });

      const held: Route[] = [];
      await page.route(LIBRARY, (route) => void held.push(route));
      await page.goto('/library');
      await expect(page.locator('main .skeleton[aria-label="Loading your songs"]')).toHaveAttribute('data-revealed', 'true');
      await shot(page, info, taken, `${at}-library-loading`, display.width, scheme);
      await page.unroute(LIBRARY);
      for (const route of held.splice(0)) await route.fallback();

      await page.goto('/library?q=nothing-is-called-this');
      await expect(page.getByText(/Nothing matches/)).toBeVisible();
      await shot(page, info, taken, `${at}-library-empty`, display.width, scheme);

      let fail = true;
      await page.route(LIBRARY, (route) => (fail ? route.fulfill({ status: 500, json: { detail: 'Internal Server Error' } }) : route.fallback()));
      await page.goto('/library');
      const problem = page.locator('main .problem[role="alert"]');
      await expect(problem).toBeVisible();
      await shot(page, info, taken, `${at}-library-failed`, display.width, scheme);

      fail = false;
      await problem.getByRole('button', { name: 'Try again' }).click();
      await expect(page.locator('.library-rows li').first()).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
      await shot(page, info, taken, `${at}-library-recovered`, display.width, scheme);
      await page.unroute(LIBRARY);
      expect(taken).toHaveLength(4);
      manifest(info, taken, `${at}-library-states`);
    });
  }
}
