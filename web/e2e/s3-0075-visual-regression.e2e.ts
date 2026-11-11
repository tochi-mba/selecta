import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * S3-0075-02: deterministic visual-review candidates for Light and Dark, phone and desktop,
 * large text and overlays. Fixture data, clock, motion and caret are frozen and live drawings are
 * masked. These captures deliberately remain test artifacts: a person must review and record them
 * in the visual-evidence log before any separate golden comparison can be introduced.
 */

const BASELINES = `${fileURLToPath(import.meta.url)}-snapshots`;
test.skip(existsSync(BASELINES), 'an unreviewed snapshot folder must not be used as a golden baseline');

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
  mask: [page.locator('canvas'), page.locator('time'), page.locator('.clock, .elapsed, .remaining')],
});

async function candidate(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`candidate-${name}`);
  await page.screenshot({ path, ...shot(page) });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

for (const theme of ['light', 'dark'] as const) {
  for (const size of WIDTHS) {
    test(`${theme} ${size.name}: every main page produces a visual-review candidate`, async ({ page }, testInfo) => {
      await prepare(page, theme, size.width, size.height);
      for (const route of ROUTES) {
        await settle(page, route);
        await candidate(page, testInfo, `${theme}-${size.name}${route.replace(/\//g, '-')}.png`);
      }
    });
  }

  test(`${theme} large text: Listen and Library produce visual-review candidates at 200% text`, async ({ page }, testInfo) => {
    await prepare(page, theme, 1280, 900);
    for (const route of ['/listen', '/library']) {
      await settle(page, route);
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await page.waitForTimeout(200);
      await candidate(page, testInfo, `${theme}-large-text${route.replace(/\//g, '-')}.png`);
    }
  });

  test(`${theme} overlays: the command palette and theme menu produce visual-review candidates`, async ({ page }, testInfo) => {
    for (const size of WIDTHS) {
      await prepare(page, theme, size.width, size.height);
      await settle(page, '/library');
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('combobox', { name: 'Search for a page or a command' })).toBeVisible();
      await candidate(page, testInfo, `${theme}-${size.name}-palette.png`);
      await page.keyboard.press('Escape');
      await page.locator('.theme-menu > button').first().click();
      await expect(page.getByRole('menuitemradio').first()).toBeVisible();
      await candidate(page, testInfo, `${theme}-${size.name}-theme-menu.png`);
      await page.keyboard.press('Escape');
    }
  });
}
