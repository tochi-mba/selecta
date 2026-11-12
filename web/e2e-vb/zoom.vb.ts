import { expect, test, type Page } from '@playwright/test';
import { PAGES, resetMix, rewriteJson } from '../e2e/helpers';
import { record, shot, THEMES, useTheme } from './vbkit';

/** Zoom and reflow in Edge: 1280x800 at 200% is a 640x400 CSS viewport, at 400% a 320x200 one. */
const ZOOMS = [{ zoom: 200, width: 640, height: 400 }, { zoom: 400, width: 320, height: 200 }];

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request, [1, 2, 3, 4]);
});

async function overflow(page: Page) {
  return page.evaluate(() => {
    const extra = document.documentElement.scrollWidth - window.innerWidth;
    const hidden = [...document.querySelectorAll<HTMLElement>('main button, main a[href], main input, nav a[href], nav button')]
      .filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1); })
      .slice(0, 5).map((element) => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40));
    return { extra, offscreenControls: hidden };
  });
}

test('S4-0110-06 every page at 200% and 400% zoom reflows with no two-way scroll', async ({ page }) => {
  for (const { zoom, width, height } of ZOOMS) {
    await page.setViewportSize({ width, height });
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator('main#main')).toBeVisible();
      await page.waitForTimeout(600);
      const facts = await overflow(page);
      // keyboard: Tab 12 times; focus never lands somewhere off screen that the page doesn't scroll to
      const lost: string[] = [];
      for (let tab = 0; tab < 12; tab += 1) {
        await page.keyboard.press('Tab');
        const where = await page.evaluate(() => { const element = document.activeElement as HTMLElement; const box = element.getBoundingClientRect(); return { ok: element === document.body || (box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth), name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 30) }; });
        if (!where.ok) lost.push(where.name);
      }
      const slug = path.replace(/\W+/g, '-').replace(/^-|-$/g, '');
      if (['/listen', '/library', '/mix/current/edit', '/workshop'].includes(path)) await shot(page, 'S4-0110-06', `zoom${zoom}-${slug}`);
      record({ task: 'S4-0110-06', zoom, path, ...facts, focusOffscreen: lost });
    }
  }
});

test('S4-0102-03 Studio labels and ruler stay put while the 64-cell grid scrolls, at 200% and 400%', async ({ page }) => {
  const row = Array.from({ length: 64 }, (_, index) => (index < 32 ? 1 : 0));
  const lanes = { vocals: row, drums: row, bass: row, other: row };
  const shape = { a: lanes, b: lanes };
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: 'vbz-64', cells: 64, seconds: 8, bars: 128, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
  for (const { zoom, width, height } of ZOOMS) {
    await page.setViewportSize({ width, height: Math.max(height, 400) });
    await page.goto('/mix/current/edit');
    await page.getByRole('button', { name: 'Change', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Studio' }).click();
    await page.getByRole('button', { name: 'Open the Studio' }).click();
    await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click();
    // move focus by keyboard to the far end of a lane, which scrolls the grid
    await page.locator('.studio-cell').first().focus();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(400);
    const facts = await page.evaluate(() => {
      const focus = document.activeElement as HTMLElement;
      const box = focus.getBoundingClientRect();
      let scroller: HTMLElement | null = focus.parentElement;
      while (scroller && !(scroller.scrollWidth > scroller.clientWidth + 2)) scroller = scroller.parentElement;
      const area = scroller?.getBoundingClientRect();
      const name = [...document.querySelectorAll('.studio-name, .studio-side-name')].map((element) => element.getBoundingClientRect()).find((rect) => rect.top <= box.top + 2 && rect.bottom >= box.bottom - 2) ?? null;
      const ruler = document.querySelector('.studio-ruler')?.getBoundingClientRect() ?? null;
      return {
        cell: focus.getAttribute('aria-label'), cellVisible: !!area && box.left >= area.left - 1 && box.right <= area.right + 1,
        scrolled: scroller?.scrollLeft ?? 0, laneNameVisible: !!name && !!area && name.left >= area.left - 1 && name.right <= area.right + 1,
        laneNameOverlapsCell: !!name && name.right > box.left && name.left < box.right,
        rulerOnScreen: !!ruler && ruler.bottom > 0, pageOverflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    await shot(page, 'S4-0102-03', `studio64-zoom${zoom}-scrolled`);
    record({ task: 'S4-0102-03', zoom, ...facts });
    await page.keyboard.press('Escape');
  }
});

test('S4-0105-01 Library list at 320, 375, 768 and 1280 in both themes, stress names', async ({ page }) => {
  for (const theme of THEMES) {
    await useTheme(page, theme);
    for (const width of [320, 375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/library');
      await expect(page.locator('main#main')).toBeVisible();
      await page.waitForTimeout(1200);
      const facts = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('.song-open')].slice(0, 30);
        const clipped = rows.filter((row) => row.scrollWidth > row.clientWidth + 2 && getComputedStyle(row).textOverflow !== 'ellipsis').length;
        return { rows: rows.length, clipped, overflow: document.documentElement.scrollWidth - innerWidth };
      });
      await shot(page, 'S4-0105-01', `library-${theme}-${width}`);
      record({ task: 'S4-0105-01', theme, width, ...facts });
    }
  }
});
