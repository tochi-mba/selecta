import { expect, test, type Page } from '@playwright/test';

/**
 * Library rows skip layout while far off screen (content-visibility: auto) and stand in at an
 * estimated height, --library-row-estimate in web/src/styles/operations.css. The estimate used to be
 * 72px while a real row is 118 to 234px, so every row coming into view grew, the rows under it jumped,
 * and the scroll specs (MP-0291-07, P0103) were flaky on a loaded runner.
 * 1. The estimate matches the real row height in both layouts, both densities and every breakpoint.
 * 2. Jumping down a long library, the rows on screen don't move once the browser draws them.
 */

const WIDTHS = [320, 768, 1024, 1440];
const COMBOS = [
  { layout: 'list', density: 'comfortable' },
  { layout: 'list', density: 'compact' },
  { layout: 'cards', density: 'comfortable' },
  { layout: 'cards', density: 'compact' },
] as const;

async function open(page: Page, layout: string, density: string, width: number) {
  await page.addInitScript(([chosenLayout, chosenDensity]) => {
    localStorage.setItem('selecta.prefs', JSON.stringify({ libraryLayout: chosenLayout, density: chosenDensity }));
  }, [layout, density]);
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/library');
  await expect(page.locator('.library-rows .song-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-density', density);
  await expect(page.locator('.library-rows.library-cards')).toHaveCount(layout === 'cards' ? 1 : 0);
}

/** Resolves once the page and every row have stayed put for ten frames. */
const settle = (page: Page) => page.evaluate(() => new Promise<void>((settled) => {
  let last = '';
  let still = 0;
  const check = () => {
    const rows = [...document.querySelectorAll('.library-rows .song-row')];
    const now = `${window.scrollY}:${rows.map((row) => row.getBoundingClientRect().top).join(',')}`;
    still = now === last ? still + 1 : 0;
    last = now;
    if (still >= 10) settled();
    else requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}));

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('the row estimate matches a drawn row in every layout, density and breakpoint', async ({ page }) => {
  const report: string[] = [];
  for (const { layout, density } of COMBOS) {
    for (const width of WIDTHS) {
      await open(page, layout, density, width);
      const reading = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('.library-rows .song-row')];
        const estimate = parseFloat(getComputedStyle(rows[0]).getPropertyValue('--library-row-estimate'));
        // draw every row to read its real height, then hand the rows back to the browser
        for (const row of rows) row.style.contentVisibility = 'visible';
        const heights = rows.map((row) => row.getBoundingClientRect().height).sort((a, b) => a - b);
        for (const row of rows) row.style.contentVisibility = '';
        return { estimate, median: heights[Math.floor(heights.length / 2)], rows: rows.length };
      });
      report.push(`${layout} ${density} ${width}px: estimate ${reading.estimate}, median ${reading.median.toFixed(1)} over ${reading.rows} rows`);
      expect(Math.abs(reading.estimate - reading.median), `${layout} ${density} ${width}px: estimate ${reading.estimate} for a ${reading.median}px row`).toBeLessThanOrEqual(4);
    }
  }
  test.info().annotations.push({ type: 'heights', description: report.join('; ') });
});

test.describe('a long library', () => {
  test.beforeEach(async ({ page }) => {
    let template: Record<string, unknown> | null = null;
    await page.route('**/api/library?**', async (route) => {
      const url = new URL(route.request().url());
      if (!template) template = (await (await route.fetch()).json()).songs[0];
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const after = Number(url.searchParams.get('after') ?? 0);
      const total = 2000;
      const songs = Array.from({ length: Math.min(limit, total - after) }, (_, index) => ({
        ...template, id: 300_000 + after + index, title: `Long Night Take ${after + index + 1}`,
      }));
      await route.fulfill({ json: { songs, total, next: after + limit < total ? String(after + limit) : null } });
    });
  });

  for (const { layout, density } of COMBOS) {
    test(`rows on screen hold still as off-screen rows are drawn: ${layout}, ${density}`, async ({ page }) => {
      for (const width of WIDTHS) {
        await open(page, layout, density, width);
        await settle(page);
        for (const share of [0.35, 0.7]) {
          // Jump straight down, as a scrollbar drag or End would. The rows that land on screen have
          // never been drawn, so this first layout places them at the estimate. Read where they sit.
          const placed = await page.evaluate((fraction) => {
            window.scrollTo(0, Math.round(document.documentElement.scrollHeight * fraction));
            const rows = [...document.querySelectorAll('.library-rows .song-row')];
            return rows.flatMap((row, index) => {
              const box = row.getBoundingClientRect();
              return box.bottom > 0 && box.top < window.innerHeight ? [{ index, top: box.top }] : [];
            });
          }, share);
          expect(placed.length, `${width}px: nothing on screen after the jump`).toBeGreaterThan(0);
          // The browser now draws those rows at their real height. Nothing on screen may move.
          await settle(page);
          const moved = await page.evaluate((rows) => {
            const all = document.querySelectorAll('.library-rows .song-row');
            return Math.max(...rows.map(({ index, top }) => Math.abs(all[index].getBoundingClientRect().top - top)));
          }, placed);
          expect(moved, `${layout} ${density} ${width}px at ${share * 100}% down: a row on screen moved ${moved}px`).toBeLessThanOrEqual(4);
        }
      }
    });
  }
});
