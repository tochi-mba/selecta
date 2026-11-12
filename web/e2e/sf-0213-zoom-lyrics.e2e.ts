import { expect, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * Flow SF-0213-06, found in the 2026-11-12 400% zoom review: a phone-width window at 400% zoom is about
 * 200px tall, and the sticky header, the pinned player and the phone bar left one clipped lyric line
 * between them. In a window that short the player sits in the page's flow (listening.css), so when the
 * words are scrolled into view, more than two lines' worth of them is uncovered.
 */
const SIZES = [[320, 200, '1280x800 at 400%'], [320, 256, '1280x1024 at 400%']] as const;

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // the words and the player are what is measured, so the transitions need not be rendered first
  await resetMix(request);
});

for (const [width, height, zoom] of SIZES) {
  test(`SF-0213-06 lyrics stay readable between the bars at ${zoom}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/listen');
    const play = page.locator('.now .transport .primary');
    await play.click();
    await expect(play).toHaveText('Pause', { timeout: 30_000 });
    const lyrics = page.locator('.now .lyrics').first();
    await expect(lyrics).toBeAttached({ timeout: 30_000 });
    await lyrics.evaluate((node) => node.scrollIntoView({ block: 'start' }));
    const clear = await lyrics.evaluate((node) => {
      // count the rows of the words that are really on top, not under a bar or the player
      const box = node.getBoundingClientRect();
      let rows = 0;
      for (let y = Math.max(0, box.top); y < Math.min(innerHeight, box.bottom); y += 2) {
        const top = document.elementFromPoint(box.left + box.width / 2, y);
        if (top && (top === node || node.contains(top))) rows += 2;
      }
      return rows;
    });
    expect(clear, `${zoom}: uncovered lyric height`).toBeGreaterThanOrEqual(60);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${zoom}: no sideways scroll`).toBeLessThanOrEqual(width);
  });
}
