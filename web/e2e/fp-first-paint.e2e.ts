import { expect, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * FP-0265-03 (ADR-0265): on a cold start the document's theme and the browser chrome colour agree
 * before the app's code runs, and nothing flips afterwards.
 *
 * For every saved choice (Light, Dark, System) against each OS setting this:
 *   1. loads the page with the app's JavaScript blocked, so only index.html's inline script has run,
 *      and reads the painted page colour and the theme-color tags at that first paint;
 *   2. loads it again normally, recording every change to <html data-theme> and to the theme-color
 *      tags from the very first moment, and checks the running app never changed what was painted.
 */

const DARK_BAR = '#100f0c';
const LIGHT_BAR = '#f5f2e9';

test.beforeEach(async ({ request }) => resetMix(request));

const look = () => ({
  attr: document.documentElement.dataset.theme ?? 'system',
  scheme: getComputedStyle(document.documentElement).colorScheme,
  background: getComputedStyle(document.body).backgroundColor,
  bars: [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((bar) => bar.content),
});

for (const saved of ['light', 'dark', 'system'] as const) {
  for (const os of ['light', 'dark'] as const) {
    test(`saved ${saved}, OS ${os}: first paint and chrome agree and never flip (FP-0265-03)`, async ({ browser }, info) => {
      const shown = saved === 'system' ? os : saved;
      const bars = saved === 'system' ? [DARK_BAR, LIGHT_BAR] : saved === 'light' ? [LIGHT_BAR, LIGHT_BAR] : [DARK_BAR, DARK_BAR];
      const context = await browser.newContext({ baseURL: info.project.use.baseURL, colorScheme: os });
      await context.addInitScript((value) => {
        if (value !== 'system') localStorage.setItem('selecta.prefs', JSON.stringify({ theme: value, motion: 'still' }));
        else localStorage.removeItem('selecta.prefs');
      }, saved);
      const page = await context.newPage();

      // 1. first paint: only the inline head script has run
      await page.route(/\/assets\/.*\.js$/, (route) => route.abort());
      await page.goto('/mixes');
      const first = await page.evaluate(look);
      expect(await page.locator('#root').evaluate((root) => root.childElementCount), 'the app did not run').toBe(0);
      expect(first.attr).toBe(saved);
      expect(first.scheme).toBe(shown);
      expect(first.bars).toEqual(bars);
      await page.screenshot({ path: info.outputPath(`first-paint-${saved}-os-${os}.png`) });

      // 2. the running app keeps exactly what was painted: no attribute or chrome change at all
      await page.unroute(/\/assets\/.*\.js$/);
      await page.addInitScript(() => {
        const changes: string[] = [];
        (window as unknown as { themeChanges: string[] }).themeChanges = changes;
        new MutationObserver((records) => {
          for (const record of records) {
            const node = record.target as Element;
            if (record.attributeName === 'data-theme' && node === document.documentElement) changes.push(`data-theme=${document.documentElement.dataset.theme}`);
            if (record.attributeName === 'content' && node.getAttribute('name') === 'theme-color') changes.push(`bar=${node.getAttribute('content')}`);
          }
        }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-theme', 'content'] });
      });
      await page.goto('/mixes');
      await expect(page.locator('main#main')).toBeVisible();
      const settled = await page.evaluate(look);
      expect(settled).toEqual(first);
      // the inline script may set the values once before the app runs; after that nothing may differ
      const changes = await page.evaluate(() => (window as unknown as { themeChanges: string[] }).themeChanges);
      const wrong = changes.filter((change) => change !== `data-theme=${saved}` && !bars.some((bar) => change === `bar=${bar}`));
      expect(wrong, changes.join(' ')).toEqual([]);
      await context.close();
    });
  }
}
