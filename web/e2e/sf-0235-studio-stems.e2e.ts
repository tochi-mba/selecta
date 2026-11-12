import { expect, test } from '@playwright/test';
import { resetMix, spyOnAudio } from './helpers';

/**
 * SF-0235-07: the real 64-cell Studio (two songs, four parts each, eight squares a part) on stems
 * cached by tests/e2e_server.py SELECTA_E2E_STEMS=1, so the server's own layout code runs and no
 * separation model is needed. Every lane is painted by dragging while the preview plays; the page
 * records long tasks and input delay the whole time, and the preview must keep the one audio focus:
 * no second audio context, no restarted sounds, the transport still playing.
 *
 * Run with the stems server: `SELECTA_E2E_STEMS=1 pnpm exec playwright test e2e/sf-0235-studio-stems.e2e.ts`.
 * Nothing here says how it sounds.
 */
test.skip(process.env.SELECTA_E2E_STEMS !== '1', 'needs the stems fixture server (SELECTA_E2E_STEMS=1)');

type Probe = {
  longTasks: number[];
  moves: number[];
  frames: number[];
  events: { name: string; delay: number; duration: number }[];
};

test.beforeEach(async ({ request }) => resetMix(request, [1, 2, 3]));

test('SF-0235-07 painting all 64 squares of the real Studio stays responsive and the preview keeps the audio focus', async ({ page }) => {
  test.setTimeout(600_000);
  await spyOnAudio(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click({ timeout: 60_000 });
  // the worker may be finishing a render first; laying out cached stems itself takes seconds
  const transport = page.locator('.studio-transport .primary');
  await expect(transport).toBeVisible({ timeout: 240_000 });
  await expect(page.locator('.studio')).not.toContainText('Separating vocals');
  const grid = page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' });
  if (await grid.count()) await grid.click();

  const lanes = page.locator('.studio-grid .studio-lane:not(.studio-ruler)');
  await expect(lanes).toHaveCount(8);
  await expect(page.locator('.studio-grid .studio-cell')).toHaveCount(64);
  await expect(transport).toBeEnabled({ timeout: 60_000 });

  await transport.click();
  await expect(transport).toHaveText(/Stop preview/);
  const before = await page.evaluate(() => ({ contexts: window.audioSpy.contexts.length, started: window.audioSpy.started.length }));

  await page.evaluate(() => {
    const probe: Probe = { longTasks: [], moves: [], frames: [], events: [] };
    (window as unknown as { probe: Probe }).probe = probe;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.longTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: false });
    // Event Timing covers the discrete events (pointerdown, pointerup); pointermove is not reported
    // there, so a capture listener measures how late each move reaches the page and its next frame
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        probe.events.push({ name: entry.name, delay: entry.processingStart - entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);
    window.addEventListener('pointermove', (event) => {
      const now = performance.now();
      probe.moves.push(now - event.timeStamp);
      requestAnimationFrame(() => probe.frames.push(performance.now() - event.timeStamp));
    }, true);
  });

  let took = 0;
  for (let lane = 0; lane < 8; lane += 1) {
    const squares = lanes.nth(lane).locator('.studio-cell');
    await squares.first().scrollIntoViewIfNeeded();
    await expect(squares.first()).toBeInViewport({ ratio: 1 });
    await expect(squares.last()).toBeInViewport({ ratio: 1 });
    const first = (await squares.first().boundingBox())!;
    const last = (await squares.last().boundingBox())!;
    const y = first.y + first.height / 2;
    const from = first.x + first.width / 2;
    const to = last.x + last.width / 2;
    const value = (await squares.first().getAttribute('aria-pressed')) === 'true' ? 'false' : 'true';
    const started = Date.now();
    await page.mouse.move(from, y);
    await page.mouse.down();
    for (let step = 1; step <= 21; step += 1) await page.mouse.move(from + ((to - from) * step) / 21, y);
    await page.mouse.up();
    took += Date.now() - started;
    // one stroke paints one value across the whole lane
    for (let index = 0; index < 8; index += 1) await expect(squares.nth(index)).toHaveAttribute('aria-pressed', value);
  }

  const probe = await page.evaluate(() => (window as unknown as { probe: Probe }).probe);
  const sorted = (values: number[]) => [...values].sort((x, y) => x - y);
  const p95 = (values: number[]) => sorted(values)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] ?? 0;
  test.info().annotations.push({
    type: 'SF-0235-07 measurements',
    description: JSON.stringify({
      paintMs: took,
      longTasks: sorted(probe.longTasks).slice(-5),
      moves: probe.moves.length,
      moveDelayP95: Math.round(p95(probe.moves)),
      nextFrameP95: Math.round(p95(probe.frames)),
      worstEvent: probe.events.reduce((worst, entry) => Math.max(worst, entry.duration), 0),
      worstEventDelay: probe.events.reduce((worst, entry) => Math.max(worst, entry.delay), 0),
    }),
  });
  console.log('SF-0235-07', test.info().annotations.at(-1)?.description);

  expect(probe.moves.length, 'the drags reached the page').toBeGreaterThanOrEqual(8 * 21);
  expect(probe.longTasks.filter((duration) => duration > 200), 'a paint step blocked the page').toEqual([]);
  // INP's "good" line is 200 ms; a pointer move must reach the page, and its next frame, well inside it
  expect(p95(probe.moves), 'pointer moves waited too long to be handled').toBeLessThan(100);
  expect(p95(probe.frames), 'painted squares waited too long for a frame').toBeLessThan(200);
  for (const entry of probe.events.filter((event) => /^pointer(down|up)$/.test(event.name))) {
    expect(entry.duration, `${entry.name} took too long to show`).toBeLessThan(200);
  }
  expect(took, 'painting 64 squares took too long').toBeLessThan(15_000);

  // still one preview, still playing: no second audio context and no restarted sounds
  await expect(transport).toHaveText(/Stop preview/);
  const after = await page.evaluate(() => ({ contexts: window.audioSpy.contexts.length, started: window.audioSpy.started.length }));
  expect(after).toEqual(before);
  await transport.click();
  await expect(transport).toHaveText(/Play preview/);
});
