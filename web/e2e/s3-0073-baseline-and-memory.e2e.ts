import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { PAGES, resetMix, rewriteJson } from './helpers';

/**
 * ADR-0073 lab measurements on the e2e server's synthetic library, in Edge.
 *   S3-0073-01  one baseline record: bundle size, JS heap, DOM size, first mount and navigation per page.
 *   S3-0073-07  repeated Studio, inspector, preview, palette and route mounts don't keep growing the heap,
 *               the DOM or the listener count.
 * Lab numbers from one machine. They say nothing about how anything sounds, and a person still records
 * them on the owner's documented hardware.
 */

test.beforeEach(async ({ request }) => resetMix(request, [1, 2, 3]));

async function heap(cdp: CDPSession) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  const counters = await cdp.send('Memory.getDOMCounters');
  return { heapBytes: usedSize, nodes: counters.nodes, listeners: counters.jsEventListeners };
}

function bundle() {
  const assets = join(__dirname, '..', process.env.SELECTA_E2E_DIST ?? 'dist', 'assets');
  const files = readdirSync(assets).map((name) => ({ name, bytes: statSync(join(assets, name)).size }));
  const sum = (ext: string) => files.filter((file) => file.name.endsWith(ext)).reduce((total, file) => total + file.bytes, 0);
  const largest = files.filter((file) => file.name.endsWith('.js')).sort((a, b) => b.bytes - a.bytes)[0];
  return { jsBytes: sum('.js'), cssBytes: sum('.css'), jsFiles: files.filter((file) => file.name.endsWith('.js')).length, largestJs: largest };
}

/** Moves within the app without a reload, so the heap carries over. */
async function goWithin(page: Page, path: string) {
  await page.evaluate((to) => { window.history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
  await expect(page.locator('main#main')).toBeVisible();
}

test('S3-0073-01 baseline: bundle, heap, DOM, first mount and navigation for every page', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  const cdp = await page.context().newCDPSession(page);
  const pages: Record<string, unknown> = {};
  for (const address of PAGES) {
    await page.goto(address);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    const mountedAt = await page.evaluate(() => Math.round(performance.now()));
    await page.waitForTimeout(500);
    const nav = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return { domContentLoaded: Math.round(entry.domContentLoadedEventEnd), load: Math.round(entry.loadEventEnd), transferBytes: entry.transferSize };
    });
    // a move within the app, the way people go from page to page
    const start = Date.now();
    await goWithin(page, address === '/listen' ? '/mixes' : '/listen');
    const withinApp = Date.now() - start;
    pages[address] = { firstMountMs: mountedAt, ...nav, inAppNavigationMs: withinApp, ...(await heap(cdp)) };
  }
  const record = { status: 'lab-baseline-one-machine', bundle: bundle(), pages };
  writeFileSync(info.outputPath('s3-0073-baseline.json'), JSON.stringify(record, null, 2));
  console.log(`S3-BASELINE ${JSON.stringify(record)}`);
  expect(record.bundle.jsBytes).toBeGreaterThan(0);
  for (const address of PAGES) expect(pages[address], `${address} measured nothing`).toBeTruthy();
});

/** A Studio for transition 1, served here because the e2e server never splits stems (as mp-0289 does). */
async function withStudio(page: Page) {
  const row = [1, 1, 1, 1, 0, 0, 0, 0];
  const lanes = { vocals: row, drums: row, bass: row, other: row };
  const shape = { a: lanes, b: lanes };
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: 's3-0073-07', cells: 8, seconds: 8, bars: 16, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
}

async function oneRound(page: Page) {
  await goWithin(page, '/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await expect(page.locator('.inspector-identity')).toBeVisible();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
  const transport = page.locator('.studio-transport .primary');
  await transport.click();
  await expect(transport).toHaveText(/Stop/, { timeout: 30_000 });
  await transport.click();
  await expect(transport).toHaveText(/Play preview/);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox', { name: 'Search for a page or a command' })).toBeVisible();
  await page.keyboard.press('Escape');
  await goWithin(page, '/listen');
  await goWithin(page, '/library');
}

test('S3-0073-07 repeated Studio, inspector, preview, palette and route mounts leave nothing growing', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await withStudio(page);
  await page.goto('/library');
  await expect(page.locator('main#main')).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  // warm up: first mounts fill caches and lazy chunks that are meant to stay
  for (let round = 0; round < 3; round += 1) await oneRound(page);
  const before = await heap(cdp);
  const ROUNDS = 12;
  for (let round = 0; round < ROUNDS; round += 1) await oneRound(page);
  const after = await heap(cdp);
  const growth = {
    heapBytesPerRound: Math.round((after.heapBytes - before.heapBytes) / ROUNDS),
    nodes: after.nodes - before.nodes,
    listeners: after.listeners - before.listeners,
  };
  writeFileSync(info.outputPath('s3-0073-07-memory.json'), JSON.stringify({ status: 'lab-one-machine', rounds: ROUNDS, before, after, growth }, null, 2));
  console.log(`S3-MEMORY ${JSON.stringify({ before, after, growth })}`);
  // Something that leaks per mount grows every round; caches and noise do not. The budgets are loose
  // on purpose: a retained Studio, inspector or audio graph is far bigger than these.
  expect(growth.heapBytesPerRound, 'heap kept growing with each round').toBeLessThan(150_000);
  expect(growth.nodes, 'DOM nodes kept growing (detached trees held)').toBeLessThan(500);
  expect(growth.listeners, 'event listeners kept growing').toBeLessThan(50);
});
