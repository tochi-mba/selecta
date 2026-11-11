import { CDPSession, expect, Page, Route, test } from '@playwright/test';
import { frameWindow, installProbe } from './perf-probe';
import { allRendered, audioClock, audioStates, resetMix, soundsStarted, spyOnAudio, rewriteJson } from './helpers';

/** Selecta / Flow, ADR-0217 to ADR-0230: scope, gestures, long mixes, drag during playback, a stale
 * Studio proposal and background calm, each in a real browser against the synthesized library. */

const order = async (page: Page) => ((await (await page.request.get('/api/mix')).json()).mix as { title: string }[]).map((song) => song.title);

test.beforeEach(async ({ request }) => {
  await resetMix(request);
});

// SF-0217-04: shaping is a default for new mixes; a choice made for this mix's own transition, and a
// draft, are left exactly as they were, across a reload.
test('SF-0217-04 the next-mix default and this mix’s own choices stay apart through a reload', async ({ page, request }) => {
  await request.post('/api/steer', { data: { action: 'mix_language', value: 'balanced' } });
  expect((await request.post('/api/mix/1/seam', { data: { move: 'cut_on_one', soft: false } })).ok()).toBe(true);
  const draft = await (await request.post('/api/drafts', { data: { name: 'Scope check' } })).json();
  await request.post(`/api/mix/songs?draft=${draft.id}`, { data: { song_id: 5 } });
  const draftBefore = await (await request.get(`/api/mix?draft=${draft.id}`)).json();
  const mixBefore = await (await request.get('/api/mix')).json();

  await page.goto('/mixes');
  await page.getByRole('button', { name: 'Customize' }).click();
  const dialog = page.getByRole('dialog', { name: 'Shape the next mix' });
  await expect(dialog.getByText(/stay as your defaults for every new mix/)).toBeVisible();
  const saved = page.waitForResponse((answer) => answer.url().endsWith('/api/steer') && answer.request().method() === 'POST');
  await dialog.getByLabel('Transition feel').selectOption('seamless');
  expect((await saved).ok()).toBe(true);
  await dialog.getByRole('button', { name: 'Done shaping' }).click();

  await page.reload();
  await page.getByRole('button', { name: 'Customize' }).click();
  await expect(page.getByRole('dialog', { name: 'Shape the next mix' }).getByLabel('Transition feel')).toHaveValue('seamless');
  expect((await (await request.get('/api/status')).json()).steering.mix_language).toBe('seamless');

  const mixAfter = await (await request.get('/api/mix')).json();
  expect(mixAfter.mix.map((item: { song_id: number }) => item.song_id)).toEqual(mixBefore.mix.map((item: { song_id: number }) => item.song_id));
  expect(mixAfter.mix[1].seam.settings).toEqual(mixBefore.mix[1].seam.settings);
  expect(mixAfter.mix[1].seam.settings.move).toBe('cut_on_one');
  expect(await (await request.get(`/api/mix?draft=${draft.id}`)).json()).toEqual(draftBefore);

  await request.post('/api/steer', { data: { action: 'mix_language', value: 'balanced' } });
  await request.delete(`/api/drafts/${draft.id}`);
});

async function touchPoint(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', x = 0, y = 0) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
}

