import { writeFileSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';

/** What a big library, a long mix and a full Studio grid cost on this computer, in the browser, in a
 * production build. Everything is measured from the page, so it includes the server and the database.
 * These are lab numbers from one machine. They aren't field data, and they say nothing about how
 * anything sounds. */

type Metrics = { longTasks: number[]; shifts: number; events: { name: string; ms: number }[] };

async function watch(page: Page) {
  await page.addInitScript(() => {
    const metrics: Metrics = { longTasks: [], shifts: 0, events: [] };
    (window as unknown as { metrics: Metrics }).metrics = metrics;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) metrics.longTasks.push(Math.round(entry.duration));
    }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) metrics.shifts += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) metrics.events.push({ name: entry.name, ms: Math.round(entry.duration) });
    }).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
  });
}

const percentile = (values: number[], at: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((one, other) => one - other);
  return sorted[Math.min(Math.floor(sorted.length * at), sorted.length - 1)];
};

async function report(page: Page) {
  return page.evaluate(() => {
    const { longTasks, shifts, events } = (window as unknown as { metrics: Metrics }).metrics;
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      long_tasks: longTasks.length,
      longest_task_ms: longTasks.length ? Math.max(...longTasks) : 0,
      layout_shift: Math.round(shifts * 1000) / 1000,
      slowest_input_ms: events.length ? Math.max(...events.map((event) => event.ms)) : 0,
      dom_nodes: document.querySelectorAll('*').length,
      heap_mb: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
    };
  });
}

/** Frame times while the page scrolls, measured by the browser's own frame callbacks. */
async function scrollFrames(page: Page, by: number, steps: number) {
  return page.evaluate(async ({ by, steps }) => {
    const frames: number[] = [];
    let last = performance.now();
    for (let step = 0; step < steps; step += 1) {
      window.scrollBy(0, by);
      await new Promise((done) => requestAnimationFrame(done));
      const moment = performance.now();
      frames.push(moment - last);
      last = moment;
    }
    return frames;
  }, { by, steps });
}

async function timed(page: Page, act: () => Promise<void>, done: () => Promise<unknown>) {
  const started = Date.now();
  await act();
  await done();
  return Date.now() - started;
}

