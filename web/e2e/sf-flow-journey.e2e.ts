import { expect, test, type Page } from '@playwright/test';
import { resetMix, rewriteJson } from './helpers';

/**
 * Selecta / Flow journey checks that no other spec covers:
 * SF-0242-06 compact labels keep their meaning and accessible names at 320px, and
 * SF-0246-04 unapplied Studio cells survive leaving for another page and coming back.
 * The e2e server never splits stems, so the Studio session is served here from a synthetic song,
 * as mp-0289-stem-studio.e2e.ts does.
 */

type Lanes = { vocals: number[]; drums: number[]; bass: number[]; other: number[] };

async function withStudio(page: Page) {
  const row = [1, 1, 1, 1, 0, 0, 0, 0];
  const lanes: Lanes = { vocals: row, drums: row, bass: row, other: row };
  const shape = { a: lanes, b: lanes };
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: 'sf0246-8', cells: 8, seconds: 8, bars: 16, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
}

async function openStudioHere(page: Page) {
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click();
  await expect(page.locator('.studio-grid')).toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request, [1, 2, 3]);
});

/** Every visible control's accessible name, as a screen reader would get it. */
async function controlNames(page: Page) {
  return page.evaluate(() => {
    const visible = (node: Element) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && !node.closest('[aria-hidden="true"], [inert]');
    };
    const nameOf = (node: Element) => {
      const labelled = node.getAttribute('aria-labelledby');
      const fromIds = labelled ? labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : '';
      const labels = (node as HTMLInputElement).labels ? [...(node as HTMLInputElement).labels!].map((label) => label.textContent ?? '').join(' ') : '';
      return (node.getAttribute('aria-label') || fromIds || labels || (node as HTMLElement).innerText || node.getAttribute('title') || node.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim();
    };
    return [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=link]')]
      .filter(visible)
      .map((node) => ({ name: nameOf(node), tag: node.tagName.toLowerCase(), cls: (node as HTMLElement).className.toString().slice(0, 40), nav: !!node.closest('nav') }));
  });
}

test('SF-0242-06 at 320px every control keeps an accessible name, and the main navigation means the same as on a wide screen', async ({ page }) => {
  for (const path of ['/listen', '/mixes', '/mixes/mine', '/library', '/mix/current/edit', '/workshop']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const wide = await controlNames(page);
    await page.setViewportSize({ width: 320, height: 720 });
    await page.waitForTimeout(300);
    const narrow = await controlNames(page);
    const unnamed = narrow.filter((control) => control.name === '');
    expect(unnamed, `${path}: controls with no accessible name at 320px`).toEqual([]);
    // the main destinations are all still there by the same names, whatever shape the navigation takes
    const destinations = ['Listen', 'Make a Mix', 'My Mixes', 'Library', 'Workspace'];
    const namesAt = (controls: typeof wide) => destinations.filter((label) => controls.some((control) => control.nav && control.name.includes(label)));
    expect(namesAt(narrow), `${path}: destinations at 320px`).toEqual(namesAt(wide));
  }
});

test('SF-0246-04 unapplied Studio cells survive going to another page and coming back', async ({ page }) => {
  await withStudio(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/mix/current/edit');
  await openStudioHere(page);
  const pair = await page.locator('.studio-pair p b').allTextContents();
  const cell = page.locator('.studio-cell[data-cell="0-7"]');
  await expect(cell).toHaveAttribute('aria-pressed', 'false');
  await cell.click();
  await expect(cell).toHaveAttribute('aria-pressed', 'true');

  // an intentional route change through the app's own navigation, then the browser's Back
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Library/ }).first().click();
  await expect(page).toHaveURL(/\/library/);
  await expect(page.locator('.studio')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/mix\/current\/edit/);
  await openStudioHere(page);
  await expect(page.locator('.studio-pair p b')).toHaveText(pair);
  await expect(page.locator('.studio-states > div').filter({ hasText: 'Recovered from this browser' }).locator('dd')).toHaveText('Yes, your earlier work');
  await expect(page.locator('.studio-cell[data-cell="0-7"]')).toHaveAttribute('aria-pressed', 'true');

  // and a full reload of a different page first: still there, still not applied
  await page.goto('/listen');
  await page.goto('/mix/current/edit');
  await openStudioHere(page);
  await expect(page.locator('.studio-cell[data-cell="0-7"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Apply to this transition' })).toBeEnabled();
});
