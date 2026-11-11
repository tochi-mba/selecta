import { expect, test, type Page } from '@playwright/test';
import { resetMix, rewriteJson, spyOnAudio } from './helpers';

/**
 * SF-0233-04: at 320px the eight lanes of an 8-cell Studio (64 squares) take a tap on a touch screen
 * and the keyboard. SF-0235-07: a 64-cell Studio (eight lanes of 64) paints a whole lane by dragging
 * without long tasks, while its preview keeps the one audio focus. As mp-0289-stem-studio.e2e.ts does,
 * the Studio session and its stems are served from a synthetic song; nothing here says how it sounds.
 */
type Lanes = { vocals: number[]; drums: number[]; bass: number[]; other: number[] };
const off = (cells: number) => Array.from({ length: cells }, () => 0);

async function withStudio(page: Page, cells: number) {
  const lanes: Lanes = { vocals: off(cells), drums: off(cells), bass: off(cells), other: off(cells) };
  const shape = { a: lanes, b: lanes };
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: `sf-${cells}`, cells, seconds: 8, bars: cells * 2, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
}

async function openStudio(page: Page) {
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
  const grid = page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' });
  if (await grid.count()) await grid.click();
}

test.beforeEach(async ({ request }) => resetMix(request, [1, 2, 3]));

test.describe('touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 320, height: 640 } });

  test('SF-0233-04 at 320px every one of the 64 squares can be tapped, and the keyboard reaches the far end', async ({ page }) => {
    await withStudio(page, 8);
    await openStudio(page);
    const squares = page.locator('.studio-cell');
    expect(await squares.count()).toBe(64);
    // the page itself never scrolls sideways; the grid scrolls inside itself
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // a tap on the first and last square of every lane turns it on
    for (const index of [0, 7, 56, 63]) {
      const square = squares.nth(index);
      await square.scrollIntoViewIfNeeded();
      await expect(square).toHaveAttribute('aria-pressed', 'false');
      await square.tap();
      await expect(square).toHaveAttribute('aria-pressed', 'true');
    }
    // the keyboard goes the whole way along a lane and toggles there too
    await squares.nth(8).focus();
    for (let move = 0; move < 7; move += 1) await page.keyboard.press('ArrowRight');
    const end = squares.nth(15);
    await expect(end).toBeFocused();
    await expect(end).toBeInViewport();
    await page.keyboard.press('Space');
    await expect(end).toHaveAttribute('aria-pressed', 'true');
    for (let move = 0; move < 7; move += 1) await page.keyboard.press('ArrowDown');
    await expect(squares.nth(63)).toBeFocused();
  });
});

test('SF-0235-07 a 64-cell Studio paints a whole lane by dragging with no long task, and the preview keeps the audio focus', async ({ page }) => {
  await spyOnAudio(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await withStudio(page, 64);
  await openStudio(page);
  const squares = page.locator('.studio-lane:not(.studio-ruler)').first().locator('.studio-cell');
  await expect(squares).toHaveCount(64);
  expect(await page.locator('.studio-cell').count()).toBe(512);

  const transport = page.locator('.studio-transport .primary');
  await transport.click();
  await expect(transport).toHaveText(/Stop preview/);
  const contexts = await page.evaluate(() => window.audioSpy.contexts.length);

  await page.evaluate(() => {
    (window as unknown as { longTasks: number[] }).longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) (window as unknown as { longTasks: number[] }).longTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: false });
  });
  const centre = async (index: number) => {
    const box = (await squares.nth(index).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  await squares.first().scrollIntoViewIfNeeded();
  const first = await centre(0);
  const last = await centre(63);
  const started = Date.now();
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let step = 1; step <= 63; step += 1) await page.mouse.move(first.x + ((last.x - first.x) * step) / 63, first.y);
  await page.mouse.up();
  const took = Date.now() - started;

  await expect(squares.locator('xpath=self::*[@aria-pressed="true"]')).toHaveCount(64);
  const longTasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
  expect(longTasks.filter((duration) => duration > 200), 'a paint step blocked the page').toEqual([]);
  expect(took, 'painting 64 squares took too long').toBeLessThan(8000);
  // still one preview, still playing, no second audio context opened
  await expect(transport).toHaveText(/Stop preview/);
  expect(await page.evaluate(() => window.audioSpy.contexts.length)).toBe(contexts);
  await transport.click();
  await expect(transport).toHaveText(/Play preview/);
});
