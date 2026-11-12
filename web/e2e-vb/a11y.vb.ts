import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { resetMix, rewriteJson } from '../e2e/helpers';
import { OUT, record, shot } from './vbkit';

/** Accessibility-tree, focus, live-region and axe checks (the machine half of the screen-reader sitting). */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function save(task: string, name: string, text: string) {
  mkdirSync(join(OUT, task), { recursive: true });
  writeFileSync(join(OUT, task, `${name}.txt`), text);
}

async function axe(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  if (include) builder.include(include);
  const result = await builder.analyze();
  return result.violations.flatMap((problem) => problem.nodes.map((node) => `${problem.id}: ${String(node.target)}`));
}

const spoken = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"], [role="status"], [role="alert"]')]
  .map((node) => (node.textContent ?? '').trim()).filter(Boolean));

async function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return 'body';
    return `${element.getAttribute('role') ?? element.tagName.toLowerCase()} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)}"`;
  });
}

async function withStudio(page: Page, cells: number) {
  const row = Array.from({ length: cells }, (_, index) => (index < cells / 2 ? 1 : 0));
  const lanes = { vocals: row, drums: row, bass: row, other: row };
  const shape = { a: lanes, b: lanes };
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: `vba-${cells}`, cells, seconds: 8, bars: cells * 2, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
}

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request, [1, 2, 3, 4]);
});

test('inspector, Studio grid and list editor: names, roles, focus and axe', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await withStudio(page, 8);
  await page.goto('/mix/current/edit');
  const change = page.getByRole('button', { name: 'Change', exact: true }).first();
  await change.focus();
  await page.keyboard.press('Enter');
  const tabs = page.getByRole('tablist').first();
  await expect(tabs).toBeVisible();
  save('S4-0101-09', 'aria-inspector', await page.locator('[role="dialog"], .inspector, aside').filter({ has: tabs }).first().ariaSnapshot());
  const tabWalk: string[] = [await focused(page)];
  await page.getByRole('tab').first().focus();
  for (let index = 0; index < 4; index += 1) { await page.keyboard.press('ArrowRight'); tabWalk.push(await focused(page)); }
  const inspectorAxe = await axe(page);
  await page.keyboard.press('Escape');
  const returned = await focused(page);
  record({ task: 'S4-0101-09', tabWalk, inspectorAxe, focusAfterEscape: returned });

  // Studio grid
  await change.click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click();
  const grid = page.locator('.studio-grid');
  save('S4-0102-01', 'aria-studio-grid', await grid.ariaSnapshot());
  await page.locator('.studio-cell').first().focus();
  const walk: string[] = [await focused(page)];
  for (const key of ['ArrowRight', 'ArrowDown', 'End', 'Control+Home', 'Space']) { await page.keyboard.press(key); walk.push(`${key} -> ${await focused(page)}`); }
  const tabStops = await grid.evaluate((element) => element.querySelectorAll('[tabindex="0"]').length);
  const gridAxe = await axe(page, '.studio');
  record({ task: 'S4-0102-01', walk, tabStops, gridAxe, live: await spoken(page) });
  await shot(page, 'S4-0102-01', 'studio-grid-focus-1440-light', page.locator('.studio'));

  // list editor (non-spatial)
  const list = page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button').filter({ hasText: /list|Checkboxes|Lanes/i });
  if (await list.count()) {
    await list.first().click();
    save('S4-0102-10', 'aria-studio-list', await page.locator('.studio').ariaSnapshot());
    const boxes = await page.locator('.studio input[type="checkbox"]').count();
    const unnamed = await page.locator('.studio input[type="checkbox"]').evaluateAll((inputs) => inputs.filter((input) => !(input as HTMLInputElement).labels?.length && !input.getAttribute('aria-label')).length);
    await page.locator('.studio input[type="checkbox"]').first().focus();
    await page.keyboard.press('Space');
    record({ task: 'S4-0102-10', boxes, unnamed, listAxe: await axe(page, '.studio'), modes: await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button').allTextContents() });
  } else {
    record({ task: 'S4-0102-10', modes: await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button').allTextContents() });
  }
});

async function songs(request: APIRequestContext) {
  const all = (await (await request.get('/api/songs?q=&state=all&limit=40')).json()) as { id: number; title: string; artist: string }[];
  return all.filter((song) => song.title && song.artist).sort((one, other) => one.id - other.id);
}

test('Requests: result names and 55 requests with approvals buried in the middle and end', async ({ page, request }) => {
  const all = await songs(request);
  const first = all[0];
  const rows = Array.from({ length: 55 }, (_, index) => {
    const song = all[index % all.length];
    const approve = index === 30 || index === 54;
    return { id: 1000 + index, song_id: song.id, title: `${song.title} (${index + 1})`, artist: song.artist, status: 'pending', available: 1,
      stage: approve ? 'approve' : 'waiting', needs_approval: approve, bridge_choice: null, after: first.title, after_id: first.id,
      route: approve ? [{ id: all[1].id, title: all[1].title, artist: all[1].artist }, { id: song.id, title: song.title, artist: song.artist }] : undefined,
      transitions: approve ? [{ from: first.title, to: all[1].title, key: `k${index}a`, status: 'waiting' }, { from: all[1].title, to: song.title, key: `k${index}b`, status: 'waiting' }] : undefined };
  });
  await page.route('**/api/requests', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { requests: rows } }) : route.fallback()));
  await page.route('**/api/requests/consider', (route) => route.fulfill({ json: { requests: rows } }));
  for (const [width, height] of [[1440, 900], [375, 812]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/listen');
    const play = page.locator('.now .transport .primary');
    await play.click();
    await expect(play).toHaveText('Pause', { timeout: 30_000 });
    const opener = page.getByRole('button', { name: /^Requests/ }).first();
    await opener.click();
    const drawer = page.getByRole('dialog', { name: 'Requests' });
    await expect(drawer).toBeVisible();
    const groups = await drawer.locator('.request-group h3').allTextContents();
    const firstGroupStages = await drawer.locator('.request-group').first().locator('.request-row').evaluateAll((items) => items.map((item) => item.getAttribute('data-stage')));
    // keyboard: how many Tab presses from the search box to the first approval action
    const search = drawer.getByRole('combobox', { name: 'Request a song' });
    await search.focus();
    let reached = -1;
    const stops: string[] = [];
    for (let tab = 1; tab <= 40; tab += 1) {
      await page.keyboard.press('Tab');
      const now = await page.evaluate(() => { const element = document.activeElement as HTMLElement; return { inRow: element.closest('.request-row')?.getAttribute('data-stage') ?? null, inDialog: !!element.closest('[role="dialog"]'), visible: (() => { const box = element.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight && box.width > 0; })() }; });
      stops.push(`${await focused(page)} [${now.inRow ?? '-'}${now.inDialog ? '' : ' OUTSIDE'}${now.visible ? '' : ' HIDDEN'}]`);
      if (reached < 0 && now.inRow === 'approve') reached = tab;
    }
    const shotPath = await shot(page, 'S4-0103-03', `requests-55-${width}`);
    // search results: names and roles
    await search.fill('Same');
    await expect(drawer.getByRole('button', { name: /Same Name/ }).first()).toBeVisible();
    const results = await drawer.getByRole('button', { name: /Same Name/ }).evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim()));
    if (width === 1440) save('S4-0103-01', 'aria-request-results', await drawer.ariaSnapshot());
    const resultsAxe = await axe(page, '[role="dialog"]');
    await page.keyboard.press('Escape');
    record({ task: 'S4-0103-03', width, groups, firstGroupStages, tabsToFirstApproval: reached, stops, shotPath, focusAfterClose: await focused(page) });
    record({ task: 'S4-0103-01', width, results, resultsAxe });
  }
});

