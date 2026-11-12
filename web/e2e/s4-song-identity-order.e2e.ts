import { expect, Page, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * S4-0091-05: a song reads the same way on every page: title, then artist, then its facts and
 * status, then its actions. For every row on each page that names one of the mix's songs, the
 * title comes before the artist in reading (DOM) order, and no action button comes before the
 * title. This is the order a screen reader reads; the owner's NVDA pass confirms it by ear.
 */
const PAGES = [
  { path: '/mix/current/edit', rows: '.timeline > .song' },
  { path: '/library', rows: '.library-rows .song-row' },
  { path: '/listen', rows: '.queue li, .up-next li, .next-up, .listen-queue li' },
] as const;

test.beforeEach(async ({ request, page }) => {
  await resetMix(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

const mixSongs = async (page: Page) =>
  ((await (await page.request.get('/api/mix')).json()).mix as { title: string; artist: string }[])
    .filter((song) => song.title && song.artist && song.title !== song.artist);

for (const where of PAGES) {
  test(`${where.path}: title, then artist, then actions, in every song row`, async ({ page }) => {
    const songs = await mixSongs(page);
    expect(songs.length).toBeGreaterThan(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(where.path);
    await expect(page.locator('main#main:not([aria-busy="true"])').locator('h1, h2').first()).toBeVisible();
    await page.waitForTimeout(200);
    const report = await page.locator(where.rows).evaluateAll((rows, known) => rows.map((row) => {
      const text = (row.textContent ?? '').replace(/\s+/g, ' ');
      const song = known.find((one) => text.includes(one.title) && text.includes(one.artist));
      if (!song) return null;
      const title = text.indexOf(song.title);
      const artist = text.indexOf(song.artist, title + song.title.length);
      // the first action's own words, if it has any, must come after the title
      const firstAction = row.querySelector('button, a[href]:not(.song-name a)');
      const actionText = (firstAction?.textContent ?? '').trim().replace(/\s+/g, ' ');
      const actionAt = actionText && !actionText.includes(song.title) ? text.indexOf(actionText) : Infinity;
      return { song: song.title, titleFirst: artist > title, actionsAfter: actionAt > title };
    }).filter(Boolean), songs);
    // the page shows at least one of the mix's songs, unless it lists none by design
    if (where.path !== '/listen') expect(report.length, `${where.path} shows no mix song`).toBeGreaterThan(0);
    for (const row of report) {
      expect(row!.titleFirst, `${where.path} ${row!.song}: artist before title`).toBe(true);
      expect(row!.actionsAfter, `${where.path} ${row!.song}: an action before the title`).toBe(true);
    }
  });
}

test('the mini-player names the title before the artist', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/listen');
  const play = page.getByRole('button', { name: /^Play/ }).first();
  if (await play.count() === 0) test.skip(true, 'nothing to play in this fixture');
  await play.click();
  await page.goto('/library');
  const mini = page.locator('.mini-song');
  await expect(mini).toBeVisible();
  const order = await mini.evaluate((node) => [...node.children].map((child) => child.tagName.toLowerCase()));
  expect(order.slice(0, 2)).toEqual(['b', 'span']);
});
