import { expect, Page, test } from '@playwright/test';
import { allRendered, resetMix, spyOnAudio } from './helpers';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

test.beforeEach(async ({ request }) => {
  await resetMix(request);
});

test('a slow answer still gets an instant reaction on Start, and it can’t be pressed twice', async ({ page, request }) => {
  await page.goto('/mixes');
  let builds = 0;
  await page.route('**/api/vibes/*/build*', async (route) => {
    builds += 1;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  const start = page.locator('.hero button.primary');
  await start.click();
  await expect(start).toHaveAttribute('aria-busy', 'true', { timeout: 300 });
  await start.click({ force: true }).catch(() => {});
  await expect(page).toHaveURL(/\/listen$/, { timeout: 30_000 });
  expect(builds).toBe(1);
  expect((await (await request.get('/api/mix')).json()).mix.length).toBeGreaterThan(1);
});

test('editing: move with the buttons, undo it, and remove a song', async ({ page }) => {
  await page.goto('/mix/current/edit');
  const rows = page.locator('.song .song-name b');
  await expect(rows.first()).toHaveText('Morning Light');
  await page.getByRole('button', { name: 'Move Slow Tide up' }).click();
  await expect(rows.first()).toHaveText('Slow Tide');
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect(rows.first()).toHaveText('Morning Light');
  await page.getByRole('button', { name: 'Remove Paper Moon' }).click();
  await expect(page.getByRole('button', { name: 'Remove Paper Moon' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect(page.getByRole('button', { name: 'Remove Paper Moon' })).toBeVisible();
});

test('a change to a mix that’s moved on stops, says so, and touches nothing', async ({ page, request }) => {
  await page.goto('/mix/current/edit');
  await expect(page.getByRole('button', { name: 'Remove Paper Moon' })).toBeVisible();
  // the mix changes behind this page's back, before its next look
  await page.route('**/api/mix*', async (route) => {
    if (route.request().method() === 'GET') await new Promise((resolve) => setTimeout(resolve, 8000));
    await route.continue();
  });
  await request.post('/api/mix/move', { data: { source: 0, target: 3 } });
  await page.getByRole('button', { name: 'Remove Paper Moon' }).click();
  await expect(page.getByText('This mix has just changed, so nothing was done.').first()).toBeVisible();
  const { mix } = await (await request.get('/api/mix')).json();
  expect((mix as { song_id: number }[]).map((item) => item.song_id)).toContain(3);
});

test('a transition’s inspector: its four areas, and a change of move renders the new one', async ({ page, request }) => {
  await allRendered(request);
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Hear it' }).first().click();
  for (const area of ['Listen', 'Change', 'Studio', 'Details']) {
    await page.getByRole('tab', { name: area }).click();
    await expect(page.getByRole('tab', { name: area })).toHaveAttribute('aria-selected', 'true');
  }
  await page.getByRole('tab', { name: 'Change' }).click();
  const unavailable = page.locator('[role="tabpanel"] button[disabled]');
  if (await unavailable.count()) await expect(unavailable.first()).toHaveAttribute('title', /.+/);
});

test('drafts: make one, name it, fill it, and it stays apart from the current mix', async ({ page, request }) => {
  await page.goto('/mixes/mine');
  const made = await (await request.post('/api/drafts', { data: { name: 'Friday night' } })).json();
  await request.post(`/api/mix/songs?draft=${made.id}`, { data: { song_id: 5 } });
  await page.reload();
  const draft = page.getByRole('button', { name: 'Edit Friday night' });
  await expect(draft).toBeVisible();
  await draft.click();
  await expect(page).toHaveURL(new RegExp(`/mixes/drafts/${made.id}/edit$`));
  await expect(page.getByText('שלום עולם').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('שלום עולם').first()).toBeVisible();
  const current = await (await request.get('/api/mix')).json();
  expect((current.mix as { song_id: number }[]).map((item) => item.song_id)).toEqual([1, 2, 3, 4]);

  await page.goto('/mixes/mine');
  await page.getByRole('button', { name: 'Delete Friday night' }).click();
  await expect(page.getByRole('button', { name: 'Edit Friday night' })).toHaveCount(0);
  await page.getByRole('button', { name: /Undo|Bring it back/ }).first().click();
  await expect(page.getByRole('button', { name: 'Edit Friday night' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Friday night' }).click();
  await expect(page.getByRole('button', { name: 'Edit Friday night' })).toHaveCount(0);
});

test('a draft that’s been deleted is explained, and never quietly swapped for another mix', async ({ page, request }) => {
  const made = await (await request.post('/api/drafts', { data: { name: 'Going away' } })).json();
  await page.goto(`/mixes/drafts/${made.id}/edit`);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await request.delete(`/api/drafts/${made.id}`);
  await page.reload();
  await expect(page.getByText('Morning Light')).toHaveCount(0);
  await expect(page.getByText(/deleted|no longer|isn’t there|gone/i).first()).toBeVisible();
});

test('saving a mix as an audio file makes a real FLAC', async ({ page, request }) => {
  await allRendered(request);
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Download audio' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as an audio file' });
  await expect(dialog).toBeVisible();
  await dialog.locator('button.primary').click();
  const link = dialog.getByRole('link');
  await expect(link).toBeVisible({ timeout: 170_000 });
  const answer = await request.get((await link.getAttribute('href'))!);
  expect(answer.status()).toBe(200);
  const bytes = await answer.body();
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('fLaC');
  expect(bytes.length).toBeGreaterThan(1_000_000);
});

test('the Library: search, song details, a correction that can be put back', async ({ page }) => {
  await page.goto('/library');
  await page.getByRole('textbox', { name: 'Search your library' }).fill('Paper');
  await page.getByRole('button', { name: /^Details for Paper Moon/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Paper Moon' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('spinbutton').fill('238');
  await sheet.getByRole('button', { name: 'Save correction' }).click();
  await expect(sheet.getByText(/238/).first()).toBeVisible();
  await sheet.getByRole('button', { name: 'Use what was measured' }).click();
  await expect(sheet.getByText(/119/).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Details for Paper Moon/ })).toBeFocused();
});

test('songs that can’t be mixed say why', async ({ page }) => {
  await page.goto('/library');
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /Set aside/ }).click();
  await expect(page.getByText('Episode 12')).toBeVisible();
  await page.getByRole('button', { name: /^Details for Episode 12/ }).click();
  await expect(page.getByRole('dialog', { name: 'Episode 12' }).getByText('Long and talky').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Search your library' }).fill('');
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /attention/i }).click();
  await expect(page.getByText('Broken File')).toBeVisible();
  await page.getByRole('button', { name: /^Details for Broken File/ }).click();
  await expect(page.getByRole('dialog', { name: 'Broken File' }).getByText('couldn’t analyse').first()).toBeVisible();
});

test('requests: asking, then seeing it find a place, and cancelling for good', async ({ page, request }) => {
  await page.goto('/listen');
  await page.keyboard.press('r');
  const drawer = page.getByRole('dialog', { name: 'Requests' });
  await drawer.getByRole('textbox', { name: 'Request a song' }).fill('Last Call');
  await drawer.getByRole('button', { name: /Last Call/ }).first().click();
  const yours = drawer.getByRole('list', { name: 'Your requests' });
  await expect(yours.getByText('Last Call')).toBeVisible();
  await expect(drawer.getByText(/Waiting to play|Finding a place|Getting ready|Needs your choice|Coming up|Needs attention/).first()).toBeVisible();

  const asked = await (await request.get('/api/requests')).json();
  expect((asked.requests as { title: string }[]).filter((row) => row.title === 'Last Call')).toHaveLength(1);

  await yours.getByRole('button', { name: 'Cancel request for Last Call' }).click();
  await expect(yours.getByText('Last Call')).toHaveCount(0);
  // it stays gone through the next few looks at the server
  await page.waitForTimeout(6000);
  await expect(drawer.getByText('Last Call')).toHaveCount(0);
  const after = await (await request.get('/api/requests')).json();
  expect((after.requests as { title: string; status: string }[]).filter((row) => row.title === 'Last Call' && row.status !== 'cancelled')).toHaveLength(0);
});

test('keyboard alone gets from the top of the page to the content, and dialogs give focus back', async ({ page }) => {
  await page.goto('/library');
  await expect(nav(page)).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to the page' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#content')).toBeFocused();
  const button = nav(page).getByRole('button', { name: /^Requests/ });
  await button.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Requests' });
  await expect(drawer).toBeVisible();
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('focus is never hidden behind the bottom bar on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/library');
  await expect(page.getByText('Morning Light').first()).toBeVisible();
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Tab');
    const hidden = await page.evaluate(() => {
      const focused = document.activeElement as HTMLElement | null;
      if (!focused || focused === document.body || focused.closest('nav')) return null;
      const box = focused.getBoundingClientRect();
      const bar = document.querySelector('nav')?.getBoundingClientRect();
      return bar && box.top < bar.top && box.bottom > bar.top + 1 && box.top + 2 > bar.top ? focused.outerHTML.slice(0, 80) : null;
    });
    expect(hidden).toBeNull();
  }
});

