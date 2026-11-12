import { expect, test } from '@playwright/test';

/**
 * Flow SF-0201-08, found in the 2026-11-12 all-screen review: on the first-run page at 1440px the full-width
 * folder field squeezed Start until it read "Star" with the "t" below the button. Start keeps its word on
 * one line, inside the button, at phone, tablet and desktop widths.
 */
for (const width of [320, 768, 1440, 1920]) {
  test(`SF-0201-08 first run: Start stays whole beside the folder field at ${width}px`, async ({ page, request }) => {
    const status = await (await request.get('/api/status')).json();
    const empty = { ...status, counts: { ...status.counts, total: 0, music: 0, analysed: 0, ready: 0 }, scan: { status: 'idle' } };
    await page.route('**/api/status', (route) => route.fulfill({ json: empty }));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const start = page.getByRole('button', { name: 'Start', exact: true });
    await expect(start).toBeVisible();
    const fit = await start.evaluate((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      return { lines: range.getClientRects().length, over: button.scrollWidth - button.clientWidth, height: button.getBoundingClientRect().height };
    });
    expect(fit.lines, `${width}px: Start breaks across lines`).toBe(1);
    expect(fit.over, `${width}px: Start spills out of its button`).toBeLessThanOrEqual(0);
    expect(fit.height).toBeGreaterThanOrEqual(44);
  });
}