test('measure', async ({ page, request }) => {
  await watch(page);
  const results: Record<string, unknown> = {};
  const counts = (await (await request.get('/api/status')).json()).counts;
  results.library = counts;

  // The Library, at the size of a very big collection
  let started = Date.now();
  await page.goto('/library');
  await expect(page.locator('.library-rows .song-row').first()).toBeVisible({ timeout: 60_000 });
  const firstRows = Date.now() - started;
  const box = page.getByRole('searchbox', { name: 'Search your library' });
  const shown = page.locator('.library-count');
  const searches: number[] = [];
  for (const words of ['golden', 'river 77', 'artist 69', 'zzzz', '']) {
    const before = await shown.textContent();
    searches.push(await timed(page, () => box.fill(words), () => expect.poll(() => shown.textContent(), { intervals: [20], timeout: 30_000 }).not.toBe(before)));
  }
  const filter = await timed(page, () => page.getByRole('button', { name: 'Ready', exact: true }).click(), () => expect(page).toHaveURL(/show=ready/));
  await expect(page.locator('.library-rows .song-row').first()).toBeVisible();
  await page.getByRole('button', { name: 'Everything', exact: true }).click();
  await expect(page.locator('.library-rows .song-row').first()).toBeVisible();
  const more = page.getByRole('button', { name: 'Show more songs' });
  const pages: number[] = [];
  for (let page_ = 0; page_ < 10 && await more.count(); page_ += 1) {
    const before = await page.locator('.library-rows .song-row').count();
    pages.push(await timed(page, () => more.click(), () => expect.poll(() => page.locator('.library-rows .song-row').count(), { intervals: [20] }).toBeGreaterThan(before)));
  }
  const rowsLoaded = await page.locator('.library-rows .song-row').count();
  const frames = await scrollFrames(page, 240, 60);
  results.library_page = {
    first_rows_ms: firstRows,
    search_ms: searches,
    filter_ms: filter,
    load_more_ms_median: percentile(pages, 0.5),
    load_more_ms_worst: percentile(pages, 1),
    rows_loaded: rowsLoaded,
    scroll_frame_ms_p50: Math.round(percentile(frames, 0.5)),
    scroll_frame_ms_p95: Math.round(percentile(frames, 0.95)),
    ...await report(page),
  };

  // The command palette looking songs up in the same big library (SF-0244-07). Each lookup is timed
  // from typing to the first song result for exactly those words.
  const lookups: number[] = [];
  await page.keyboard.press('Control+k');
  const paletteBox = page.getByRole('combobox', { name: 'Search for a page or a command' });
  await expect(paletteBox).toBeFocused();
  for (const words of ['golden', 'river 7', 'velvet echo', 'mirror 41']) {
    lookups.push(await timed(page, () => paletteBox.fill(words), () => expect(page.getByRole('option', { name: new RegExp(`^Song: .*${words.split(' ')[0]}`, 'i') }).first()).toBeVisible({ timeout: 30_000 })));
  }
  results.palette_songs = {
    lookup_ms_median: percentile(lookups, 0.5),
    lookup_ms_worst: percentile(lookups, 1),
    options_shown: await page.getByRole('option').count(),
  };
  await page.keyboard.press('Escape');

  // A hundred songs in the editor, with the render worker going
  await request.post('/api/mix/render');
  started = Date.now();
  await page.goto('/mix/current/edit');
  await expect(page.locator('.timeline .song').first()).toBeVisible({ timeout: 120_000 });
  const firstEditor = Date.now() - started;
  const songsShown = await page.locator('.timeline .song').count();
  const editorFrames = await scrollFrames(page, 240, 60);
  await page.evaluate(() => window.scrollTo(0, 0));
  const moves: number[] = [];
  for (let move = 0; move < 5; move += 1) {
    const down = page.locator('.timeline .song').first().locator('[data-move="down"]');
    const title = await page.locator('.timeline .song').first().locator('.song-name b').textContent();
    moves.push(await timed(page, () => down.click(), () => expect.poll(() => page.locator('.timeline .song').first().locator('.song-name b').textContent(), { intervals: [20], timeout: 60_000 }).not.toBe(title)));
  }
  results.editor_page = {
    songs: songsShown,
    first_rows_ms: firstEditor,
    scroll_frame_ms_p50: Math.round(percentile(editorFrames, 0.5)),
    scroll_frame_ms_p95: Math.round(percentile(editorFrames, 0.95)),
    move_song_ms_median: percentile(moves, 0.5),
    move_song_ms_worst: percentile(moves, 1),
    ...await report(page),
  };

  // The full Studio grid: both songs, four parts, eight squares each. The stems here are stand-ins,
  // because splitting takes the big model. What's measured is the grid.
  const cells = 8;
  const row = Array.from({ length: cells }, (_, index) => (index < cells / 2 ? 1 : 0));
  const shape = { a: { vocals: row, drums: row, bass: row, other: row }, b: { vocals: row, drums: row, bass: row, other: row } };
  await page.route('**/api/mix/1/studio*', (route) => route.fulfill({ json: { status: 'ready', key: 'bench', cells, seconds: 8, start_shape: shape, shape } }));
  await page.route('**/api/mix/1/options*', async (route) => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...await answer.json(), studio: { available: true } } });
  });
  const firstSong = (await (await request.get('/api/mix')).json()).mix[0].song_id;
  const stem = await (await request.get(`/api/songs/${firstSong}/audio`)).body();
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  const squares = page.locator('.studio-cell');
  await expect(squares.first()).toBeVisible({ timeout: 120_000 });
  const count = await squares.count();
  const taps: number[] = [];
  for (let tap = 0; tap < 16; tap += 1) {
    const square = squares.nth((tap * 7) % count);
    const before = await square.getAttribute('aria-pressed');
    taps.push(await timed(page, () => square.click(), () => expect(square).not.toHaveAttribute('aria-pressed', before ?? '')));
  }
  const studio = { squares: count, tap_ms_median: percentile(taps, 0.5), tap_ms_worst: percentile(taps, 1), ...await report(page) };
  results.studio_grid = studio;

  results.measured_at = new Date().toISOString();
  console.log(JSON.stringify(results, null, 1));
  if (process.env.SELECTA_SCALE_OUT) writeFileSync(process.env.SELECTA_SCALE_OUT, JSON.stringify(results, null, 1));
});
