import { expect, test, type Page } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * GP-0260-04: Discovery keeps what you were looking at. A word search lives in the address, so typing,
 * reload, adding a pair (which may open Edit) and Back all return to the same search and the same card;
 * the chord-match tab comes back on Back with the same unanswered pair. Fixtures stand in for the lyric
 * and chord searches; the pair is really added to the synthetic library's current mix.
 */
const ready = { status: 'ready', key: 'gp260-back', label: 'Word blend', style: 'word_blend', passed: true };
const link = { phrase: 'all night', kind: 'end-start', a: 1, b: 2, artist_a: 'Ada Reyes', title_a: 'Morning Light', artist_b: 'Bo Lindqvist', title_b: 'Slow Tide', line_a: 'we danced all night', line_b: 'all night we sang', moves: ['word_blend', 'word_cut'], move: 'word_blend', state: ready, worked: true };
const pair = { id: 7, song_a: 3, song_b: 4, title_a: 'Paper Moon', title_b: 'Glass Harbour', artist_a: 'Ada Reyes', artist_b: 'Bo Lindqvist', status: 'new', payload: { a_at: 10, b_at: 20, bars: 4, transpose: 0 } };

async function fixtures(page: Page, asked: string[]) {
  await page.route('**/api/links?**', (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    return route.fulfill({ json: { links: [link], prepared: 1, preparing: 1 } });
  });
  await page.route('**/api/discoveries', (route) => route.fulfill({ json: [pair, { ...pair, id: 8, song_a: 5, song_b: 6, title_a: 'Later One', title_b: 'Later Two' }] }));
}

const search = (page: Page) => page.getByRole('textbox', { name: 'Search shared words' });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('GP-0260-04 a word search survives typing, reload, adding a pair and Back', async ({ page, request }) => {
  await resetMix(request, [3, 4]);
  const asked: string[] = [];
  await fixtures(page, asked);
  await page.goto('/discover');
  await search(page).fill('night');
  await expect(page).toHaveURL(/\/discover\?q=night$/);
  await page.reload();
  await expect(search(page)).toHaveValue('night');
  await expect.poll(() => asked.at(-1)).toBe('night');

  const card = page.locator('.link-card').first();
  await expect(card.locator('.phrase')).toContainText('all night');
  const add = card.getByRole('button', { name: /^Add both to/ });
  await add.click();
  if (await page.getByRole('menuitem', { name: 'Your current mix' }).isVisible()) {
    await page.getByRole('menuitem', { name: 'Your current mix' }).click();
  }
  await expect.poll(async () => (await (await request.get('/api/mix')).json()).mix.map((item: { song_id: number }) => item.song_id)).toEqual([3, 4, 1, 2]);

  // with the editor on, adding to the current mix opens Edit; Back must land on the same search
  if (!new URL(page.url()).pathname.startsWith('/discover')) {
    await page.goBack();
  }
  await expect(page).toHaveURL(/\/discover\?q=night$/);
  await expect(search(page)).toHaveValue('night');
  await expect(page.locator('.link-card').first().locator('.phrase')).toContainText('all night');
  await expect.poll(() => asked.at(-1)).toBe('night');
  // nothing was added twice by coming back
  const { mix } = await (await request.get('/api/mix')).json();
  expect(mix.map((item: { song_id: number }) => item.song_id)).toEqual([3, 4, 1, 2]);
});

test('GP-0260-04 Back and Forward between searches keep the field and the results in step', async ({ page }) => {
  const asked: string[] = [];
  await fixtures(page, asked);
  await page.goto('/discover?q=night');
  await expect(search(page)).toHaveValue('night');
  await page.goto('/discover?q=love');
  await expect(search(page)).toHaveValue('love');
  await page.goBack();
  await expect(page).toHaveURL(/\/discover\?q=night$/);
  await expect(search(page)).toHaveValue('night');
  await expect.poll(() => asked.at(-1)).toBe('night');
  await page.goForward();
  await expect(search(page)).toHaveValue('love');
  await expect.poll(() => asked.at(-1)).toBe('love');
});

test('GP-0260-04 the chord-match tab and its unanswered pair come back on Back', async ({ page }) => {
  await fixtures(page, []);
  await page.goto('/discover/harmonic');
  await expect(page.locator('.discovery')).toHaveAttribute('data-pair', '3>4');
  await page.goto('/library');
  await page.goBack();
  await expect(page).toHaveURL(/\/discover\/harmonic$/);
  await expect(page.getByRole('link', { name: 'Harmonic matches' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.discovery')).toHaveAttribute('data-pair', '3>4');
  await expect(page.locator('.discovery h3')).toHaveText('Paper Moon and Glass Harbour');
});
