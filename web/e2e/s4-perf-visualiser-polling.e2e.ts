import { expect, test, type Page } from '@playwright/test';
import { audioClock, resetMix, soundsRestarted, spyOnAudio } from './helpers';
import { browserLine, frameWindow, installProbe } from './perf-probe';

/**
 * S4-0098-05 (visualiser canvas work) and S4-0107-10 (quiet background polling), measured in Edge
 * against the made-up library from tests/e2e_server.py. Lab numbers from one shared laptop, headless;
 * they are a probe for a person's profile, not a replacement for it, and say nothing about how
 * anything sounds. Results print as `S4-PERF {...}` lines.
 */
const BUDGET = {
  // Now.tsx targets 30 frames/s for responsive audio, backing off to 15 on slow hardware.
  visibleDrawsPer2s: 64,
  // hidden or scrolled away, it paints nothing (one wake-up frame is allowed for the change itself)
  hiddenDrawsPer2s: 1,
  frameP95Ms: 50,
  longTaskMs: 200,
  // no single API path is asked more than once a second on average while analysis and render run
  requestsPerPathPerSecond: 1,
};

declare global {
  interface Window {
    s4Draws: number;
    s4Hidden: (hidden: boolean) => void;
  }
}

/** Counts every visualiser repaint (each one starts with clearRect on its canvas), and lets the test
 * hide and show the page the way switching tabs does. */
async function watchCanvasAndVisibility(page: Page) {
  await page.addInitScript(() => {
    window.s4Draws = 0;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function counted(...args: Parameters<typeof clear>) {
      if (this.canvas.classList.contains('music-visualizer')) window.s4Draws += 1;
      return clear.apply(this, args);
    };
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    window.s4Hidden = (next: boolean) => {
      hidden = next;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
}

const drawsOver = async (page: Page, ms: number) => {
  const before = await page.evaluate(() => window.s4Draws);
  await page.waitForTimeout(ms);
  return (await page.evaluate(() => window.s4Draws)) - before;
};

async function playOnListen(page: Page) {
  await page.goto('/listen');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).first().click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(async () => (await audioClock(page))[0] ?? 0).toBeGreaterThan(0.3);
}

test.beforeEach(async ({ request }) => {
  await resetMix(request);
});

test('S4-0098-05 the visualiser paints only while seen, stops when hidden, and a theme switch restarts no sound', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  await installProbe(page);
  await spyOnAudio(page);
  await watchCanvasAndVisibility(page);
  await playOnListen(page);
  const canvas = page.locator('canvas.music-visualizer').first();
  await expect(canvas).toBeVisible();

  const visible = await drawsOver(page, 2000);
  // the page hidden, as when another tab is in front: no canvas work at all
  await page.evaluate(() => window.s4Hidden(true));
  const hidden = await drawsOver(page, 2000);
  await page.evaluate(() => window.s4Hidden(false));
  const back = await drawsOver(page, 2000);

  // a theme switch while playing: the canvas repaints with the new colours, no sound starts again
  const restartsBefore = await soundsRestarted(page);
  const clockBefore = (await audioClock(page))[0];
  const themeWindow = frameWindow(page, 3000);
  await page.waitForTimeout(500);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(1000);
  await page.emulateMedia({ colorScheme: 'dark' });
  const theme = await themeWindow;
  const afterTheme = await drawsOver(page, 1000);
  const restartsAfter = await soundsRestarted(page);
  const clockAfter = (await audioClock(page))[0];

  const result = { test: 'S4-0098-05', machine: await browserLine(page), budget: BUDGET, draws: { visible, hidden, back, afterTheme }, theme, restartsBefore, restartsAfter, clockBefore, clockAfter };
  console.log(`S4-PERF ${JSON.stringify(result)}`);
  await info.attach('s4-0098-05.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });

  expect(visible, 'the visualiser was not drawing while seen').toBeGreaterThan(5);
  expect(visible, 'more than 30 paints a second').toBeLessThanOrEqual(BUDGET.visibleDrawsPer2s);
  expect(hidden, 'canvas work while the page was hidden').toBeLessThanOrEqual(BUDGET.hiddenDrawsPer2s);
  expect(back, 'did not resume after the page came back').toBeGreaterThan(5);
  expect(afterTheme, 'stopped drawing after the theme switch').toBeGreaterThan(2);
  expect(restartsAfter, 'a theme switch started a sound again').toBe(restartsBefore);
  expect(clockAfter, 'the audio clock stopped').toBeGreaterThan(clockBefore);
  expect.soft(theme.frameP95, 'p95 frame during the theme switch').toBeLessThanOrEqual(BUDGET.frameP95Ms);
  expect.soft(theme.longTasks.filter((ms) => ms > BUDGET.longTaskMs), 'long tasks during the theme switch').toEqual([]);
});

test('S4-0098-05 a visualiser scrolled out of view paints nothing', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 640 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await spyOnAudio(page);
  await watchCanvasAndVisibility(page);
  await playOnListen(page);
  const canvas = page.locator('canvas.music-visualizer').first();
  test.skip(!(await canvas.count()), 'no visualiser on this layout');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const inView = await canvas.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight;
  });
  test.skip(inView, 'the page is too short to scroll the visualiser away');
  await page.waitForTimeout(300);
  const away = await drawsOver(page, 2000);
  console.log(`S4-PERF ${JSON.stringify({ test: 'S4-0098-05 offscreen', away })}`);
  expect(away, 'canvas work while scrolled out of view').toBeLessThanOrEqual(BUDGET.hiddenDrawsPer2s);
});