test('Song Details: reading order, Escape, Back and Forward keep the Library context', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/library?q=Same');
  const open = page.getByRole('button', { name: /^Details for Same Name/ }).nth(1);
  await expect(open).toBeVisible();
  const which = await open.getAttribute('aria-label');
  await open.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog').first();
  await expect(dialog).toBeVisible();
  const urlOpen = page.url();
  save('S4-0106-01', 'aria-song-details', await dialog.ariaSnapshot());
  const headings = await dialog.locator('h1, h2, h3, h4').allTextContents();
  const detailsAxe = await axe(page, '[role="dialog"]');
  await shot(page, 'S4-0106-01', 'song-details-1440-light', dialog);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const afterEscape = { url: page.url(), focus: await focused(page), sameButton: await open.evaluate((element) => element === document.activeElement) };
  // Back from an open Song Details, then Forward
  await open.click();
  await expect(page.getByRole('dialog').first()).toBeVisible();
  await page.goBack();
  await page.waitForTimeout(800);
  const afterBack = { url: page.url(), dialogs: await page.getByRole('dialog').count(), search: await page.getByRole('searchbox').first().inputValue().catch(() => null), focus: await focused(page) };
  await page.goForward();
  await page.waitForTimeout(800);
  const afterForward = { url: page.url(), dialogs: await page.getByRole('dialog').count(), heading: await page.getByRole('dialog').first().locator('h2, h3').first().textContent().catch(() => null) };
  record({ task: 'S4-0106-07', which, urlOpen, afterEscape, afterBack, afterForward });
  record({ task: 'S4-0106-01', headings, detailsAxe });
});

