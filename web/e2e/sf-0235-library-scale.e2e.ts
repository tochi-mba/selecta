import { expect, test } from '@playwright/test';

/** SF-0235-05: a 20,000-song library. Paging and search stay quick, and the JavaScript heap, measured
 * through the browser's own heap counter, grows only with what is on screen, not with the library. */

const TOTAL = 20_000;

test('SF-0235-05 a 20,000-song library pages and searches quickly, and the heap stays bounded', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let template: Record<string, unknown> | null = null;
  const asked: number[] = [];
  await page.route('**/api/library?**', async (route) => {
    const url = new URL(route.request().url());
    if (!template) template = (await (await route.fetch()).json()).songs[0];
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const after = Number(url.searchParams.get('after') ?? 0);
    const q = url.searchParams.get('q') ?? '';
    const total = q ? 1200 : TOTAL;
    asked.push(limit);
    const songs = Array.from({ length: Math.max(0, Math.min(limit, total - after)) }, (_, index) => ({
      ...template, id: 100_000 + after + index, title: `${q ? `${q} ` : ''}Scale Recording ${after + index + 1}`, artist: `Artist ${(after + index) % 300}`,
    }));
    await route.fulfill({ json: { songs, total, next: after + limit < total ? String(after + limit) : null } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/library');
  await expect(page.locator('.library-count')).toHaveText(`Showing 100 of ${TOTAL} songs.`, { timeout: 30_000 });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return (await cdp.send('Runtime.getHeapUsage')).usedSize / 1_048_576;
  };
  const start = await heap();

  // the library is never asked for all at once: every request is one page
  expect(Math.max(...asked)).toBeLessThanOrEqual(100);
  const more = page.getByRole('button', { name: 'Show more songs' });
  for (let round = 0; round < 5; round += 1) {
    const started = Date.now();
    await more.click();
    await expect(page.locator('.library-rows .song-row')).toHaveCount(200 + round * 100);
    expect(Date.now() - started, 'a page took too long to show').toBeLessThan(3000);
  }
  const paged = await heap();

  const search = page.getByRole('searchbox', { name: 'Search your library' }).or(page.getByRole('textbox', { name: 'Search your library' })).first();
  const started = Date.now();
  await search.fill('Night');
  await expect(page.locator('.library-count')).toHaveText('Showing 100 of 1200 songs.');
  expect(Date.now() - started, 'search took too long').toBeLessThan(3000);
  await search.fill('');
  await expect(page.locator('.library-count')).toHaveText(`Showing 100 of ${TOTAL} songs.`);
  const settled = await heap();

  test.info().annotations.push({ type: 'heap MB', description: `start ${start.toFixed(1)}, after 600 rows ${paged.toFixed(1)}, after search and clear ${settled.toFixed(1)}` });
  // 500 more rows on screen cost a few MB at most; nothing near the size of 20,000 songs
  expect(paged - start, 'paging grew the heap too much').toBeLessThan(40);
  // clearing a search back to one page lets go of what the longer list held
  expect(settled - start, 'the heap kept what was no longer shown').toBeLessThan(20);
  expect(Math.max(...asked)).toBeLessThanOrEqual(100);
});
