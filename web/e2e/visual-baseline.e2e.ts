import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * T0014: the visual-regression baseline. Every main page at a phone and a desktop size, in both themes,
 * against the synthetic library from tests/e2e_server.py, with motion stilled and the caret hidden.
 *
 * Capture or refresh the baseline:   pnpm e2e:baseline
 *   (writes web/e2e/visual-baseline.e2e.ts-snapshots/*.png; a person looks at them and commits the ones
 *   they approve, which is what makes them a baseline)
 * Compare against it:                 pnpm e2e e2e/visual-baseline.e2e.ts
 *
 * A view with no approved image yet is skipped, not failed, so CI stays green until the owner has
 * approved the first set. Once an image is committed, any change beyond the small tolerance fails.
 */
const VIEWS = [
  { path: '/mixes', name: 'explore' },
  { path: '/listen', name: 'listen' },
  { path: '/mixes/mine', name: 'my-mixes' },
  { path: '/mix/current/edit', name: 'editor' },
  { path: '/library', name: 'library' },
  { path: '/workshop', name: 'workspace' },
] as const;

const DISPLAYS = [
  { width: 375, height: 812, scheme: 'light' },
  { width: 375, height: 812, scheme: 'dark' },
  { width: 1280, height: 900, scheme: 'light' },
  { width: 1280, height: 900, scheme: 'dark' },
] as const;

test.beforeEach(async ({ request }) => resetMix(request));

for (const display of DISPLAYS) {
  for (const view of VIEWS) {
    const name = `${view.name}-${display.width}-${display.scheme}.png`;
    test(`visual baseline: ${view.name} at ${display.width}px in ${display.scheme}`, async ({ page }, info) => {
      const updating = ['all', 'changed', 'missing'].includes(info.config.updateSnapshots);
      test.skip(!updating && !existsSync(info.snapshotPath(name)), `no approved baseline for ${name} yet`);
      await page.setViewportSize({ width: display.width, height: display.height });
      await page.emulateMedia({ colorScheme: display.scheme, reducedMotion: 'reduce' });
      await page.goto(view.path);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await expect(page).toHaveScreenshot(name, {
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
        // live clock and progress text change between runs; they are not layout
        mask: [page.locator('time'), page.locator('[role="progressbar"]'), page.locator('.mini-time')],
        maxDiffPixelRatio: 0.01,
      });
    });
  }
}