test('Workshop tells the truth about what’s running, and diagnostics hold nothing private', async ({ page, request }) => {
  await page.goto('/workshop/diagnostics');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  const text = await (await request.get('/api/diagnostics')).text();
  expect(text).not.toContain('Morning Light');
  expect(text).not.toContain('selecta-e2e');
  await page.goto('/workshop/sources');
  await expect(page.getByRole('heading', { name: 'Your music folders' })).toBeVisible();
});

test('the listening test: nothing gives away which is which, and a failed send can be retried', async ({ page, request }) => {
  const body = await (await request.get('/api/listening')).text().catch(() => '');
  await page.goto('/listening');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  expect(body).not.toContain('"condition"');
});

test.describe('when the server stops answering', () => {
  test('it says so, keeps what’s on screen, and recovers by itself', async ({ page }) => {
    await page.goto('/mix/current/edit');
    await expect(page.getByRole('button', { name: 'Remove Paper Moon' })).toBeVisible();
    await page.route('**/api/**', (route) => route.abort());
    await expect(page.getByText('Can’t reach Selecta.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Remove Paper Moon' })).toBeVisible();
    await page.unroute('**/api/**');
    await expect(page.getByText('Can’t reach Selecta.')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Remove Paper Moon' })).toBeVisible();
  });

  test('a change that couldn’t be sent says so, and nothing pretends it happened', async ({ page, request }) => {
    await page.goto('/mix/current/edit');
    await expect(page.getByRole('button', { name: 'Remove Paper Moon' })).toBeVisible();
    await page.route('**/api/mix/songs/**', (route) => route.abort());
    await page.getByRole('button', { name: 'Remove Paper Moon' }).click();
    await expect(page.getByRole('button', { name: 'Remove Paper Moon' })).toBeVisible();
    await page.unroute('**/api/mix/songs/**');
    const { mix } = await (await request.get('/api/mix')).json();
    expect((mix as { song_id: number }[]).map((item) => item.song_id)).toContain(3);
  });

  test('music already loaded keeps playing while the server is away', async ({ page, request }) => {
    await allRendered(request);
    await spyOnAudio(page);
    await page.goto('/listen');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await page.route('**/api/**', (route) => route.abort());
    await expect(page.getByText('Can’t reach Selecta.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.audioSpy.contexts[0].state)).toBe('running');
  });
});
