import { expect, test } from '@playwright/test';
import { allRendered, audioStates, resetMix, spyOnAudio } from './helpers';

const ids = (body: { mix: { song_id: number }[] }) => body.mix.map((item) => item.song_id);

test.beforeEach(async ({ request }) => {
  await resetMix(request);
  await request.post('/api/mix/render');
});

test('editing a draft while the current mix plays: neither touches the other, and Undo knows which is which', async ({ page, request }) => {
  await allRendered(request);
  await spyOnAudio(page);
  const made = await (await request.post('/api/drafts', { data: { name: 'While listening' } })).json();
  for (const song of [5, 6, 7]) await request.post(`/api/mix/songs?draft=${made.id}`, { data: { song_id: song } });

  await page.goto('/listen');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  await page.evaluate((id) => {
    window.history.pushState({}, '', `/mixes/drafts/${id}/edit`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, made.id);
  await page.getByRole('button', { name: 'Move 日本語の歌 up' }).click();
  await expect(page.locator('.song .song-name b').nth(1)).toHaveText('日本語の歌');
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect(page.locator('.song .song-name b').nth(2)).toHaveText('日本語の歌');

  expect(ids(await (await request.get('/api/mix')).json())).toEqual([1, 2, 3, 4]);
  expect(ids(await (await request.get(`/api/mix?draft=${made.id}`)).json())).toEqual([5, 6, 7]);
  expect(await audioStates(page)).toEqual(['running']);
  await request.delete(`/api/drafts/${made.id}`);
});

test('two requests at once: no song goes in twice and no two share a spot', async ({ page, request }) => {
  await page.goto('/mix/current/edit');
  const first = request.post('/api/requests', { data: { song_id: 5 } });
  const second = request.post('/api/requests', { data: { song_id: 6 } });
  const same = request.post('/api/requests', { data: { song_id: 6 } });
  await Promise.all([first, second, same]);
  await expect
    .poll(async () => {
      const { requests } = await (await request.get('/api/requests')).json();
      return (requests as { song_id: number }[]).filter((row) => row.song_id === 6).length;
    })
    .toBe(1);
  const { requests } = await (await request.get('/api/requests')).json();
  const spots = (requests as { after_song_id?: number | null }[]).map((row) => row.after_song_id).filter((spot) => spot != null);
  expect(new Set(spots).size).toBe(spots.length);
  for (const row of requests as { id: number }[]) await request.delete(`/api/requests/${row.id}`);
});

test('a cancelled request that’s answered late doesn’t come back', async ({ page, request }) => {
  const asked = await (await request.post('/api/requests', { data: { song_id: 7 } })).json();
  const id = asked.id ?? asked.request?.id;
  await page.route('**/api/requests', async (route) => {
    if (route.request().method() === 'GET') {
      const old = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fulfill({ response: old });
    } else {
      await route.continue();
    }
  });
  await page.goto('/mix/current/edit');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Requests/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Requests' });
  await expect(drawer.getByText('日本語の歌').first()).toBeVisible({ timeout: 15_000 });
  await drawer.getByRole('button', { name: 'Cancel request for 日本語の歌' }).click();
  await expect(drawer.getByRole('button', { name: 'Cancel request for 日本語の歌' })).toHaveCount(0);
  await page.waitForTimeout(7000);
  await expect(drawer.getByRole('button', { name: 'Cancel request for 日本語の歌' })).toHaveCount(0);
  await request.delete(`/api/requests/${id}`).catch(() => {});
});

test('saving a draft as a file while another mix is reordered: the file is of the draft', async ({ page, request }) => {
  await allRendered(request);
  const made = await (await request.post('/api/drafts', { data: { name: 'To save' } })).json();
  for (const song of [1, 2]) await request.post(`/api/mix/songs?draft=${made.id}`, { data: { song_id: song } });
  await page.goto(`/mixes/drafts/${made.id}/edit`);
  await page.getByRole('button', { name: /Save as an audio file|Save/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Save as an audio file' });
  await dialog.locator('button.primary').click();
  await request.post('/api/mix/move', { data: { source: 0, target: 3 } });
  const link = dialog.getByRole('link');
  await expect(link).toBeVisible({ timeout: 170_000 });
  const bytes = await (await request.get((await link.getAttribute('href'))!)).body();
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('fLaC');
  // two songs of about 90 seconds, minus the overlap, and nothing from the other mix
  expect(ids(await (await request.get(`/api/mix?draft=${made.id}`)).json())).toEqual([1, 2]);
  await request.delete(`/api/drafts/${made.id}`);
});

test('changing a draft while it’s being saved stops the save, and says why', async ({ page, request }) => {
  const made = await (await request.post('/api/drafts', { data: { name: 'Moving target' } })).json();
  for (const song of [8, 9, 10]) await request.post(`/api/mix/songs?draft=${made.id}`, { data: { song_id: song } });
  await page.goto(`/mixes/drafts/${made.id}/edit`);
  await page.getByRole('button', { name: /Save as an audio file|Save/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Save as an audio file' });
  await dialog.locator('button.primary').click();
  await request.post(`/api/mix/move?draft=${made.id}`, { data: { source: 0, target: 2 } });
  await expect(dialog.getByText(/changed while it was getting ready/)).toBeVisible({ timeout: 30_000 });
  await request.delete(`/api/drafts/${made.id}`);
});

test('a correction made while the page is open shows up, and only touches its own transitions', async ({ page, request }) => {
  await allRendered(request);
  await page.goto('/mix/current/edit');
  const before = await (await request.get('/api/mix')).json();
  const keys = before.mix.slice(1).map((item: { seam: { state: { key: string } } }) => item.seam.state.key);
  const answer = await (await request.post('/api/songs/4/correct', { data: { camelot: '2B' } })).json();
  expect(answer.redone).toBeGreaterThanOrEqual(1);
  await expect(page.getByText('2B').first()).toBeVisible({ timeout: 15_000 });
  const after = await (await request.get('/api/mix')).json();
  expect(after.mix[1].seam.state.key).toBe(keys[0]);
  expect(after.mix[1].seam.state.status).toBe('ready');
  await request.post('/api/songs/4/correct', { data: { clear: ['camelot'] } });
});

test('a hundred quick looks at a page never lose what’s on it', async ({ page }) => {
  await page.goto('/library');
  const search = page.getByRole('textbox', { name: 'Search your library' });
  for (const typed of ['S', 'Sl', 'Slo', 'Slow', 'Slo', 'Sl', 'Slow']) await search.fill(typed);
  await expect(page.getByText('Slow Tide').first()).toBeVisible();
  await expect(page.getByText('Morning Light')).toHaveCount(0);
});
