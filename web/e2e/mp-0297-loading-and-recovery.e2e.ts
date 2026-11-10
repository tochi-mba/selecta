import { expect, test, type Page, type Route } from '@playwright/test';
import { audioStates, resetMix, spyOnAudio } from './helpers';

/**
 * ADR-0297 skeletons, async feedback, errors and local recovery, measured in Edge against the
 * synthetic library in tests/e2e_server.py with slow or failing answers injected by route. Unit
 * proofs for stale answers and coalesced notices: web/src/state/async.test.tsx,
 * web/src/ui/controls.test.tsx and web/src/ui/toastsCoalesce.test.tsx.
 */

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

/** Holds matching requests until released, so a loading state can be measured. */
function gate(page: Page, pattern: string | RegExp) {
  const held: Route[] = [];
  let open = false;
  const ready = page.route(pattern, (route) => (open ? route.fallback() : void held.push(route)));
  return {
    ready,
    held: () => held.length,
    release: async () => { open = true; for (const route of held.splice(0)) await route.fallback(); },
  };
}

const LIBRARY = /\/api\/library\?/;

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request);
});

test('MP-0297-01 loading placeholders take the real layout’s place, with no made-up music', async ({ page }) => {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const library = gate(page, LIBRARY);
    await library.ready;
    await page.goto('/library');
    const skeleton = page.locator('main .skeleton').first();
    await expect(skeleton).toBeVisible();
    await settle(page);
    const placeholder = await skeleton.evaluate((node) => ({
      box: node.getBoundingClientRect().toJSON(),
      // nothing that could be read as a song: the visible part is shapes only
      text: (node.querySelector('.skeleton-content') as HTMLElement).innerText.trim(),
      hidden: node.querySelector('.skeleton-content')!.getAttribute('aria-hidden'),
      busy: node.getAttribute('aria-busy'),
      units: node.querySelectorAll('.skeleton-unit').length,
    }));
    await library.release();
    await page.unroute(LIBRARY);
    await expect(page.locator('.library-rows li').first()).toBeVisible();
    const loaded = await page.evaluate(() => {
      const rows = document.querySelector('.library-rows')!;
      const first = rows.querySelector('li')!.getBoundingClientRect();
      return { box: rows.getBoundingClientRect().toJSON(), row: first.toJSON() };
    });
    const at = `${width}px`;
    expect(placeholder.text, `${at}: placeholder shows words`).toBe('');
    expect(placeholder.hidden).toBe('true');
    expect(placeholder.busy).toBe('true');
    expect(placeholder.units).toBe(6);
    expect(Math.abs(placeholder.box.left - loaded.box.left), `${at}: left edge`).toBeLessThanOrEqual(1);
    expect(Math.abs(placeholder.box.width - loaded.box.width), `${at}: width`).toBeLessThanOrEqual(1);
    // the placeholder starts within a row's height of where the list starts
    expect(Math.abs(placeholder.box.top - loaded.box.top), `${at}: top`).toBeLessThanOrEqual(loaded.row.height);
  }
});

test('MP-0297-02 a failed or unreachable server never looks like an empty library', async ({ page }) => {
  for (const failure of ['server', 'network'] as const) {
    await page.route(LIBRARY, (route) => (failure === 'server' ? route.fulfill({ status: 500, json: { detail: 'boom' } }) : route.abort('connectionrefused')));
    await page.goto('/library');
    const problem = page.locator('main .problem[role="alert"]');
    await expect(problem).toContainText('Couldn’t load your library. Your songs are fine.');
    await expect(problem.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/No songs|Nothing here|nothing matches|0 songs/i);
    await page.unroute(LIBRARY);
    await problem.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.library-rows li').first()).toBeVisible();
    await expect(problem).toHaveCount(0);
  }
  // the same for Workspace panels
  await page.route('**/api/diagnostics', (route) => route.abort('connectionrefused'));
  await page.goto('/workshop/diagnostics');
  await expect(page.locator('main .problem[role="alert"]')).toContainText('The server isn’t answering');
});

