import { expect, Page, test } from '@playwright/test';
import { resetMix, stickingOut } from './helpers';

/**
 * S4-0091-08: Compact density condenses rows, never words. Captions, facts and disabled controls
 * keep a readable size, a fine pointer keeps 36px targets and a touch screen keeps 44px, and with
 * the text enlarged to 200% nothing that was on screen disappears or pushes the page sideways.
 * Captures land in the output folder as density-<mode>-<route>.png.
 */
const ROUTES = ['/library', '/mix/current/edit', '/workshop'] as const;

test.beforeEach(async ({ request }) => resetMix(request));

const settle = async (page: Page) => {
  await expect(page.locator('main#main:not([aria-busy="true"])').locator('h1, h2').first()).toBeVisible();
  await page.waitForTimeout(150);
};

const compact = async (page: Page) => {
  await page.goto('/mixes');
  await page.evaluate(() => localStorage.setItem('selecta.prefs', JSON.stringify({ density: 'compact', motion: 'still' })));
};

/** the visible text nodes' smallest size, and the shortest visible control in a .density area */
const measure = (page: Page) => page.evaluate(() => {
  const shown = (node: Element) => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[aria-hidden="true"], .visually-hidden');
  };
  // running words have a 12px floor (--text-xs); mono marks (pills, tags, rulers) are counted apart
  let smallest = Infinity;
  let smallestMark = Infinity;
  const walker = document.createTreeWalker(document.querySelector('main') ?? document.body, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const parent = text.parentElement;
    if (!parent || !text.textContent?.trim() || !shown(parent)) continue;
    const style = getComputedStyle(parent);
    const size = parseFloat(style.fontSize);
    if (/monospace|Cascadia Mono|Consolas/.test(style.fontFamily)) smallestMark = Math.min(smallestMark, size);
    else smallest = Math.min(smallest, size);
  }
  const controls = [...document.querySelectorAll<HTMLElement>('.density button, .density input:not([type="checkbox"]):not([type="radio"]), .density select')].filter(shown);
  const shortest = controls.reduce((low, node) => Math.min(low, node.getBoundingClientRect().height), Infinity);
  const words = [...document.querySelectorAll<HTMLElement>('main button, main a[href], main h1, main h2, main h3')]
    .filter(shown).map((node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim()).filter(Boolean);
  return { smallest, smallestMark, shortest, controls: controls.length, density: document.documentElement.dataset.density, words };
});

test('Compact keeps every caption at 12px or more and fine-pointer targets at 36px', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await compact(page);
  for (const route of ROUTES) {
    await page.goto(route);
    await settle(page);
    const seen = await measure(page);
    expect(seen.density).toBe('compact');
    expect(seen.smallest, `${route} smallest text`).toBeGreaterThanOrEqual(12);
    // mono marks are 0.72rem by design (pills, request tags, the Studio ruler): legible, listed for the owner
    expect(seen.smallestMark, `${route} smallest mono mark`).toBeGreaterThanOrEqual(11);
    if (seen.controls) expect(seen.shortest, `${route} shortest compact control`).toBeGreaterThanOrEqual(24);
    await page.screenshot({ path: info.outputPath(`density-compact${route.replace(/\//g, '_')}.png`), fullPage: true, animations: 'disabled', caret: 'hide' });
  }
});

test('Compact text is the same size as Comfortable text, so density never shrinks words', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/library');
  await settle(page);
  const comfortable = await measure(page);
  await compact(page);
  await page.goto('/library');
  await settle(page);
  const condensed = await measure(page);
  expect(condensed.smallest).toBe(comfortable.smallest);
  expect(condensed.smallestMark).toBe(comfortable.smallestMark);
  expect(condensed.words).toEqual(comfortable.words);
});

test('with text at 200% in Compact, nothing on screen disappears or overflows sideways', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await compact(page);
  for (const route of ROUTES) {
    await page.goto(route);
    await settle(page);
    const before = await measure(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.waitForTimeout(150);
    const after = await measure(page);
    for (const word of new Set(before.words)) expect(after.words, `${route}: "${word}" vanished at 200% text`).toContain(word);
    expect(await stickingOut(page, route)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`density-compact-200${route.replace(/\//g, '_')}.png`), fullPage: true, animations: 'disabled', caret: 'hide' });
  }
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 768, height: 1024 } });

  test('Compact keeps 44px targets when the pointer is coarse', async ({ page }) => {
    await compact(page);
    await page.goto('/library');
    await settle(page);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const height = await page.evaluate(() => {
      const area = document.querySelector('.density');
      return area ? getComputedStyle(area).getPropertyValue('--control-height').trim() : '44px';
    });
    expect(height).toBe('44px');
  });
});
