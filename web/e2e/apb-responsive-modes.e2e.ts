import { expect, test } from '@playwright/test';
import { PAGES, resetMix, spyOnAudio, stickingOut } from './helpers';

/**
 * ADR-0439 AV-0439-02 and AV-0439-04: the Local mode's critical pages (docs/autopilot/critical-tasks.json)
 * at 320 CSS px and at a 400% zoom equivalent (a 1280px window at 400% is 320 CSS px with 4x pixels),
 * in both themes, with reduced motion, more contrast and forced colours. Nothing may stick out sideways,
 * the main heading stays visible, keyboard focus lands on something visible, and with reduced motion no
 * endless animation runs. Run with SELECTA_E2E_DIST=dist-apb2 SELECTA_E2E_PORT=9040.
 * Cloud, Room host and guest pages need the cloud harness (tests/cloud_e2e_server.py) and are covered
 * by their own specs; a real phone and NVDA/VoiceOver stay person steps.
 */
const SIZES = [
  { name: '320px', width: 320, height: 640, scale: 1 },
  { name: '400% zoom', width: 320, height: 200, scale: 4 },
] as const;
const THEMES = ['light', 'dark'] as const;

test.beforeEach(async ({ page, request }) => {
  await spyOnAudio(page);
  await resetMix(request);
});

for (const size of SIZES) {
  for (const theme of THEMES) {
    test(`critical pages reflow at ${size.name} in ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale,
        colorScheme: theme, reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const problems: string[] = [];
      for (const path of PAGES) {
        await page.goto(path);
        await page.evaluate((chosen) => { document.documentElement.dataset.theme = chosen; }, theme);
        await expect(page.locator('h1').first()).toBeVisible();
        problems.push(...(await stickingOut(page, `${path} ${theme}`)));
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return true;
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        });
        expect(focused, `${path}: first Tab lands on something visible`).toBe(true);
      }
      expect(problems).toEqual([]);
      await context.close();
    });
  }
}

test('reduced motion leaves no endless animation on critical pages', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const path of ['/listen', '/mixes', '/mix/current/edit', '/library', '/workshop']) {
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    const endless = await page.evaluate(() => document.getAnimations()
      .filter((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().endTime === Infinity).length);
    expect(endless, path).toBe(0);
  }
});

test('forced colours and more contrast keep critical controls visible', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const media of [{ forcedColors: 'active' as const }, { contrast: 'more' as const }]) {
    await page.emulateMedia(media);
    for (const path of ['/listen', '/mixes', '/mix/current/edit']) {
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
      expect(await stickingOut(page, `${path} ${JSON.stringify(media)}`)).toEqual([]);
      const unnamed = await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('button')]
        .filter((button) => button.offsetParent !== null && !(button.getAttribute('aria-label') || button.textContent?.trim() || button.title))
        .length);
      expect(unnamed, `${path}: every visible button has a name`).toBe(0);
    }
  }
});
