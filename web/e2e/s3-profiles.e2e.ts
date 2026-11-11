import { expect, test, type Page } from '@playwright/test';
import { audioClock, resetMix, spyOnAudio } from './helpers';
import { browserLine, installProbe, interactionsSince, mark } from './perf-probe';

/**
 * S3-0057-08 and S3-0059-08: two lab profiles in Edge on the e2e server's synthetic library, held to the
 * same budget as web/e2e/mi-0162-performance.e2e.ts (web.dev "good" INP of 200 ms, no long task over
 * 200 ms). Each prints one `S3-PROFILE` line with the numbers. Lab numbers from one shared laptop; they
 * say nothing about how anything sounds.
 */
const BUDGET = { interactionMs: 200, longTaskMs: 200 };

/** Counts nodes matching `selector` that React takes out of the page, i.e. remounts. */
async function countRemovals(page: Page, selector: string) {
  await page.evaluate((selector) => {
    const state = window as unknown as { removed: number };
    state.removed = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue;
          state.removed += (node.matches(selector) ? 1 : 0) + node.querySelectorAll(selector).length;
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }, selector);
}
const removed = (page: Page) => page.evaluate(() => (window as unknown as { removed: number }).removed);

test('S3-0057-08 a 100-song timeline keeps audio, focus and scroll through moves, inside the interaction budget', async ({ page, request }) => {
  test.setTimeout(300_000);
  await spyOnAudio(page);
  await installProbe(page);
  await request.post('/api/mix/clear');
  for (let index = 0; index < 100; index += 1) await request.post('/api/mix/songs', { data: { song_id: (index % 12) + 1 } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/listen');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(async () => (await audioClock(page))[0] ?? 0).toBeGreaterThan(0.2);
  const started = await page.evaluate(() => window.audioSpy.started.length);
  const elements = await page.evaluate(() => document.querySelectorAll('audio').length);

  const began = Date.now();
  await page.evaluate(() => { window.history.pushState({}, '', '/mix/current/edit'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('.timeline > .song')).toHaveCount(100);
  const openMs = Date.now() - began;
  await expect(page.locator('.timeline')).toHaveClass(/long/);
  await countRemovals(page, '.timeline > .song');

  const row = page.locator('.timeline > .song').nth(60);
  await row.scrollIntoViewIfNeeded();
  const grip = row.locator('.grip');
  const name = (await grip.getAttribute('aria-label'))!;
  await grip.focus();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const from = await mark(page);
  // five moves up then five back, from the keyboard, as someone tidying a long mix would
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.timeline > .song').nth(59 - step).locator('.grip')).toHaveAttribute('aria-label', name);
  }
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.timeline > .song').nth(56 + step).locator('.grip')).toHaveAttribute('aria-label', name);
  }
  const focusedName = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  const moves = await interactionsSince(page, from);
  const clock = (await audioClock(page))[0];
  await expect.poll(async () => (await audioClock(page))[0]).toBeGreaterThan(clock + 0.3);
  const reading = {
    machine: await browserLine(page),
    open_100_songs_ms: openMs,
    moves: moves.count,
    move_next_paint_p50_ms: moves.nextPaintP50Ms,
    move_next_paint_worst_ms: moves.nextPaintWorstMs,
    move_event_timing_worst_ms: moves.eventTimingWorstMs,
    long_tasks_ms: moves.longTasks,
    rows_remounted: await removed(page),
    scroll_drift_px: Math.round(Math.abs(scrollAfter - scrollBefore)),
    sounds_restarted: (await page.evaluate(() => window.audioSpy.started.length)) - started,
    audio_elements_before: elements,
    audio_elements_after: await page.evaluate(() => document.querySelectorAll('audio').length),
  };
  console.log(`S3-PROFILE ${JSON.stringify({ test: 'S3-0057-08', budget: BUDGET, reading })}`);
  expect(focusedName, 'focus stays on the moved song').toBe(name);
  expect(reading.open_100_songs_ms, 'opening 100 songs').toBeLessThan(5000);
  expect(reading.move_next_paint_worst_ms, 'slowest move to next paint').toBeLessThanOrEqual(BUDGET.interactionMs);
  expect(reading.long_tasks_ms.filter((ms) => ms > BUDGET.longTaskMs), 'long tasks while moving').toEqual([]);
  expect(reading.rows_remounted, 'moving a song remounts no rows').toBe(0);
  // a keyboard move keeps the moved row in view, so the page scrolls by at most a few rows
  expect(reading.scroll_drift_px, 'scroll position kept').toBeLessThanOrEqual(900);
  expect(reading.sounds_restarted, 'no sound restarted').toBe(0);
  expect(reading.audio_elements_after, 'no audio element mounted or removed').toBe(reading.audio_elements_before);
});

/** A Studio for transition 1 with `cells` squares, served from a synthetic song (as in
 * web/e2e/mp-0289-stem-studio.e2e.ts; the e2e server never splits stems). */
async function withStudio(page: Page, cells: number) {
  const row = Array.from({ length: cells }, (_, index) => (index < cells / 2 ? 1 : 0));
  const lanes = { vocals: row, drums: row, bass: row, other: row };
  const shape = { a: lanes, b: lanes };
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  // the Studio opens its session with a POST to /mix/1/studio (tune and use have their own routes)
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: `s3-${cells}`, cells, seconds: 8, bars: cells * 2, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', async (route) => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...await answer.json(), studio: { available: true } } });
  });
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
}

