import { expect, test, type Page } from '@playwright/test';
import { resetMix, rewriteJson } from '../e2e/helpers';
import { record } from './vbkit';

/** One headed Edge session under real NVDA. Each section starts by focusing a marker button
 * named "VB MARK <section>", so the speech log can be split by section. */
test.use({ headless: false, channel: 'msedge' });

async function mark(page: Page, name: string) {
  await page.evaluate((label) => {
    document.getElementById('vb-mark')?.remove();
    const button = document.createElement('button');
    button.id = 'vb-mark';
    button.setAttribute('aria-label', `VB MARK ${label}`);
    button.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0.01;z-index:99999';
    document.body.prepend(button);
    button.focus();
  }, name);
  await page.waitForTimeout(1500);
}

const pause = (page: Page, ms = 900) => page.waitForTimeout(ms);
async function press(page: Page, key: string, times = 1, ms = 900) {
  for (let index = 0; index < times; index += 1) { await page.keyboard.press(key); await pause(page, ms); }
}

test('NVDA session: inspector, Studio grid and list, requests, Song Details, attention, editor', async ({ page, request }) => {
  test.setTimeout(900_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request, [1, 2, 3, 4]);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.bringToFront();

  // Song Details: open by keyboard, read in order, Escape returns focus
  await page.goto('/library?q=Same');
  await expect(page.getByRole('button', { name: /^Details for Same Name/ }).first()).toBeVisible();
  await mark(page, 'song details');
  await page.getByRole('button', { name: /^Details for Same Name/ }).nth(1).focus();
  await pause(page, 1500);
  await press(page, 'Enter', 1, 2500);
  await press(page, 'Tab', 8);
  await mark(page, 'song details escape');
  await page.getByRole('dialog').first().locator('button, input').first().focus();
  await pause(page);
  await press(page, 'Escape', 1, 2000);

  // Inspector tabs
  await page.goto('/mix/current/edit');
  await expect(page.getByRole('button', { name: 'Change', exact: true }).first()).toBeVisible();
  await mark(page, 'inspector');
  await page.getByRole('button', { name: 'Change', exact: true }).first().focus();
  await pause(page);
  await press(page, 'Enter', 1, 2500);
  await page.getByRole('tab').first().focus();
  await pause(page, 1500);
  await press(page, 'ArrowRight', 4, 1200);
  await press(page, 'Escape', 1, 2000);

  // Editor: move a song by keyboard with the grip, hear the new position
  await mark(page, 'editor reorder');
  const up = page.getByRole('button', { name: 'Move Slow Tide up' });
  await up.focus();
  await pause(page, 1500);
  await press(page, 'Enter', 1, 2500);
  await page.getByRole('button', { name: 'Undo' }).first().focus();
  await press(page, 'Enter', 1, 2000);

  // Studio grid and list editor
  const row = Array.from({ length: 8 }, (_, index) => (index < 4 ? 1 : 0));
  const lanes = { vocals: row, drums: row, bass: row, other: row };
  const shape = { a: lanes, b: lanes };
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: 'vbn-8', cells: 8, seconds: 8, bars: 16, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click();
  await mark(page, 'studio grid');
  await page.locator('.studio-cell').first().focus();
  await pause(page, 1500);
  await press(page, 'ArrowRight', 2, 1200);
  await press(page, 'ArrowDown', 1, 1200);
  await press(page, 'End', 1, 1200);
  await press(page, 'Space', 1, 1500);
  await press(page, 'Space', 1, 1500);
  const modes = page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button');
  const names = await modes.allTextContents();
  const listMode = names.findIndex((name) => !/Detailed grid|Shape/i.test(name));
  if (listMode >= 0) {
    await modes.nth(listMode).click();
    await mark(page, 'studio list');
    await page.locator('.studio input[type="checkbox"]').first().focus();
    await pause(page, 1500);
    await press(page, 'Tab', 3, 1200);
    await press(page, 'Space', 1, 1500);
  }
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // Requests search results
  await page.goto('/listen');
  await expect(page.locator('main#main')).toBeVisible();
  await mark(page, 'requests');
  await page.keyboard.press('r');
  await pause(page, 2500);
  await page.keyboard.type('Same', { delay: 150 });
  await pause(page, 2500);
  await press(page, 'ArrowDown', 2, 1500);
  await press(page, 'Escape', 1, 2000);

  // Workspace attention indicator
  await page.route('**/api/jobs', (route) => route.fulfill({ json: { worker: { running: true, rendering_the_mix: false }, mix: { queued: 0, rendering: 0, failed: 0, none: 0, ready: 3 }, drafts_in_line: 0, storage_full: true, analysis: { running: false, paused: false, asked_for: 0, left: 0 }, failed_seams: [], failed_songs: [{ id: 3, title: 'Synthetic song', artist: null }], estimates: '' } }));
  await page.goto('/library');
  await expect(page.locator('.health-attention')).toBeVisible();
  await mark(page, 'attention');
  await page.locator('.health-attention').focus();
  await pause(page, 2500);
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // Harmonic chord strip: reach the strip's text in browse mode by Tab to the nearest control, then read
  const clip = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/discoveries', (route) => route.fulfill({ json: [{ id: 7, song_a: 3, song_b: 4, title_a: 'Paper Moon', title_b: 'Neon Rain', artist_a: 'Cass Okafor', artist_b: 'Dev Patel', status: 'new', payload: { a_at: 10, b_at: 20, bars: 4, transpose: 0 } }] }));
  await page.route('**/api/discoveries/*/hear', (route) => route.fulfill({ json: { chords: ['C', 'G', 'Am', 'F'], bar_starts: [0, 2, 4, 6], seconds: 8, semitones: 0 } }));
  await page.route('**/api/discoveries/*/hear/*', (route) => route.fulfill({ body: clip, contentType: 'audio/flac' }));
  await page.goto('/discover/harmonic');
  await expect(page.locator('.discovery').first()).toBeVisible();
  await mark(page, 'harmonic');
  const buttons = page.locator('.discovery button');
  await buttons.first().focus();
  await pause(page, 1500);
  await press(page, 'Enter', 1, 3000);
  await press(page, 'Tab', 6, 1200);
  await mark(page, 'end');
  record({ task: 'NVDA', done: true });
});
