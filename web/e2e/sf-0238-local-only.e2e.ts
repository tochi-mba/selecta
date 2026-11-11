import { expect, Page, test } from '@playwright/test';
import { PAGES, resetMix } from './helpers';

/** SF-0238-07 and SF-0238-08: with every host but this machine cut off, every page, its fonts, icons
 * and artwork come from the local server alone, and playing, browsing the library and editing the
 * mix all still work. Nothing here needs a cloud. */

test.beforeEach(async ({ request }) => resetMix(request));

/** Cuts the page off from everything except the local Selecta server, and remembers what tried. */
async function cutOffTheInternet(page: Page) {
  const elsewhere: string[] = [];
  const local = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1').host;
  await page.context().route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.host === local) return route.continue();
    elsewhere.push(url.href);
    return route.abort('internetdisconnected');
  });
  return elsewhere;
}

test('SF-0238-07 every page, font, icon and picture comes from this machine', async ({ page }) => {
  const elsewhere = await cutOffTheInternet(page);
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await page.waitForLoadState('networkidle');
  }
  expect(elsewhere).toEqual([]);
  // the fonts the page asked for all loaded, from here
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map((face) => ({ family: face.family, status: face.status }));
  });
  expect(fonts.filter((face) => face.status === 'error')).toEqual([]);
  // nothing the page shows or links as a resource points at another host
  const foreign = await page.evaluate(() => {
    const here = location.host;
    const urls = [
      ...[...document.querySelectorAll('img[src],source[src],link[href],script[src]')]
        .map((node) => (node as HTMLImageElement).src || (node as HTMLLinkElement).href),
      ...performance.getEntriesByType('resource').map((entry) => entry.name),
    ];
    return urls.filter((url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) && u.host !== here; } catch { return false; } });
  });
  expect(foreign).toEqual([]);
});

test('SF-0238-08 playing, the library and editing all work with no internet at all', async ({ page, request }) => {
  const elsewhere = await cutOffTheInternet(page);

  // play
  await page.goto('/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
  await play.click();
  await expect(play).not.toHaveText('Pause');

  // the library lists and searches
  await page.goto('/library');
  const search = page.getByRole('searchbox').first();
  await search.fill('Neon');
  await expect(page.getByText('Neon Rain').first()).toBeVisible();

  // editing: move a song with the keyboard, and the server keeps the new order
  await page.goto('/mix/current/edit');
  const grip = page.getByRole('button', { name: 'Reorder Morning Light' });
  await grip.focus();
  await page.keyboard.press('ArrowDown');
  const order = async () => ((await (await request.get('/api/mix')).json()).mix as { title: string }[]).map((song) => song.title);
  await expect.poll(order).toEqual(['Slow Tide', 'Morning Light', 'Paper Moon', 'Neon Rain']);

  expect(elsewhere).toEqual([]);
});
