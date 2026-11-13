import { expect, Page, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * S4-0090-09 and S4-0094-09: with Windows forced colours (emulated in Edge), selection, toggles,
 * disabled controls and overlay edges stay discernible, and every main route is captured for the
 * owner's forced-colours review. Captures land in this test's output folder as
 * forced-<route>.png. The flow-forced-colors.e2e.ts spec already covers the nav's current page
 * and focus rings. The static half is web/src/styles/s4-forced-colours.test.ts.
 */
const ROUTES = [
  { path: '/mixes', id: 'mixes' },
  { path: '/listen', id: 'listen' },
  { path: '/mix/current/edit', id: 'editor' },
  { path: '/library', id: 'library' },
  { path: '/discover', id: 'discover' },
  { path: '/workshop', id: 'workspace' },
] as const;

test.beforeEach(async ({ request }) => resetMix(request));

const settle = async (page: Page) => {
  await expect(page.locator('main#main:not([aria-busy="true"])').locator('h1, h2').first()).toBeVisible();
  await page.waitForTimeout(150);
};

/** what a system colour keyword resolves to on this machine, for comparison */
const system = (page: Page, keyword: string) => page.evaluate((word) => {
  const probe = document.createElement('span');
  probe.style.color = word;
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}, keyword);

const edge = (page: Page, selector: string) => page.locator(selector).first().evaluate((node) => {
  const style = getComputedStyle(node);
  return {
    border: style.borderTopStyle !== 'none' && parseFloat(style.borderTopWidth) >= 1,
    borderColour: style.borderTopColor,
    outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1,
    outlineColour: style.outlineColor,
    colour: style.color,
  };
});

test('every main route is captured under forced colours with its text in a real colour', async ({ page }, info) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const route of ROUTES) {
    await page.goto(route.path);
    await settle(page);
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
    const invisible = await page.locator('main button:visible, main a[href]:visible, main [role="tab"]:visible').evaluateAll((nodes) =>
      nodes.filter((node) => {
        const style = getComputedStyle(node);
        return style.color === 'rgba(0, 0, 0, 0)' || style.visibility === 'hidden' || style.opacity === '0';
      }).map((node) => node.outerHTML.slice(0, 80)));
    expect(invisible, route.path).toEqual([]);
    await page.screenshot({ path: info.outputPath(`forced-${route.id}.png`), fullPage: true, animations: 'disabled', caret: 'hide' });
  }
});

test('a selected Library row keeps a solid Highlight outline under forced colours', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/library');
  await settle(page);
  const box = page.getByRole('checkbox', { name: /^Select recording/ }).first();
  await box.check();
  // while the row holds focus it shows the focus ring, outside the row, so focus and selection differ
  const focused = await page.locator('.library-rows .song-row.selected').first().evaluate((node) => {
    const style = getComputedStyle(node);
    return { offset: parseFloat(style.outlineOffset), style: style.outlineStyle };
  });
  expect(focused.style).toBe('solid');
  expect(focused.offset).toBeGreaterThan(0);
  await box.evaluate((node) => (node as HTMLElement).blur());
  const row = await edge(page, '.library-rows .song-row.selected');
  expect(row.outline).toBe(true);
  expect(row.outlineColour).toBe(await system(page, 'Highlight'));
  expect(await page.locator('.library-rows .song-row.selected').first().evaluate((node) => parseFloat(getComputedStyle(node).outlineOffset))).toBeLessThanOrEqual(0);
});

test('a pressed toggle draws a different edge from an unpressed one under forced colours', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/library');
  await settle(page);
  const pressed = page.locator(".library-layout button[aria-pressed='true'], .library-filters button[aria-pressed='true']");
  await expect(pressed.first()).toBeVisible();
  const on = await edge(page, ".library-layout button[aria-pressed='true'], .library-filters button[aria-pressed='true']");
  expect(on.border).toBe(true);
  expect(on.borderColour).toBe(await system(page, 'Highlight'));
  const offCount = await page.locator(".library-layout button[aria-pressed='false']").count();
  if (offCount > 0) {
    const off = await edge(page, ".library-layout button[aria-pressed='false']");
    expect(off.borderColour).not.toBe(on.borderColour);
  }
});

test('a disabled control reads as GrayText and an overlay keeps its edge under forced colours', async ({ page }, info) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/mixes');
  await settle(page);
  const grey = await system(page, 'GrayText');
  const disabled = page.locator('button:disabled:visible');
  if (await disabled.count() > 0) {
    expect(await disabled.first().evaluate((node) => getComputedStyle(node).color)).toBe(grey);
  }
  await page.getByRole('button', { name: 'Customize' }).click();
  const dialog = page.getByRole('dialog', { name: 'Shape the next mix' });
  await expect(dialog).toBeVisible();
  const panel = await edge(page, '.overlay-panel');
  expect(panel.border).toBe(true);
  expect(panel.borderColour).toBe(await system(page, 'CanvasText'));
  await page.screenshot({ path: info.outputPath('forced-shape-dialog.png'), animations: 'disabled', caret: 'hide' });
});
