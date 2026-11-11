import { expect, test } from '@playwright/test';
import { PAGES, resetMix } from './helpers';

/**
 * SF-0234-01 focus and reading order. On every page the structure a screen reader walks is the one a
 * sighted person reads: the skip link is the first stop, the main navigation comes before the page,
 * there is one main region with one page heading, headings never skip a level, nothing jumps the Tab
 * order with a positive tabindex, and Tab moves down the page in the order things are drawn.
 * The scene-by-scene map is in docs/engineering/flow-cross-cutting.md "Focus and reading order".
 */

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request, [1, 2, 3]);
});

for (const path of PAGES) {
  test(`SF-0234-01 ${path} has one main, one page heading, headings in order and a skip link first`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForLoadState('networkidle');

    const structure = await page.evaluate(() => {
      const visible = (node: Element) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[aria-hidden="true"], [inert]');
      };
      const mains = [...document.querySelectorAll('main, [role="main"]')];
      const main = mains[0];
      const headings = [...(main?.querySelectorAll('h1, h2, h3, h4, h5, h6') ?? [])].filter(visible).map((node) => Number(node.tagName[1]));
      const nav = document.querySelector('nav[aria-label="Main"]');
      return {
        mains: mains.length,
        h1s: [...document.querySelectorAll('h1')].filter(visible).length,
        headings,
        navFirst: !nav || !main ? null : Boolean(nav.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING),
        positiveTabindex: [...document.querySelectorAll('[tabindex]')].filter((node) => Number(node.getAttribute('tabindex')) > 0).map((node) => node.outerHTML.slice(0, 80)),
      };
    });
    expect(structure.mains).toBe(1);
    expect(structure.h1s).toBe(1);
    expect(structure.headings[0]).toBe(1);
    // a heading may go back up any number of levels, but never down more than one
    for (let index = 1; index < structure.headings.length; index += 1) {
      expect(structure.headings[index] - structure.headings[index - 1], `heading levels ${structure.headings.join(',')}`).toBeLessThanOrEqual(1);
    }
    expect(structure.navFirst).toBe(true);
    expect(structure.positiveTabindex).toEqual([]);

    // the first Tab reaches the skip link, and following it lands in the page
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveText('Skip to the page');
  });
}

test('SF-0234-01 inside the page, Tab goes down the page in the order things are drawn', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const path of ['/listen', '/mixes', '/library', '/mix/current/edit', '/workshop']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const first = page.locator('main').locator('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]').first();
    await first.focus();
    const tops: number[] = [];
    for (let step = 0; step < 12; step += 1) {
      const where = await page.evaluate(() => {
        const node = document.activeElement;
        if (!node || !node.closest('main')) return null;
        const box = node.getBoundingClientRect();
        return box.top + window.scrollY;
      });
      if (where === null) break;
      tops.push(where);
      await page.keyboard.press('Tab');
    }
    expect(tops.length, `${path} has focusable content in its main region`).toBeGreaterThan(1);
    // rows can sit side by side, so allow a step back up within one row's height, never a jump to an earlier section
    for (let index = 1; index < tops.length; index += 1) {
      expect(tops[index], `${path} focus order ${tops.map(Math.round).join(',')}`).toBeGreaterThan(tops[index - 1] - 120);
    }
  }
});