test('S4-0107-10 background polling during analysis and render stays quiet and keeps the music steady', async ({ page, request }, info) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await installProbe(page);
  await spyOnAudio(page);
  await watchCanvasAndVisibility(page);
  await playOnListen(page);
  // work in the background: every transition asked for again, and analysis running
  await request.post('/api/mix/render');
  await request.post('/api/analysis/start');
  for (const id of [5, 6, 7]) await request.post(`/api/songs/${id}/analyse`).catch(() => {});

  const surfaces: Record<string, unknown> = {};
  const restartsBefore = await soundsRestarted(page);
  for (const path of ['/listen', '/mix/current/edit', '/workshop', '/library']) {
    await page.evaluate((path) => {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);
    await page.waitForTimeout(500);
    const window_ = await frameWindow(page, 8000);
    const perPath: Record<string, number> = {};
    for (const done of window_.apiDone) {
      const name = done.split(' @')[0];
      perPath[name] = (perPath[name] ?? 0) + 1;
    }
    surfaces[path] = { frameP95: window_.frameP95, frameWorst: window_.frameWorst, longTasks: window_.longTasks, perPath };
    expect.soft(window_.frameP95, `${path}: p95 frame while work runs`).toBeLessThanOrEqual(BUDGET.frameP95Ms);
    expect.soft(window_.longTasks.filter((ms) => ms > BUDGET.longTaskMs), `${path}: long tasks while work runs`).toEqual([]);
    for (const [name, count] of Object.entries(perPath)) {
      // audio for the song and transition clips is the music itself, not polling
      if (/\/audio|\/preview|\/seams\/[^/]+\/(clip|audio)/.test(name)) continue;
      expect.soft(count / 8, `${path}: ${name} asked ${count} times in 8 s`).toBeLessThanOrEqual(BUDGET.requestsPerPathPerSecond);
    }
  }
  // hidden: no polling at all for presentation-only data
  const hiddenFrom = await page.evaluate(() => performance.now());
  await page.evaluate(() => window.s4Hidden(true));
  await page.waitForTimeout(8000);
  const hiddenRequests = await page.evaluate((from) => (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
    .filter((entry) => entry.name.includes('/api/') && entry.startTime >= from + 500 && !/\/audio|\/preview/.test(entry.name))
    .map((entry) => new URL(entry.name).pathname), hiddenFrom);
  await page.evaluate(() => window.s4Hidden(false));
  const restartsAfter = await soundsRestarted(page);

  const result = { test: 'S4-0107-10', machine: await browserLine(page), budget: BUDGET, surfaces, hiddenRequests, restartsBefore, restartsAfter };
  console.log(`S4-PERF ${JSON.stringify(result)}`);
  await info.attach('s4-0107-10.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  // presentation polls stop while hidden; two requests already in flight as it hid are allowed
  expect.soft(hiddenRequests.length, `requests while hidden: ${hiddenRequests.join(', ')}`).toBeLessThanOrEqual(2);
  expect(restartsAfter, 'polling or navigation started a sound again').toBe(restartsBefore);
});
