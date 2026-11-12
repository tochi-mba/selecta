import { expect, test, type Page } from '@playwright/test';
import { resetMix, rewriteJson } from '../e2e/helpers';
import { record, shot, THEMES, useTheme } from './vbkit';

/** Emulated phones (iPhone 13 on WebKit, Pixel 7 on Chromium, touch): S4-0102-02, S4-0105-01, S4-0110-04, S4-0110-09. */

async function withStudio(page: Page, cells: number) {
  const row = Array.from({ length: cells }, (_, index) => (index < cells / 2 ? 1 : 0));
  const lanes = { vocals: row, drums: row, bass: row, other: row };
  const shape = { a: lanes, b: lanes };
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: `vbp-${cells}`, cells, seconds: 8, bars: cells * 2, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
}

test.beforeEach(async ({ request }) => {
  await resetMix(request, [1, 2, 3, 4]);
});

test('phone: Library cards, Studio grid by touch, reorder without dragging, short landscape', async ({ page }, info) => {
  const device = info.project.name;
  // S4-0105-01 Library card rows in both themes
  for (const theme of THEMES) {
    await useTheme(page, theme);
    await page.goto('/library');
    await expect(page.locator('main#main')).toBeVisible();
    await page.waitForTimeout(1200);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await shot(page, 'S4-0105-01', `library-${device}-${theme}`);
    record({ task: 'S4-0105-01', device, theme, overflow: wide, viewport: page.viewportSize() });
  }

  // S4-0102-02 the full 64-cell grid on a phone: tap toggles the tapped square; the grid scrolls on its own
  await withStudio(page, 64);
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().tap();
  await page.getByRole('tab', { name: 'Studio' }).tap();
  await page.getByRole('button', { name: 'Open the Studio' }).tap();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).tap();
  const grid = page.locator('.studio-grid');
  await expect(grid).toBeVisible();
  const scroller = await grid.evaluate((element) => {
    let node: HTMLElement | null = element as HTMLElement;
    while (node && !(node.scrollWidth > node.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(node).overflowX))) node = node.parentElement;
    if (!node) return null;
    node.dataset.vbScroller = '1';
    return { scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, touchAction: getComputedStyle(node).touchAction, pageOverflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  const cell = page.locator('.studio-cell[data-cell="0-40"]');
  await cell.scrollIntoViewIfNeeded();
  const before = await cell.getAttribute('aria-pressed');
  await cell.tap();
  const after = await cell.getAttribute('aria-pressed');
  const others = await page.locator('.studio-cell[aria-pressed="true"]').count();
  const sticky = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-vb-scroller]');
    const name = document.querySelector('.studio-name, .studio-side-name');
    const ruler = document.querySelector('.studio-ruler');
    if (!scroller || !name) return null;
    const box = scroller.getBoundingClientRect();
    const label = name.getBoundingClientRect();
    return { scrolledTo: scroller.scrollLeft, nameLeft: Math.round(label.left - box.left), nameVisible: label.right > box.left && label.left < box.right, rulerSticky: ruler ? getComputedStyle(ruler).position : null };
  });
  await shot(page, 'S4-0102-02', `studio64-touch-${device}`);
  record({ task: 'S4-0102-02', device, scroller, before, after, onCount: others, sticky });
  await page.keyboard.press('Escape');

  // S4-0110-04 reorder by tapping buttons, no drag
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('/mix/current/edit');
  const rows = page.locator('.song .song-name b');
  await expect(rows.first()).toHaveText('Morning Light');
  const up = page.getByRole('button', { name: 'Move Slow Tide up' });
  const upBox = await up.boundingBox();
  await up.tap();
  await expect(rows.first()).toHaveText('Slow Tide');
  await page.getByRole('button', { name: 'Undo' }).first().tap();
  await expect(rows.first()).toHaveText('Morning Light');
  await shot(page, 'S4-0110-04', `editor-move-buttons-${device}`);
  record({ task: 'S4-0110-04', device, moveButton: upBox, reorderedByTap: true, undoneByTap: true });

  // S4-0110-09 short landscape: the Requests drawer search, its results and Close stay reachable
  const portrait = page.viewportSize()!;
  await page.setViewportSize({ width: portrait.height, height: portrait.width });
  await page.goto('/listen');
  await expect(page.locator('main#main')).toBeVisible();
  await page.waitForTimeout(800);
  await page.keyboard.press('r');
  const drawer = page.getByRole('dialog', { name: 'Requests' });
  await expect(drawer).toBeVisible();
  const box = drawer.getByRole('combobox', { name: 'Request a song' });
  await box.tap();
  await box.fill('Déjà');
  await expect(drawer.getByRole('button', { name: /Déjà Vu/ })).toBeVisible();
  const inView = async (locator: ReturnType<Page['locator']>) => locator.evaluate((element) => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth; });
  const close = drawer.getByRole('button', { name: /^Close/ }).first();
  const facts = { input: await inView(box), result: await inView(drawer.getByRole('button', { name: /Déjà Vu/ }).first()), close: (await close.count()) ? await inView(close) : 'no close button', focused: await box.evaluate((element) => element === document.activeElement) };
  await shot(page, 'S4-0110-09', `requests-landscape-${device}`);
  record({ task: 'S4-0110-09', device, viewport: page.viewportSize(), ...facts });
});
