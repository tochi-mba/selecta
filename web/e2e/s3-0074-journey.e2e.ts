import { expect, test, type Page } from '@playwright/test';
import { allRendered, audioClock, resetMix, rewriteJson, spyOnAudio } from './helpers';

/**
 * S3-0074-05: one person's whole path in a real browser against the real server, in order: read the
 * folder, play, edit, request a song, open the stems, and save the mix as a FLAC. The songs are
 * synthesized, the audio is muted, and the Studio's stems are served here because the e2e server never
 * splits stems (as mp-0289 does). It proves the steps join up; it says nothing about how anything sounds.
 */

test.beforeEach(async ({ request }) => resetMix(request));

async function withStudio(page: Page) {
  const row = [1, 1, 1, 1, 0, 0, 0, 0];
  const lanes = { vocals: row, drums: row, bass: row, other: row };
  const shape = { a: lanes, b: lanes };
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: 's3-0074-05', cells: 8, seconds: 8, bars: 16, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
}

test('folder to FLAC: scan, play, edit, request, stems and export join up (S3-0074-05)', async ({ page, request }) => {
  test.setTimeout(480_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await spyOnAudio(page);

  // 1. read the folder again, and the Library still holds every song once
  const { folders } = await (await request.get('/api/folders')).json() as { folders: { path: string; songs: number }[] };
  expect(folders.length).toBeGreaterThan(0);
  const before = folders[0].songs;
  expect((await request.post('/api/scan', { data: { folder: folders[0].path } })).ok()).toBe(true);
  await expect.poll(async () => (await (await request.get('/api/folders')).json()).scan?.status, { timeout: 120_000 }).toBe('done');
  const after = (await (await request.get('/api/folders')).json()).folders[0].songs;
  expect(after).toBe(before);
  await page.goto('/library');
  await expect(page.locator('.library-count')).toContainText('songs');

  // 2. play the current mix
  await page.goto('/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
  const clock = (await audioClock(page))[0];
  await expect.poll(async () => (await audioClock(page))[0], { timeout: 20_000 }).toBeGreaterThan(clock);
  await play.click();
  await expect(play).toHaveText('Play');

  // 3. edit: move a song, then undo it
  await page.goto('/mix/current/edit');
  const rows = page.locator('.song .song-name b');
  await expect(rows.first()).toHaveText('Morning Light');
  await page.getByRole('button', { name: 'Move Slow Tide up' }).click();
  await expect(rows.first()).toHaveText('Slow Tide');
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect(rows.first()).toHaveText('Morning Light');

  // 4. request a song, see it held, and cancel it
  const previous = (await (await request.get('/api/requests')).json()).requests as { id: number; title: string }[];
  for (const row of previous.filter((item) => item.title === 'Last Call')) await request.delete(`/api/requests/${row.id}`);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.keyboard.press('r');
  const drawer = page.getByRole('dialog', { name: 'Requests' });
  await drawer.getByRole('combobox', { name: 'Request a song' }).fill('Last Call');
  await drawer.getByRole('button', { name: /Last Call/ }).first().click();
  const yours = drawer.getByRole('list', { name: 'Your requests' });
  await expect(yours.getByText('Last Call')).toBeVisible();
  await yours.getByRole('button', { name: 'Cancel request for Last Call' }).click();
  await expect(yours.getByText('Last Call')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // 5. the stems of the first transition: open the Studio and preview it
  await withStudio(page);
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
  const transport = page.locator('.studio-transport .primary');
  await transport.click();
  await expect(transport).toHaveText(/Stop preview/);
  await transport.click();
  await expect(transport).toHaveText(/Play preview/);
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // 6. save the mix as an audio file, and it is a real FLAC
  await allRendered(request);
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Download audio' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as an audio file' });
  await expect(dialog).toBeVisible();
  const save = dialog.getByRole('button', { name: 'Save it', exact: true });
  if (await save.count()) await save.click();
  const file = dialog.locator('a[href^="/api/exports/"]');
  await expect(file).toBeVisible({ timeout: 170_000 });
  const bytes = await (await request.get((await file.getAttribute('href'))!)).body();
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('fLaC');
});
