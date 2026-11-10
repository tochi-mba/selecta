import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PAGES, resetMix } from './helpers';

/**
 * UF-0387-01 and -03: the exact Unified finish viewport matrix, measured on every page of the synthetic
 * library. Each size must keep the page on screen with no sideways scroll, a way to every other page, a
 * heading, and no main control hidden under the fixed player or navigation. A lab candidate only:
 * screenshots, real phones and a person's review are separate (UF-0389-01/02).
 */

const SIZES = [
  [320, 640], [375, 812], [620, 800], [760, 900], [768, 1024], [1024, 768], [1280, 800], [1440, 900],
  [1920, 1080], [3840, 2160], [568, 320], [844, 390],
] as const;

async function open(page: Page, route: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(route);
  await expect(page.locator('main#main')).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request);
});

test('UF-0387-01/03 every page holds across the UF viewport matrix, with nothing hidden under fixed chrome', async ({ page }, info) => {
  test.setTimeout(15 * 60_000);
  const readings = [];
  for (const route of PAGES) {
    for (const [width, height] of SIZES) {
      await open(page, route, width, height);
      const reading = await page.evaluate(() => {
        const nav = [...document.querySelectorAll('nav[aria-label="Main"]')].some((node) => node.getBoundingClientRect().width > 0);
        const heading = document.querySelector('main h1, main h2');
        // fixed chrome: anything pinned to the viewport outside main (player, bottom bar, rail)
        const fixed = [...document.querySelectorAll<HTMLElement>('body *')].filter((node) => {
          const style = getComputedStyle(node);
          return (style.position === 'fixed' || style.position === 'sticky') && !node.closest('main') && node.getBoundingClientRect().height > 0;
        });
        // scroll each main control into view and check that what is drawn at its centre is the control
        const covered: string[] = [];
        const controls = [...document.querySelectorAll<HTMLElement>('main button, main a[href], main input:not([type="hidden"]), main select')]
          .filter((node) => node.getBoundingClientRect().width > 0 && !node.closest('[inert], [aria-hidden="true"], details:not([open])'));
        for (const control of controls.slice(0, 40)) {
          control.scrollIntoView({ block: 'center' });
          const box = control.getBoundingClientRect();
          const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          if (top && !control.contains(top) && !top.contains(control) && fixed.some((chrome) => chrome.contains(top))) {
            covered.push((control.getAttribute('aria-label') || control.textContent || control.tagName).trim().slice(0, 40));
          }
        }
        window.scrollTo(0, 0);
        return {
          scroll: document.documentElement.scrollWidth,
          nav,
          heading: heading ? heading.getBoundingClientRect().width > 0 : false,
          covered,
        };
      });
      const at = `${route} at ${width}x${height}`;
      expect(reading.scroll, `${at}: scrolls sideways`).toBeLessThanOrEqual(width);
      expect(reading.nav, `${at}: no way to the other pages`).toBe(true);
      expect(reading.heading, `${at}: no heading`).toBe(true);
      expect(reading.covered, `${at}: controls under fixed chrome`).toEqual([]);
      readings.push({ route, width, height, scroll: reading.scroll });
    }
  }
  writeFileSync(info.outputPath('uf-0387-01-matrix.json'), JSON.stringify({ status: 'candidate-not-independently-verified', sizes: SIZES, pages: PAGES.length, readings }, null, 2));
  expect(readings.length).toBe(PAGES.length * SIZES.length);
});
