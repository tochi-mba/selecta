import { APIRequestContext, BrowserContext, expect, Page, test } from '@playwright/test';
import { allRendered, resetMix, rewriteJson } from './helpers';
import { browserLine, frameWindow, installProbe, interactionsSince, mark, type FrameWindow } from './perf-probe';

/**
 * ADR-0162 MI-0162-02 and MI-0162-03 in Edge against the made-up library from tests/e2e_server.py.
 * Lab numbers from one shared 4-core laptop with no GPU, headless; they are not field data and not an
 * independent measurement. Results are printed as `MI-0162 {...}` lines and copied into
 * docs/adr/selecta-microinteraction-performance-results.md. Nothing here proves how anything sounds:
 * MI-0162-03 checks the times the player hands the sound card, not captured audio.
 */

// Budgets, stated before measuring. Frame p95 is for this machine with software compositing; the
// interaction budget is the web.dev "good" INP threshold; a long task over 200 ms during a window in
// which nobody touched the page is blamed on animation or background updates.
const BUDGET = { frameP95Ms: 50, longTaskMs: 200, interactionMs: 200, regressionMs: 100 };
const WINDOW_MS = 3000;
const VIEWPORT = { width: 1440, height: 900 };

/** The app's own router, so the player keeps playing between pages. */
async function go(page: Page, path: string) {
  await page.evaluate((path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

/** A Studio for transition 1 with the real 2 x 4 lanes x 8 squares (64 cells), served from a
 * synthetic song as mp-0289-stem-studio.e2e.ts does, because the e2e server never splits stems. */
async function withStudio(page: Page) {
  const row = Array.from({ length: 8 }, (_, index) => (index < 4 ? 1 : 0));
  const lanes = { vocals: row, drums: row, bass: row, other: row };
  const shape = { a: lanes, b: lanes };
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  // the Studio opens its session with a POST to /mix/1/studio (tune and use have their own routes)
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: 'mi0162', cells: 8, seconds: 8, bars: 16, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
}

/** A Lucy conversation with a proposal, made with the built-in planner (no AI service is called). */
async function lucyConversation(request: APIRequestContext): Promise<string> {
  await request.put('/api/lucy/settings', { data: { enabled: true } });
  const made = await (await request.post('/api/lucy/conversations', { data: { title: 'MI-0162 frames' } })).json();
  const sent = await request.post(`/api/lucy/conversations/${made.id}/turns`, {
    data: { client_id: `mi0162-${Date.now()}`, text: 'make me 6 songs', expected_revision: null },
  });
  expect(sent.ok()).toBe(true);
  await expect.poll(async () => {
    const snap = await (await request.get(`/api/lucy/conversations/${made.id}`)).json();
    return snap.messages.filter((m: { role: string; status: string }) => m.role === 'assistant' && m.status === 'complete').length;
  }, { timeout: 60_000 }).toBe(1);
  return made.id;
}

type Surface = { name: string; open: (page: Page) => Promise<void>; interact: (page: Page) => Promise<void> };

const surfaces = (lucy: string): Surface[] => [
  {
    name: 'Listen (playing, lyrics, visualizer)',
    open: async (page) => {
      await go(page, '/listen');
      await expect(page.getByText('the morning light comes through').first()).toBeVisible();
    },
    interact: async (page) => {
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    },
  },
  {
    name: 'Stage (fullscreen lyrics and visuals)',
    open: async (page) => {
      await page.keyboard.press('f');
      await expect(page.locator('.now.stage')).toBeVisible();
    },
    interact: async (page) => {
      await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
      await page.getByRole('button', { name: 'Resume', exact: true }).first().click();
      await page.keyboard.press('f');
      await expect(page.locator('.now.stage')).toHaveCount(0);
    },
  },
  {
    name: 'Make a Mix cards',
    open: async (page) => {
      await go(page, '/mixes');
      await expect(page.locator('article.vibe-card').first()).toBeVisible();
    },
    interact: async (page) => {
      const card = page.locator('article.vibe-card').first();
      await card.locator('summary').click();
      await card.locator('summary').click();
      await card.locator('summary').focus();
      for (let press = 0; press < 3; press += 1) await page.keyboard.press('Tab');
    },
  },
  {
    name: 'Editor timeline',
    open: async (page) => {
      await go(page, '/mix/current/edit');
      await expect(page.locator('.timeline .song').first()).toBeVisible();
    },
    interact: async (page) => {
      await page.getByRole('button', { name: 'Change', exact: true }).first().click();
      await page.getByRole('tab', { name: 'Studio' }).click();
      await expect(page.getByRole('button', { name: 'Open the Studio' })).toBeVisible();
    },
  },
  {
    name: 'Studio grid (64 cells)',
    open: async (page) => {
      await page.getByRole('button', { name: 'Open the Studio' }).click();
      await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
      await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click();
      await expect(page.locator('.studio-grid .studio-cell')).toHaveCount(64);
    },
    interact: async (page) => {
      const cells = page.locator('.studio-grid .studio-cell');
      for (const index of [3, 12, 27, 60]) {
        const cell = cells.nth(index);
        const before = await cell.getAttribute('aria-pressed');
        await cell.click();
        await expect(cell).not.toHaveAttribute('aria-pressed', before ?? '');
        await cell.click();
        await expect(cell).toHaveAttribute('aria-pressed', before ?? '');
      }
      for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) await page.keyboard.press(key);
    },
  },
  {
    name: 'Lucy activity cards',
    open: async (page) => {
      await go(page, `/mixes/lucy/${lucy}`);
      const steps = page.getByRole('region', { name: 'Lucy’s steps' }).or(page.locator('section.lucy-plan')).first();
      await expect(steps).toBeVisible({ timeout: 30_000 });
      await steps.getByRole('button', { name: /^Show all/ }).click();
      await expect(page.locator('.lucy-card').first()).toBeVisible();
    },
    interact: async (page) => {
      const steps = page.locator('section.lucy-plan').first();
      await steps.getByRole('button', { name: 'Show less' }).click();
      await steps.getByRole('button', { name: /^Show all/ }).click();
      const composer = page.getByRole('textbox', { name: 'Message to Lucy' });
      await composer.click();
      await composer.pressSequentially('calm', { delay: 60 });
      await composer.fill('');
    },
  },
];

type Reading = { surface: string; window: FrameWindow; interactions: Awaited<ReturnType<typeof interactionsSince>> };

async function measure(context: BrowserContext, lucy: string, animated: boolean): Promise<Reading[]> {
  await context.addInitScript((motion) => {
    try {
      window.localStorage.setItem('selecta.prefs', JSON.stringify({ motion }));
    } catch { /* storage blocked: the default motion applies */ }
  }, animated ? 'expressive' : 'still');
  const page = await context.newPage();
  await installProbe(page);
  await withStudio(page);
  await page.goto('/listen');
  await expect(page.locator('h1.display')).toHaveText('Morning Light');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const readings: Reading[] = [];
  for (const surface of surfaces(lucy)) {
    await surface.open(page);
    // let entrance motion start, then watch a fixed window with no input
    await page.waitForTimeout(300);
    const window = await frameWindow(page, WINDOW_MS);
    const from = await mark(page);
    await surface.interact(page);
    await page.waitForTimeout(300);
    readings.push({ surface: surface.name, window, interactions: await interactionsSince(page, from) });
  }
  await page.close();
  return readings;
}

test('MI-0162-02 animated surfaces stay inside long-task, frame and interaction budgets', async ({ browser, baseURL, request }) => {
  test.setTimeout(420_000);
  await resetMix(request);
  const lucy = await lucyConversation(request);
  const results: Record<string, Reading[]> = {};
  // still first, as the baseline, then everything moving
  for (const animated of [false, true]) {
    const context = await browser.newContext({ baseURL, viewport: VIEWPORT, reducedMotion: animated ? 'no-preference' : 'reduce' });
    results[animated ? 'animated' : 'still'] = await measure(context, lucy, animated);
    await context.close();
  }
  const probePage = await browser.newPage();
  const machine = await browserLine(probePage);
  await probePage.close();
  console.log(`MI-0162 ${JSON.stringify({ test: 'MI-0162-02', machine, budget: BUDGET, window_ms: WINDOW_MS, results })}`);

  for (const reading of results.animated) {
    const where = `${reading.surface} (animated)`;
    expect.soft(reading.window.frames, `${where}: too few frames to judge`).toBeGreaterThan(20);
    expect.soft(reading.window.frameP95, `${where}: p95 frame`).toBeLessThanOrEqual(BUDGET.frameP95Ms);
    expect.soft(reading.window.longTasks.filter((ms) => ms > BUDGET.longTaskMs), `${where}: long tasks with nobody touching the page`).toEqual([]);
    expect.soft(reading.interactions.count, `${where}: the interactions were not seen`).toBeGreaterThan(0);
    expect.soft(reading.interactions.eventTimingWorstMs, `${where}: ${reading.interactions.eventTimingWorst}`).toBeLessThanOrEqual(BUDGET.interactionMs);
    expect.soft(reading.interactions.nextPaintWorstMs, `${where}: ${reading.interactions.nextPaintWorst}`).toBeLessThanOrEqual(BUDGET.interactionMs);
  }
  // a meaningful INP regression: animation making the slowest interaction much slower than still
  const worst = (readings: Reading[]) => Math.max(...readings.map((reading) => Math.max(reading.interactions.eventTimingWorstMs, reading.interactions.nextPaintWorstMs)));
  expect.soft(worst(results.animated) - worst(results.still), 'animation made the slowest interaction slower').toBeLessThanOrEqual(BUDGET.regressionMs);
});

type Source = { id: number; at: number; when: number; offset: number; length: number; stops: { at: number; when: number }[] };

declare global {
  interface Window {
    mi0162Audio: { sources: Source[]; contexts: AudioContext[] };
    mi0162Load: { stop: () => void } | undefined;
  }
}

/** Records every sound the player hands the sound card: when it was asked for (audio clock), when it
 * starts, where in its buffer, how long the buffer is, and every stop time it is given. */
async function recordSchedule(page: Page) {
  await page.addInitScript(() => {
    const log: Window['mi0162Audio'] = { sources: [], contexts: [] };
    window.mi0162Audio = log;
    const ids = new WeakMap<AudioBufferSourceNode, Source>();
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        log.contexts.push(this);
      }
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function started(when = 0, offset = 0, duration?: number) {
      const source: Source = { id: log.sources.length, at: this.context.currentTime, when, offset, length: this.buffer?.duration ?? 0, stops: [] };
      ids.set(this, source);
      log.sources.push(source);
      return duration === undefined ? start.call(this, when, offset) : start.call(this, when, offset, duration);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function stopped(when = 0) {
      ids.get(this)?.stops.push({ at: this.context.currentTime, when });
      return stop.call(this, when);
    };
  });
}

/** Keeps the page's main thread busy: a 70 ms busy loop every 100 ms, and a 250 ms task each second. */
async function busyMainThread(page: Page) {
  await page.evaluate(() => {
    const spin = (ms: number) => { const until = performance.now() + ms; while (performance.now() < until) { /* busy */ } };
    const often = window.setInterval(() => spin(70), 100);
    const rarely = window.setInterval(() => spin(250), 1000);
    window.mi0162Load = { stop: () => { window.clearInterval(often); window.clearInterval(rarely); } };
  });
}

test('MI-0162-03 a seam stays contiguous on the audio clock with a busy main thread, page changes and a render going', async ({ page, request }) => {
  test.setTimeout(420_000);
  await recordSchedule(page);
  await installProbe(page);
  await resetMix(request);
  await allRendered(request);
  await page.setViewportSize(VIEWPORT);
  await page.goto('/listen');
  await expect(page.locator('h1.display')).toHaveText('Morning Light');
  const { mix } = await (await request.get('/api/mix')).json();
  const seam = mix[1].seam.state;
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  // the first plan (song, clip, next song) is scheduled once both have loaded
  await expect.poll(() => page.evaluate(() => window.mi0162Audio.sources.length), { timeout: 30_000 }).toBe(3);

  // Load: a song added at the end starts a real background render on the server, the page's main
  // thread is kept about 70% busy with a 250 ms task every second, and the listener moves around.
  await request.post('/api/mix/songs', { data: { song_id: 5 } });
  await request.post('/api/mix/render');
  const renderAtJump = ((await (await request.get('/api/mix')).json()).mix as { seam: { state: { status: string } } | null }[])[4]?.seam?.state.status ?? 'none';
  await busyMainThread(page);
  const from = await mark(page);
  const wallBegun = Date.now();
  const [clockBegun] = await page.evaluate(() => window.mi0162Audio.contexts.map((context) => context.currentTime));
  const earlier = await page.evaluate(() => window.mi0162Audio.sources.length);
  await page.getByRole('button', { name: 'Jump to the transition' }).click();
  await expect(page.getByText('Jumped to just before the seam.')).toBeVisible();
  await go(page, '/library');
  const search = page.getByRole('searchbox', { name: 'Search your library' }).or(page.getByRole('textbox', { name: 'Search your library' })).first();
  await search.pressSequentially('paper', { delay: 80 });
  await go(page, '/mixes');
  await page.locator('article.vibe-card').first().locator('summary').click();
  await go(page, '/mix/current/edit');
  await expect(page.locator('.timeline .song').first()).toBeVisible();
  await go(page, '/listen');
  await expect(page.locator('h1.display')).toHaveText('Slow Tide', { timeout: 150_000 });
  // keep the load on past the switch, until B has been playing on its own for a couple of seconds
  await expect.poll(async () => page.evaluate(({ earlier }) => {
    const [context] = window.mi0162Audio.contexts;
    const after = window.mi0162Audio.sources[earlier + 2];
    return after ? context.currentTime - (after.when + 2) : -1;
  }, { earlier }), { timeout: 60_000, intervals: [250] }).toBeGreaterThan(0);
  const [clockEnded] = await page.evaluate(() => window.mi0162Audio.contexts.map((context) => context.currentTime));
  const wallEnded = Date.now();
  await page.evaluate(() => window.mi0162Load?.stop());
  const renderAfter = ((await (await request.get('/api/mix')).json()).mix as { seam: { state: { status: string } } | null }[])[4]?.seam?.state.status ?? 'none';
  const load = await interactionsSince(page, from);
  const sources = await page.evaluate(() => window.mi0162Audio.sources);
  const [song, clip, after] = sources.slice(earlier);
  const songEnds = song.stops.at(-1)?.when ?? Infinity;
  const clipEnds = clip.when + clip.length;
  const reading = {
    a_source_start: seam.a_source_start,
    b_source_end: seam.b_source_end,
    cue_error_ms: (clip.when - (song.when - song.offset + seam.a_source_start)) * 1000,
    a_runs_past_clip_start_ms: (songEnds - clip.when) * 1000,
    b_overlaps_clip_end_ms: (clipEnds - after.when) * 1000,
    b_offset_error_ms: (after.offset - (seam.b_source_end - 0.03)) * 1000,
    clip_scheduled_ahead_ms: (clip.when - clip.at) * 1000,
    b_scheduled_ahead_ms: (after.when - after.at) * 1000,
    audio_clock_per_wall_second: (clockEnded - clockBegun) / ((wallEnded - wallBegun) / 1000),
    sources_after_jump: sources.length - earlier,
    long_tasks: load.longTasks.length,
    long_task_total_ms: load.longTasks.reduce((sum, ms) => sum + ms, 0),
    slowest_interaction_ms: Math.max(load.eventTimingWorstMs, load.nextPaintWorstMs),
    render_at_jump: renderAtJump,
    render_after: renderAfter,
    audio: await page.evaluate(() => {
      const [context] = window.mi0162Audio.contexts;
      return { sample_rate: context.sampleRate, base_latency_ms: Math.round(context.baseLatency * 1000 * 10) / 10, output_latency_ms: Math.round((context.outputLatency ?? 0) * 1000 * 10) / 10 };
    }),
  };
  console.log(`MI-0162 ${JSON.stringify({ test: 'MI-0162-03', machine: await browserLine(page), tolerance_ms: 1, reading })}`);

  // the main thread really was busy, so the plan was made under load
  expect(reading.long_tasks, 'the busy loop did not register as long tasks').toBeGreaterThanOrEqual(10);
  // A is followed by the clip on its exact cue, with A held 50 ms (30 ms fade, 20 ms at zero gain)
  expect(Math.abs(reading.cue_error_ms), 'the clip moved off its cue').toBeLessThanOrEqual(1);
  expect(Math.abs(reading.a_runs_past_clip_start_ms - 50), 'A stopped early (a gap) or ran on (an overlap)').toBeLessThanOrEqual(1);
  // B comes in exactly 30 ms before the clip ends, at the place in B the clip reached
  expect(Math.abs(reading.b_overlaps_clip_end_ms - 30), 'B left a gap or overlapped more than the crossfade').toBeLessThanOrEqual(1);
  expect(Math.abs(reading.b_offset_error_ms), 'B started from the wrong place').toBeLessThanOrEqual(1);
  // both were handed to the sound card ahead of time, so a late main thread could not move them
  expect(reading.clip_scheduled_ahead_ms).toBeGreaterThan(0);
  expect(reading.b_scheduled_ahead_ms).toBeGreaterThan(0);
  // the audio clock kept real time while the page was busy
  expect(reading.audio_clock_per_wall_second).toBeGreaterThan(0.9);
  await expect(page.getByText('That seam wasn’t ready in time, so this one faded in.')).toHaveCount(0);
  await resetMix(request);
});
