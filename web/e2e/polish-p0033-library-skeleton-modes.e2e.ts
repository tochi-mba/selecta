import { expect, test, type Route } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * UI/UX polish ADR-0036 P0033 and P0043: the Library placeholder matches the loaded list's song/artist,
 * facts and readiness columns in every layout mode (list comfortable, list compact, cards) at phone,
 * tablet and desktop widths, and the swap from placeholder to songs does not move the page's controls.
 * MP-0297-01 (mp-0297-loading-and-recovery.e2e.ts) covers the default mode only.
 */
const LIBRARY = /\/api\/library\?/;
const MODES = [
  { name: 'list comfortable', prefs: { density: 'comfortable', libraryLayout: 'list' } },
  { name: 'list compact', prefs: { density: 'compact', libraryLayout: 'list' } },
  { name: 'cards', prefs: { density: 'comfortable', libraryLayout: 'cards' } },
] as const;

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request);
});

for (const mode of MODES) {
  test(`P0033 the Library placeholder matches the loaded ${mode.name} layout at every width`, async ({ page }) => {
    await page.addInitScript((prefs) => window.localStorage.setItem('selecta.prefs', JSON.stringify(prefs)), mode.prefs);
    for (const width of [320, 768, 1440]) {
      const at = `${mode.name} ${width}px`;
      await page.setViewportSize({ width, height: 900 });
      const held: Route[] = [];
      let open = false;
      await page.route(LIBRARY, (route) => (open ? route.fallback() : void held.push(route)));
      await page.goto('/library');
      const skeleton = page.locator('main .skeleton[aria-label="Loading your songs"]');
      await expect(skeleton).toHaveAttribute('data-revealed', 'true');
      await expect(skeleton).toHaveClass(mode.prefs.libraryLayout === 'cards' ? /skeleton-cards/ : /skeleton-library/);
      const controls = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main .library-density button, main .library-layout button, main input[type="search"]')]
        .map((node) => { const rect = node.getBoundingClientRect(); return { name: node.textContent?.trim() || node.getAttribute('aria-label') || node.getAttribute('placeholder'), left: rect.left, top: rect.top + scrollY, width: rect.width }; }));
      const placeholder = await skeleton.evaluate((node) => {
        const content = node.querySelector('.skeleton-content')!.getBoundingClientRect();
        const units = [...node.querySelectorAll('.skeleton-unit')].map((unit) => {
          const box = unit.getBoundingClientRect();
          const title = unit.querySelector('.skeleton-title')!.getBoundingClientRect();
          const meta = unit.querySelector('.skeleton-meta')!.getBoundingClientRect();
          return { left: box.left, top: box.top, width: box.width, height: box.height, titleLeft: title.left, titleRight: title.right, metaLeft: meta.left, metaTop: meta.top };
        });
        return { content: { left: content.left, top: content.top, width: content.width }, units };
      });
      const before = await controls();
      open = true;
      for (const route of held.splice(0)) await route.fallback();
      await page.unroute(LIBRARY);
      await expect(page.locator('.library-rows li').first()).toBeVisible();
      await expect(page.locator('main .skeleton')).toHaveCount(0);
      const loaded = await page.evaluate(() => {
        const list = document.querySelector('.library-rows')!.getBoundingClientRect();
        const rows = [...document.querySelectorAll('.library-rows > li')].slice(0, 6).map((row) => {
          const box = row.getBoundingClientRect();
          const name = row.querySelector('.song-name')!.getBoundingClientRect();
          const facts = row.querySelector('.song-columns')?.getBoundingClientRect();
          return { left: box.left, top: box.top, width: box.width, height: box.height, nameLeft: name.left, nameRight: name.right, factsLeft: facts?.left ?? 0, factsTop: facts?.top ?? 0 };
        });
        return { list: { left: list.left, top: list.top, width: list.width }, rows };
      });
      const after = await controls();

      // the block: same left edge and width, starting within a row of where the songs start
      expect(Math.abs(placeholder.content.left - loaded.list.left), `${at}: left edge`).toBeLessThanOrEqual(1);
      expect(Math.abs(placeholder.content.width - loaded.list.width), `${at}: width`).toBeLessThanOrEqual(1);
      expect(Math.abs(placeholder.content.top - loaded.list.top), `${at}: top`).toBeLessThanOrEqual(loaded.rows[0].height);

      // the columns
      const columns = (items: { left: number }[]) => new Set(items.map((item) => Math.round(item.left))).size;
      const [unit, row] = [placeholder.units[0], loaded.rows[0]];
      if (mode.prefs.libraryLayout === 'cards') {
        expect(columns(placeholder.units), `${at}: card columns`).toBe(columns(loaded.rows));
        expect(Math.abs(unit.width - row.width), `${at}: card width`).toBeLessThanOrEqual(2);
      } else {
        expect(columns(placeholder.units), `${at}: one column of rows`).toBe(1);
        expect(Math.abs(unit.width - row.width), `${at}: row width`).toBeLessThanOrEqual(1);
        expect(Math.abs(unit.titleLeft - row.nameLeft), `${at}: song/artist column edge`).toBeLessThanOrEqual(16);
        // facts beside the title when the loaded row puts them beside it, below when it stacks them
        const beside = row.factsLeft >= row.nameRight - 1;
        expect(unit.metaLeft >= unit.titleRight - 1, `${at}: facts column ${beside ? 'beside' : 'below'} the title`).toBe(beside);
        // row height within a quarter of a typical (median) loaded row, so the page does not jump by whole rows
        const heights = loaded.rows.map((item) => item.height).sort((a, b) => a - b);
        const typical = heights[Math.floor(heights.length / 2)];
        expect(unit.height / typical, `${at}: row height ${unit.height} vs ${typical}`).toBeGreaterThan(0.75);
        expect(unit.height / typical, `${at}: row height ${unit.height} vs ${typical}`).toBeLessThan(1.33);
      }

      // P0043: the controls above the list never move when the songs arrive
      expect(after.length, `${at}: controls`).toBeGreaterThan(0);
      for (const control of after) {
        const was = before.find((item) => item.name === control.name);
        expect(was, `${at}: ${control.name} appeared late`).toBeTruthy();
        expect(Math.abs(control.left - was!.left), `${at}: ${control.name} jumped sideways`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(control.top - was!.top), `${at}: ${control.name} jumped up or down`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(control.width - was!.width), `${at}: ${control.name} changed width`).toBeLessThanOrEqual(0.5);
      }
    }
  });
}
