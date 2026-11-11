import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * S3-0075-02: a pixel-diff gate for Light and Dark, phone and desktop, large text and overlays.
 * Fixture data, clock, motion and caret are frozen and live drawings are masked, so a difference means
 * the page changed. Baselines are pictures a person has looked at: create them with
 *   SELECTA_VISUAL_BASELINE=1 pnpm exec playwright test e2e/s3-0075-visual-regression.e2e.ts --update-snapshots
 * review every image, and commit the folder. Until a reviewed folder exists the gate skips, rather than
 * quietly accepting whatever the first run drew. Never update baselines in bulk to make a diff go away.
 */

const BASELINES = `${fileURLToPath(import.meta.url)}-snapshots`;
test.skip(!existsSync(BASELINES) && !process.env.SELECTA_VISUAL_BASELINE, 'no reviewed baseline folder yet (see the comment above)');

test.beforeEach(async ({ request }) => resetMix(request));

const ROUTES = ['/listen', '/mixes', '/library', '/workshop'];
const WIDTHS = [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 900 }];

async function prepare(page: Page, theme: 'light' | 'dark', width: number, height: number) {
  await page.clock.setFixedTime(new Date('2026-01-05T12:00:00Z'));
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
  await page.setViewportSize({ width, height });
  await page.goto('/mixes');
  await page.evaluate((chosen) => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' })), theme);
}

async function settle(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

const shot = (page: Page) => ({
  animations: 'disabled' as const,
  caret: 'hide' as const,
  fullPage: false,
  maxDiffPixelRatio: 0.002,
  mask: [page.locator('canvas'), page.locator('time'), page.locator('.clock, .elapsed, .remaining')],
});

for (const theme of ['light', 'dark'] as const) {
  for (const size of WIDTHS) {
    test(`${theme} ${size.name}: every main page matches its reviewed picture`, async ({ page }) => {
      await prepare(page, theme, size.width, size.height);
      for (const route of ROUTES) {
        await settle(page, route);
        await expect(page).toHaveScreenshot(`${theme}-${size.name}${route.replace(/\//g, '-')}.png`, shot(page));
      }
    });
  }

  test(`${theme} large text: Listen and Library at 200% text match their reviewed pictures`, async ({ page }) => {
    await prepare(page, theme, 1280, 900);
    for (const route of ['/listen', '/library']) {
      await settle(page, route);
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await page.waitForTimeout(200);
      await expect(page).toHaveScreenshot(`${theme}-large-text${route.replace(/\//g, '-')}.png`, shot(page));
    }
  });

  test(`${theme} overlays: the command palette and the theme menu match their reviewed pictures`, async ({ page }) => {
    for (const size of WIDTHS) {
      await prepare(page, theme, size.width, size.height);
      await settle(page, '/library');
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('combobox', { name: 'Search for a page or a command' })).toBeVisible();
      await expect(page).toHaveScreenshot(`${theme}-${size.name}-palette.png`, shot(page));
      await page.keyboard.press('Escape');
      await page.locator('.theme-menu > button').first().click();
      await expect(page.getByRole('menuitemradio').first()).toBeVisible();
      await expect(page).toHaveScreenshot(`${theme}-${size.name}-theme-menu.png`, shot(page));
      await page.keyboard.press('Escape');
    }
  });
}

