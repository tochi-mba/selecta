import { expect, test, type Page } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * EX-0131-03: an old or failed answer never overwrites the current revision of the mix. Three ways it
 * could happen in a real browser: two tabs editing the same mix, a slow look at the mix that comes back
 * after a newer edit, and a slow network under every request. The server is the e2e fixture server; the
 * `x-mix-order` guard in `src/selecta/api.py` and the edit counter in `web/src/App.tsx` are what is tested.
 */
const editorSong = (page: Page, title: string) => page.locator('.song .song-name button').filter({ hasText: title });
const firstRow = (page: Page) => page.locator('.song .song-name b').first();
const serverOrder = async (page: Page) => ((await (await page.request.get('/api/mix')).json()).mix as { song_id: number }[]).map((item) => item.song_id);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function removeSong(page: Page, title: string) {
  await page.getByRole('button', { name: `More for ${title}` }).click();
  await page.getByRole('menuitem', { name: `Remove ${title}` }).click();
}

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request);
});

test('EX-0131-03 two tabs: an edit from a tab that has not seen the other tab’s change stops and touches nothing', async ({ page }) => {
  const other = await page.context().newPage();
  for (const tab of [page, other]) {
    await tab.goto('/mix/current/edit');
    await expect(editorSong(tab, 'Paper Moon')).toBeVisible();
  }
  // this tab cannot catch up while the other one edits, as if its looks were slow
  let stale = true;
  await page.route('**/api/mix', async (route) => {
    while (stale && route.request().method() === 'GET') await pause(100);
    await route.continue();
  });
  await removeSong(other, 'Slow Tide');
  await expect(editorSong(other, 'Slow Tide')).toHaveCount(0);
  expect(await serverOrder(page)).toEqual([1, 3, 4]);

  await removeSong(page, 'Paper Moon');
  await expect(page.getByText('This mix has just changed, so nothing was done.').first()).toBeVisible();
  // the other tab's change stands and the stale one did nothing
  expect(await serverOrder(page)).toEqual([1, 3, 4]);

  // once it can look again, the stale tab shows the mix as it really is
  stale = false;
  await expect(editorSong(page, 'Slow Tide')).toHaveCount(0, { timeout: 10_000 });
  await expect(editorSong(page, 'Paper Moon')).toBeVisible();
  await expect(editorSong(other, 'Paper Moon')).toBeVisible();
  await other.close();
});

test('EX-0131-03 race: a look at the mix that started before an edit cannot undo it on screen', async ({ page }) => {
  await page.goto('/mix/current/edit');
  await expect(firstRow(page)).toHaveText('Morning Light');
  // the next look at the mix reads the mix now, then is held back until after the edit has landed
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => { release = resolve; });
  let held: Promise<void> | null = null;
  let sawOld: (value: void) => void = () => {};
  const old = new Promise<void>((resolve) => { sawOld = resolve; });
  await page.route('**/api/mix', async (route) => {
    if (route.request().method() !== 'GET' || held) return route.continue();
    held = (async () => {
      const response = await route.fetch();
      sawOld();
      await released;
      await route.fulfill({ response });
    })();
    await held;
  });
  // Route changes cause the app to check the current mix. Trigger this check
  // explicitly rather than waiting for a poll that only runs while seams are busy.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Library', exact: true }).click();
  await nav.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(firstRow(page)).toHaveText('Morning Light');
  await old;
  await page.getByRole('button', { name: 'Move Slow Tide up' }).click();
  await expect(firstRow(page)).toHaveText('Slow Tide');
  expect(await serverOrder(page)).toEqual([2, 1, 3, 4]);
  release();
  await held;
  // the old answer arrived last, and the screen still shows the newer edit
  await pause(500);
  await expect(firstRow(page)).toHaveText('Slow Tide');
  await page.unroute('**/api/mix');
  await pause(2000);
  await expect(firstRow(page)).toHaveText('Slow Tide');
});

test('EX-0131-03 slow network: every answer late, the edit and its undo never flicker back to an older order', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    await pause(1200);
    await route.continue().catch(() => {});
  });
  await page.goto('/mix/current/edit');
  await expect(firstRow(page)).toHaveText('Morning Light', { timeout: 20_000 });
  // write down what the first row says every 50 ms, with the time
  await page.evaluate(() => {
    const seen: [number, string][] = [];
    (window as unknown as { firstRows: [number, string][] }).firstRows = seen;
    window.setInterval(() => {
      const text = document.querySelector('.song .song-name b')?.textContent ?? '';
      if (seen.at(-1)?.[1] !== text) seen.push([performance.now(), text]);
    }, 50);
  });
  await page.getByRole('button', { name: 'Move Slow Tide up' }).click();
  await expect(firstRow(page)).toHaveText('Slow Tide', { timeout: 20_000 });
  // let several slow looks at the mix come and go
  await pause(5000);
  const undoAt = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect(firstRow(page)).toHaveText('Morning Light', { timeout: 20_000 });
  await pause(5000);
  const rows = await page.evaluate(() => (window as unknown as { firstRows: [number, string][] }).firstRows);
  const beforeUndo = rows.filter(([at]) => at < undoAt).map(([, text]) => text);
  const afterUndo = rows.filter(([at]) => at >= undoAt).map(([, text]) => text);
  // once the edit showed, nothing older came back before Undo, and once Undo showed, the edit stayed gone
  expect(beforeUndo.slice(beforeUndo.indexOf('Slow Tide'))).toEqual(['Slow Tide']);
  expect(afterUndo.slice(afterUndo.indexOf('Morning Light'))).toEqual(['Morning Light']);
  await page.unroute('**/api/**');
  expect(await serverOrder(page)).toEqual([1, 2, 3, 4]);
});
