import { expect, test, type Page } from '@playwright/test';
import { resetMix, spyOnAudio } from './helpers';

/**
 * Stage at laptop and desktop sizes, with the longest title in the made-up library: the whole current
 * lyric line is inside the window, not clipped, and clear of the floating Pause and Exit fullscreen
 * buttons, in light and dark. At 1440x900 the line used to start at the bottom edge ("the morning light
 * come..." with the rest hidden). Edge, muted, tests/e2e_server.py.
 */
const LONG_TITLE = 'An Extraordinarily Long Song Title That Goes On And On Without Any Regard For The Width Of A Phone Screen (Extended Club Remix)';
const SIZES = [[1280, 720], [1280, 800], [1366, 768], [1440, 900], [1600, 900], [1680, 1050], [1920, 1080]] as const;

/** Every answer that names the first song gets the long title, so Stage shows a three-line heading. */
async function longTitle(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || /\/audio|\/peaks|\/stems/.test(url)) return route.fallback();
    const answer = await route.fetch();
    if (!(answer.headers()['content-type'] ?? '').includes('json')) return route.fulfill({ response: answer });
    const swap = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(swap);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, key === 'title' && inner === 'Morning Light' ? LONG_TITLE : swap(inner)]));
      }
      return value;
    };
    await route.fulfill({ response: answer, json: swap(await answer.json()) });
  });
}

test.beforeEach(async ({ page, request }) => {
  await spyOnAudio(page);
  await resetMix(request);
  await longTitle(page);
});

test('the whole current lyric line shows on Stage from 1280 to 1920 wide, light and dark', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const [width, height] of SIZES) {
      const where = `${width}x${height} ${scheme}`;
      await page.setViewportSize({ width, height });
      await page.goto('/listen');
      await expect(page.locator('.lyrics')).toBeVisible();
      await page.locator('.now .transport .primary').click();
      await expect(page.locator('.now .transport .primary')).toHaveText('Pause', { timeout: 30_000 });
      await page.keyboard.press('f');
      await expect(page.locator('.now.stage')).toBeVisible();
      await expect(page.locator('.stage .lyrics .sung')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.stage .track-title')).toContainText('Extraordinarily');
      await page.evaluate(() => document.fonts.ready);
      const fit = await page.evaluate(() => {
        const sung = document.querySelector('.stage .lyrics .sung')!;
        const box = sung.getBoundingClientRect();
        const controls = [...document.querySelectorAll('.stage-controls button')].map((button) => button.getBoundingClientRect());
        // the sung line's own text boxes, so a wrapped line is judged by where its words are
        const range = document.createRange();
        range.selectNodeContents(sung);
        const words = [...range.getClientRects()].filter((rect) => rect.width > 0);
        return {
          top: box.top, bottom: box.bottom, left: box.left, right: box.right,
          // scrollWidth/scrollHeight include font ink and the highlighted word's decoration,
          // even when none of the letters is clipped. Check rendered text rectangles instead.
          cut: words.some((rect) => rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1),
          title: document.querySelector('.stage .track-title')!.getBoundingClientRect().height,
          overlaps: words.some((rect) => controls.some((button) => rect.left < button.right && rect.right > button.left && rect.top < button.bottom && rect.bottom > button.top)),
        };
      });
      expect(fit.title, `${where}: the long title wraps`).toBeGreaterThan(80);
      expect(fit.top, `${where}: current line above the top`).toBeGreaterThanOrEqual(0);
      expect(fit.bottom, `${where}: current line below the fold`).toBeLessThanOrEqual(height);
      expect(fit.left, `${where}: cut at the left`).toBeGreaterThanOrEqual(0);
      expect(fit.right, `${where}: cut at the right`).toBeLessThanOrEqual(width);
      expect(fit.cut, `${where}: clipped`).toBe(false);
      expect(fit.overlaps, `${where}: under Pause or Exit fullscreen`).toBe(false);
      await page.keyboard.press('Escape');
    }
  }
});
