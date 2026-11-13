import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetMix, rewriteJson } from './helpers';

/**
 * T0263: the request, Mixes, Edit, Studio, Library, export and study workflows done start to finish
 * from the keyboard alone, in a real browser against tests/e2e_server.py. No test here clicks or
 * calls focus(): every control is reached with Tab (or the page's own shortcut) and used with keys,
 * so a control the keyboard can't reach fails the walk. A person still has to judge whether the walk
 * is comfortable; that part is P0126 in the polish checklist.
 */
test.beforeEach(async ({ request }) => {
  await request.post('/api/test/flags', { data: { flags: 'all' } });
  await resetMix(request);
});

test.afterEach(async ({ request }) => {
  await request.post('/api/test/flags', { data: { flags: '' } });
});

/** Presses Tab until `target` has focus, as someone without a mouse would, or fails. */
async function tabTo(page: Page, target: Locator, most = 120) {
  for (let presses = 0; presses < most; presses += 1) {
    if (await target.evaluate((node) => node === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target, `reachable with Tab within ${most} presses`).toBeFocused();
}

const order = async (page: Page) => ((await (await page.request.get('/api/mix')).json()).mix as { title: string }[]).map((song) => song.title);

test('T0263 request: ask for a song, cancel it and close, from the keyboard alone', async ({ page, request }) => {
  await page.goto('/listen');
  await expect(page.locator('.lyrics')).toBeVisible();
  await page.keyboard.press('r');
  const drawer = page.getByRole('dialog', { name: 'Requests' });
  const box = drawer.getByRole('combobox', { name: 'Request a song' });
  await expect(box).toBeFocused();
  await page.keyboard.type('Déjà');
  await expect(drawer.getByRole('button', { name: /Déjà Vu/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(drawer.getByRole('list', { name: 'Your requests' }).getByText('Déjà Vu')).toBeVisible();
  await tabTo(page, drawer.getByRole('button', { name: 'Cancel request for Déjà Vu' }));
  await page.keyboard.press('Enter');
  await expect(drawer.getByRole('list', { name: 'Your requests' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  expect((await (await request.get('/api/requests')).json()).requests).toEqual([]);
});

test('T0263 Mixes: start a mix from the Mixes page with Tab and Enter', async ({ page }) => {
  await page.goto('/mixes');
  const start = page.locator('.hero button.primary');
  await expect(start).toBeVisible();
  await tabTo(page, start);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/listen$/, { timeout: 30_000 });
  expect((await order(page)).length).toBeGreaterThan(1);
});

test('T0263 Edit: move a song down and back with its handle, focus staying on it', async ({ page }) => {
  await page.goto('/mix/current/edit');
  const grip = page.getByRole('button', { name: 'Reorder Morning Light' });
  await tabTo(page, grip);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => order(page)).toEqual(['Slow Tide', 'Morning Light', 'Paper Moon', 'Neon Rain']);
  await expect(page.getByRole('button', { name: 'Reorder Morning Light' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => order(page)).toEqual(['Morning Light', 'Slow Tide', 'Paper Moon', 'Neon Rain']);
});

test('T0263 Studio: open a transition, reach the Studio, turn a square over and leave, by keyboard', async ({ page, request }) => {
  const cells = 8;
  const row = Array.from({ length: cells }, (_, index) => (index < cells / 2 ? 1 : 0));
  const shape = { a: { vocals: row, drums: row, bass: row, other: row }, b: { vocals: row, drums: row, bass: row, other: row } };
  const stem = await (await request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => route.fulfill({ json: { status: 'ready', key: 't0263', cells, seconds: 8, bars: 16, start_shape: shape, shape } }));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
  await page.goto('/mix/current/edit');
  await tabTo(page, page.getByRole('button', { name: 'Change', exact: true }).first());
  await page.keyboard.press('Enter');
  const changeTab = page.getByRole('tab', { name: 'Change' });
  await expect(changeTab).toHaveAttribute('aria-selected', 'true');
  await tabTo(page, changeTab);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Studio' })).toHaveAttribute('aria-selected', 'true');
  await tabTo(page, page.getByRole('button', { name: 'Open the Studio' }));
  await page.keyboard.press('Enter');
  const squares = page.locator('.studio-cell');
  await expect(squares.first()).toBeVisible({ timeout: 60_000 });
  // the grid is one tab stop, so Tab lands on a square and the arrows do the rest
  await tabTo(page, squares.first());
  const was = await squares.first().getAttribute('aria-pressed');
  await page.keyboard.press('Space');
  await expect(squares.first()).not.toHaveAttribute('aria-pressed', was ?? '');
  await page.keyboard.press('ArrowRight');
  await expect(squares.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.studio')).toHaveCount(0);
});

test('T0263 Library: search with /, open a song’s menu and add it to the mix, by keyboard', async ({ page }) => {
  await page.goto('/library');
  await expect(page.locator('.library-count')).toBeVisible();
  await page.keyboard.press('/');
  const search = page.getByRole('searchbox', { name: 'Search your library' });
  await expect(search).toBeFocused();
  await page.keyboard.type('Last Call');
  const more = page.getByRole('button', { name: 'More actions for Last Call' });
  await expect(more).toBeVisible();
  await tabTo(page, more);
  await page.keyboard.press('Enter');
  const add = page.getByRole('menu').getByRole('menuitem', { name: 'Add to current mix' });
  await expect(add).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => order(page)).toContain('Last Call');
});

test('T0263 export: open the save dialog from Edit, start saving, cancel it and close back to the button', async ({ page }) => {
  // A previous test may have exported the default mix on this shared server.
  await resetMix(page.request, [1, 2, 3, 5]);
  // The export job is held on this page's side. On the real server a job can only be cancelled while
  // it waits on transitions, and once every transition of this mix has been rendered (the server
  // renders the current mix by itself) that wait lasts a few milliseconds, so a keyboard walk to
  // Cancel export loses the race and the server answers 409. Holding the job in "preparing" until
  // the cancel arrives keeps this a keyboard question, not a render-speed one.
  const mix = (await (await page.request.get('/api/mix')).json()).mix as { song_id: number; title: string; artist: string; seam?: { state: { key: string } } }[];
  let held: Record<string, unknown> | null = null;
  const job = (state: string) => ({
    id: 'job-t0263', state, scope: 'current', draft: null, mix_name: 'Keyboard walk', revision: 'rev-t0263',
    songs: mix.map((item) => ({ song_id: item.song_id, title: item.title, artist: item.artist })),
    seams: mix.slice(1).map((item, index) => ({ key: item.seam?.state.key ?? `seam-${index}`, from: mix[index].title, to: item.title })),
    seams_total: mix.length - 1, seams_ready: 1, seconds_estimate: 240, name: 'keyboard-walk.flac', seconds: null,
    error: null, created_at: 1_794_000_000, can_cancel: state === 'preparing', quiet_seconds: 0,
  });
  await page.route('**/api/exports/jobs', (route) => {
    if (route.request().method() === 'POST') held = job('preparing');
    return route.fulfill({ json: route.request().method() === 'POST' ? held : { jobs: held ? [held] : [] } });
  });
  await page.route('**/api/exports/jobs/job-t0263', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    held = job('cancelled');
    return route.fulfill({ json: { ...job('cancelling'), can_cancel: false } });
  });
  await page.goto('/mix/current/edit');
  const download = page.getByRole('button', { name: 'Download audio' });
  await tabTo(page, download);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Save as an audio file' });
  await expect(dialog).toBeVisible();
  // focus is held inside the dialog: Tab cycles its own controls and never reaches the page behind
  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  // no export of this mix exists yet, so Save it is offered
  const save = dialog.getByRole('button', { name: 'Save it', exact: true });
  await expect(save).toBeEnabled();
  await tabTo(page, save, 20);
  await page.keyboard.press('Enter');
  // the export has started on the server; how long the render takes is not a keyboard question,
  // so the walk ends by cancelling it from the keyboard and getting Save it back
  const cancel = dialog.getByRole('button', { name: 'Cancel export' });
  await expect(cancel).toBeVisible({ timeout: 30_000 });
  await tabTo(page, cancel, 20);
  await page.keyboard.press('Enter');
  await expect(cancel).toHaveCount(0, { timeout: 30_000 });
  await expect(save).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(download).toBeFocused();
});

test('T0263 study: open a study, grade a version and answer, by keyboard to the end', async ({ page }) => {
  const posted: unknown[] = [];
  const audio = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route(/\/api\/listening\?/, (route) => route.fulfill({ json: [{ id: 'kb-1' }] }));
  await page.route('**/api/listening/*/*/audio', (route) => route.fulfill({ body: audio, contentType: 'audio/flac' }));
  await page.route('**/api/listening/*/response', (route) => { posted.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); });
  await page.goto('/listening');
  const study = page.locator('section.study');
  await tabTo(page, study.getByLabel('Study code'));
  await page.keyboard.type('SYNTH-1');
  await page.keyboard.press('Tab');
  await page.keyboard.type('listener-one');
  await page.keyboard.press('Tab');
  await page.keyboard.type('headphones');
  await page.keyboard.press('Enter');
  await expect(study.getByText(/Comparison 1 of 1/)).toBeVisible();
  const grade = study.getByRole('radiogroup', { name: 'Quality of A' }).getByRole('radio', { name: '4' });
  await tabTo(page, study.getByRole('radiogroup', { name: 'Quality of A' }).getByRole('radio').first());
  // a radio group takes its choice with the arrows
  for (let step = 0; step < 6 && !(await grade.isChecked()); step += 1) await page.keyboard.press('ArrowRight');
  await expect(grade).toBeChecked();
  // a preference needs both versions heard: each player is reached with Tab and played with Space
  const now = study.locator('.study-now');
  for (const version of ['A', 'B']) {
    await tabTo(page, study.getByLabel(`Version ${version}`, { exact: true }));
    await page.keyboard.press('Space');
    await expect(now).toHaveText(`Now playing: Version ${version}`);
    // The preference is intentionally gated until actual audio crosses 0.5s.
    await expect.poll(() => study.getByLabel(`Version ${version}`, { exact: true }).evaluate((node) => (node as HTMLAudioElement).currentTime), { timeout: 20_000 }).toBeGreaterThan(0.65);
  }
  const prefer = study.getByRole('button', { name: 'Prefer A' });
  await expect(prefer).toBeEnabled({ timeout: 30_000 });
  await tabTo(page, prefer);
  await page.keyboard.press('Enter');
  await expect(study.getByText('All responses saved. Thank you for listening.')).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ choice: 'a', quality: { a: { grade: 4 } } });
});