test('S3-0059-08 the Studio grid answers within budget during a background render and never remounts its cells', async ({ page, request }) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request, [1, 2, 3]);
  await installProbe(page);
  await withStudio(page, 64);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click();
  await expect(page.locator('.studio-grid')).toBeVisible();
  const cells = await page.locator('.studio-cell').count();

  // a song added at the end starts a real background render on the server
  await request.post('/api/mix/songs', { data: { song_id: 5 } });
  await request.post('/api/mix/render');
  const renderState = async () => ((await (await request.get('/api/mix')).json()).mix as { seam: { state: { status: string } } | null }[]).at(-1)?.seam?.state.status ?? 'none';
  const renderAtStart = await renderState();
  await countRemovals(page, '.studio-cell');

  const first = page.locator('.studio-cell').first();
  await first.focus();
  const from = await mark(page);
  // walk the first lane from the keyboard, turning every other square over, then click a few
  for (let step = 0; step < 24; step += 1) {
    if (step % 2 === 0) await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
  }
  for (const index of [70, 75, 80, 85]) await page.locator('.studio-cell').nth(index).click();
  await expect(page.locator('.studio-cell').nth(85)).toHaveAttribute('aria-pressed', /true|false/);
  const load = await interactionsSince(page, from);
  const reading = {
    machine: await browserLine(page),
    cells,
    render_at_start: renderAtStart,
    render_at_end: await renderState(),
    interactions: load.count,
    next_paint_p50_ms: load.nextPaintP50Ms,
    next_paint_worst_ms: load.nextPaintWorstMs,
    event_timing_worst_ms: load.eventTimingWorstMs,
    long_tasks_ms: load.longTasks,
    cells_remounted: await removed(page),
  };
  console.log(`S3-PROFILE ${JSON.stringify({ test: 'S3-0059-08', budget: BUDGET, reading })}`);
  expect(reading.cells, 'eight lanes of 64 squares').toBe(8 * 64);
  expect(reading.next_paint_worst_ms, `slowest grid interaction (${load.nextPaintWorst})`).toBeLessThanOrEqual(BUDGET.interactionMs);
  expect(reading.long_tasks_ms.filter((ms) => ms > BUDGET.longTaskMs), 'long tasks while editing').toEqual([]);
  expect(reading.cells_remounted, 'toggling and moving never remounts a square').toBe(0);
  await expect(page.locator('.studio-cell').nth(70)).toBeVisible();
});