test('MP-0297-03 a refresh keeps selection, focus, the known list and the music', async ({ page }) => {
  await spyOnAudio(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/listen');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'Library' }).first().click();
  await expect(page.locator('.library-rows li').first()).toBeVisible();
  const box = page.locator('.library-rows li input[type="checkbox"]').nth(1);
  await box.check();
  await box.focus();
  const before = await page.evaluate(() => ({ ids: [...document.querySelectorAll('.library-rows li input[type="checkbox"]')].map((node) => node.getAttribute('aria-label')), scroll: scrollY }));
  let refreshes = 0;
  for (const outcome of ['ok', 'failed'] as const) {
    await page.route(LIBRARY, (route) => { refreshes += 1; return outcome === 'ok' ? route.fallback() : route.fulfill({ status: 503, json: { detail: 'busy' } }); });
    // coming back to the tab refreshes what's shown straight away
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => refreshes).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({
      ids: [...document.querySelectorAll('.library-rows li input[type="checkbox"]')].map((node) => node.getAttribute('aria-label')),
      scroll: scrollY,
      focused: document.activeElement?.getAttribute('aria-label') ?? null,
      checked: [...document.querySelectorAll<HTMLInputElement>('.library-rows li input[type="checkbox"]')].filter((node) => node.checked).length,
    }));
    expect(after.ids, `${outcome}: the list changed`).toEqual(before.ids);
    expect(after.scroll, `${outcome}: scrolled`).toBe(before.scroll);
    expect(after.focused, `${outcome}: focus moved`).toBe(before.ids[1]);
    expect(after.checked, `${outcome}: selection lost`).toBe(1);
    await expect(page.locator('main .skeleton')).toHaveCount(0);
    expect(await audioStates(page), `${outcome}: the music stopped`).toEqual(['running']);
    await page.unroute(LIBRARY);
    refreshes = 0;
  }
});

test('MP-0297-04 working labels never change a button’s width or shove its neighbours', async ({ page }) => {
  const measure = (selector: string) => page.locator(selector).evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const next = button.nextElementSibling?.getBoundingClientRect() ?? null;
    return { width: rect.width, left: rect.left, nextLeft: next?.left ?? null, text: button.textContent };
  });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    // Read folder, while the folder is checked
    const check = gate(page, '**/api/folders/check*');
    await check.ready;
    await page.goto('/workshop/sources');
    await page.getByLabel('Music folder').fill('C:\\Synthetic\\Music');
    const read = 'form.sources-add > button';
    const idle = await measure(read);
    await page.locator(read).click();
    await expect(page.getByRole('button', { name: 'Reading…' })).toBeVisible();
    const busy = await measure(read);
    expect(Math.abs(busy.width - idle.width), `${width}px: Read folder width`).toBeLessThanOrEqual(0.5);
    await check.release();
    await page.unroute('**/api/folders/check*');
    // Check now, an Action with a working label
    const recheck = gate(page, '**/api/library/check');
    await recheck.ready;
    await page.goto('/workshop/sources');
    const now = page.getByRole('button', { name: 'Check now' });
    const before = await now.evaluate((button) => ({ width: button.getBoundingClientRect().width, left: button.getBoundingClientRect().left, previous: button.previousElementSibling!.getBoundingClientRect().right }));
    await now.click();
    await expect(page.locator('button[aria-busy="true"]').filter({ hasText: 'Checking…' })).toBeVisible();
    const during = await page.locator('button[aria-busy="true"]').filter({ hasText: 'Checking…' }).evaluate((button) => ({ width: button.getBoundingClientRect().width, left: button.getBoundingClientRect().left, previous: button.previousElementSibling!.getBoundingClientRect().right }));
    expect(Math.abs(during.width - before.width), `${width}px: Check now width`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(during.left - before.left), `${width}px: Check now moved`).toBeLessThanOrEqual(0.5);
    await recheck.release();
    await page.unroute('**/api/library/check');
    // Open study, while the study loads
    const study = gate(page, /\/api\/listening\?/);
    await study.ready;
    await page.goto('/listening');
    for (const [label, value] of [['Study code', 'SYNTH-1'], ['Listener nickname', 'listener-one'], ['Listening setup', 'headphones']]) await page.getByLabel(label).fill(value);
    const open = '.study-setup > button';
    const ready = await measure(open);
    await page.locator(open).click();
    await expect(page.getByRole('button', { name: 'Opening study…' })).toBeVisible();
    const loading = await measure(open);
    expect(Math.abs(loading.width - ready.width), `${width}px: Open study width`).toBeLessThanOrEqual(0.5);
    await study.release();
    await page.unroute(/\/api\/listening\?/);
  }
});

