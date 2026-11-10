import { expect, Page, test } from '@playwright/test';
import { resetMix } from './helpers';

// Flow SF-0201-06 and SF-0204-06: with the operating system's colours forced (Windows High
// Contrast, emulated here in Edge), controls stay visible and selection and focus stay two
// different, non-colour marks.

test.beforeEach(async ({ request }) => resetMix(request));

type Ring = { style: string; width: number; offset: number; border: string; text: string };

const ring = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((node): Ring => {
    const style = getComputedStyle(node);
    return {
      style: style.outlineStyle,
      width: parseFloat(style.outlineWidth) || 0,
      offset: parseFloat(style.outlineOffset) || 0,
      border: style.borderTopStyle,
      text: style.color,
    };
  });

test('forced colours keep controls visible, and selection and focus distinct', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/library');
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);

  // the page you're on is marked by an outline, not only by a colour the OS has taken away
  const current = await ring(page, ".nav a[aria-current='page']");
  expect(current.style).toBe('solid');
  expect(current.width).toBeGreaterThanOrEqual(2);
  const other = await ring(page, ".nav a:not([aria-current='page'])");
  expect(other.style === 'none' || other.width === 0).toBe(true);

  // every visible button still has its text in a real colour and is on screen
  const hidden = await page.locator('button:visible').evaluateAll((buttons) =>
    buttons.filter((button) => {
      const style = getComputedStyle(button);
      const box = button.getBoundingClientRect();
      return style.color === 'rgba(0, 0, 0, 0)' || style.visibility === 'hidden' || box.width < 1 || box.height < 1;
    }).length);
  expect(hidden).toBe(0);

  // focus by keyboard draws a thicker ring outside the control, so it never reads as "selected"
  await page.locator(".nav a[aria-current='page']").first().focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const node = document.activeElement as HTMLElement;
    const style = getComputedStyle(node);
    return { selected: node.getAttribute('aria-current') === 'page', width: parseFloat(style.outlineWidth) || 0, offset: parseFloat(style.outlineOffset) || 0, style: style.outlineStyle };
  });
  expect(focused.style).toBe('solid');
  expect(focused.width).toBeGreaterThanOrEqual(3);
  expect(focused.offset).toBeGreaterThan(0);
  expect(focused.width !== current.width || focused.offset !== current.offset).toBe(true);
});

test('forced colours keep the Listen transport and seek strip usable', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/listen');
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeVisible();
  const slider = page.getByRole('slider', { name: 'Where in the song' });
  await expect(slider).toBeVisible();
  await slider.focus();
  const strip = await ring(page, '.strip');
  expect(strip.style).not.toBe('none');
  expect(strip.width).toBeGreaterThan(0);
});
