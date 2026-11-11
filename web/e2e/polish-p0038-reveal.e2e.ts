import { expect, test } from '@playwright/test';

/**
 * UI/UX polish ADR-0036 P0038: the short-load reveal policy measured in Edge. The Library's read is
 * delayed by route; every animation frame records whether the placeholder's bars were painted
 * (visibility and opacity) until the songs arrive. A quick answer must never paint a placeholder, a
 * slow one must, and the songs must appear as soon as they arrive (no minimum placeholder time).
 * Fake-clock version of the same table: web/src/ui/polishReveal.test.tsx.
 */

const LIBRARY = /\/api\/library\?/;

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`P0038 quick answers never flash a placeholder; slow ones show it (${motion} motion)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    const results: Array<{ delay: number; paintedMs: number; maxOpacity: number; returned: boolean }> = [];
    // the recorder starts before the app on every load, so the very first frames are seen
    await page.addInitScript(() => {
      const log = { firstPaint: 0, lastPaint: 0, maxOpacity: 0, contentAt: 0, returned: false };
      (window as unknown as { revealLog: typeof log }).revealLog = log;
      const tick = (now: number) => {
        const bars = document.querySelector('main .skeleton[aria-label="Loading your songs"] .skeleton-content') as HTMLElement | null;
        const rows = document.querySelector('.library-rows li');
        if (bars) {
          const style = getComputedStyle(bars);
          const opacity = style.visibility === 'hidden' ? 0 : Number(style.opacity);
          log.maxOpacity = Math.max(log.maxOpacity, opacity);
          if (opacity > 0.05) { log.firstPaint ||= now; log.lastPaint = now; }
          if (log.contentAt) log.returned = true;
        }
        if (rows && !log.contentAt) log.contentAt = now;
        if (!log.contentAt || now - log.contentAt < 300) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    for (const delay of [0, 40, 600]) {
      await page.route(LIBRARY, async (route) => {
        await new Promise((done) => setTimeout(done, delay));
        await route.fallback();
      });
      await page.goto('/library');
      await expect(page.locator('.library-rows li').first()).toBeVisible();
      await page.waitForTimeout(400);
      const log = await page.evaluate(() => (window as unknown as { revealLog: { firstPaint: number; lastPaint: number; maxOpacity: number; returned: boolean } }).revealLog);
      results.push({ delay, paintedMs: log.firstPaint ? log.lastPaint - log.firstPaint : 0, maxOpacity: log.maxOpacity, returned: log.returned });
      await page.unroute(LIBRARY);
    }
    console.log(`P0038 ${motion}: ${JSON.stringify(results)}`);
    for (const row of results) expect(row.returned, `${row.delay} ms: placeholder came back after content`).toBe(false);
    // a quick answer (route delay plus server time) stays under the 120 ms reveal delay: nothing painted
    for (const row of results.filter((result) => result.delay <= 40)) {
      expect(row.maxOpacity, `${row.delay} ms painted a placeholder`).toBeLessThanOrEqual(0.05);
    }
    // a genuinely slow answer does show its placeholder
    expect(results.find((row) => row.delay === 600)!.maxOpacity).toBeGreaterThan(0.5);
  });
}