const centre = async (page: Page, title: string) => {
  const box = (await page.locator('.timeline .song', { hasText: title }).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

// SF-0220-03: a finger on the handle shows where the song would land before anything moves; letting
// go of nothing (a cancel) leaves no mark and no change; only a real drop moves it.
test('SF-0220-03 a touch drag previews the insertion, a cancel leaves nothing, and a drop moves it', async ({ page }) => {
  // The finger only ever lands on rows that are on screen: below the editor's header the third song sits
  // near y=1150, past a 720px window, where elementFromPoint finds nothing. A tall window keeps both the
  // handle and the target on screen and clear of the 90px edge that scrolls the page mid-drag.
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto('/mix/current/edit');
  const grip = page.getByRole('button', { name: 'Reorder Morning Light' });
  await expect(grip).toBeVisible();
  const before = await order(page);
  const cdp = await page.context().newCDPSession(page);
  const start = (await grip.boundingBox())!;
  const target = await centre(page, 'Paper Moon');
  const over = page.locator('.timeline .song.over');

  await touchPoint(cdp, 'touchStart', start.x + start.width / 2, start.y + start.height / 2);
  for (let step = 1; step <= 6; step += 1) {
    await touchPoint(cdp, 'touchMove', start.x + start.width / 2, start.y + start.height / 2 + ((target.y - start.y) * step) / 6);
  }
  await expect(over).toHaveCount(1);
  await expect(over).toContainText('Paper Moon');
  const line = await over.evaluate((row) => getComputedStyle(row).boxShadow);
  expect(line).toMatch(/-3px/);
  expect(await order(page)).toEqual(before);

  await touchPoint(cdp, 'touchCancel');
  await expect(over).toHaveCount(0);
  const unmarked = await page.locator('.timeline .song', { hasText: 'Paper Moon' }).first().evaluate((row) => getComputedStyle(row).boxShadow);
  expect(unmarked).not.toMatch(/-3px/);
  await page.waitForTimeout(400);
  expect(await order(page)).toEqual(before);

  const again = (await grip.boundingBox())!;
  await touchPoint(cdp, 'touchStart', again.x + again.width / 2, again.y + again.height / 2);
  for (let step = 1; step <= 6; step += 1) {
    await touchPoint(cdp, 'touchMove', again.x + again.width / 2, again.y + again.height / 2 + ((target.y - again.y) * step) / 6);
  }
  await expect(over).toContainText('Paper Moon');
  await touchPoint(cdp, 'touchEnd');
  await expect.poll(() => order(page)).toEqual(['Slow Tide', 'Paper Moon', 'Morning Light', 'Neon Rain']);
  await expect(over).toHaveCount(0);
});

type Item = { position: number; song_id: number; title: string; artist: string; seam: unknown; locked: boolean };

/** A hundred-song current mix, served to the page in place of the four-song one. Moves are applied to
 * this list exactly as the server would, so the page sees a consistent mix throughout. */
async function hundredSongs(page: Page) {
  const real = await (await page.request.get('/api/mix')).json();
  const template = real.mix[1] as Item;
  let mix: Item[] = Array.from({ length: 100 }, (_, index) => ({
    ...template,
    position: index,
    song_id: (index % 12) + 1,
    title: `Stress ${String(index + 1).padStart(3, '0')}`,
    artist: `Artist ${index % 7}`,
    locked: false,
    seam: index === 0 ? null : { settings: { move: 'bass_swap_blend' }, state: { status: 'none', key: `stress-${index}`, passed: true } },
  }));
  const answer = () => ({ ...real, mix });
  await page.route('**/api/mix', (route: Route) => (route.request().method() === 'GET' ? route.fulfill({ json: answer() }) : route.fallback()));
  await page.route('**/api/mix?*', (route: Route) => (route.request().method() === 'GET' ? route.fulfill({ json: answer() }) : route.fallback()));
  await page.route('**/api/mix/move*', async (route: Route) => {
    const { source, target } = route.request().postDataJSON() as { source: number; target: number };
    const next = [...mix];
    const [moving] = next.splice(source, 1);
    next.splice(target, 0, moving);
    mix = next.map((item, position) => ({ ...item, position }));
    await route.fulfill({ json: answer() });
  });
  await page.route('**/api/mix/*/options*', async (route: Route) => {
    const options = await route.fetch({ url: route.request().url().replace(/\/api\/mix\/\d+\/options/, '/api/mix/1/options') });
    await route.fulfill({ response: options });
  });
}

// SF-0220-07: a hundred songs; keyboard moves keep focus on the song being moved, in view, and the
// page doesn't jump while it re-renders.
test('SF-0220-07 a hundred-song mix keeps scrolling and focus steady while songs move', async ({ page }) => {
  await installProbe(page);
  await hundredSongs(page);
  await page.goto('/mix/current/edit');
  await expect(page.locator('.timeline .song')).toHaveCount(100);
  const grip = page.getByRole('button', { name: 'Reorder Stress 080' });
  await grip.scrollIntoViewIfNeeded();
  await grip.focus();
  for (let move = 0; move < 5; move += 1) {
    const before = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.timeline .song').nth(78 - move)).toContainText('Stress 080');
    await expect(page.getByRole('button', { name: 'Reorder Stress 080' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Reorder Stress 080' })).toBeInViewport();
    // one row up at most, never a jump back to the top or a lurch down the page
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(400);
  }
  const scrolling = await frameWindow(page, 1500, { scrollBy: 60 });
  expect(scrolling.frames).toBeGreaterThan(20);
  expect(scrolling.frameP95).toBeLessThan(100);
  expect(scrolling.longTasks.filter((task) => task > 250)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Reorder Stress 080' })).toHaveCount(1);
});

// SF-0221-07: the open transition stays the same pair, and stays in sight, while songs far away move.
test('SF-0221-07 in a hundred-song mix the inspector keeps its pair while other songs move', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await hundredSongs(page);
  await page.goto('/mix/current/edit');
  await expect(page.locator('.timeline .song')).toHaveCount(100);
  const into = page.locator('.timeline .song', { hasText: 'Stress 061' }).first();
  await into.scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Change', exact: true }).nth(59).click();
  const side = page.getByRole('complementary', { name: 'This transition' });
  await expect(side).toBeVisible();
  await expect(side).toContainText('Stress 060');
  await expect(side).toContainText('Stress 061');

  const far = page.getByRole('button', { name: 'Reorder Stress 010' });
  await far.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.timeline .song').nth(10)).toContainText('Stress 010');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.timeline .song').nth(8)).toContainText('Stress 010');
  await expect(side).toContainText('Stress 060');
  await expect(side).toContainText('Stress 061');
  // sticky beside the long timeline: scroll far away and it's still on screen
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(side).toBeInViewport();
  await expect(side).toContainText('Stress 061');
});

// SF-0222-07: dragging in the editor while the mix plays: frames stay smooth and the audio clock keeps
// moving with no sound restarted or stopped.
test('SF-0222-07 dragging a song while the mix plays leaves playback alone', async ({ page, request }) => {
  test.setTimeout(420_000);
  await installProbe(page);
  await spyOnAudio(page);
  // two songs, one transition: enough to play across a seam, and quick to render on a busy machine
  await resetMix(request, [1, 2]);
  await allRendered(request);
  await page.goto('/listen');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  // the transition and the next song are scheduled ahead once loaded; after that nothing new should start
  await expect.poll(() => soundsStarted(page), { timeout: 30_000 }).toBe(3);
  // through the app, never a reload, which would stop the music
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(/\/mix\/current\/edit$/);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const grip = page.getByRole('button', { name: /^Reorder / }).nth(1);
  await expect(grip).toBeVisible();
  const startedBefore = await soundsStarted(page);
  const stoppedBefore = await page.evaluate(() => window.audioSpy.stopped);
  const [clockBefore] = await audioClock(page);
  const wallBefore = Date.now();
  const cdp = await page.context().newCDPSession(page);
  const box = (await grip.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await touchPoint(cdp, 'touchStart', x, y);
  const watching = frameWindow(page, 2000);
  for (let step = 1; step <= 40; step += 1) await touchPoint(cdp, 'touchMove', x, y + (step % 20) * 6);
  const frames = await watching;
  await touchPoint(cdp, 'touchCancel');
  const [clockAfter] = await audioClock(page);
  const wall = (Date.now() - wallBefore) / 1000;
  expect(await audioStates(page)).toEqual(['running']);
  expect(clockAfter - clockBefore).toBeGreaterThan(wall * 0.8);
  expect(await soundsStarted(page)).toBe(startedBefore);
  expect(await page.evaluate(() => window.audioSpy.stopped)).toBe(stoppedBefore);
  expect(frames.frameP95).toBeLessThan(100);
  expect(frames.longTasks.filter((task) => task > 250)).toEqual([]);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
});

// SF-0224-03: a fine-tune answer that comes back after someone has painted the grid never replaces
// what they painted, and Apply sends their version.
test('SF-0224-03 a stale Studio proposal cannot overwrite newer strokes', async ({ page, request }) => {
  const cells = 8;
  const row = Array.from({ length: cells }, (_, index) => (index < cells / 2 ? 1 : 0));
  const shape = { a: { vocals: row, drums: row, bass: row, other: row }, b: { vocals: row, drums: row, bass: row, other: row } };
  const full = Array.from({ length: cells }, () => 1);
  const proposal = { a: { vocals: full, drums: full, bass: full, other: full }, b: { vocals: full, drums: full, bass: full, other: full } };
  const stem = await (await request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => route.fulfill({ json: { status: 'ready', key: 'race', cells, seconds: 8, bars: 16, start_shape: shape, shape } }));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
  let release: () => void = () => {};
  const held = new Promise<void>((done) => { release = done; });
  await page.route('**/api/mix/1/studio/tune', async (route) => {
    await held;
    await route.fulfill({ json: { shape: proposal, changes: ['Brought every part in throughout.'] } });
  });
  const applied: unknown[] = [];
  await page.route('**/api/mix/1/studio/use', async (route) => {
    applied.push(route.request().postDataJSON());
    await route.abort();
  });
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  const squares = page.locator('.studio-cell');
  await expect(squares.first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Fine tune mine' }).click();
  await expect(page.getByRole('button', { name: 'Fine tuning…' })).toBeVisible();
  // a newer stroke of the person's own while Selecta is still thinking: the last square of the first lane
  const last = squares.nth(cells - 1);
  await expect(last).toHaveAttribute('aria-pressed', 'false');
  await last.click();
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  release();
  await expect(page.getByText('You changed the grid while Selecta was working, so your version stays.')).toBeVisible();
  // the proposal turned every square on; the person's grid still has squares off, and their stroke stays
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  await expect(squares.nth(cells - 2)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Put it back' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply to this transition' }).click();
  await expect.poll(() => applied.length).toBe(1);
  const sent = (applied[0] as { shape: typeof shape }).shape;
  expect(sent.a.vocals[cells - 1]).toBe(1);
  expect(sent.a.vocals[cells - 2]).toBe(0);
});

// SF-0230-07: background job updates in Workspace never move focus and never start sound.
test('SF-0230-07 job updates never steal focus or start playback', async ({ page }) => {
  await spyOnAudio(page);
  const base = {
    worker: { running: true, rendering_the_mix: false },
    mix: { queued: 2, rendering: 1, failed: 0, none: 0, ready: 1 },
    drafts_in_line: 0, storage_full: false,
    analysis: { running: true, paused: false, asked_for: 0, left: 9 },
    failed_seams: [] as { from: string; to: string }[], failed_songs: [] as { id: number; title: string; artist: string }[], estimates: '',
  };
  let calls = 0;
  await page.route('**/api/jobs', async (route) => {
    calls += 1;
    // every answer is different: rendering finishes, a seam fails, storage fills, analysis pauses
    const step = calls % 4;
    await route.fulfill({ json: {
      ...base,
      mix: { ...base.mix, rendering: step % 2, ready: 1 + step },
      storage_full: step === 2,
      failed_seams: step === 1 ? [{ from: 'Morning Light', to: 'Slow Tide' }] : [],
      analysis: { ...base.analysis, paused: step === 3, left: 9 - step },
    } });
  });
  await page.goto('/workshop');
  const compact = page.getByRole('checkbox', { name: /Compact rows/ });
  await compact.focus();
  await expect(compact).toBeFocused();
  const startCalls = calls;
  const url = page.url();
  await expect.poll(() => calls, { timeout: 30_000 }).toBeGreaterThanOrEqual(startCalls + 3);
  await expect(compact).toBeFocused();
  expect(page.url()).toBe(url);
  expect(await soundsStarted(page)).toBe(0);
  expect(await page.evaluate(() => window.audioSpy.contexts.filter((context) => context.state === 'running').length)).toBe(0);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  await expect(page.locator('[role="alertdialog"], dialog[open]')).toHaveCount(0);
});
