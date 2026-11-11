import { writeFileSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * MI-0138-08: a press is acknowledged at once even when the server is slow, and the page only says it
 * worked once the server has said so. Each answer is held back for DELAY ms by the test (or held back and
 * then refused), and the page itself times the gap from the press (the click event's own timestamp) to
 * the first animation frame in which the acknowledgement is in the document. That is a timed interaction
 * test only: how confident people feel (the 1-5 task confidence rating) needs real people.
 */
const DELAY = 2000;
const BUDGET = 100;
const REFUSED = 'The test server held this back and then said no.';

type Reading = { action: string; outcome: 'answered' | 'refused'; frame: number; dom: number };
let readings: Reading[] = [];

declare global {
  interface Window {
    ackProbe: { start: number; seen: number; frame: number };
  }
}

/** Hold back the next matching request for DELAY ms, then let it through or refuse it. */
async function holdBack(page: Page, url: string | RegExp, method: string, outcome: Reading['outcome']) {
  const held = { count: 0, answered: false };
  await page.route(url, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    held.count += 1;
    await new Promise((resolve) => setTimeout(resolve, DELAY));
    held.answered = true;
    if (outcome === 'refused') await route.fulfill({ status: 500, json: { detail: REFUSED } });
    else await route.continue();
  });
  return held;
}

/** Start timing at the next press, and stop at the first frame where `selector` (holding `text`) is
 * in the document. It must not be there before the press, or the reading would mean nothing. */
async function arm(page: Page, selector: string, text = '') {
  const already = await page.evaluate(({ selector, text }) => {
    const matches = () => [...document.querySelectorAll(selector)].some((element) => !text || (element.textContent ?? '').includes(text));
    const probe = { start: 0, seen: 0, frame: 0 };
    window.ackProbe = probe;
    const begin = (event: Event) => { if (!probe.start) probe.start = event.timeStamp; };
    document.addEventListener('click', begin, true);
    document.addEventListener('submit', begin, true);
    const observer = new MutationObserver(() => {
      if (!probe.start || probe.seen || !matches()) return;
      probe.seen = performance.now();
      observer.disconnect();
      requestAnimationFrame(() => { probe.frame = performance.now(); });
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    return matches();
  }, { selector, text });
  expect(already, `${selector} was showing before the press`).toBe(false);
}

/** How long the acknowledgement took, and that it fits the budget. */
async function acknowledged(page: Page, action: string, outcome: Reading['outcome']) {
  await expect.poll(() => page.evaluate(() => window.ackProbe.frame), { message: `${action}: no acknowledgement`, timeout: DELAY / 2 }).toBeGreaterThan(0);
  const reading = await page.evaluate(() => ({ frame: window.ackProbe.frame - window.ackProbe.start, dom: window.ackProbe.seen - window.ackProbe.start }));
  readings.push({ action, outcome, ...reading });
  expect(reading.frame, `${action}: acknowledged after ${Math.round(reading.frame)} ms`).toBeLessThanOrEqual(BUDGET);
}

const rows = (page: Page) => page.locator('.song .song-name b');
const order = (page: Page) => rows(page).allTextContents();
const problemToast = (page: Page) => page.locator('.toast-row.problem').filter({ hasText: REFUSED });

test.beforeEach(async ({ page, request }) => {
  readings = [];
  await resetMix(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.afterEach(async ({}, info) => {
  writeFileSync(info.outputPath('mi-0138-08-reading.json'), JSON.stringify({ delay: DELAY, budget: BUDGET, readings }, null, 2));
});

for (const outcome of ['answered', 'refused'] as const) {
  test(`MI-0138-08 Play on a mix idea says Building at once and only plays once the mix is made (${outcome})`, async ({ page, request }) => {
    await page.goto('/mixes');
    const play = page.locator('.hero button.primary');
    await expect(play).toBeEnabled();
    const songsOf = async () => ((await (await request.get('/api/mix')).json()).mix as { song_id: number }[]).map((item) => item.song_id);
    const before = await songsOf();
    const held = await holdBack(page, '**/api/vibes/*/build*', 'POST', outcome);
    await arm(page, '.hero button.primary[aria-busy="true"]');
    await play.click();
    await acknowledged(page, 'Play a mix idea', outcome);
    await play.click({ force: true }).catch(() => {});
    // waiting is not success: still here, nothing playing
    expect(held.answered).toBe(false);
    await expect(page).toHaveURL(/\/mixes$/);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
    if (outcome === 'answered') {
      await expect(page).toHaveURL(/\/listen$/, { timeout: 30_000 });
    } else {
      await expect(page.getByRole('alert').filter({ hasText: REFUSED })).toBeVisible({ timeout: DELAY * 3 });
      await expect(play).not.toHaveAttribute('aria-busy', 'true');
      await expect(page).toHaveURL(/\/mixes$/);
      expect(await songsOf()).toEqual(before);
    }
    expect(held.count, 'a second press made a second mix').toBe(1);
  });

  test(`MI-0138-08 Replace and play, with music playing, is acknowledged once the dialog closes (${outcome})`, async ({ page }) => {
    await page.goto('/listen');
    const transport = page.locator('.now .transport .primary');
    await transport.click();
    await expect(transport).toHaveText('Pause', { timeout: 30_000 });
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Make a Mix', exact: true }).click();
    const play = page.locator('.hero button.primary');
    await play.click();
    const dialog = page.getByRole('dialog', { name: /^Replace / });
    await expect(dialog).toBeVisible();
    const held = await holdBack(page, '**/api/vibes/*/build*', 'POST', outcome);
    await arm(page, '.hero button.primary[aria-busy="true"]');
    await dialog.getByRole('button', { name: 'Replace and play' }).click();
    await acknowledged(page, 'Replace and play', outcome);
    expect(held.answered).toBe(false);
    await expect(page).toHaveURL(/\/mixes$/);
    if (outcome === 'answered') {
      await expect(page).toHaveURL(/\/listen$/, { timeout: 30_000 });
    } else {
      await expect(page.getByRole('alert').filter({ hasText: REFUSED })).toBeVisible({ timeout: DELAY * 3 });
      await expect(play).not.toHaveAttribute('aria-busy', 'true');
    }
  });

  test(`MI-0138-08 moving a song in the editor is acknowledged on the button and settles to the server's order (${outcome})`, async ({ page }) => {
    await page.goto('/mix/current/edit');
    await expect(rows(page).first()).toHaveText('Morning Light');
    const before = await order(page);
    const held = await holdBack(page, '**/api/mix/move*', 'POST', outcome);
    await arm(page, '[aria-label="Move Slow Tide up"][aria-busy="true"]');
    await page.getByRole('button', { name: 'Move Slow Tide up' }).click();
    await acknowledged(page, 'Move a song up', outcome);
    expect(held.answered).toBe(false);
    await expect(page.locator('.toast-row').filter({ hasText: 'Moved Slow Tide up.' })).toHaveCount(0);
    if (outcome === 'answered') {
      await expect(rows(page).first()).toHaveText('Slow Tide', { timeout: DELAY * 3 });
      await expect(page.locator('.toast-row').filter({ hasText: 'Moved Slow Tide up.' })).toBeVisible();
    } else {
      await expect(problemToast(page)).toBeVisible({ timeout: DELAY * 3 });
      expect(await order(page)).toEqual(before);
    }
    await expect(page.locator('[aria-label="Move Slow Tide up"]')).not.toHaveAttribute('aria-busy', 'true');
  });

  test(`MI-0138-08 removing a song in the editor marks its row at once and only takes it away when the server has (${outcome})`, async ({ page }) => {
    await page.goto('/mix/current/edit');
    const row = page.locator('.song').filter({ has: page.locator('.song-name b', { hasText: 'Paper Moon' }) });
    await expect(row).toHaveCount(1);
    await page.getByRole('button', { name: 'More for Paper Moon' }).click();
    const held = await holdBack(page, /\/api\/mix\/songs\/\d+/, 'DELETE', outcome);
    await arm(page, '.song[aria-busy="true"]', 'Paper Moon');
    await page.getByRole('menuitem', { name: 'Remove Paper Moon' }).click();
    await acknowledged(page, 'Remove a song', outcome);
    expect(held.answered).toBe(false);
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('status')).toHaveText('Removing…');
    if (outcome === 'answered') {
      await expect(row).toHaveCount(0, { timeout: DELAY * 3 });
    } else {
      await expect(problemToast(page)).toBeVisible({ timeout: DELAY * 3 });
      await expect(row).toHaveCount(1);
      await expect(row).not.toHaveAttribute('aria-busy', 'true');
      await expect(row.getByRole('status')).toHaveCount(0);
    }
  });

  test(`MI-0138-08 adding a song in the editor marks the choice at once and adds it only when the server has (${outcome})`, async ({ page }) => {
    await page.goto('/mix/current/edit');
    await expect(rows(page)).toHaveCount(4);
    await page.getByRole('button', { name: 'Add a song after Neon Rain' }).click();
    const choice = page.locator('.adder .suggestion:not([disabled])').first();
    await expect(choice).toBeVisible();
    const title = (await choice.locator('b').textContent()) ?? '';
    const held = await holdBack(page, /\/api\/mix\/songs(\?.*)?$/, 'POST', outcome);
    await arm(page, '.adder .suggestion[aria-busy="true"]', title);
    await choice.click();
    await acknowledged(page, 'Add a song', outcome);
    await choice.click({ force: true }).catch(() => {});
    expect(held.answered).toBe(false);
    await expect(page.locator('.adder [role="status"]')).toContainText(`Adding ${title}`);
    await expect(rows(page)).toHaveCount(4);
    if (outcome === 'answered') {
      await expect(rows(page)).toHaveCount(5, { timeout: DELAY * 3 });
      await expect(page.locator('.adder')).toHaveCount(0);
    } else {
      await expect(page.getByRole('alert').filter({ hasText: REFUSED })).toBeVisible({ timeout: DELAY * 3 });
      await expect(rows(page)).toHaveCount(4);
      await expect(page.locator('.adder .suggestion[aria-busy="true"]')).toHaveCount(0);
    }
    expect(held.count, 'a second press added it twice').toBe(1);
  });

  test(`MI-0138-08 saving the current mix as a draft says Saving at once and names the draft only once it exists (${outcome})`, async ({ page }) => {
    await page.goto('/mixes/mine');
    const save = page.getByRole('button', { name: 'Save current mix as a draft' });
    await expect(save).toBeEnabled();
    const held = await holdBack(page, /\/api\/drafts$/, 'POST', outcome);
    await arm(page, '.drafts-head button[aria-busy="true"]', 'Saving…');
    await save.click();
    await acknowledged(page, 'Save current mix as a draft', outcome);
    expect(held.answered).toBe(false);
    await expect(page.locator('.toast-row').filter({ hasText: 'Saved a copy of your current mix' })).toHaveCount(0);
    if (outcome === 'answered') {
      await expect(page.locator('.toast-row').filter({ hasText: 'Saved a copy of your current mix' })).toBeVisible({ timeout: DELAY * 3 });
    } else {
      await expect(problemToast(page)).toBeVisible({ timeout: DELAY * 3 });
    }
    await expect(save).not.toHaveAttribute('aria-busy', 'true');
  });

  test(`MI-0138-08 Save a copy in the editor says Saving at once and closes only once the draft exists (${outcome})`, async ({ page }) => {
    await page.goto('/mix/current/edit');
    await page.getByRole('button', { name: 'Save a copy' }).click();
    await page.getByRole('textbox', { name: 'Name this mix' }).fill(`Slow server ${outcome}`);
    const held = await holdBack(page, /\/api\/drafts$/, 'POST', outcome);
    await arm(page, 'form button.primary[aria-busy="true"]', 'Saving…');
    await page.getByRole('button', { name: 'Save copy' }).click();
    await acknowledged(page, 'Save a copy as a draft', outcome);
    expect(held.answered).toBe(false);
    await expect(page.getByRole('textbox', { name: 'Name this mix' })).toBeVisible();
    if (outcome === 'answered') {
      await expect(page.locator('.toast-row').filter({ hasText: `Saved a copy as a draft: Slow server ${outcome}` })).toBeVisible({ timeout: DELAY * 3 });
      await expect(page.getByRole('textbox', { name: 'Name this mix' })).toHaveCount(0);
    } else {
      await expect(page.getByRole('alert').filter({ hasText: REFUSED })).toBeVisible({ timeout: DELAY * 3 });
      await expect(page.getByRole('textbox', { name: 'Name this mix' })).toHaveValue(`Slow server ${outcome}`);
      await expect(page.locator('form button.primary')).not.toHaveAttribute('aria-busy', 'true');
    }
    expect(held.count).toBe(1);
  });

  test(`MI-0138-08 sending a song request shows it as Adding at once and settles to the server's answer (${outcome})`, async ({ page }) => {
    await page.goto('/listen');
    await page.getByRole('button', { name: /^Requests/ }).first().click();
    const drawer = page.getByRole('dialog', { name: 'Requests' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('combobox', { name: 'Request a song' }).fill('Déjà');
    const option = drawer.getByRole('button', { name: /^Déjà Vu - Zoë Müller - Request$/ });
    await expect(option).toBeVisible();
    const held = await holdBack(page, /\/api\/requests$/, 'POST', outcome);
    await arm(page, '.request-row[data-stage="adding"]', 'Déjà Vu');
    await option.click();
    await acknowledged(page, 'Send a song request', outcome);
    expect(held.answered).toBe(false);
    const row = drawer.locator('.request-row').filter({ hasText: 'Déjà Vu' });
    await expect(row).toContainText('Adding');
    if (outcome === 'answered') {
      await expect(row).not.toHaveAttribute('data-stage', 'adding', { timeout: DELAY * 3 });
      await expect(row).toHaveCount(1);
      await drawer.getByRole('button', { name: 'Cancel request for Déjà Vu' }).click();
      await expect(row).toHaveCount(0);
    } else {
      await expect(drawer.getByRole('alert').filter({ hasText: REFUSED })).toBeVisible({ timeout: DELAY * 3 });
      await expect(row).toHaveCount(0);
    }
  });
}

test('MI-0138-08 starting an export says Starting at once and reports a refusal instead of a file', async ({ page }) => {
  // The server is shared by the whole shard, so an earlier spec (flows: "a real FLAC") can leave a
  // ready file of this very mix, and then the dialog rightly offers that download, not Save it.
  // This measures a fresh start, so the job list it reads is empty.
  await page.route(/\/api\/exports\/jobs(\?.*)?$/, (route) => route.request().method() === 'GET' ? route.fulfill({ json: { jobs: [] } }) : route.fallback());
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Download audio' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as an audio file' });
  await expect(dialog).toBeVisible();
  const save = dialog.getByRole('button', { name: 'Save it' });
  await expect(save).toBeEnabled();
  // only the refusal: a real export would render and encode the whole mix, which isn't what this measures
  const held = await holdBack(page, /\/api\/exports\/jobs(\?.*)?$/, 'POST', 'refused');
  await arm(page, '.overlay button.primary[aria-busy="true"]', 'Starting export…');
  await save.click();
  await acknowledged(page, 'Start an export', 'refused');
  expect(held.answered).toBe(false);
  await expect(dialog.getByRole('alert').filter({ hasText: REFUSED })).toBeVisible({ timeout: DELAY * 3 });
  await expect(dialog.getByRole('link', { name: /^download / })).toHaveCount(0);
  await expect(save).not.toHaveAttribute('aria-busy', 'true');
});
