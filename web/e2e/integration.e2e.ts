import { expect, test, type APIRequestContext, type Route } from '@playwright/test';
import { failNetwork, fixClock } from './harness';
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
      // an answer read now and delivered late, as a slow check would be
      const fresh = await route.fetch();
      const body = await fresh.text();
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fulfill({ status: fresh.status(), contentType: 'application/json', body }).catch(() => {});
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
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await request.delete(`/api/requests/${id}`).catch(() => {});
});

test('saving a draft as a file while another mix is reordered: the file is of the draft', async ({ page, request }) => {
  await allRendered(request);
  const made = await (await request.post('/api/drafts', { data: { name: 'To save' } })).json();
  for (const song of [1, 2]) await request.post(`/api/mix/songs?draft=${made.id}`, { data: { song_id: song } });
  await page.goto(`/mixes/drafts/${made.id}/edit`);
  await page.getByRole('button', { name: 'Download audio' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as an audio file' });
  const save = dialog.getByRole('button', { name: 'Save it', exact: true });
  if (await save.count()) await save.click();
  await request.post('/api/mix/move', { data: { source: 0, target: 3 } });
  // The dialog also links to Workspace; only an /api/exports/ link is the actual FLAC.
  const link = dialog.locator('a[href^="/api/exports/"]');
  await expect(link).toBeVisible({ timeout: 170_000 });
  const bytes = await (await request.get((await link.getAttribute('href'))!)).body();
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('fLaC');
  // two songs of about 90 seconds, minus the overlap, and nothing from the other mix
  expect(ids(await (await request.get(`/api/mix?draft=${made.id}`)).json())).toEqual([1, 2]);
  await request.delete(`/api/drafts/${made.id}`);
});

test('editing a draft during export keeps the job pinned to its original revision', async ({ page, request }) => {
  const made = await (await request.post('/api/drafts', { data: { name: 'Moving target' } })).json();
  for (const song of [8, 9, 10]) await request.post(`/api/mix/songs?draft=${made.id}`, { data: { song_id: song } });
  await page.goto(`/mixes/drafts/${made.id}/edit`);
  await page.getByRole('button', { name: 'Download audio' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as an audio file' });
  const save = dialog.getByRole('button', { name: 'Save it', exact: true });
  if (await save.count()) await save.click();

  // UI requests can be asynchronous. Wait for the server to persist the exact snapshot.
  await expect.poll(async () => {
    const data = await (await request.get('/api/exports/jobs')).json();
    return data.jobs.some((job: { draft: number; scope: string }) => job.scope === 'draft' && job.draft === made.id);
  }, { timeout: 20_000 }).toBe(true);
  const before = await (await request.get('/api/exports/jobs')).json();
  const job = before.jobs.find((entry: { draft: number; scope: string }) =>
    entry.scope === 'draft' && entry.draft === made.id,
  );
  expect(job.songs.map((song: { song_id: number }) => song.song_id)).toEqual([8, 9, 10]);
  const keys = job.seams.map((seam: { key: string }) => seam.key);

  // Reordering the source draft cannot alter the already accepted export request.
  const changed = await request.post(`/api/mix/move?draft=${made.id}`, { data: { source: 0, target: 2 } });
  expect(changed.ok()).toBe(true);
  expect(ids(await (await request.get(`/api/mix?draft=${made.id}`)).json())).toEqual([9, 10, 8]);
  const retained = await (await request.get(`/api/exports/jobs/${job.id}`)).json();
  expect(retained.songs.map((song: { song_id: number }) => song.song_id)).toEqual([8, 9, 10]);
  expect(retained.seams.map((seam: { key: string }) => seam.key)).toEqual(keys);
  expect(retained.state).not.toBe('cancelled');
  expect(retained.error ?? '').not.toMatch(/changed|revision/i);
  if (retained.can_cancel) await request.delete(`/api/exports/jobs/${job.id}`);
  await request.delete(`/api/drafts/${made.id}`);
});

test('a correction made while the page is open shows up, and only touches its own transitions', async ({ page, request }) => {
  await allRendered(request);
  await page.goto('/mix/current/edit');
  const before = await (await request.get('/api/mix')).json();
  const keys = before.mix.slice(1).map((item: { seam: { state: { key: string } } }) => item.seam.state.key);
  const answer = await (await request.post('/api/songs/4/correct', { data: { camelot: '2B' } })).json();
  expect(answer.redone).toBeGreaterThanOrEqual(1);
  // coming back to the page shows it, as it would after correcting a song in the Library
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Library', exact: true }).click();
  await nav.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page.getByText('2B').first()).toBeVisible({ timeout: 15_000 });
  const after = await (await request.get('/api/mix')).json();
  expect(after.mix[1].seam.state.key).toBe(keys[0]);
  expect(after.mix[1].seam.state.status).toBe('ready');
  await request.post('/api/songs/4/correct', { data: { clear: ['camelot'] } });
});

test('a hundred quick looks at a page never lose what’s on it', async ({ page }) => {
  await page.goto('/library');
  const search = page.getByRole('searchbox', { name: 'Search your library' });
  for (const typed of ['S', 'Sl', 'Slo', 'Slow', 'Slo', 'Sl', 'Slow']) await search.fill(typed);
  await expect(page.getByText('Slow Tide').first()).toBeVisible();
  await expect(page.getByText('Morning Light')).toHaveCount(0);
});

/**
 * P0138 (Polish): the integrated failure and recovery set, run together against the same server. Each
 * scenario breaks one thing the way the real world does (via ./harness or a held or rewritten answer),
 * checks the page says what happened and offers the way back, recovers, and checks that the current
 * mix on the server was never touched by the failure.
 */
test.describe('P0138 integrated failure and recovery', () => {
  const currentMix = async (request: APIRequestContext) => ids(await (await request.get('/api/mix')).json());
  const draftName = async (request: APIRequestContext, id: number) => ((await (await request.get('/api/drafts')).json()).drafts as { id: number; name: string }[])
    .find((item) => item.id === id)?.name;

  test('P0138-01 disconnect and reconnect: the page says so, keeps the mix, and recovers by itself', async ({ page, request }) => {
    await fixClock(page);
    await page.goto('/mix/current/edit');
    await expect(page.locator('.song .song-name b').first()).toHaveText('Morning Light');
    const restore = await failNetwork(page, 'offline');
    await expect(async () => {
      await page.clock.runFor(5_000);
      await expect(page.getByText('Can’t reach SelectaDJ.').first()).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 30_000 });
    // what was loaded stays on screen while the server is away
    await expect(page.locator('.song .song-name b')).toHaveCount(4);
    await restore();
    await expect(async () => {
      await page.clock.runFor(5_000);
      await expect(page.getByText('Can’t reach SelectaDJ.')).toHaveCount(0, { timeout: 500 });
    }).toPass({ timeout: 30_000 });
    await expect(page.locator('.song .song-name b').first()).toHaveText('Morning Light');
    expect(await currentMix(request)).toEqual([1, 2, 3, 4]);
  });

  test('P0138-02 a stale search answer that arrives late never replaces the newer one', async ({ page, request }) => {
    const held: Route[] = [];
    await page.route(/\/api\/library\?.*q=Paper/, (route) => void held.push(route));
    await page.goto('/library');
    await expect(page.locator('.library-rows li').first()).toBeVisible();
    const search = page.getByRole('searchbox', { name: 'Search your library' });
    await search.fill('Paper');
    await expect.poll(() => held.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await search.fill('Slow');
    await expect(page.getByRole('button', { name: /^Details for Slow Tide/ })).toBeVisible();
    // the older answer now lands, after the newer one
    for (const route of held.splice(0)) await route.fallback();
    await page.waitForTimeout(1_000);
    await expect(page.getByRole('button', { name: /^Details for Slow Tide/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Details for Paper Moon/ })).toHaveCount(0);
    await expect(search).toHaveValue('Slow');
    expect(await currentMix(request)).toEqual([1, 2, 3, 4]);
  });

  test('P0138-03 a failed render says why and Try again asks for it again', async ({ page, request }) => {
    let failed = true;
    const retries: string[] = [];
    await page.route(/\/api\/mix(\?.*)?$/, async (route) => {
      if (!failed || route.request().method() !== 'GET' || route.request().url().includes('draft=')) return route.fallback();
      const answer = await route.fetch();
      const body = await answer.json();
      body.mix[1].seam.state = { ...body.mix[1].seam.state, status: 'failed', error: 'The render ran out of room.' };
      return route.fulfill({ response: answer, json: body });
    });
    await page.route(/\/api\/mix\/\d+\/render/, (route) => {
      retries.push(route.request().url());
      failed = false;
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto('/mix/current/edit');
    const seam = page.locator('li.seam').filter({ hasText: 'Remembered failed attempt' });
    await expect(seam).toContainText('Remembered failed attempt: The render ran out of room.');
    await seam.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => retries.length).toBe(1);
    expect(retries[0]).toContain('retry=true');
    await expect(page.getByText('Remembered failed attempt')).toHaveCount(0);
    expect(await currentMix(request)).toEqual([1, 2, 3, 4]);
  });

  test('P0138-04 a failed save keeps what was typed, says why, and saves on the next try', async ({ page, request }) => {
    const made = await (await request.post('/api/drafts', { data: { name: 'Keep me' } })).json();
    try {
      let failing = true;
      await page.route('**/api/drafts/*/name', (route) => (failing
        ? route.fulfill({ status: 507, json: { detail: 'There isn’t enough free space to save that.', code: 'storage_full' } })
        : route.fallback()));
      await page.goto('/mixes/mine');
      await page.getByRole('button', { name: `More actions for ${made.name}` }).click();
      await page.getByRole('menuitem', { name: `Rename ${made.name}` }).click();
      const field = page.getByRole('textbox', { name: 'Name this draft' });
      await field.fill('Renamed after a full disk');
      await page.getByRole('button', { name: 'Save name' }).click();
      await expect(page.locator('.rename-draft [role="alert"]')).toHaveText('There isn’t enough free space to save that.');
      await expect(field).toHaveValue('Renamed after a full disk');
      expect(await draftName(request, made.id)).toBe(made.name);
      failing = false;
      await page.getByRole('button', { name: 'Save name' }).click();
      await expect(field).toHaveCount(0);
      await expect(page.locator('.draft-list .draft').filter({ hasText: 'Renamed after a full disk' })).toHaveCount(1);
      expect(await draftName(request, made.id)).toBe('Renamed after a full disk');
      expect(await currentMix(request)).toEqual([1, 2, 3, 4]);
    } finally {
      await request.delete(`/api/drafts/${made.id}`);
    }
  });

  test('P0138-05 a missing source says so, and plays again once it is back', async ({ page, request }) => {
    await spyOnAudio(page);
    await page.route('**/api/songs/*/audio', (route) => route.fulfill({ status: 404, body: '{}' }));
    await page.goto('/listen');
    await page.getByRole('button', { name: /^(Play|Resume)/ }).click();
    await expect(page.getByText('That song isn’t available.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Play|Resume)/ })).toBeVisible();
    await page.unroute('**/api/songs/*/audio');
    await page.getByRole('button', { name: /^(Play|Resume)/ }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    expect(await currentMix(request)).toEqual([1, 2, 3, 4]);
  });

  test('P0138-06 export recovery: a lost job list and a failed export each lead back to a new export', async ({ page, request }) => {
    const failedJob = {
      id: 'p0138-failed', state: 'failed', scope: 'current', draft: null, mix_name: 'Current mix',
      revision: 'p0138', songs: [{ song_id: 1, title: 'Morning Light', artist: 'Ada Reyes' }], seams: [],
      seams_total: 3, seams_ready: 1, seconds_estimate: 600, name: 'p0138.flac', seconds: null,
      error: 'The export stopped: the disk filled up.', created_at: 1_767_607_200, can_cancel: false, quiet_seconds: 0,
    };
    let jobs: 'down' | 'failed' = 'down';
    await page.route('**/api/exports/jobs', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return jobs === 'down'
        ? route.fulfill({ status: 500, json: { detail: 'Internal Server Error' } })
        : route.fulfill({ json: { jobs: [failedJob] } });
    });
    await page.goto('/workshop');
    const lost = page.locator('section.panel').filter({ hasText: 'Couldn’t check on your exports.' });
    await expect(lost).toBeVisible();
    jobs = 'failed';
    await lost.getByRole('button', { name: 'Try again' }).click();
    const row = page.locator('.exports-list .export-job[data-state="failed"]');
    await expect(row).toContainText('Didn’t work');
    await expect(row).toContainText('The export stopped: the disk filled up.');
    await row.getByRole('link', { name: 'Open this mix to export it again' }).click();
    await expect(page).toHaveURL(/\/mix\/current\/edit$/);
    await page.getByRole('button', { name: 'Download audio' }).click();
    await expect(page.getByRole('dialog', { name: 'Save as an audio file' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await currentMix(request)).toEqual([1, 2, 3, 4]);
  });
});
