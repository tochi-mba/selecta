import { expect, test, type Page } from '@playwright/test';
import { resetMix, rewriteJson } from './helpers';
import { browserLine, installProbe, interactionsSince, mark } from './perf-probe';

/**
 * T0265, the browser half: a 120-song Edit (more than 100) and the 64-cell Studio profiled with
 * the CPU slowed four times (Chromium's own throttling, as a low-end machine) while a real render
 * runs on the server. The server half, a 20,500-song library paged during a real render on full
 * CPU and a nearly full drive, is tests/test_t0265_constrained_profile.py. Unthrottled, the same journeys are held to web.dev's
 * "good" 200 ms in web/e2e/s3-profiles.e2e.ts; slowed four times they are held to the 500 ms line
 * web.dev calls poor, so a slow machine is slower but never stuck. Each prints one T0265-PROFILE line.
 */
const SLOWDOWN = 4;
const BUDGET = { interactionMs: 500, longTaskMs: 500 };
const EDIT_SONGS = 120;

async function throttle(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });
}

const lastSeam = async (page: Page) => {
  const { mix } = await (await page.request.get('/api/mix')).json();
  return (mix as { seam: { state: { status: string } } | null }[]).at(-1)?.seam?.state.status ?? 'none';
};

async function startARender(page: Page) {
  await page.request.post('/api/mix/render');
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/test/flags', { data: { flags: 'all' } });
});

test.afterEach(async ({ request }) => {
  await request.post('/api/test/flags', { data: { flags: '' } });
});

test('T0265 a 120-song Edit on a slowed CPU during a render: moves stay under 500 ms and focus stays put', async ({ page, request }) => {
  test.setTimeout(400_000);
  await installProbe(page);
  await request.post('/api/mix/clear');
  for (let index = 0; index < EDIT_SONGS; index += 1) await request.post('/api/mix/songs', { data: { song_id: (index % 12) + 1 } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await throttle(page);
  const began = Date.now();
  await page.goto('/mix/current/edit');
  await expect(page.locator('.timeline > .song')).toHaveCount(EDIT_SONGS, { timeout: 60_000 });
  const openMs = Date.now() - began;
  await startARender(page);
  const renderAtStart = await lastSeam(page);

  const grip = page.locator('.timeline > .song').nth(60).locator('.grip');
  await grip.scrollIntoViewIfNeeded();
  const name = (await grip.getAttribute('aria-label'))!;
  await grip.focus();
  const from = await mark(page);
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.timeline > .song').nth(59 - step).locator('.grip')).toHaveAttribute('aria-label', name);
  }
  const moves = await interactionsSince(page, from);
  const reading = {
    machine: await browserLine(page),
    slowdown: SLOWDOWN,
    songs: EDIT_SONGS,
    open_ms: openMs,
    render_at_start: renderAtStart,
    render_at_end: await lastSeam(page),
    moves: moves.count,
    move_next_paint_p50_ms: moves.nextPaintP50Ms,
    move_next_paint_worst_ms: moves.nextPaintWorstMs,
    long_tasks_ms: moves.longTasks,
  };
  console.log(`T0265-PROFILE ${JSON.stringify({ test: 'edit-120', budget: BUDGET, reading })}`);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null), 'focus stays on the moved song').toBe(name);
  expect(reading.open_ms, 'opening 120 songs on a slow machine').toBeLessThan(20_000);
  expect(reading.move_next_paint_worst_ms, 'slowest move').toBeLessThanOrEqual(BUDGET.interactionMs);
  expect(reading.long_tasks_ms.filter((ms) => ms > BUDGET.longTaskMs), 'long tasks while moving').toEqual([]);
});

test('T0265 the 64-cell Studio on a slowed CPU during a render answers under 500 ms', async ({ page, request }) => {
  test.setTimeout(400_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request, [1, 2, 3]);
  await installProbe(page);
  const cells = 64;
  const row = Array.from({ length: cells }, (_, index) => (index < cells / 2 ? 1 : 0));
  const lanes = { vocals: row, drums: row, bass: row, other: row };
  const shape = { a: lanes, b: lanes };
  const stem = await (await request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: 't0265-64', cells, seconds: 8, bars: cells * 2, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await throttle(page);
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 90_000 });
  await startARender(page);
  const renderAtStart = await lastSeam(page);

  await page.locator('.studio-cell').first().focus();
  const from = await mark(page);
  for (let step = 0; step < 16; step += 1) {
    if (step % 2 === 0) await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
  }
  const load = await interactionsSince(page, from);
  const reading = {
    machine: await browserLine(page),
    slowdown: SLOWDOWN,
    cells: await page.locator('.studio-cell').count(),
    render_at_start: renderAtStart,
    render_at_end: await lastSeam(page),
    interactions: load.count,
    next_paint_p50_ms: load.nextPaintP50Ms,
    next_paint_worst_ms: load.nextPaintWorstMs,
    long_tasks_ms: load.longTasks,
  };
  console.log(`T0265-PROFILE ${JSON.stringify({ test: 'studio-64', budget: BUDGET, reading })}`);
  expect(reading.cells, 'the whole grid is there').toBeGreaterThanOrEqual(cells);
  expect(reading.next_paint_worst_ms, 'slowest grid interaction').toBeLessThanOrEqual(BUDGET.interactionMs);
  expect(reading.long_tasks_ms.filter((ms) => ms > BUDGET.longTaskMs), 'long tasks while editing').toEqual([]);
});
