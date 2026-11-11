import { expect, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * T0014: deterministic visual-review candidates. Every main page is captured at a phone and desktop
 * size in both themes against the synthetic library from tests/e2e_server.py, with motion stilled and
 * the caret hidden. The images remain CI artifacts until a named person records approval, device and
 * exact SHA in the visual-evidence log; this spec never promotes its own first capture to a golden.
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
    test(`visual candidate: ${view.name} at ${display.width}px in ${display.scheme}`, async ({ page }, info) => {
      await page.setViewportSize({ width: display.width, height: display.height });
      await page.emulateMedia({ colorScheme: display.scheme, reducedMotion: 'reduce' });
      await page.goto(view.path);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      const path = info.outputPath(`candidate-${name}`);
      await page.screenshot({
        path,
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
        // live clock and progress text change between runs; they are not layout
        mask: [page.locator('time'), page.locator('[role="progressbar"]'), page.locator('.mini-time')],
      });
      await info.attach(name, { path, contentType: 'image/png' });
    });
  }
}