test('health attention outside Workspace: desktop indicator and mobile More', async ({ page }) => {
  const JOBS = { worker: { running: true, rendering_the_mix: false }, mix: { queued: 0, rendering: 0, failed: 1, none: 0, ready: 2 }, drafts_in_line: 0, storage_full: true,
    analysis: { running: false, paused: false, asked_for: 0, left: 0 }, failed_seams: [{ position: 2, from: 'Slow Tide', to: 'Paper Moon' }], failed_songs: [{ id: 3, title: 'Synthetic song', artist: null }], estimates: '' };
  await page.route('**/api/jobs', (route) => route.fulfill({ json: JOBS }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/library');
  const indicator = page.locator('.health-attention');
  await expect(indicator).toBeVisible();
  const desktop = { label: await indicator.getAttribute('aria-label'), href: await indicator.getAttribute('href'), live: await spoken(page) };
  await shot(page, 'S4-0107-08', 'attention-desktop-1440', page.locator('header, .topbar, .shell-top').first());
  await indicator.click();
  await expect(page).toHaveURL(/\/workshop/);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/library');
  const more = page.locator('.nav-more-mobile');
  await expect(more).toBeVisible();
  const mobile = { description: await more.getAttribute('aria-description'), dot: await page.locator('.nav-attention').count(), indicatorVisible: await indicator.isVisible() };
  await shot(page, 'S4-0107-08', 'attention-mobile-375');
  await more.click();
  const sheet = page.getByRole('dialog').first();
  await expect(sheet).toBeVisible();
  save('S4-0107-08', 'aria-mobile-more', await sheet.ariaSnapshot());
  await shot(page, 'S4-0107-08', 'attention-mobile-more-open-375');
  record({ task: 'S4-0107-08', desktop, mobile, moreAxe: await axe(page, '[role="dialog"]') });
});

test('chord strip text, shortcuts preference, and axe with overlays open', async ({ page }) => {
  const clip = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/discoveries', (route) => route.fulfill({ json: [{ id: 7, song_a: 3, song_b: 4, title_a: 'Paper Moon', title_b: 'Neon Rain', artist_a: 'Cass Okafor', artist_b: 'Dev Patel', status: 'new', payload: { a_at: 10, b_at: 20, bars: 4, transpose: 0 } }] }));
  await page.route('**/api/discoveries/*/hear', (route) => route.fulfill({ json: { chords: ['C', 'G', 'Am', 'F'], bar_starts: [0, 2, 4, 6], seconds: 8, semitones: 0 } }));
  await page.route('**/api/discoveries/*/hear/*', (route) => route.fulfill({ body: clip, contentType: 'audio/flac' }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/discover/harmonic');
  await expect(page.locator('.discovery').first()).toBeVisible();
  const play = page.locator('.discovery').getByRole('button').filter({ hasText: /Play|Hear/ }).first();
  if (await play.count()) await play.click();
  await page.waitForTimeout(1500);
  const strip = page.locator('.chord-strip').first();
  const chord = (await strip.count()) ? { label: await strip.getAttribute('aria-label'), text: (await strip.textContent())?.replace(/\s+/g, ' '), position: await page.locator('.chord-position').first().textContent().catch(() => null) } : null;
  save('S4-0104-06', 'aria-harmonic', await page.locator('main#main').ariaSnapshot());
  await shot(page, 'S4-0104-06', 'chord-strip-1440-light', page.locator('.discovery').first());
  record({ task: 'S4-0104-06', chord, axe: await axe(page, 'main#main') });

  // S4-0110-03 single-key shortcuts: on, typing in a field never triggers them; off, the key does nothing
  await page.goto('/workshop');
  const toggle = page.getByRole('checkbox', { name: /single-key|Single-key|one-key/i }).first();
  const facts: Record<string, unknown> = { toggleFound: await toggle.count() };
  await page.goto('/listen');
  await page.keyboard.press('r');
  facts.rOpensRequests = await page.getByRole('dialog', { name: 'Requests' }).isVisible();
  await page.keyboard.press('Escape');
  if (facts.toggleFound) {
    await page.goto('/workshop');
    if (await toggle.isChecked()) await toggle.uncheck();
    await page.goto('/listen');
    await page.keyboard.press('r');
    facts.rWhenOff = await page.getByRole('dialog', { name: 'Requests' }).isVisible();
    await page.goto('/workshop');
    await toggle.check();
  }
  record({ task: 'S4-0110-03', ...facts });

  // S4-0110-05 axe with each overlay open
  const overlays: Record<string, string[]> = {};
  await page.goto('/listen');
  await page.keyboard.press('Control+k');
  if (await page.getByRole('dialog').count()) overlays.palette = await axe(page, '[role="dialog"]');
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  if (await page.getByRole('dialog').count()) overlays.requests = await axe(page, '[role="dialog"]');
  await page.keyboard.press('Escape');
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  overlays.inspector = await axe(page);
  record({ task: 'S4-0110-05', overlays });
});
