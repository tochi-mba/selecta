import { expect, test } from '@playwright/test';

/**
 * UI/UX polish ADR-0040 P0103: the scroll half of "filter, query, scroll and focus survive song
 * details, errors and the way back", which jsdom cannot measure. A long filtered, searched list is
 * scrolled down, a song's details are opened, a refused value is entered, and the sheet is closed with
 * its button and with Escape: the page is still scrolled to the same place, the row is where it was,
 * the opener has the focus and the query and filter are still in the box and the address.
 * The jsdom half (focus, query, filter, failed save): web/src/views/polish-p0103-p0104.test.tsx.
 */

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let template: Record<string, unknown> | null = null;
  await page.route('**/api/library?**', async (route) => {
    const url = new URL(route.request().url());
    if (!template) template = (await (await route.fetch()).json()).songs[0];
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const after = Number(url.searchParams.get('after') ?? 0);
    const total = 300;
    const songs = Array.from({ length: Math.min(limit, total - after) }, (_, index) => ({
      ...template, id: 200_000 + after + index, title: `Night Recording ${after + index + 1}`,
      override_bpm: null, override_camelot: null, detected_bpm: 120, bpm: 120,
    }));
    await route.fulfill({ json: { songs, total, next: after + limit < total ? String(after + limit) : null } });
  });
});

for (const how of ['the close button', 'Escape'] as const) {
  test(`P0103 closing details with ${how} keeps scroll, focus, query and filter`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('/library?q=Night&show=ready');
    const rows = page.locator('.library-rows .song-row');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const opener = page.getByRole('button', { name: /^Details for Night Recording 60\b/ });
    await opener.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 120));
    // Rows skip layout off screen (content-visibility) and stand in at an estimated height until they
    // are drawn. The rows that just came into view take their real height a frame or more later, and
    // scroll anchoring moves the page to keep what's on screen still, so the place is read only once
    // the page and the row have stayed put for several frames (a slow machine takes longer to get there).
    await opener.evaluate((element) => new Promise<void>((settled) => {
      let last = '';
      let still = 0;
      const check = () => {
        const now = `${window.scrollY}:${element.getBoundingClientRect().top}`;
        still = now === last ? still + 1 : 0;
        last = now;
        if (still >= 5) settled();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }));
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(scrolled).toBeGreaterThan(0);
    const rowTop = () => opener.evaluate((element) => element.getBoundingClientRect().top);
    const before = await rowTop();

    await opener.click();
    const details = page.getByRole('dialog').last();
    const tempo = details.getByRole('spinbutton', { name: /^Tempo/ });
    await tempo.fill('400');
    await details.getByRole('button', { name: 'Save correction' }).click();
    await expect(tempo).toHaveAttribute('aria-invalid', 'true');
    if (how === 'Escape') await page.keyboard.press('Escape');
    else await details.getByRole('button', { name: /^Close / }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await expect(opener).toBeFocused();
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrolled), 'the page scrolled away').toBeLessThanOrEqual(1);
    expect(Math.abs((await rowTop()) - before), 'the row moved').toBeLessThanOrEqual(1);
    await expect(page.getByRole('searchbox', { name: 'Search your library' })).toHaveValue('Night');
    await expect(page.getByRole('button', { name: 'Ready', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const address = new URL(page.url()).searchParams;
    expect(address.get('q')).toBe('Night');
    expect(address.get('show')).toBe('ready');
  });
}