test('MP-0297-05 retry sits beside the failure and keeps the input, the selected transition and the next step', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // the editor's selected transition: its options fail, the same transition stays open with Try again inside it
  let failOptions = true;
  await page.route('**/api/mix/*/options*', (route) => (failOptions ? route.fulfill({ status: 500, json: { detail: 'Options are unavailable right now.' } }) : route.fallback()));
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  const sheet = page.locator('.overlay-sheet .overlay-panel');
  await expect(sheet).toBeVisible();
  const title = await sheet.locator('.overlay-head h2').textContent();
  const identity = await sheet.locator('.inspector-identity').textContent().catch(() => null);
  const problem = sheet.locator('.problem[role="alert"]').first();
  await expect(problem).toContainText('Options are unavailable right now.');
  await expect(problem.getByRole('button', { name: 'Try again' })).toBeVisible();
  failOptions = false;
  await problem.getByRole('button', { name: 'Try again' }).click();
  await expect(sheet.locator('.problem[role="alert"]')).toHaveCount(0);
  await expect(sheet.locator('.overlay-head h2')).toHaveText(title!);
  if (identity) await expect(sheet.locator('.inspector-identity')).toHaveText(identity);
  await page.keyboard.press('Escape');

  // a study answer whose save is uncertain keeps the ratings and offers the same answer again, in place
  const audio = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route(/\/api\/listening\?/, (route) => route.fulfill({ json: [{ id: 'trial-1' }] }));
  await page.route('**/api/listening/*/*/audio', (route) => route.fulfill({ body: audio, contentType: 'audio/flac' }));
  let failSave = true;
  await page.route('**/api/listening/*/response', (route) => (failSave ? route.fulfill({ status: 503, json: { detail: 'busy' } }) : route.fulfill({ json: { ok: true } })));
  await page.goto('/listening');
  for (const [label, value] of [['Study code', 'SYNTH-1'], ['Listener nickname', 'listener-one'], ['Listening setup', 'headphones']]) await page.getByLabel(label).fill(value);
  await page.getByRole('button', { name: 'Open study' }).click();
  await page.getByRole('radio', { name: '3' }).first().check();
  await page.getByRole('button', { name: 'Cannot judge' }).click();
  const alert = page.locator('.study [role="alert"]');
  await expect(alert).toContainText('Retry the same answer');
  const retry = page.getByRole('button', { name: 'Retry the same answer' });
  await expect(retry).toBeVisible();
  await expect(page.getByRole('radio', { name: '3' }).first()).toBeChecked();
  const near = await page.evaluate(() => {
    const message = document.querySelector('.study [role="alert"]')!.getBoundingClientRect();
    const button = [...document.querySelectorAll('.study-choices button')].find((node) => node.textContent === 'Retry the same answer')!.getBoundingClientRect();
    return Math.abs(button.top - message.bottom);
  });
  expect(near, 'Retry is far from its failure').toBeLessThanOrEqual(page.viewportSize()!.height / 2);
  failSave = false;
  await retry.click();
  await expect(page.getByText('All responses saved. Thank you for listening.')).toBeVisible();
});
